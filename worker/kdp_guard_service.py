#!/usr/bin/env python3
"""
PublishGuard KDP Pre-Flight 26 项零风控合规审计服务。
提炼自实战封号复盘规则：
- 支持纯文本/HTML/EPUB 二进制包多模式体检
- 支持 Apple Books + OpenLibrary 全网书名查重与多笔名同域名关联拦截
- 输出结构化风险项、合规评分与词典级脱敏建议，供 Next.js 前后台与 Worker 共用
"""

from __future__ import annotations

import argparse
import html as _html
import io
import json
import posixpath
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import asdict, dataclass, field
from typing import Any
from urllib.parse import urlparse

from PIL import Image

# 亚马逊 KDP 官方 31 个顶级品类白名单（剔除旧版 BISAC 术语如 Body, Mind & Spirit）
VALID_KDP_PRIMARY_CATEGORIES: set[str] = {
    "Arts & Photography",
    "Biographies & Memoirs",
    "Business & Money",
    "Calendars",
    "Children's Books",
    "Christian Books & Bibles",
    "Comics & Graphic Novels",
    "Computers & Technology",
    "Cookbooks, Food & Wine",
    "Crafts, Hobbies & Home",
    "Education & Teaching",
    "Engineering & Transportation",
    "Health, Fitness & Dieting",
    "History",
    "Humor & Entertainment",
    "Law",
    "LGBTQ+",
    "Literature & Fiction",
    "Medical Books",
    "Mystery, Thriller & Suspense",
    "Parenting & Relationships",
    "Politics & Social Sciences",
    "Reference",
    "Religion & Spirituality",
    "Romance",
    "Science & Math",
    "Science Fiction & Fantasy",
    "Self-Help",
    "Sports & Outdoors",
    "Teen & Young Adult",
    "Travel",
}

# DSM-5 临床医学/精神诊断词与医疗速效宣称映射词典（规则 14 & 17）
DSM5_CLINICAL_REPLACEMENTS: list[tuple[str, str, str]] = [
    (r"\bpanic\s+attacks?\b", "panic attack(s)", "sensory overwhelm"),
    (r"\bacute\s+anxiety\b", "acute anxiety", "heightened cognitive friction"),
    (r"\bclinical\s+anxiety\b", "clinical anxiety", "persistent restlessness"),
    (r"\banxiety\s+disorder\b", "anxiety disorder", "chronic nervous tension"),
    (r"\binsomnia\b", "insomnia", "restless evenings"),
    (r"\bdepression\b", "depression", "low emotional momentum"),
    (r"\bptsd\b", "PTSD", "deep stress conditioning"),
    (r"\badhd\b", "ADHD", "scattered attentional patterns"),
    (r"\bbipolar\b", "bipolar", "rapid mood oscillations"),
    (r"\btrauma\b", "trauma", "past stress imprints"),
    (r"\bturn\s+off\s+anxiety\b", "turn off anxiety", "quiet everyday restlessness"),
    (r"\bcure\s+(?:anxiety|depression|insomnia|panic)\b", "cure clinical condition", "support mindful evening balance"),
    (r"\bdeflect\s+panic\b", "deflect panic", "soften sudden overwhelm"),
    (r"\bhealing\s+code\b", "healing code", "mindful restoration protocol"),
    (r"\bclinical\s+(?:diagnosis|treatment)\b", "clinical diagnosis/treatment", "reflective self-observation"),
    (r"\bsymptoms?\s+of\b", "symptom(s) of", "bodily cues of"),
    (r"\binstant\s+relief\b", "instant relief", "gradual somatic grounding"),
    (r"\b60[- ]second\s+miracle\b", "60-second miracle", "brief grounding pause"),
]

# 商业促销码与脱离书本剪裁道具高危词汇（规则 2 & 9）
PROMO_AND_PROP_PATTERNS: list[tuple[str, str, str]] = [
    (
        r"\bwelcome\d{1,2}\b",
        "Promotional discount code detected (e.g., WELCOME15). Do not print promo codes inside book pages.",
        "书内严禁包含优惠折扣码（如 WELCOME15）。",
    ),
    (
        r"\bpromo\s*code\b",
        "Promotional solicitation wording ('Promo Code') violates KDP Content Guidelines §5.1.2.",
        "书内严禁包含 Promo Code 商业促销引导。",
    ),
    (
        r"\bdiscount\s*code\b",
        "Discount code wording violates KDP in-book advertising rules.",
        "书内严禁包含 Discount Code。",
    ),
    (
        r"\bcoupon\b|\bvoucher\b",
        "Coupon or voucher wording detected inside manuscript/description.",
        "书内严禁出现 Coupon / Voucher 商业代金券。",
    ),
    (
        r"\b\d+\s*%\s*off\b",
        "Commercial discount percentage ('% OFF') detected inside book copy.",
        "书内严禁出现商业打折百分比（% OFF）。",
    ),
    (
        r"\bcut[- ]out\b|\bpocket\s*cards?\b|\bscissor\b",
        "Physical cut-out prop wording detected; avoid non-book game/card instructions.",
        "严禁包含虚线剪裁卡片或离线游戏道具。",
    ),
    (
        r"\babundance\s*cheque\b",
        "Financial imitation instrument ('Abundance Cheque') triggers review rejection.",
        "严禁包含仿金融支票凭证（Abundance Cheque）。",
    ),
]

# 伪造传统出版社印记与非自然人作者词（规则 10 & 11）
IMPERSONATION_PATTERNS: list[tuple[str, str, str]] = [
    (
        r"\blumina\s+(?:studio|sacred\s+press|publishing)\b",
        "Non-human publisher imprint wording ('Studio / Press / Publishing') risks Option 3 impersonation review.",
        "严禁出现非自然人 Studio / Press 虚假出版商印记。",
    ),
    (
        r"\b(?:new\s+york\s*[·•,]\s*london|paris\s*[·•,]\s*milan|san\s+francisco\s*[·•,]\s*new\s+jersey)\b",
        "Fictional multinational imprint city line detected on an independently published book.",
        "严禁在自主出版书籍中虚构传统跨国出版社城市地名。",
    ),
]

# 诱发平装书被人工审核误判为低内容打卡表（Low-Content Workbook）的高危词（规则 25）
WORKBOOK_TRIGGER_PATTERNS: list[tuple[str, str, str]] = [
    (
        r"\bscorecard\b",
        "Word 'Scorecard' may trigger KDP review mistaking non-fiction books for low-content workbooks.",
        "Scorecard 词汇易触发平装书被误判为低内容打卡表。",
    ),
    (
        r"\bbinary\s+score\b",
        "Word 'Binary Score' risks low-content workbook classification.",
        "Binary Score 评分词汇易触发人工退稿。",
    ),
    (
        r"\bdaily\s+ledger\b|\bledger\b",
        "Word 'Ledger' frequently triggers low-content logbook / ledger classification.",
        "Ledger 账簿/记录表词汇易误判为低内容记事本。",
    ),
    (
        r"\bprintable\s+worksheet\b|\bfill-in-the-blank\b",
        "Printable worksheets and fill-in-the-blank templates are ineligible for free KDP ISBNs.",
        "填空表/可打印练习表禁止申请免费 KDP ISBN。",
    ),
]

# 电子书正文中的商业/促销外链特征
PROMO_URL_PATTERN = re.compile(
    r"(?:coupon|promo|discount|voucher|checkout|buy|cart|aff(?:iliate)?|[?&](?:ref|utm_)=?)",
    re.IGNORECASE,
)

# 公式化副标题模版黑名单（规则 18 & 25）
FORMULAIC_SUBTITLE_PATTERNS: list[str] = [
    r"^A\s+\d+[- ]?(?:Minute|Day|Week)\s+Neuroscience\s+Guide\s+to\s+",
    r"^A\s+Practical\s+Field\s+Guide\s+to\s+",
    r"^The\s+Ultimate\s+Step[- ]by[- ]Step\s+Guide\s+to\s+",
]


def _norm_lang(lang: str | None) -> str:
    """规范化审计报告语言，默认输出英文，仅明确传 `zh` 时返回简体中文。"""
    return "zh" if str(lang or "en").strip().lower().startswith("zh") else "en"


def _tx(lang: str, en_text: str, zh_text: str) -> str:
    """按目标语言选择对应文案，避免在业务检查中重复分支代码。"""
    return zh_text if lang == "zh" else en_text


@dataclass
class GuardFinding:
    """单条审计风险或警告明细。"""

    code: str
    severity: str  # error | warning
    rule_ref: str
    message: str
    matched_text: str = ""
    suggestion: str = ""
    rule_tier: str = "risk_advisory"  # platform_spec | risk_advisory


@dataclass
class GuardAuditResult:
    """26 项合规扫描完整输出。"""

    passed: bool
    score: int
    mode: str
    word_count: int
    errors: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[dict[str, Any]] = field(default_factory=list)
    collisions: dict[str, Any] = field(default_factory=dict)
    suggestions: list[dict[str, str]] = field(default_factory=list)
    checks_not_run: list[dict[str, str]] = field(default_factory=list)
    extracted_meta: dict[str, str] = field(default_factory=dict)
    extracted_excerpt: str = ""


def strip_html_tags(raw_text: str) -> str:
    """剔除 HTML 标签，仅提取纯正文用于词数统计与语义审计。"""
    cleaned = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw_text, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def count_words(text: str) -> int:
    """统计英文与通用词数。"""
    plain = strip_html_tags(text)
    if not plain:
        return 0
    return len(re.findall(r"[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|[\u4e00-\u9fff]", plain))


def normalize_title_tokens(title: str) -> str:
    """标准化主标题用于跨平台精确碰撞比对。"""
    return re.sub(r"[^a-z0-9\s]", "", title.lower()).strip()


def check_live_title_collisions(title: str, timeout_sec: float = 4.0) -> dict[str, Any]:
    """实时检索 Apple Books 与 OpenLibrary 公开接口，避免主书名直接撞车成熟畅销书（规则 12 & 18）。"""
    clean_title = title.strip()
    if not clean_title:
        return {"checked": False, "exact_matches": [], "similar_titles": [], "sources": []}

    encoded = urllib.parse.quote(clean_title)
    norm_target = normalize_title_tokens(clean_title)
    exact_matches: list[dict[str, str]] = []
    similar_titles: list[dict[str, str]] = []
    checked_sources: list[str] = []

    # 1. Apple Books API（免密钥、稳定、反应快）
    try:
        url = f"https://itunes.apple.com/search?term={encoded}&entity=ebook&limit=8"
        req = urllib.request.Request(url, headers={"User-Agent": "PublishGuard/1.0"})
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="ignore"))
            checked_sources.append("apple_books")
            for item in payload.get("results", []):
                found = str(item.get("trackName") or "").strip()
                author = str(item.get("artistName") or "").strip()
                if not found:
                    continue
                norm_found = normalize_title_tokens(found)
                entry = {"title": found, "author": author, "source": "Apple Books"}
                if norm_found == norm_target or (
                    len(norm_target) >= 8 and norm_found.startswith(norm_target + ":")
                ):
                    exact_matches.append(entry)
                elif len(similar_titles) < 6:
                    similar_titles.append(entry)
    except Exception:
        pass

    # 2. OpenLibrary Search API
    try:
        url = f"https://openlibrary.org/search.json?title={encoded}&limit=6"
        req = urllib.request.Request(url, headers={"User-Agent": "PublishGuard/1.0"})
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="ignore"))
            checked_sources.append("openlibrary")
            for doc in payload.get("docs", []):
                found = str(doc.get("title") or "").strip()
                authors = doc.get("author_name") or []
                author = str(authors[0]) if authors else "Unknown"
                if not found:
                    continue
                norm_found = normalize_title_tokens(found)
                entry = {"title": found, "author": author, "source": "OpenLibrary"}
                if norm_found == norm_target:
                    exact_matches.append(entry)
                elif len(similar_titles) < 8:
                    similar_titles.append(entry)
    except Exception:
        pass

    return {
        "checked": len(checked_sources) > 0,
        "sources": checked_sources,
        "exact_matches": exact_matches,
        "similar_titles": similar_titles,
    }


def _scan_text_block(
    *,
    plain_text: str,
    raw_html_or_css: str,
    mode: str,
    lang: str,
    findings: list[GuardFinding],
    suggestions: list[dict[str, str]],
) -> None:
    """对文本与样式代码执行 26 条核心违禁与风控扫描。"""
    lowered = plain_text.lower()

    # 规则 14 & 17：DSM-5 临床诊断词与医疗根治词清零
    for pattern, label, replacement in DSM5_CLINICAL_REPLACEMENTS:
        matches = list(re.finditer(pattern, plain_text, flags=re.IGNORECASE))
        if matches:
            sample = matches[0].group(0)
            findings.append(
                GuardFinding(
                    code="CLINICAL_MEDICAL_TERM",
                    severity="error",
                    rule_ref="PublishGuard Advisory #14 & #17",
                    rule_tier="risk_advisory",
                    message=_tx(
                        lang,
                        f"Matched clinical/medical claim term `{label}` ({len(matches)} occurrence(s)), which risks KDP unsubstantiated medical claim flags.",
                        f"命中临床/医疗诊断敏感词 `{label}`（共 {len(matches)} 处），易被 KDP 判处未经实证的医疗宣称。",
                    ),
                    matched_text=sample,
                    suggestion=_tx(
                        lang,
                        f"Replace with neutral lifestyle wording: `{replacement}`",
                        f"建议脱敏替换为学术中性表达：`{replacement}`",
                    ),
                )
            )
            suggestions.append({"original": sample, "replacement": replacement})

    # 规则 2 & 9：促销折扣券与剪裁道具
    for pattern, en_msg, zh_msg in PROMO_AND_PROP_PATTERNS:
        m = re.search(pattern, lowered, flags=re.IGNORECASE)
        if m:
            findings.append(
                GuardFinding(
                    code="COMMERCIAL_PROMO_OR_PROP",
                    severity="error",
                    rule_ref="KDP Content Guidelines §5.1.2",
                    rule_tier="platform_spec",
                    message=_tx(lang, en_msg, zh_msg),
                    matched_text=m.group(0),
                    suggestion=_tx(
                        lang,
                        "Remove promo codes, vouchers, or cut-out prop instructions; link readers only to a neutral companion page after purchase.",
                        "删除优惠券或剪纸道具描述，改为纯学术阅读伴读资源引导。",
                    ),
                )
            )

    # 规则 10 & 11：仿冒出版社印记与城市地名
    for pattern, en_msg, zh_msg in IMPERSONATION_PATTERNS:
        m = re.search(pattern, lowered, flags=re.IGNORECASE)
        if m:
            findings.append(
                GuardFinding(
                    code="IMPERSONATION_IMPRINT",
                    severity="error",
                    rule_ref="PublishGuard Advisory #10 & #11",
                    rule_tier="risk_advisory",
                    message=_tx(lang, en_msg, zh_msg),
                    matched_text=m.group(0),
                    suggestion=_tx(
                        lang,
                        "Standardize copyright/back cover imprint as `Independently published by [Author Full Name]`.",
                        "统一标注为 `Independently published by [Author Full Name]`。",
                    ),
                )
            )

    # 规则 25：平装书诱发低内容打卡表误判词
    if mode in ("paperback", "dual"):
        for pattern, en_msg, zh_msg in WORKBOOK_TRIGGER_PATTERNS:
            m = re.search(pattern, plain_text, flags=re.IGNORECASE)
            if m:
                findings.append(
                    GuardFinding(
                        code="WORKBOOK_TRIGGER_LEXICON",
                        severity="error",
                        rule_ref="KDP Low-Content Policy / Advisory #25",
                        rule_tier="risk_advisory",
                        message=_tx(lang, en_msg, zh_msg),
                        matched_text=m.group(0),
                        suggestion=_tx(
                            lang,
                            "Use prose-oriented non-fiction terms such as `Daily Observation` or `Reflection Guide`.",
                            "改用 `Daily Observation` / `Reflection Guide` 等非虚构专著表述。",
                        ),
                    )
                )

    # 规则 25：CSS 矩形边框方框检查（`.prompt-card` 等禁用四周边框与灰底）
    box_matches = re.findall(
        r"\.(?:prompt-card|exercise-block|worksheet-box)[^{]*\{[^}]*(?:border\s*:|background(?:-color)?\s*:\s*#f)",
        raw_html_or_css,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if box_matches:
        findings.append(
            GuardFinding(
                code="RECTANGULAR_BOX_CSS",
                severity="error",
                rule_ref="PublishGuard Advisory #25",
                rule_tier="risk_advisory",
                message=_tx(
                    lang,
                    "Detected boxed card CSS with full borders or light-gray fills (e.g., `.prompt-card { border: ... }`), which causes print reviewers to misclassify books as low-content workbooks.",
                    "检测到内页样式中对卡片区块使用了四周边框或浅灰底色（如 `.prompt-card { border: ... }`），平装书缩略图审核极易将其误判为低内容记事本！",
                ),
                matched_text=box_matches[0][:80],
                suggestion=_tx(
                    lang,
                    "Switch to borderless editorial typography or use only a subtle `border-left` accent bar.",
                    "改用纯无边框段落排版，或仅允许 `border-left` 左侧细竖线引用样式。",
                ),
            )
        )

    # 规则 20：电子书外链按用途区分（促销外链硬阻断，读者辅助资源链接转为提醒）
    if mode in ("ebook", "dual"):
        ext_urls = re.findall(
            r'<a\b[^>]*\bhref=["\'](https?://[^"\']+)["\']',
            raw_html_or_css,
            flags=re.IGNORECASE,
        )
        promo_urls = [u for u in ext_urls if PROMO_URL_PATTERN.search(u)]
        resource_urls = [u for u in ext_urls if not PROMO_URL_PATTERN.search(u)]

        if promo_urls:
            findings.append(
                GuardFinding(
                    code="EBOOK_PROMO_HYPERLINK",
                    severity="error",
                    rule_ref="KDP Content Guidelines §5.1.2",
                    rule_tier="platform_spec",
                    message=_tx(
                        lang,
                        f"Detected {len(promo_urls)} promotional or affiliate clickable hyperlink(s) inside eBook content.",
                        f"电子书内检测到 {len(promo_urls)} 个带促销/返佣/优惠参数的可点击外部超链接！",
                    ),
                    matched_text=promo_urls[0],
                    suggestion=_tx(
                        lang,
                        "Remove commercial or affiliate links from interior pages; keep only reader-helpful companion resources.",
                        "移除商业促销与返佣外链，仅保留纯净的读者伴读资源。",
                    ),
                )
            )
        if resource_urls:
            findings.append(
                GuardFinding(
                    code="EBOOK_EXTERNAL_HYPERLINK",
                    severity="warning",
                    rule_ref="PublishGuard Advisory #20",
                    rule_tier="risk_advisory",
                    message=_tx(
                        lang,
                        f"Found {len(resource_urls)} external reader-resource hyperlink(s). KDP permits useful companion links, but automated bots reject links returning HTTP 429/404 or redirect chains.",
                        f"电子书内检测到 {len(resource_urls)} 个可点击读者资源链接。KDP 允许有助于读者的伴读/参考链接，但爬虫若遇 HTTP 429/404 或多跳重定向会触发死链退稿。",
                    ),
                    matched_text=resource_urls[0],
                    suggestion=_tx(
                        lang,
                        "Ensure the URL returns direct HTTP 200 to bots without redirects, or display plain-text domain instructions alongside a 2D QR code.",
                        "确保外链对无 Cookie 爬虫直接返回 200 OK，或改为纯文本域名展示（如 `Visit example.com/audio`）。",
                    ),
                )
            )

        if re.search(r"display\s*:\s*flex", raw_html_or_css, flags=re.IGNORECASE):
            findings.append(
                GuardFinding(
                    code="KINDLE_95_PERCENT_FLEX",
                    severity="warning",
                    rule_ref="Kindle Rendering Advisory",
                    rule_tier="risk_advisory",
                    message=_tx(
                        lang,
                        "CSS contains `display: flex`, which can hang older Kindle rendering engines around 95% progress in Kindle Previewer.",
                        "电子书样式中包含 `display: flex`，部分老旧 Kindle 渲染引擎会卡在 95% 进度无法通过 Previewer。",
                    ),
                    matched_text="display: flex",
                    suggestion=_tx(
                        lang,
                        "Use standard semantic flow layout (`block` with margin/padding).",
                        "改为标准语义化流式块级排版（block + margin/padding）。",
                    ),
                )
            )
        if re.search(r"position\s*:\s*absolute", raw_html_or_css, flags=re.IGNORECASE):
            findings.append(
                GuardFinding(
                    code="KINDLE_95_PERCENT_ABS",
                    severity="warning",
                    rule_ref="Kindle Rendering Advisory",
                    rule_tier="risk_advisory",
                    message=_tx(
                        lang,
                        "CSS contains `position: absolute`, which causes overlapping text or hang failures in reflowable Kindle layouts.",
                        "电子书样式中包含 `position: absolute`，流式排版中会导致文字重叠或解析挂起。",
                    ),
                    matched_text="position: absolute",
                    suggestion=_tx(
                        lang,
                        "Remove absolute positioning and rely on standard document flow.",
                        "移除绝对定位，改用常规文本流。",
                    ),
                )
            )


def run_preflight_audit(
    *,
    title: str = "",
    subtitle: str = "",
    description: str = "",
    author_name: str = "",
    primary_category: str = "",
    manuscript_text: str = "",
    companion_domain: str = "",
    other_pen_domains: list[str] | None = None,
    existing_pen_titles: list[str] | None = None,
    mode: str = "dual",
    lang: str = "en",
    check_live_collisions: bool = True,
    collision_override: dict[str, Any] | None = None,
    enforce_min_words: bool = False,
) -> GuardAuditResult:
    """
    执行完整 26 项 KDP 零风控审计。
    - `enforce_min_words=True` 时用于出版编译放行（强制要求 ≥15,000 词）；
    - 公域快检单段文案时可设 `enforce_min_words=False`，仍提示体量过薄警告。
    """
    lang_norm = _norm_lang(lang)
    findings: list[GuardFinding] = []
    suggestions: list[dict[str, str]] = []
    checks_not_run: list[dict[str, str]] = []

    # 1. 标题与副标题合规：区分 KDP 官方 200 字符硬限与可读性建议（规则 3 & 18 & 25）
    clean_title = title.strip()
    clean_sub = subtitle.strip()
    combined_title_len = len(clean_title) + len(clean_sub)
    if combined_title_len >= 200:
        findings.append(
            GuardFinding(
                code="TITLE_SUBTITLE_COMBINED_OVER_200",
                severity="error",
                rule_ref="Amazon KDP Official Title Spec",
                rule_tier="platform_spec",
                message=_tx(
                    lang_norm,
                    f"Combined title + subtitle length is {combined_title_len} characters. Amazon KDP requires Title + Subtitle combined to be under 200 characters.",
                    f"主书名与副标题合计 {combined_title_len} 字符，违反 Amazon KDP 官方硬性规定（主副标题合计必须少于 200 字符）。",
                ),
                matched_text=f"{clean_title}: {clean_sub}"[:120],
                suggestion=_tx(
                    lang_norm,
                    "Shorten title and subtitle so their combined length stays strictly under 200 characters (recommended <= 160 chars).",
                    "请精简主副标题，确保两者合计严格少于 200 字符（建议控制在 160 字符内）。",
                ),
            )
        )

    if clean_title:
        if len(clean_title) > 120:
            findings.append(
                GuardFinding(
                    code="TITLE_TOO_LONG",
                    severity="warning",
                    rule_ref="PublishGuard Advisory #3",
                    rule_tier="risk_advisory",
                    message=_tx(
                        lang_norm,
                        f"Main title is {len(clean_title)} characters long, leaving very little budget inside KDP's 200-char combined limit.",
                        f"主书名长度达 {len(clean_title)} 字符，极易挤压副标题字符配额并稀释搜索权重。",
                    ),
                    matched_text=clean_title,
                    suggestion=_tx(
                        lang_norm,
                        "Keep main title crisp (typically 20–75 characters) and place descriptive context in the subtitle.",
                        "主书名应凝练有力，建议控制在 60~80 字符以内。",
                    ),
                )
            )
        if ":" in clean_title and not clean_sub:
            findings.append(
                GuardFinding(
                    code="TITLE_COLON_STUFFING",
                    severity="warning",
                    rule_ref="PublishGuard Advisory #3",
                    rule_tier="risk_advisory",
                    message=_tx(
                        lang_norm,
                        "Main title contains a colon while Subtitle is empty. Confirm subtitle phrases belong in the separate KDP Subtitle field.",
                        "主书名内包含冒号，请确认副标题是否拆入 Subtitle 字段而非堆在主标题内。",
                    ),
                    matched_text=clean_title,
                    suggestion=_tx(
                        lang_norm,
                        "Move text after ':' into the dedicated Subtitle input.",
                        "将冒号后的补充说明拆分填写至 Subtitle 字段。",
                    ),
                )
            )

    if clean_sub:
        if len(clean_sub) > 110:
            findings.append(
                GuardFinding(
                    code="SUBTITLE_OVER_110",
                    severity="warning",
                    rule_ref="PublishGuard Advisory #3",
                    rule_tier="risk_advisory",
                    message=_tx(
                        lang_norm,
                        f"Subtitle is {len(clean_sub)} characters long. While KDP checks Title + Subtitle < 200 total, subtitles above ~110 chars often truncate on store cards.",
                        f"副标题长 {len(clean_sub)} 字符（虽未超官方总长 200，但超过 110 字符在详情页易被折断展示）。",
                    ),
                    matched_text=clean_sub,
                    suggestion=_tx(
                        lang_norm,
                        "Trim subtitle to 80–100 characters for cleaner store display.",
                        "建议精简副标题至 80~100 字符以内以获最佳展示效果。",
                    ),
                )
            )
        if clean_sub.count(":") >= 2 or clean_sub.count("|") >= 1:
            findings.append(
                GuardFinding(
                    code="SUBTITLE_MULTI_COLON",
                    severity="error",
                    rule_ref="KDP Keyword Stuffing Policy",
                    rule_tier="platform_spec",
                    message=_tx(
                        lang_norm,
                        "Subtitle uses multiple colons or pipe separators ('|'), a primary trigger for KDP keyword-stuffing rejections.",
                        "副标题存在多重冒号或竖线分隔符，属于典型 SEO 堆砌特征。",
                    ),
                    matched_text=clean_sub,
                    suggestion=_tx(
                        lang_norm,
                        "Write one natural sentence fragment without pipe delimiters or chained colons.",
                        "删除多余冒号与 `|` 分隔符，使用单一自然语句。",
                    ),
                )
            )
        for pat in FORMULAIC_SUBTITLE_PATTERNS:
            if re.search(pat, clean_sub, flags=re.IGNORECASE):
                findings.append(
                    GuardFinding(
                        code="SUBTITLE_FORMULAIC_TEMPLATE",
                        severity="error",
                        rule_ref="PublishGuard Advisory #18 & #25",
                        rule_tier="risk_advisory",
                        message=_tx(
                            lang_norm,
                            "Subtitle matches a high-frequency formulaic pattern across AI books, elevating repetitive-content review risk.",
                            "副标题命中高度模版化高频句式，多本连发极易被平台识别为流水线批量图书。",
                        ),
                        matched_text=clean_sub,
                        suggestion=_tx(
                            lang_norm,
                            "Rephrase with a domain-specific monograph angle instead of generic 'Guide to ...' phrasing.",
                            "改用具体方法论或专著视角改写副标题结构。",
                        ),
                    )
                )
                break

    # 2. 作者姓名防非自然人机构词汇（规则 10）
    if author_name.strip():
        bad_author_tokens = re.findall(
            r"\b(?:studio|press|publishing|team|lab|official|inc|llc|group)\b",
            author_name,
            flags=re.IGNORECASE,
        )
        if bad_author_tokens:
            findings.append(
                GuardFinding(
                    code="NON_HUMAN_AUTHOR_NAME",
                    severity="error",
                    rule_ref="KDP Contributor Guidelines",
                    rule_tier="platform_spec",
                    message=_tx(
                        lang_norm,
                        f"Author name includes institutional token `{bad_author_tokens[0]}`, which triggers KDP contributor-impersonation verification.",
                        f"作者姓名包含非自然人机构后缀 `{bad_author_tokens[0]}`，极易触发仿冒第三方机构审查（Option 3）。",
                    ),
                    matched_text=author_name,
                    suggestion=_tx(
                        lang_norm,
                        "Use a realistic First + Last human pen name (e.g., `Evelyn Vance`) matching cover, title page, and KDP metadata 100%.",
                        "使用真实感单人笔名（First Name + Last Name），例如 `Evelyn Vance`，并与封面完全一致。",
                    ),
                )
            )

    # 3. 顶级类目校验（规则 8）
    if primary_category.strip():
        if primary_category.strip() not in VALID_KDP_PRIMARY_CATEGORIES:
            findings.append(
                GuardFinding(
                    code="INVALID_KDP_CATEGORY",
                    severity="error",
                    rule_ref="Amazon KDP Browse Category Spec",
                    rule_tier="platform_spec",
                    message=_tx(
                        lang_norm,
                        f"Primary category `{primary_category}` is not in Amazon KDP's 31 current top-level store categories (legacy BISAC labels such as 'Body, Mind & Spirit' are rejected).",
                        f"顶级主类目 `{primary_category}` 不在亚马逊 KDP 官方 31 个顶级大类白名单内（禁止使用过时的 BISAC 术语如 Body, Mind & Spirit）。",
                    ),
                    matched_text=primary_category,
                    suggestion=_tx(
                        lang_norm,
                        "Select `Self-Help`, `Religion & Spirituality`, `Health, Fitness & Dieting`, or another valid top-level KDP category.",
                        "身心灵/个人成长请选择 `Religion & Spirituality` 或 `Self-Help`。",
                    ),
                )
            )

    # 4. 图书描述纯净度（规则 13）
    if description.strip():
        if re.search(r"https?://", description, flags=re.IGNORECASE):
            findings.append(
                GuardFinding(
                    code="DESCRIPTION_EXTERNAL_URL",
                    severity="error",
                    rule_ref="Amazon KDP Description Formatting Spec",
                    rule_tier="platform_spec",
                    message=_tx(
                        lang_norm,
                        "Amazon KDP book description field prohibits `http://` or `https://` URLs and HTML external links.",
                        "KDP 图书描述（Description）中物理禁止包含任何 http/https 外部网址，保存时会被后台拒绝或触发引流惩罚。",
                    ),
                    matched_text="http(s)://...",
                    suggestion=_tx(
                        lang_norm,
                        "Remove all URLs from the book description; keep companion website directions inside interior front/back matter only.",
                        "彻底删除图书简介中的 URL，改为纯内容卖点展示。",
                    ),
                )
            )

    # 5. SaaS 独家：跨笔名关联域名隔离警告
    clean_domain = companion_domain.strip().lower()
    if clean_domain:
        parsed = urlparse(clean_domain if "://" in clean_domain else f"https://{clean_domain}")
        host = (parsed.netloc or parsed.path).split("/")[0].removeprefix("www.")
        normalized_others = {
            (urlparse(d if "://" in d else f"https://{d}").netloc or d).split("/")[0].removeprefix("www.").lower()
            for d in (other_pen_domains or [])
            if d.strip()
        }
        if host and host in normalized_others:
            findings.append(
                GuardFinding(
                    code="CROSS_ACCOUNT_DOMAIN_LINKAGE",
                    severity="error",
                    rule_ref="PublishGuard Brand Separation Advisory",
                    rule_tier="risk_advisory",
                    message=_tx(
                        lang_norm,
                        f"Domain `{host}` is already bound to another pen profile in your workspace. Reusing identical companion domains blurs brand separation.",
                        f"隔离提醒！域名 `{host}` 已被您的其他作者笔名使用。建议为不同笔名品牌保持独立的伴读域名。",
                    ),
                    matched_text=host,
                    suggestion=_tx(
                        lang_norm,
                        "Assign a distinct domain per pen name brand to keep reader touchpoints cleanly separated.",
                        "每个独立笔名品牌建议使用独立的伴读域名或清空复用域名。",
                    ),
                )
            )

    # 6. 合并所有文本域执行深层扫雷
    combined_raw = "\n".join([clean_title, clean_sub, description, manuscript_text])
    combined_plain = strip_html_tags(combined_raw)
    _scan_text_block(
        plain_text=combined_plain,
        raw_html_or_css=manuscript_text + "\n" + description,
        mode=mode,
        lang=lang_norm,
        findings=findings,
        suggestions=suggestions,
    )

    # 7. 字数体量判定（规则 15, 16, 22）
    wc = count_words(manuscript_text or description)
    if manuscript_text.strip():
        if wc < 15000:
            findings.append(
                GuardFinding(
                    code="THIN_CONTENT_UNDER_15K",
                    severity="error" if enforce_min_words else "warning",
                    rule_ref="PublishGuard Depth Standard #15 & #16",
                    rule_tier="risk_advisory",
                    message=_tx(
                        lang_norm,
                        f"Manuscript text has {wc:,} words (below our 15,000-word depth threshold). Short booklets risk low KENP engagement and 'Thin Content' customer complaints.",
                        f"当前手稿纯正文仅 {wc:,} 词（低于 15,000 词安全底线）。短小篇幅极易触发 Thin Content（单薄内容）负面体验反馈。",
                    ),
                    matched_text=f"{wc} words",
                    suggestion=_tx(
                        lang_norm,
                        "Expand into 18,000–22,000 words of substantive prose so 6×9 paperback buyers receive a solid ~100-page edition.",
                        "通过 PublishGuard 长文流水线扩写至 18,000～22,000 词深度专著体量。",
                    ),
                )
            )

    # 8. 全网书名防撞车检查（规则 12）
    collisions: dict[str, Any] = {"checked": False, "exact_matches": [], "similar_titles": [], "sources": []}
    if clean_title:
        if collision_override is not None:
            collisions = collision_override
        elif check_live_collisions:
            collisions = check_live_title_collisions(clean_title)

        if existing_pen_titles:
            norm_t = normalize_title_tokens(clean_title)
            for old_t in existing_pen_titles:
                if normalize_title_tokens(old_t) == norm_t:
                    collisions.setdefault("exact_matches", []).append(
                        {"title": old_t, "author": "Your Existing Workspace Book", "source": "Workspace History"}
                    )

        if collisions.get("exact_matches"):
            hit = collisions["exact_matches"][0]
            findings.append(
                GuardFinding(
                    code="TITLE_COLLISION_EXACT",
                    severity="error",
                    rule_ref="PublishGuard Collision Advisory #12",
                    rule_tier="risk_advisory",
                    message=_tx(
                        lang_norm,
                        f"Main title `{clean_title}` closely collides with existing book `{hit['title']}` ({hit['source']}), risking reader confusion or Option 1 impersonation flags.",
                        f"主书名 `{clean_title}` 与已有出版作品《{hit['title']}》（{hit['source']}）重名撞车，极易触发仿冒投诉（Option 1）！",
                    ),
                    matched_text=clean_title,
                    suggestion=_tx(
                        lang_norm,
                        "Differentiate the main title with a distinctive methodology or conceptual framing.",
                        "使用更具独创性的方法论组合词重构主标题。",
                    ),
                )
            )
    else:
        checks_not_run.append(
            {
                "code": "TITLE_COLLISION_SKIPPED",
                "title": _tx(lang_norm, "Live Catalog Title Collision Check", "全网书名防撞车检索"),
                "reason": _tx(
                    lang_norm,
                    "Skipped because Book Title was left blank.",
                    "未填写主书名（且 EPUB 中未读取到 `<dc:title>`），跳过全网书库比对。",
                ),
            }
        )

    if mode in ("paperback", "dual"):
        checks_not_run.append(
            {
                "code": "PRINT_GEOMETRY_NOT_VERIFIED",
                "title": _tx(lang_norm, "Print Trim, Bleed & Spine Wrap PDF Geometry", "平装印刷尺寸、出血与书脊 PDF 几何校核"),
                "reason": _tx(
                    lang_norm,
                    "Text/EPUB pre-flight does not inspect final interior/wrap PDF page margins or spine calculation. Verify in KDP Print Previewer before publishing.",
                    "纯文本/EPUB 预检无法核验最终排版 PDF 的页边距、出血位与书脊宽度，提交前需在 Amazon Print Previewer 预览确认。",
                ),
            }
        )
    if mode in ("ebook", "dual"):
        checks_not_run.append(
            {
                "code": "KINDLE_PREVIEWER_VISUAL",
                "title": _tx(lang_norm, "Amazon Kindle Previewer 3 Device Render", "Amazon 官方 Kindle Previewer 3 真机渲染检查"),
                "reason": _tx(
                    lang_norm,
                    "Automated static checks do not replace opening your final EPUB in official Amazon Kindle Previewer 3.",
                    "静态合规检查不能替代在 Amazon 官方 Kindle Previewer 3 中的逐页可视化加载确认。",
                ),
            }
        )
    checks_not_run.append(
        {
            "code": "AI_DISCLOSURE_DECLARATION",
            "title": _tx(lang_norm, "Amazon KDP AI-Generated Content Disclosure", "Amazon KDP AI 生成内容合规申报"),
            "reason": _tx(
                lang_norm,
                "Amazon KDP requires authors to explicitly declare AI-generated text, images, or translations during book setup.",
                "在 KDP 后台上架时，必须按平台要求如实勾选/申报书中是否包含 AI 生成的文本、图片或翻译内容。",
            ),
        }
    )

    # 汇总评分与分级
    errors = [asdict(f) for f in findings if f.severity == "error"]
    warnings = [asdict(f) for f in findings if f.severity == "warning"]
    penalty = len(errors) * 22 + len(warnings) * 8
    score = max(0, 100 - penalty)
    passed = len(errors) == 0

    # 去重建议
    seen_sug = set()
    dedup_suggestions = []
    for item in suggestions:
        key = (item["original"].lower(), item["replacement"].lower())
        if key not in seen_sug:
            seen_sug.add(key)
            dedup_suggestions.append(item)

    return GuardAuditResult(
        passed=passed,
        score=score,
        mode=mode,
        word_count=wc,
        errors=errors,
        warnings=warnings,
        collisions=collisions,
        suggestions=dedup_suggestions,
        checks_not_run=checks_not_run,
    )


MAX_EPUB_ZIP_BYTES = 15 * 1024 * 1024
MAX_EPUB_ENTRIES = 2000
MAX_EPUB_ENTRY_BYTES = 15 * 1024 * 1024
MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES = 60 * 1024 * 1024


class _ZipBombLimitError(ValueError):
    """EPUB 压缩包超出安全体积、条目数或解压膨胀上限。"""


def _xml_localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower() if "}" in tag else tag.lower()


def _safe_parse_xml(raw_bytes: bytes) -> ET.Element:
    """安全解析 container.xml / OPF，显式拒绝 DOCTYPE/ENTITY 实体注入。"""
    if re.search(rb"<!\s*(?:DOCTYPE|ENTITY)\b", raw_bytes, flags=re.IGNORECASE):
        raise ValueError("Disallowed DOCTYPE or ENTITY declaration in XML")
    return ET.fromstring(raw_bytes)


def _normalize_zip_rel_path(base_dir: str, href: str) -> str:
    raw_href = urllib.parse.unquote((href or "").split("#", 1)[0].split("?", 1)[0]).strip()
    joined = posixpath.join(base_dir, raw_href) if base_dir else raw_href
    norm = posixpath.normpath(joined.replace("\\", "/")).lstrip("/")
    if not norm or norm == "." or norm.startswith("..") or "/../" in norm:
        return ""
    return norm


def _safe_read_entry(zf: zipfile.ZipFile, info: zipfile.ZipInfo, budget: list[int]) -> bytes:
    """按严格字节预算读取单个 ZIP 条目，防止伪造头部引发解压炸弹 OOM。"""
    if info.file_size > MAX_EPUB_ENTRY_BYTES or info.file_size > budget[0]:
        raise _ZipBombLimitError("EPUB entry exceeds safe uncompressed byte limit")
    max_allowed = min(MAX_EPUB_ENTRY_BYTES, budget[0])
    with zf.open(info, "r") as stream:
        data = stream.read(max_allowed + 1)
    if len(data) > max_allowed:
        raise _ZipBombLimitError("EPUB uncompressed content exceeds safe budget")
    budget[0] -= len(data)
    return data


def audit_epub_bytes(epub_bytes: bytes, **kwargs: Any) -> GuardAuditResult:
    """解包上传的 EPUB 文件，严格校验尺寸/ZIP 炸弹上限及 container.xml->OPF->manifest->spine 引用链后执行全量检查。"""
    lang = _norm_lang(kwargs.pop("lang", "en"))
    mode = str(kwargs.pop("mode", "ebook") or "ebook")
    if mode not in ("ebook", "paperback", "dual"):
        mode = "ebook"
    extracted_title = str(kwargs.pop("title", "") or "").strip()
    extracted_author = str(kwargs.pop("author_name", "") or "").strip()
    extracted_lang = lang

    def _container_fail(
        code: str, msg_en: str, msg_zh: str, matched: str, sug_en: str, sug_zh: str
    ) -> GuardAuditResult:
        finding = GuardFinding(
            code=code,
            severity="error",
            rule_ref="EPUB 3 Package & Container Spec",
            rule_tier="platform_spec",
            message=_tx(lang, msg_en, msg_zh),
            matched_text=matched,
            suggestion=_tx(lang, sug_en, sug_zh),
        )
        return GuardAuditResult(
            passed=False,
            score=0,
            mode=mode,
            word_count=0,
            errors=[asdict(finding)],
            warnings=[],
            collisions={"checked": False, "exact_matches": [], "similar_titles": [], "sources": []},
            suggestions=[],
            checks_not_run=[],
        )

    if not epub_bytes:
        return _container_fail(
            "INVALID_EPUB_ARCHIVE",
            "Uploaded file is empty and cannot be parsed as an EPUB archive.",
            "上传文件为空，无法作为有效 EPUB 文件解析。",
            "empty file",
            "Upload a valid compiled .epub archive.",
            "请上传完整编译的 .epub 电子书文件。",
        )

    if len(epub_bytes) > MAX_EPUB_ZIP_BYTES:
        return _container_fail(
            "EPUB_TOO_LARGE",
            "Uploaded EPUB file exceeds the 15 MB safety limit.",
            "上传的 EPUB 文件超过 15 MB 安全体积上限。",
            f"{len(epub_bytes)} bytes",
            "Compress oversized images or split media assets so the EPUB stays under 15 MB.",
            "请压缩过大的图片资产，确保 EPUB 体积不超过 15 MB。",
        )

    extra_findings: list[GuardFinding] = []
    html_chunks: list[str] = []
    prose_chunks: list[str] = []

    try:
        with zipfile.ZipFile(io.BytesIO(epub_bytes), "r") as zf:
            infos = zf.infolist()
            if len(infos) > MAX_EPUB_ENTRIES:
                return _container_fail(
                    "EPUB_TOO_MANY_ENTRIES",
                    f"EPUB archive contains {len(infos)} entries, exceeding the 2,000-entry limit.",
                    f"EPUB 包内包含 {len(infos)} 个条目，超过 2,000 条安全上限。",
                    f"{len(infos)} entries",
                    "Remove unused resource files and re-export the EPUB cleanly.",
                    "请清理冗余资源文件后重新打包导出 EPUB。",
                )

            declared_total = sum(max(0, info.file_size) for info in infos)
            if declared_total > MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES:
                return _container_fail(
                    "EPUB_UNCOMPRESSED_LIMIT_EXCEEDED",
                    "EPUB uncompressed size exceeds the 60 MB archive expansion limit.",
                    "EPUB 解压后总大小超过 60 MB 安全上限，拒绝解析。",
                    f"{declared_total} bytes",
                    "Optimize embedded images and verify archive integrity.",
                    "请优化内嵌图片体积并确认压缩包无异常膨胀。",
                )

            remaining_budget = [MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES]
            names = [info.filename for info in infos]
            info_by_name: dict[str, zipfile.ZipInfo] = {}
            for info in infos:
                if info.filename.startswith("/") or ".." in info.filename.replace("\\", "/").split("/"):
                    return _container_fail(
                        "EPUB_UNSAFE_PATH",
                        f"Unsafe ZIP entry path `{info.filename}` detected.",
                        f"检测到不安全的压缩包路径 `{info.filename}`。",
                        info.filename,
                        "Repackage EPUB using standard relative container paths.",
                        "请使用标准相对路径重新打包 EPUB。",
                    )
                info_by_name[info.filename] = info

            if not names or names[0] != "mimetype":
                extra_findings.append(
                    GuardFinding(
                        code="EPUB_MIMETYPE_NOT_FIRST",
                        severity="error",
                        rule_ref="EPUB 3 Container Spec",
                        rule_tier="platform_spec",
                        message=_tx(
                            lang,
                            "EPUB container error: `mimetype` must be the very first entry in the ZIP archive.",
                            "EPUB 规范校验失败：`mimetype` 必须作为压缩包第一个文件存储。",
                        ),
                        matched_text=names[0] if names else "empty",
                        suggestion=_tx(
                            lang,
                            "Repackage EPUB with `mimetype` stored uncompressed as entry #0.",
                            "请将 `mimetype` 置于压缩包首个条目且设为 ZIP_STORED 无压缩存储。",
                        ),
                    )
                )
            else:
                mime_raw = _safe_read_entry(zf, infos[0], remaining_budget).decode("ascii", errors="ignore").strip()
                if mime_raw != "application/epub+zip":
                    extra_findings.append(
                        GuardFinding(
                            code="EPUB_INVALID_MIMETYPE",
                            severity="error",
                            rule_ref="EPUB 3 Container Spec",
                            rule_tier="platform_spec",
                            message=_tx(
                                lang,
                                f"Invalid EPUB `mimetype` contents: expected `application/epub+zip`, found `{mime_raw or 'empty'}`.",
                                f"EPUB `mimetype` 内容无效：期望为 `application/epub+zip`，实际为 `{mime_raw or '空'}`。",
                            ),
                            matched_text=mime_raw or "empty",
                            suggestion=_tx(
                                lang,
                                "Write exact ASCII bytes `application/epub+zip` into `mimetype`.",
                                "请确保 `mimetype` 文件内容严格为 `application/epub+zip`。",
                            ),
                        )
                    )
                if infos[0].compress_type != zipfile.ZIP_STORED:
                    extra_findings.append(
                        GuardFinding(
                            code="EPUB_MIMETYPE_COMPRESSED",
                            severity="error",
                            rule_ref="EPUB 3 Container Spec",
                            rule_tier="platform_spec",
                            message=_tx(
                                lang,
                                "`mimetype` entry is compressed; EPUB 3 specification strictly requires uncompressed (ZIP_STORED) storage.",
                                "`mimetype` 条目被压缩存储；EPUB 3 规范严格要求采用无压缩（ZIP_STORED）存储。",
                            ),
                            matched_text="compressed mimetype",
                            suggestion=_tx(
                                lang,
                                "Store `mimetype` with ZIP_STORED when packaging EPUB.",
                                "打包 EPUB 时必须为 `mimetype` 使用 ZIP_STORED 无压缩模式。",
                            ),
                        )
                    )

            # 1. 强校验 META-INF/container.xml -> .opf 引用链
            opf_path = ""
            container_info = info_by_name.get("META-INF/container.xml")
            if not container_info:
                extra_findings.append(
                    GuardFinding(
                        code="EPUB_MISSING_CONTAINER_XML",
                        severity="error",
                        rule_ref="EPUB 3 OCF Container Spec",
                        rule_tier="platform_spec",
                        message=_tx(
                            lang,
                            "Missing `META-INF/container.xml` pointer; readers and Kindle ingestion cannot locate the OPF package.",
                            "缺少必需的 `META-INF/container.xml` 容器索引文件，Kindle 与阅读器无法定位 OPF 包结构。",
                        ),
                        matched_text="META-INF/container.xml",
                        suggestion=_tx(
                            lang,
                            "Ensure a valid `META-INF/container.xml` pointing to the `.opf` package document is included.",
                            "请确保 EPUB 包含指向 `.opf` 包文档的标准 `META-INF/container.xml`。",
                        ),
                    )
                )
            else:
                try:
                    container_root = _safe_parse_xml(_safe_read_entry(zf, container_info, remaining_budget))
                    for elem in container_root.iter():
                        if _xml_localname(elem.tag) == "rootfile":
                            full_path = (elem.attrib.get("full-path") or "").strip()
                            media_type = (elem.attrib.get("media-type") or "").strip()
                            if full_path and (
                                not media_type or media_type == "application/oebps-package+xml"
                            ):
                                opf_path = _normalize_zip_rel_path("", full_path)
                                break
                    if not opf_path or opf_path not in info_by_name:
                        extra_findings.append(
                            GuardFinding(
                                code="EPUB_INVALID_CONTAINER_XML",
                                severity="error",
                                rule_ref="EPUB 3 OCF Container Spec",
                                rule_tier="platform_spec",
                                message=_tx(
                                    lang,
                                    "`META-INF/container.xml` does not point to an existing `.opf` package file.",
                                    "`META-INF/container.xml` 未指向包内实际存在的 `.opf` 元数据文件。",
                                ),
                                matched_text=opf_path or "missing rootfile",
                                suggestion=_tx(
                                    lang,
                                    "Fix `rootfile/@full-path` in `META-INF/container.xml` to match your OPF file.",
                                    "请修正 `META-INF/container.xml` 中 `rootfile` 的 `full-path` 路径。",
                                ),
                            )
                        )
                        opf_path = ""
                except _ZipBombLimitError:
                    raise
                except Exception as exc:
                    extra_findings.append(
                        GuardFinding(
                            code="EPUB_INVALID_CONTAINER_XML",
                            severity="error",
                            rule_ref="EPUB 3 OCF Container Spec",
                            rule_tier="platform_spec",
                            message=_tx(
                                lang,
                                f"`META-INF/container.xml` failed XML validation: {exc}",
                                f"`META-INF/container.xml` XML 语法校验失败：{exc}",
                            ),
                            matched_text="invalid container.xml",
                            suggestion=_tx(
                                lang,
                                "Regenerate a well-formed UTF-8 `META-INF/container.xml`.",
                                "请重新生成格式合规的 UTF-8 `META-INF/container.xml`。",
                            ),
                        )
                    )
                    opf_path = ""

            # 2. 强校验 OPF -> <manifest> -> <spine>
            spine_content_paths: list[str] = []
            css_paths: list[str] = []
            image_paths: list[str] = []

            if not opf_path:
                if container_info is None:
                    # 上面已报 MISSING_CONTAINER_XML，但若无 OPF 仍需显式标出缺失 OPF
                    extra_findings.append(
                        GuardFinding(
                            code="EPUB_MISSING_OPF",
                            severity="error",
                            rule_ref="EPUB 3 Package Spec",
                            rule_tier="platform_spec",
                            message=_tx(
                                lang,
                                "Missing `.opf` package document referenced by container.xml; required for Amazon KDP ingestion.",
                                "无法通过 container.xml 定位有效 `.opf` 包元数据文件，Amazon KDP 将拒收此书。",
                            ),
                            matched_text="missing .opf",
                            suggestion=_tx(
                                lang,
                                "Include a valid OPF manifest and spine via an EPUB 3 compiler.",
                                "请通过标准 EPUB 3 编译器生成完整的 OPF 清单与 Spine 结构。",
                            ),
                        )
                    )
            else:
                opf_dir = posixpath.dirname(opf_path)
                try:
                    opf_root = _safe_parse_xml(_safe_read_entry(zf, info_by_name[opf_path], remaining_budget))
                    manifest_by_id: dict[str, tuple[str, str]] = {}
                    spine_idrefs: list[str] = []

                    for elem in opf_root.iter():
                        lname = _xml_localname(elem.tag)
                        if lname == "title" and not extracted_title and (elem.text or "").strip():
                            raw_t = _html.unescape(elem.text or "").strip()
                            sub_kw = str(kwargs.get("subtitle") or "").strip()
                            if sub_kw and raw_t.lower().endswith(f": {sub_kw.lower()}"):
                                raw_t = raw_t[: -(len(sub_kw) + 2)].strip()
                            extracted_title = raw_t
                        elif lname == "creator" and not extracted_author and (elem.text or "").strip():
                            extracted_author = _html.unescape(elem.text or "").strip()
                        elif lname == "language" and (elem.text or "").strip():
                            extracted_lang = (elem.text or "").strip()[:20]
                        elif lname == "item":
                            item_id = (elem.attrib.get("id") or "").strip()
                            href = (elem.attrib.get("href") or "").strip()
                            mtype = (elem.attrib.get("media-type") or "").strip().lower()
                            if item_id and href:
                                resolved = _normalize_zip_rel_path(opf_dir, href)
                                manifest_by_id[item_id] = (resolved, mtype)
                                if mtype == "text/css" or resolved.lower().endswith(".css"):
                                    if resolved in info_by_name:
                                        css_paths.append(resolved)
                                elif mtype.startswith("image/") or resolved.lower().endswith((".png", ".jpg", ".jpeg")):
                                    if resolved in info_by_name:
                                        image_paths.append(resolved)
                        elif lname == "itemref":
                            idref = (elem.attrib.get("idref") or "").strip()
                            if idref:
                                spine_idrefs.append(idref)

                    if not manifest_by_id or not spine_idrefs:
                        extra_findings.append(
                            GuardFinding(
                                code="EPUB_INVALID_OPF_STRUCTURE",
                                severity="error",
                                rule_ref="EPUB 3 Package Spec",
                                rule_tier="platform_spec",
                                message=_tx(
                                    lang,
                                    "OPF package document is missing a valid `<manifest>` or `<spine>` chapter sequence.",
                                    "`.opf` 文件缺少有效的 `<manifest>` 资源清单或 `<spine>` 阅读顺序序列。",
                                ),
                                matched_text=opf_path,
                                suggestion=_tx(
                                    lang,
                                    "Ensure `.opf` contains non-empty `<manifest>` and `<spine>` referencing your chapter XHTML files.",
                                    "请确保 `.opf` 包含非空的 `<manifest>` 和指向章节 XHTML 的 `<spine>`。",
                                ),
                            )
                        )
                    else:
                        broken_refs: list[str] = []
                        for idref in spine_idrefs:
                            entry = manifest_by_id.get(idref)
                            if not entry or not entry[0] or entry[0] not in info_by_name:
                                broken_refs.append(idref)
                            else:
                                spine_content_paths.append(entry[0])
                        if broken_refs:
                            extra_findings.append(
                                GuardFinding(
                                    code="EPUB_BROKEN_SPINE_REF",
                                    severity="error",
                                    rule_ref="EPUB 3 Spine Spec",
                                    rule_tier="platform_spec",
                                    message=_tx(
                                        lang,
                                        f"OPF `<spine>` references missing manifest/archive items: {', '.join(broken_refs[:5])}.",
                                        f"OPF `<spine>` 引用了不存在的清单或文件条目：{', '.join(broken_refs[:5])}。",
                                    ),
                                    matched_text=", ".join(broken_refs[:5]),
                                    suggestion=_tx(
                                        lang,
                                        "Align every `<spine><itemref>` idref with a valid `<manifest><item>` existing inside the EPUB.",
                                        "请核对 `<spine>` 与 `<manifest>` 引用路径，确保所有章节文件完整存在。",
                                    ),
                                )
                            )
                except _ZipBombLimitError:
                    raise
                except Exception as exc:
                    extra_findings.append(
                        GuardFinding(
                            code="EPUB_INVALID_OPF_XML",
                            severity="error",
                            rule_ref="EPUB 3 Package Spec",
                            rule_tier="platform_spec",
                            message=_tx(
                                lang,
                                f"OPF package document `{opf_path}` is invalid XML: {exc}",
                                f"OPF 元数据文件 `{opf_path}` XML 解析失败：{exc}",
                            ),
                            matched_text=opf_path,
                            suggestion=_tx(
                                lang,
                                "Recompile the EPUB using a standards-compliant EPUB 3 packager.",
                                "请使用标准 EPUB 3 打包工具重新生成合乎 XML 规范的 OPF 文件。",
                            ),
                        )
                    )

            # 仅统计有效 spine 引用的 XHTML/HTML 章节正文，彻底堵住孤立散落 XHTML 绕过检测
            for sp_path in spine_content_paths:
                sp_info = info_by_name.get(sp_path)
                if not sp_info:
                    continue
                raw = _safe_read_entry(zf, sp_info, remaining_budget).decode("utf-8", errors="ignore")
                html_chunks.append(raw)
                prose_chunks.append(raw)

            # 扫描 manifest 引用的 CSS 及包内其余未列出的 CSS
            seen_css: set[str] = set()
            for cp in css_paths + [n for n in names if n.lower().endswith(".css")]:
                if cp in seen_css or cp not in info_by_name:
                    continue
                seen_css.add(cp)
                raw_css = _safe_read_entry(zf, info_by_name[cp], remaining_budget).decode("utf-8", errors="ignore")
                html_chunks.append(raw_css)

            # 扫描所有图片色彩模式（含 1-bit Kindle 卡死风险图）
            seen_imgs: set[str] = set()
            for ip in image_paths + [n for n in names if n.lower().endswith((".png", ".jpg", ".jpeg"))]:
                if ip in seen_imgs or ip not in info_by_name:
                    continue
                seen_imgs.add(ip)
                try:
                    img_data = _safe_read_entry(zf, info_by_name[ip], remaining_budget)
                    with Image.open(io.BytesIO(img_data)) as img:
                        if img.mode == "1":
                            extra_findings.append(
                                GuardFinding(
                                    code="IMAGE_1BIT_KINDLE_FREEZE",
                                    severity="error",
                                    rule_ref="Kindle Image Spec & Advisory #20",
                                    rule_tier="platform_spec",
                                    message=_tx(
                                        lang,
                                        f"Image `{ip}` uses 1-bit monochrome color mode (common in default QR generators), which can freeze Kindle Previewer at 95%.",
                                        f"图片 `{ip}` 为 1-bit 黑白二值位图（常见于默认 qrcode 库），会导致 Kindle Previewer 永远卡在 95% 报错！",
                                    ),
                                    matched_text=ip,
                                    suggestion=_tx(
                                        lang,
                                        "Convert image to 8-bit RGB mode before packaging EPUB.",
                                        "必须转换为 8-bit RGB 格式重新封装导出。",
                                    ),
                                )
                            )
                except _ZipBombLimitError:
                    raise
                except Exception:
                    pass
    except _ZipBombLimitError as exc:
        return _container_fail(
            "EPUB_ZIP_BOMB_LIMIT",
            str(exc),
            f"EPUB 超出解压安全上限：{exc}",
            "archive limit exceeded",
            "Verify your EPUB container contains no corrupted or abnormally compressed entries.",
            "请检查 EPUB 压缩包是否包含异常膨胀条目或非法嵌套文件。",
        )
    except (zipfile.BadZipFile, EOFError, OSError, RuntimeError, ValueError):
        return _container_fail(
            "INVALID_EPUB_ARCHIVE",
            "Uploaded file is not a valid EPUB / ZIP container archive.",
            "上传的文件损坏或不是有效的 EPUB（ZIP）压缩包，无法解析。",
            "corrupt archive",
            "Re-export your EPUB file from your formatting tool or PublishGuard Studio and upload again.",
            "请确认上传的是标准未损坏的 .epub 电子书包，重新导出后再试。",
        )

    prose_word_count = count_words("\n".join(prose_chunks))
    if prose_word_count == 0:
        extra_findings.append(
            GuardFinding(
                code="EPUB_NO_CONTENT",
                severity="error",
                rule_ref="EPUB 3 Content Spec",
                rule_tier="platform_spec",
                message=_tx(
                    lang,
                    "EPUB contains no readable XHTML/HTML chapter prose referenced by OPF `<spine>` (0 manuscript words found).",
                    "EPUB 的 OPF `<spine>` 中未检测到任何有效可读章节正文（纯正文词数为 0）。",
                ),
                matched_text="0 content words",
                suggestion=_tx(
                    lang,
                    "Ensure chapter XHTML documents are declared in `<manifest>` and `<spine>` inside the EPUB container.",
                    "请检查章节 HTML/XHTML 是否已在 OPF `<manifest>` 与 `<spine>` 中正确声明并打包。",
                ),
            )
        )

    manuscript_raw = "\n".join(html_chunks)
    plain_excerpt = _html.unescape(strip_html_tags("\n".join(prose_chunks))).strip()
    extracted_excerpt = plain_excerpt[:12000]

    res = run_preflight_audit(
        title=extracted_title,
        author_name=extracted_author,
        manuscript_text=manuscript_raw,
        mode=mode,
        lang=lang,
        **kwargs,
    )
    res.extracted_meta = {
        "title": extracted_title,
        "author_name": extracted_author,
        "language": extracted_lang,
    }
    res.extracted_excerpt = extracted_excerpt

    if extra_findings:
        container_errors = [asdict(f) for f in extra_findings if f.severity == "error"]
        container_warnings = [asdict(f) for f in extra_findings if f.severity == "warning"]
        res.errors = container_errors + res.errors
        res.warnings = container_warnings + res.warnings
        if container_errors:
            res.passed = False
        res.score = max(0, res.score - len(container_errors) * 25 - len(container_warnings) * 8)
    return res


def quick_dictionary_sanitize(raw_text: str) -> str:
    """确定性安全词典脱敏器（当未配置外部 LLM 时也可即时清洗高危医疗/促销/低内容触发词）。"""
    sanitized = raw_text
    for pattern, _, replacement in DSM5_CLINICAL_REPLACEMENTS:
        sanitized = re.sub(pattern, replacement, sanitized, flags=re.IGNORECASE)
    # 同步清洗易触发平装低内容误判的打卡表触发词（规则 25）
    workbook_replacements = [
        (r"\bscorecards?\b", "reflective summary"),
        (r"\bbinary\s+scores?\b", "qualitative indicator"),
        (r"\bdaily\s+ledgers?\b", "evening reflection"),
        (r"\bledgers?\b", "reflection log"),
        (r"\bprintable\s+worksheets?\b", "structured exercise"),
        (r"\bfill-in-the-blank\b", "open-ended prompt"),
    ]
    for pattern, replacement in workbook_replacements:
        sanitized = re.sub(pattern, replacement, sanitized, flags=re.IGNORECASE)
    # 剥离外部超链接标签保留可读纯文本域名
    sanitized = re.sub(
        r'<a\b[^>]*\bhref=["\'](https?://[^"\']+)["\'][^>]*>(.*?)</a>',
        r'\2 (\1)',
        sanitized,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return sanitized


def main() -> int:
    """CLI 入口：从标准输入读取 JSON 请求并输出审计 JSON 报告。"""
    parser = argparse.ArgumentParser(description="PublishGuard 26-Rule KDP Pre-Flight Audit")
    parser.add_argument("--stdin", action="store_true", help="Read JSON payload from stdin")
    args = parser.parse_args()

    if not args.stdin:
        print(json.dumps({"error": "Pass --stdin with JSON payload"}))
        return 1

    payload = json.loads(sys.stdin.read() or "{}")
    lang = _norm_lang(payload.get("lang", "en"))
    epub_b64 = payload.get("epub_base64")
    if epub_b64:
        import base64
        import binascii

        b64_str = str(epub_b64).strip()
        if "," in b64_str and b64_str.startswith("data:"):
            b64_str = b64_str.split(",", 1)[1].strip()
        if len(b64_str) > 21 * 1024 * 1024:
            raw_bytes = b"\x00" * (MAX_EPUB_ZIP_BYTES + 1)
        else:
            try:
                raw_bytes = base64.b64decode(b64_str, validate=False)
            except (binascii.Error, ValueError):
                raw_bytes = b""

        res = audit_epub_bytes(
            raw_bytes,
            title=payload.get("title", ""),
            subtitle=payload.get("subtitle", ""),
            description=payload.get("description", ""),
            author_name=payload.get("author_name", ""),
            primary_category=payload.get("primary_category", ""),
            companion_domain=payload.get("companion_domain", ""),
            other_pen_domains=payload.get("other_pen_domains") or [],
            existing_pen_titles=payload.get("existing_pen_titles") or [],
            mode=payload.get("mode", "ebook"),
            lang=lang,
            check_live_collisions=bool(payload.get("check_live_collisions", True)),
            enforce_min_words=bool(payload.get("enforce_min_words", False)),
        )
    else:
        res = run_preflight_audit(
            title=payload.get("title", ""),
            subtitle=payload.get("subtitle", ""),
            description=payload.get("description", ""),
            author_name=payload.get("author_name", ""),
            primary_category=payload.get("primary_category", ""),
            manuscript_text=payload.get("manuscript_text", ""),
            companion_domain=payload.get("companion_domain", ""),
            other_pen_domains=payload.get("other_pen_domains") or [],
            existing_pen_titles=payload.get("existing_pen_titles") or [],
            mode=payload.get("mode", "dual"),
            lang=lang,
            check_live_collisions=bool(payload.get("check_live_collisions", True)),
            enforce_min_words=bool(payload.get("enforce_min_words", False)),
        )

    print(json.dumps(asdict(res), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
