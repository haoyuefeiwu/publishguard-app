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
import io
import json
import re
import sys
import urllib.parse
import urllib.request
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
PROMO_AND_PROP_PATTERNS: list[tuple[str, str]] = [
    (r"\bwelcome\d{1,2}\b", "书内严禁包含优惠折扣码（如 WELCOME15）"),
    (r"\bpromo\s*code\b", "书内严禁包含 Promo Code 商业促销引导"),
    (r"\bdiscount\s*code\b", "书内严禁包含 Discount Code"),
    (r"\bcoupon\b|\bvoucher\b", "书内严禁出现 Coupon / Voucher 商业代金券"),
    (r"\b\d+\s*%\s*off\b", "书内严禁出现商业打折百分比（% OFF）"),
    (r"\bcut[- ]out\b|\bpocket\s*cards?\b|\bscissor\b", "严禁包含虚线剪裁卡片或离线游戏道具"),
    (r"\babundance\s*cheque\b", "严禁包含仿金融支票凭证（Abundance Cheque）"),
]

# 伪造传统出版社印记与非自然人作者词（规则 10 & 11）
IMPERSONATION_PATTERNS: list[tuple[str, str]] = [
    (r"\blumina\s+(?:studio|sacred\s+press|publishing)\b", "严禁出现非自然人 Studio / Press 虚假出版商印记"),
    (r"\b(?:new\s+york\s*[·•,]\s*london|paris\s*[·•,]\s*milan|san\s+francisco\s*[·•,]\s*new\s+jersey)\b", "严禁在自主出版书籍中虚构传统跨国出版社城市地名"),
]

# 诱发平装书被人工审核误判为低内容打卡表（Low-Content Workbook）的高危词（规则 25）
WORKBOOK_TRIGGER_PATTERNS: list[tuple[str, str]] = [
    (r"\bscorecard\b", "Scorecard 词汇易触发平装书被误判为低内容打卡表"),
    (r"\bbinary\s+score\b", "Binary Score 评分词汇易触发人工退稿"),
    (r"\bdaily\s+ledger\b|\bledger\b", "Ledger 账簿/记录表词汇易误判为低内容记事本"),
    (r"\bprintable\s+worksheet\b|\bfill-in-the-blank\b", "填空表/可打印练习表禁止申请免费 KDP ISBN"),
]

# 公式化副标题模版黑名单（规则 18 & 25）
FORMULAIC_SUBTITLE_PATTERNS: list[str] = [
    r"^A\s+\d+[- ]?(?:Minute|Day|Week)\s+Neuroscience\s+Guide\s+to\s+",
    r"^A\s+Practical\s+Field\s+Guide\s+to\s+",
    r"^The\s+Ultimate\s+Step[- ]by[- ]Step\s+Guide\s+to\s+",
]


@dataclass
class GuardFinding:
    """单条审计风险或警告明细。"""

    code: str
    severity: str  # error | warning
    rule_ref: str
    message: str
    matched_text: str = ""
    suggestion: str = ""


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
                    rule_ref="Rule 14 & 17",
                    message=f"命中临床/医疗诊断敏感词 `{label}`（共 {len(matches)} 处），易被 KDP 判处未经实证的医疗宣称。",
                    matched_text=sample,
                    suggestion=f"建议脱敏替换为学术中性表达：`{replacement}`",
                )
            )
            suggestions.append({"original": sample, "replacement": replacement})

    # 规则 2 & 9：促销折扣券与剪裁道具
    for pattern, msg in PROMO_AND_PROP_PATTERNS:
        m = re.search(pattern, lowered, flags=re.IGNORECASE)
        if m:
            findings.append(
                GuardFinding(
                    code="COMMERCIAL_PROMO_OR_PROP",
                    severity="error",
                    rule_ref="Rule 2 & 9",
                    message=msg,
                    matched_text=m.group(0),
                    suggestion="删除优惠券或剪纸道具描述，改为纯学术阅读伴读资源引导。",
                )
            )

    # 规则 10 & 11：仿冒出版社印记与城市地名
    for pattern, msg in IMPERSONATION_PATTERNS:
        m = re.search(pattern, lowered, flags=re.IGNORECASE)
        if m:
            findings.append(
                GuardFinding(
                    code="IMPERSONATION_IMPRINT",
                    severity="error",
                    rule_ref="Rule 10 & 11",
                    message=msg,
                    matched_text=m.group(0),
                    suggestion="统一标注为 `Independently published by [Author Full Name]`。",
                )
            )

    # 规则 25：平装书诱发低内容打卡表误判词
    if mode in ("paperback", "dual"):
        for pattern, msg in WORKBOOK_TRIGGER_PATTERNS:
            m = re.search(pattern, plain_text, flags=re.IGNORECASE)
            if m:
                findings.append(
                    GuardFinding(
                        code="WORKBOOK_TRIGGER_LEXICON",
                        severity="error",
                        rule_ref="Rule 25",
                        message=msg,
                        matched_text=m.group(0),
                        suggestion="改用 `Daily Observation` / `Reflection Guide` 等非虚构专著表述。",
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
                rule_ref="Rule 25",
                message="检测到内页样式中对卡片区块使用了四周边框或浅灰底色（如 `.prompt-card { border: ... }`），平装书缩略图审核极易将其误判为低内容记事本！",
                matched_text=box_matches[0][:80],
                suggestion="改用纯无边框段落排版，或仅允许 `border-left` 左侧细竖线引用样式。",
            )
        )

    # 规则 20：电子书内页外部可点击超链接清零 + Kindle Previewer 卡 95% 隐患检测
    if mode in ("ebook", "dual"):
        ext_links = re.findall(r'<a\b[^>]*\bhref=["\']https?://[^"\']+["\']', raw_html_or_css, flags=re.IGNORECASE)
        if ext_links:
            findings.append(
                GuardFinding(
                    code="EBOOK_EXTERNAL_HYPERLINK",
                    severity="error",
                    rule_ref="Rule 20 & 24",
                    message=f"电子书内检测到 {len(ext_links)} 个可点击外部超链接！亚马逊爬虫若遇 429/重定向会直接秒杀封书。",
                    matched_text=ext_links[0],
                    suggestion="移除 `<a href='http...'>` 标签，改为纯文本域名展示（如 `Visit example.com/audio`）。",
                )
            )

        if re.search(r"display\s*:\s*flex", raw_html_or_css, flags=re.IGNORECASE):
            findings.append(
                GuardFinding(
                    code="KINDLE_95_PERCENT_FLEX",
                    severity="warning",
                    rule_ref="Rule 20",
                    message="电子书样式中包含 `display: flex`，部分老旧 Kindle 渲染引擎会卡在 95% 进度无法通过 Previewer。",
                    matched_text="display: flex",
                    suggestion="改为标准语义化流式块级排版（block + margin/padding）。",
                )
            )
        if re.search(r"position\s*:\s*absolute", raw_html_or_css, flags=re.IGNORECASE):
            findings.append(
                GuardFinding(
                    code="KINDLE_95_PERCENT_ABS",
                    severity="warning",
                    rule_ref="Rule 20",
                    message="电子书样式中包含 `position: absolute`，流式排版中会导致文字重叠或解析挂起。",
                    matched_text="position: absolute",
                    suggestion="移除绝对定位，改用常规文本流。",
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
    check_live_collisions: bool = True,
    collision_override: dict[str, Any] | None = None,
    enforce_min_words: bool = False,
) -> GuardAuditResult:
    """
    执行完整 26 项 KDP 零风控审计。
    - `enforce_min_words=True` 时用于出版编译放行（强制要求 ≥15,000 词）；
    - 公域快检单段文案时可设 `enforce_min_words=False`，仍提示体量过薄警告。
    """
    findings: list[GuardFinding] = []
    suggestions: list[dict[str, str]] = []

    # 1. 标题与副标题合规（规则 3 & 18 & 25）
    clean_title = title.strip()
    clean_sub = subtitle.strip()
    if clean_title:
        if len(clean_title) > 120:
            findings.append(
                GuardFinding(
                    code="TITLE_TOO_LONG",
                    severity="error",
                    rule_ref="Rule 3",
                    message=f"主书名长度 {len(clean_title)} 字符过长，疑似关键词堆砌。",
                    matched_text=clean_title,
                    suggestion="主书名应凝练有力，控制在 60~80 字符以内。",
                )
            )
        if ":" in clean_title and not clean_sub:
            findings.append(
                GuardFinding(
                    code="TITLE_COLON_STUFFING",
                    severity="warning",
                    rule_ref="Rule 3",
                    message="主书名内包含冒号，请确认副标题是否拆入 Subtitle 字段而非堆在主标题内。",
                    matched_text=clean_title,
                )
            )

    if clean_sub:
        if len(clean_sub) > 110:
            findings.append(
                GuardFinding(
                    code="SUBTITLE_OVER_110",
                    severity="error",
                    rule_ref="Rule 3",
                    message=f"副标题长达 {len(clean_sub)} 字符（超过 110 字符红线），存在被亚马逊前端截断及触发堆砌惩罚风险。",
                    matched_text=clean_sub,
                    suggestion="精简副标题至 80~100 字符以内。",
                )
            )
        if clean_sub.count(":") >= 2 or clean_sub.count("|") >= 1:
            findings.append(
                GuardFinding(
                    code="SUBTITLE_MULTI_COLON",
                    severity="error",
                    rule_ref="Rule 3",
                    message="副标题存在多重冒号或竖线分隔符，属于典型 SEO 堆砌特征。",
                    matched_text=clean_sub,
                )
            )
        for pat in FORMULAIC_SUBTITLE_PATTERNS:
            if re.search(pat, clean_sub, flags=re.IGNORECASE):
                findings.append(
                    GuardFinding(
                        code="SUBTITLE_FORMULAIC_TEMPLATE",
                        severity="error",
                        rule_ref="Rule 18 & 25",
                        message="副标题命中高度模版化高频句式，多本连发极易被平台批量关联识别为流水线图书。",
                        matched_text=clean_sub,
                        suggestion="改用具体方法论或专著视角改写副标题结构。",
                    )
                )
                break

    # 2. 作者姓名防非自然人机构词汇（规则 10）
    if author_name.strip():
        bad_author_tokens = re.findall(r"\b(?:studio|press|publishing|team|lab|official|inc|llc|group)\b", author_name, flags=re.IGNORECASE)
        if bad_author_tokens:
            findings.append(
                GuardFinding(
                    code="NON_HUMAN_AUTHOR_NAME",
                    severity="error",
                    rule_ref="Rule 10",
                    message=f"作者姓名包含非自然人机构后缀 `{bad_author_tokens[0]}`，极易触发仿冒第三方机构审查（Option 3）。",
                    matched_text=author_name,
                    suggestion="使用真实感单人笔名（First Name + Last Name），例如 `Evelyn Vance`。",
                )
            )

    # 3. 顶级类目校验（规则 8）
    if primary_category.strip():
        if primary_category.strip() not in VALID_KDP_PRIMARY_CATEGORIES:
            findings.append(
                GuardFinding(
                    code="INVALID_KDP_CATEGORY",
                    severity="error",
                    rule_ref="Rule 8",
                    message=f"顶级主类目 `{primary_category}` 不在亚马逊 KDP 官方 31 个顶级大类白名单内（禁止使用过时的 BISAC 术语如 Body, Mind & Spirit）。",
                    matched_text=primary_category,
                    suggestion="玄学/身心灵请选择 `Religion & Spirituality` 或 `Self-Help`。",
                )
            )

    # 4. 图书描述纯净度（规则 13）
    if description.strip():
        if re.search(r"https?://", description, flags=re.IGNORECASE):
            findings.append(
                GuardFinding(
                    code="DESCRIPTION_EXTERNAL_URL",
                    severity="error",
                    rule_ref="Rule 13",
                    message="KDP 图书描述（Description）中物理禁止包含任何 http/https 外部网址，保存时会被后台拒绝或触发引流惩罚。",
                    matched_text="http(s)://...",
                    suggestion="彻底删除图书简介中的 URL，改为纯内容卖点展示。",
                )
            )

    # 5. SaaS 独家：跨笔名关联域名隔离警告（规则 23 + 血泪教训）
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
                    rule_ref="Cross-Account Isolation Guard",
                    message=f"致命关联风险！域名 `{host}` 已被您的其他作者笔名使用。在多个独立 KDP 账号中共用同一独立站伴读域名会导致整网连坐封号！",
                    matched_text=host,
                    suggestion="每个独立笔名/KDP 账号必须使用物理隔离的独立域名或关闭跨账号域名。",
                )
            )

    # 6. 合并所有文本域执行深层扫雷
    combined_raw = "\n".join([clean_title, clean_sub, description, manuscript_text])
    combined_plain = strip_html_tags(combined_raw)
    _scan_text_block(
        plain_text=combined_plain,
        raw_html_or_css=manuscript_text + "\n" + description,
        mode=mode,
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
                    rule_ref="Rule 15 & 16 & 22",
                    message=f"当前手稿纯正文仅 {wc:,} 词（低于 15,000 词安全底线）。短小篇幅极易被 KES 模型判定为 Thin Content（单薄内容）并处以封锁。",
                    matched_text=f"{wc} words",
                    suggestion="通过 PublishGuard 长文流水线扩写至 18,000～22,000 词深度专著体量。",
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
                    rule_ref="Rule 12",
                    message=f"主书名 `{clean_title}` 与已有出版作品《{hit['title']}》（{hit['source']}）高度重名撞车，极易触发仿冒投诉（Option 1）！",
                    matched_text=clean_title,
                    suggestion="使用更具独创性的方法论组合词重构主标题。",
                )
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
    )


def audit_epub_bytes(epub_bytes: bytes, **kwargs: Any) -> GuardAuditResult:
    """解包上传的 EPUB 文件，抽取正文、CSS 与所有图片色彩模式执行 26 项全量物理检查。"""
    extra_findings: list[GuardFinding] = []
    html_chunks: list[str] = []
    extracted_title = kwargs.pop("title", "")

    with zipfile.ZipFile(io.BytesIO(epub_bytes), "r") as zf:
        names = zf.namelist()
        if not names or names[0] != "mimetype":
            extra_findings.append(
                GuardFinding(
                    code="EPUB_MIMETYPE_NOT_FIRST",
                    severity="error",
                    rule_ref="EPUB 3 Spec",
                    message="EPUB 规范校验失败：`mimetype` 必须作为压缩包第一个文件无压缩存储。",
                    matched_text=names[0] if names else "empty",
                )
            )

        for name in names:
            lower = name.lower()
            if lower.endswith((".html", ".xhtml", ".htm", ".css")):
                raw = zf.read(name).decode("utf-8", errors="ignore")
                html_chunks.append(raw)
                if not extracted_title and lower.endswith(".opf"):
                    m_title = re.search(r"<dc:title[^>]*>(.*?)</dc:title>", raw, flags=re.IGNORECASE | re.DOTALL)
                    if m_title:
                        extracted_title = m_title.group(1).strip()
            elif lower.endswith(".opf") and not extracted_title:
                raw = zf.read(name).decode("utf-8", errors="ignore")
                m_title = re.search(r"<dc:title[^>]*>(.*?)</dc:title>", raw, flags=re.IGNORECASE | re.DOTALL)
                if m_title:
                    extracted_title = m_title.group(1).strip()
            elif lower.endswith((".png", ".jpg", ".jpeg")):
                try:
                    img_data = zf.read(name)
                    with Image.open(io.BytesIO(img_data)) as img:
                        if img.mode == "1":
                            extra_findings.append(
                                GuardFinding(
                                    code="IMAGE_1BIT_KINDLE_FREEZE",
                                    severity="error",
                                    rule_ref="Rule 20 & Kindle 95% Freeze",
                                    message=f"图片 `{name}` 为 1-bit 黑白二值位图（常见于默认 qrcode 库），会导致 Kindle Previewer 永远卡在 95% 报错！",
                                    matched_text=name,
                                    suggestion="必须转换为 8-bit RGB 格式重新封装导出。",
                                )
                            )
                except Exception:
                    pass

    manuscript_raw = "\n".join(html_chunks)
    res = run_preflight_audit(
        title=extracted_title,
        manuscript_text=manuscript_raw,
        mode="ebook",
        **kwargs,
    )
    if extra_findings:
        res.errors = [asdict(f) for f in extra_findings] + res.errors
        res.passed = False
        res.score = max(0, res.score - len(extra_findings) * 20)
    return res


def quick_dictionary_sanitize(raw_text: str) -> str:
    """确定性安全词典脱敏器（当未配置外部 LLM 时也可即时清洗高危医疗/促销词汇）。"""
    sanitized = raw_text
    for pattern, _, replacement in DSM5_CLINICAL_REPLACEMENTS:
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
    epub_b64 = payload.get("epub_base64")
    if epub_b64:
        import base64

        res = audit_epub_bytes(
            base64.b64decode(epub_b64),
            subtitle=payload.get("subtitle", ""),
            description=payload.get("description", ""),
            author_name=payload.get("author_name", ""),
            primary_category=payload.get("primary_category", ""),
            companion_domain=payload.get("companion_domain", ""),
            other_pen_domains=payload.get("other_pen_domains") or [],
            existing_pen_titles=payload.get("existing_pen_titles") or [],
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
            check_live_collisions=bool(payload.get("check_live_collisions", True)),
            enforce_min_words=bool(payload.get("enforce_min_words", False)),
        )

    print(json.dumps(asdict(res), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
