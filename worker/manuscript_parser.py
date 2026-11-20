#!/usr/bin/env python3
"""
PublishGuard 多格式自带书稿解析与合规切章引擎（零第三方依赖，仅用 Python 标准库）。
支持格式：
- `.docx`：安全解析 `word/document.xml` 与 `docProps/core.xml`，识别 Title / Subtitle / Heading1 / 粗斜体与列表
- `.epub`：校验容器与 XML 安全边界后按 OPF `<spine>` 顺序抽取各章节正文与元数据
- `.md` / `.markdown`：支持 frontmatter、按 `#`/`##` 自动切章并转为干净出版级 HTML
- `.txt` / 纯文本 / HTML 片段：自动识别 `Chapter N` / HTML 标题切章并做段落分段
全部输出章节正文统一经过 `html_sanitizer.sanitize_chapter_html` 白名单净化，供导入立项与 60 积分 5 件套编译使用。
"""

from __future__ import annotations

import argparse
import base64
import binascii
import html
import io
import json
import posixpath
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any

WORKER_DIR = Path(__file__).resolve().parent
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))

from html_sanitizer import sanitize_chapter_html
from kdp_guard_service import (
    MAX_EPUB_ENTRIES,
    MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES,
    MAX_EPUB_ZIP_BYTES,
    _ZipBombLimitError,
    _normalize_zip_rel_path,
    _safe_parse_xml,
    _safe_read_entry,
    _xml_localname,
    count_words,
    strip_html_tags,
)

MAX_CHAPTERS_LIMIT = 80
MIN_MANUSCRIPT_WORDS = 100
CHUNK_TARGET_WORDS = 1800

CHAPTER_HEADING_RE = re.compile(
    r"^(?:"
    r"(?:chapter|part|section)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?:\s*[:.\-—–]\s*.+)?|"
    r"(?:prologue|introduction|preface|foreword|conclusion|epilogue|afterword|appendix)\b(?:\s*[:.\-—–]\s*.+)?"
    r")$",
    re.IGNORECASE,
)

SKIP_EPUB_FRONTMATTER_RE = re.compile(
    r"(?:^|/)(?:nav|toc|cover|half[-_ ]?title|title[-_ ]?page|copyright|colophon)(?:\b|[._-])",
    re.IGNORECASE,
)


def _slugify(raw: str, index: int) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", str(raw or "").lower()).strip("-")
    if not base:
        return f"section-{index + 1:02d}"
    return f"{base[:48]}-{index + 1:02d}"


def _infer_section_type(title: str, idx: int) -> str:
    low = title.strip().lower()
    if idx == 0 and re.match(r"^(?:prologue|introduction|preface|foreword)\b", low):
        return "front_matter"
    if re.match(r"^(?:conclusion|epilogue|afterword|appendix)\b", low):
        return "back_matter"
    return "chapter"


def _make_summary(content_html: str) -> str:
    plain = html.unescape(strip_html_tags(content_html)).strip()
    plain = re.sub(r"\s+", " ", plain)
    if len(plain) <= 160:
        return plain
    return plain[:157].rstrip() + "..."


def _decode_base64_bytes(b64_raw: str) -> bytes:
    clean = str(b64_raw or "").strip()
    if clean.startswith("data:") and "," in clean:
        clean = clean.split(",", 1)[1].strip()
    if len(clean) > 21 * 1024 * 1024:
        raise ValueError("Uploaded file exceeds the 15 MB limit.")
    try:
        raw = base64.b64decode(clean, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid uploaded file encoding.") from exc
    if not raw:
        raise ValueError("Uploaded file is empty.")
    if len(raw) > MAX_EPUB_ZIP_BYTES:
        raise ValueError("Uploaded file exceeds the 15 MB limit.")
    return raw


def _split_large_paragraphs_into_chapters(
    blocks: list[str],
    *,
    base_title: str = "Part",
) -> list[tuple[str, str]]:
    """当原稿未显式划分章节时，按约 1,800 词在自然段落边界切分为均衡章节，避免单章过长渲染失衡。"""
    if not blocks:
        return []
    total_words = count_words("\n".join(blocks))
    if total_words <= 2600:
        return [("Chapter 1: Main Text", "\n".join(blocks))]

    sections: list[tuple[str, str]] = []
    cur_blocks: list[str] = []
    cur_words = 0
    for blk in blocks:
        w = count_words(blk)
        if cur_blocks and cur_words + w > CHUNK_TARGET_WORDS and cur_words >= 1100:
            idx = len(sections) + 1
            sections.append((f"{base_title} {idx}", "\n".join(cur_blocks)))
            cur_blocks = [blk]
            cur_words = w
        else:
            cur_blocks.append(blk)
            cur_words += w

    if cur_blocks:
        idx = len(sections) + 1
        sections.append((f"{base_title} {idx}", "\n".join(cur_blocks)))
    return sections


def _finalize_chapters(raw_chapters: list[tuple[str, str]]) -> list[dict[str, Any]]:
    """统一执行 HTML 白名单净化、过滤空章、限制最大章节数并补充统计字段。"""
    cleaned_list: list[tuple[str, str]] = []
    for raw_title, raw_html in raw_chapters:
        sanitized = sanitize_chapter_html(raw_html)
        wc = count_words(sanitized)
        if wc == 0:
            continue
        title = re.sub(r"\s+", " ", html.unescape(strip_html_tags(raw_title or ""))).strip()
        if not title:
            title = f"Chapter {len(cleaned_list) + 1}"
        title = title[:160]
        cleaned_list.append((title, sanitized))

    if len(cleaned_list) > MAX_CHAPTERS_LIMIT:
        head = cleaned_list[: MAX_CHAPTERS_LIMIT - 1]
        tail_title = cleaned_list[MAX_CHAPTERS_LIMIT - 1][0]
        tail_html = "\n".join(
            f"<h2>{html.escape(t)}</h2>\n{h}" for t, h in cleaned_list[MAX_CHAPTERS_LIMIT - 1 :]
        )
        cleaned_list = head + [(tail_title, sanitize_chapter_html(tail_html))]

    output: list[dict[str, Any]] = []
    for idx, (ch_title, ch_html) in enumerate(cleaned_list):
        wc = count_words(ch_html)
        output.append(
            {
                "chapter_index": idx,
                "section_type": _infer_section_type(ch_title, idx),
                "title": ch_title,
                "slug": _slugify(ch_title, idx),
                "summary": _make_summary(ch_html),
                "content_html": ch_html,
                "word_count": wc,
            }
        )
    return output


def _is_bool_prop_on(el: ET.Element | None) -> bool:
    if el is None:
        return False
    for attr_k, attr_v in el.attrib.items():
        if _xml_localname(attr_k) == "val":
            return str(attr_v).strip().lower() not in ("0", "false", "off", "no")
    return True


def _extract_docx(raw_bytes: bytes) -> dict[str, Any]:
    """解析 `.docx` Word 文档的段落、标题层级、粗斜体与列表，内置 Zip Slip 与膨胀防护。"""
    meta_title = ""
    meta_author = ""
    meta_subtitle = ""

    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes), "r") as zf:
            infos = zf.infolist()
            if len(infos) > MAX_EPUB_ENTRIES:
                raise _ZipBombLimitError("DOCX contains too many archive entries.")
            declared_total = sum(max(0, info.file_size) for info in infos)
            if declared_total > MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES:
                raise _ZipBombLimitError("DOCX uncompressed size exceeds 60 MB safety limit.")

            info_by_name: dict[str, zipfile.ZipInfo] = {}
            for info in infos:
                if info.filename.startswith("/") or ".." in info.filename.replace("\\", "/").split("/"):
                    raise ValueError(f"Unsafe archive entry path `{info.filename}`.")
                info_by_name[info.filename] = info

            if "word/document.xml" not in info_by_name:
                raise ValueError("Invalid .docx archive: missing `word/document.xml`.")

            budget = [MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES]

            # 读取可选 Word 文档核心元数据
            core_info = info_by_name.get("docProps/core.xml")
            if core_info:
                try:
                    core_root = _safe_parse_xml(_safe_read_entry(zf, core_info, budget))
                    for el in core_root.iter():
                        lname = _xml_localname(el.tag)
                        txt = (el.text or "").strip()
                        if not txt:
                            continue
                        if lname == "title" and not meta_title:
                            meta_title = txt[:200]
                        elif lname == "creator" and not meta_author:
                            meta_author = txt[:160]
                except _ZipBombLimitError:
                    raise
                except Exception:
                    pass

            doc_bytes = _safe_read_entry(zf, info_by_name["word/document.xml"], budget)
            doc_root = _safe_parse_xml(doc_bytes)
    except _ZipBombLimitError as exc:
        raise ValueError(str(exc)) from exc
    except (zipfile.BadZipFile, EOFError, OSError) as exc:
        raise ValueError("Uploaded file is not a valid .docx archive.") from exc
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"Failed to parse .docx XML structure: {exc}") from exc

    body_el = None
    for el in doc_root.iter():
        if _xml_localname(el.tag) == "body":
            body_el = el
            break
    if body_el is None:
        raise ValueError("Invalid .docx structure: missing document body.")

    chapters: list[tuple[str, list[str]]] = []
    cur_title = ""
    cur_blocks: list[str] = []
    flat_blocks: list[str] = []
    list_buffer: list[str] = []

    def _flush_list(target: list[str]) -> None:
        if list_buffer:
            target.append("<ul>\n" + "\n".join(list_buffer) + "\n</ul>")
            list_buffer.clear()

    for child in body_el:
        if _xml_localname(child.tag) != "p":
            continue

        style_val = ""
        is_list_item = False
        p_parts: list[str] = []
        plain_parts: list[str] = []

        for sub in child:
            sname = _xml_localname(sub.tag)
            if sname == "ppr":
                for pprop in sub:
                    pname = _xml_localname(pprop.tag)
                    if pname == "pstyle":
                        for ak, av in pprop.attrib.items():
                            if _xml_localname(ak) == "val":
                                style_val = str(av or "").strip()
                    elif pname == "numpr":
                        is_list_item = True
            elif sname == "r":
                is_bold = False
                is_italic = False
                run_text_parts: list[str] = []
                for rsub in sub:
                    rname = _xml_localname(rsub.tag)
                    if rname == "rpr":
                        for rprop in rsub:
                            rpname = _xml_localname(rprop.tag)
                            if rpname == "b" and _is_bool_prop_on(rprop):
                                is_bold = True
                            elif rpname == "i" and _is_bool_prop_on(rprop):
                                is_italic = True
                    elif rname == "t" and rsub.text:
                        run_text_parts.append(rsub.text)
                    elif rname == "tab":
                        run_text_parts.append(" ")
                    elif rname == "br":
                        run_text_parts.append("\n")
                run_text = "".join(run_text_parts)
                if not run_text:
                    continue
                plain_parts.append(run_text)
                esc = html.escape(run_text).replace("\n", "<br />")
                if is_bold and is_italic:
                    p_parts.append(f"<strong><em>{esc}</em></strong>")
                elif is_bold:
                    p_parts.append(f"<strong>{esc}</strong>")
                elif is_italic:
                    p_parts.append(f"<em>{esc}</em>")
                else:
                    p_parts.append(esc)
            elif sname == "hyperlink":
                # 遵照 KDP 规范 20，将外部可点击链接转为纯文本保留文字，避免 EPUB 外链被拦截
                link_txt = "".join(el.text for el in sub.iter() if _xml_localname(el.tag) == "t" and el.text)
                if link_txt:
                    plain_parts.append(link_txt)
                    p_parts.append(html.escape(link_txt))

        plain_text = re.sub(r"\s+", " ", "".join(plain_parts)).strip()
        if not plain_text:
            continue

        style_low = style_val.lower().replace(" ", "")
        rich_inner = "".join(p_parts).strip()

        if style_low == "title" and not chapters and not cur_blocks and len(plain_text.split()) <= 25:
            meta_title = meta_title or plain_text[:200]
            continue
        if style_low == "subtitle" and not chapters and not cur_blocks and len(plain_text.split()) <= 35:
            meta_subtitle = meta_subtitle or plain_text[:250]
            continue

        is_chapter_break = style_low in ("heading1", "heading") or (
            len(plain_text) <= 105 and bool(CHAPTER_HEADING_RE.match(plain_text))
        )
        if is_chapter_break:
            _flush_list(cur_blocks if cur_title or chapters else flat_blocks)
            if cur_title and cur_blocks:
                chapters.append((cur_title, cur_blocks))
            elif cur_blocks and not chapters:
                # 在第一章标题之前的引言正文保留为 Opening / Front Matter
                chapters.append(("Introduction", cur_blocks))
            elif flat_blocks and not chapters:
                chapters.append(("Introduction", list(flat_blocks)))
                flat_blocks.clear()
            cur_title = plain_text
            cur_blocks = []
            continue

        if style_low == "heading2":
            _flush_list(cur_blocks if cur_title or chapters else flat_blocks)
            block_html = f"<h2>{html.escape(plain_text)}</h2>"
        elif style_low in ("heading3", "heading4"):
            _flush_list(cur_blocks if cur_title or chapters else flat_blocks)
            block_html = f"<h3>{html.escape(plain_text)}</h3>"
        elif is_list_item:
            list_buffer.append(f"<li>{rich_inner}</li>")
            continue
        elif style_low in ("quote", "intensequote", "blockquote"):
            _flush_list(cur_blocks if cur_title or chapters else flat_blocks)
            block_html = f"<blockquote><p>{rich_inner}</p></blockquote>"
        else:
            _flush_list(cur_blocks if cur_title or chapters else flat_blocks)
            block_html = f"<p>{rich_inner}</p>"

        if cur_title or chapters:
            cur_blocks.append(block_html)
        else:
            flat_blocks.append(block_html)

    _flush_list(cur_blocks if cur_title or chapters else flat_blocks)
    if cur_title and cur_blocks:
        chapters.append((cur_title, cur_blocks))

    if chapters:
        raw_pairs = [(t, "\n".join(blks)) for t, blks in chapters]
    else:
        raw_pairs = _split_large_paragraphs_into_chapters(flat_blocks)

    return {
        "title": meta_title,
        "subtitle": meta_subtitle,
        "author_name": meta_author,
        "chapters": _finalize_chapters(raw_pairs),
    }


def _extract_epub(raw_bytes: bytes) -> dict[str, Any]:
    """从上传的 `.epub` 容器按 OPF `<spine>` 顺序安全抽取出标题、作者及干净章节列表。"""
    meta_title = ""
    meta_author = ""
    chapters: list[tuple[str, str]] = []

    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes), "r") as zf:
            infos = zf.infolist()
            if len(infos) > MAX_EPUB_ENTRIES:
                raise _ZipBombLimitError("EPUB contains too many archive entries.")
            declared_total = sum(max(0, info.file_size) for info in infos)
            if declared_total > MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES:
                raise _ZipBombLimitError("EPUB uncompressed size exceeds 60 MB safety limit.")

            info_by_name: dict[str, zipfile.ZipInfo] = {}
            for info in infos:
                if info.filename.startswith("/") or ".." in info.filename.replace("\\", "/").split("/"):
                    raise ValueError(f"Unsafe archive entry path `{info.filename}`.")
                info_by_name[info.filename] = info

            budget = [MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES]
            container_info = info_by_name.get("META-INF/container.xml")
            if not container_info:
                raise ValueError("Invalid .epub file: missing `META-INF/container.xml`.")

            container_root = _safe_parse_xml(_safe_read_entry(zf, container_info, budget))
            opf_path = ""
            for elem in container_root.iter():
                if _xml_localname(elem.tag) == "rootfile":
                    fp = (elem.attrib.get("full-path") or "").strip()
                    if fp:
                        opf_path = _normalize_zip_rel_path("", fp)
                        break
            if not opf_path or opf_path not in info_by_name:
                raise ValueError("Invalid .epub file: missing `.opf` package document.")

            opf_dir = posixpath.dirname(opf_path)
            opf_root = _safe_parse_xml(_safe_read_entry(zf, info_by_name[opf_path], budget))
            manifest: dict[str, tuple[str, str, str]] = {}
            spine_ids: list[str] = []

            for elem in opf_root.iter():
                lname = _xml_localname(elem.tag)
                if lname == "title" and not meta_title and (elem.text or "").strip():
                    meta_title = html.unescape(elem.text or "").strip()[:200]
                elif lname == "creator" and not meta_author and (elem.text or "").strip():
                    meta_author = html.unescape(elem.text or "").strip()[:160]
                elif lname == "item":
                    iid = (elem.attrib.get("id") or "").strip()
                    href = (elem.attrib.get("href") or "").strip()
                    mtype = (elem.attrib.get("media-type") or "").strip().lower()
                    props = (elem.attrib.get("properties") or "").strip().lower()
                    if iid and href:
                        manifest[iid] = (_normalize_zip_rel_path(opf_dir, href), mtype, props)
                elif lname == "itemref":
                    idref = (elem.attrib.get("idref") or "").strip()
                    if idref:
                        spine_ids.append(idref)

            fallback_chapters: list[tuple[str, str]] = []
            for idref in spine_ids:
                item = manifest.get(idref)
                if not item:
                    continue
                rel_path, mtype, props = item
                if not rel_path or rel_path not in info_by_name:
                    continue
                if "xhtml" not in mtype and "html" not in mtype and not rel_path.lower().endswith((".xhtml", ".html", ".htm")):
                    continue

                raw_doc = _safe_read_entry(zf, info_by_name[rel_path], budget).decode("utf-8", errors="ignore")
                body_match = re.search(r"<body\b[^>]*>([\s\S]*?)</body>", raw_doc, flags=re.IGNORECASE)
                fragment = body_match.group(1) if body_match else raw_doc
                sanitized = sanitize_chapter_html(fragment)
                wc = count_words(sanitized)
                if wc == 0:
                    continue

                h_match = re.search(r"<h[12]\b[^>]*>([\s\S]*?)</h[12]>", sanitized, flags=re.IGNORECASE)
                ch_title = (
                    re.sub(r"\s+", " ", html.unescape(strip_html_tags(h_match.group(1)))).strip()
                    if h_match
                    else ""
                )
                if not ch_title:
                    stem = Path(rel_path).stem.replace("_", " ").replace("-", " ").strip()
                    ch_title = stem.title() or f"Chapter {len(chapters) + 1}"

                fallback_chapters.append((ch_title, sanitized))
                is_skip_front = ("nav" in props) or (bool(SKIP_EPUB_FRONTMATTER_RE.search(rel_path)) and wc < 220)
                if not is_skip_front:
                    chapters.append((ch_title, sanitized))

            if not chapters:
                chapters = fallback_chapters
    except _ZipBombLimitError as exc:
        raise ValueError(str(exc)) from exc
    except (zipfile.BadZipFile, EOFError, OSError) as exc:
        raise ValueError("Uploaded file is not a valid .epub archive.") from exc
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"Failed to parse .epub structure: {exc}") from exc

    return {
        "title": meta_title,
        "subtitle": "",
        "author_name": meta_author,
        "chapters": _finalize_chapters(chapters),
    }


def _markdown_inline_to_html(text: str) -> str:
    """转义行内 HTML 后还原基础 Markdown 强调与链接（外链降级为纯文本域名）。"""
    # 先提取 Markdown 外链 `[label](https://...)` -> 纯文本域名（遵照规则 20）
    def _link_repl(m: re.Match[str]) -> str:
        label = m.group(1).strip()
        url = m.group(2).strip()
        plain_url = re.sub(r"^https?://", "", url, flags=re.IGNORECASE).rstrip("/")
        return f"{label} ({plain_url})" if plain_url else label

    normalized = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", _link_repl, text)
    escaped = html.escape(normalized, quote=False)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"__(.+?)__", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<em>\1</em>", escaped)
    escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
    return escaped


def _markdown_body_to_html(md_text: str) -> str:
    """将单章 Markdown 片段转换为干净安全的出版级 HTML。"""
    blocks: list[str] = []
    para_lines: list[str] = []
    list_items: list[str] = []
    list_tag = ""
    quote_lines: list[str] = []

    def _flush_para() -> None:
        if para_lines:
            joined = " ".join(line.strip() for line in para_lines if line.strip())
            if joined:
                blocks.append(f"<p>{_markdown_inline_to_html(joined)}</p>")
            para_lines.clear()

    def _flush_list() -> None:
        nonlocal list_tag
        if list_items and list_tag:
            blocks.append(f"<{list_tag}>\n" + "\n".join(list_items) + f"\n</{list_tag}>")
            list_items.clear()
            list_tag = ""

    def _flush_quote() -> None:
        if quote_lines:
            joined = " ".join(line.strip() for line in quote_lines if line.strip())
            if joined:
                blocks.append(f"<blockquote><p>{_markdown_inline_to_html(joined)}</p></blockquote>")
            quote_lines.clear()

    for raw_line in md_text.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped:
            _flush_para()
            _flush_list()
            _flush_quote()
            continue

        h_match = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if h_match:
            _flush_para()
            _flush_list()
            _flush_quote()
            level = min(6, max(2, len(h_match.group(1))))
            blocks.append(f"<h{level}>{_markdown_inline_to_html(h_match.group(2).strip())}</h{level}>")
            continue

        if stripped.startswith(">"):
            _flush_para()
            _flush_list()
            quote_lines.append(stripped.lstrip(">").strip())
            continue

        ul_match = re.match(r"^[-*+]\s+(.+)$", stripped)
        if ul_match:
            _flush_para()
            _flush_quote()
            if list_tag and list_tag != "ul":
                _flush_list()
            list_tag = "ul"
            list_items.append(f"<li>{_markdown_inline_to_html(ul_match.group(1))}</li>")
            continue

        ol_match = re.match(r"^\d+[.)]\s+(.+)$", stripped)
        if ol_match:
            _flush_para()
            _flush_quote()
            if list_tag and list_tag != "ol":
                _flush_list()
            list_tag = "ol"
            list_items.append(f"<li>{_markdown_inline_to_html(ol_match.group(1))}</li>")
            continue

        _flush_list()
        _flush_quote()
        para_lines.append(stripped)

    _flush_para()
    _flush_list()
    _flush_quote()
    return "\n".join(blocks)


def _extract_markdown(raw_text: str) -> dict[str, Any]:
    """解析 Markdown 文本：支持可选 frontmatter 元数据，并按 `# ` 或 `## ` 切章。"""
    text = raw_text.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    meta_title = ""
    meta_subtitle = ""
    meta_author = ""

    # 解析可选顶部 YAML frontmatter
    if text.startswith("---\n"):
        end_idx = text.find("\n---\n", 4)
        if end_idx != -1 and end_idx < 2500:
            fm = text[4:end_idx]
            text = text[end_idx + 5 :]
            for line in fm.splitlines():
                m = re.match(r"^(title|subtitle|author)\s*:\s*(.+)$", line.strip(), flags=re.IGNORECASE)
                if m:
                    k = m.group(1).lower()
                    v = m.group(2).strip().strip('"').strip("'")
                    if k == "title" and v:
                        meta_title = v[:200]
                    elif k == "subtitle" and v:
                        meta_subtitle = v[:250]
                    elif k == "author" and v:
                        meta_author = v[:160]

    lines = text.split("\n")
    has_h1 = any(re.match(r"^#\s+\S", ln.strip()) for ln in lines)
    h2_count = sum(1 for ln in lines if re.match(r"^##\s+\S", ln.strip()))
    split_re = re.compile(r"^#\s+(.+)$") if has_h1 else (re.compile(r"^##\s+(.+)$") if h2_count >= 2 else None)

    raw_sections: list[tuple[str, str]] = []
    if split_re:
        cur_title = ""
        cur_lines: list[str] = []
        for ln in lines:
            m = split_re.match(ln.strip())
            if m:
                body_str = "\n".join(cur_lines).strip()
                if body_str:
                    raw_sections.append((cur_title or "Introduction", _markdown_body_to_html(body_str)))
                cur_title = m.group(1).strip()
                cur_lines = []
            else:
                cur_lines.append(ln)
        tail_body = "\n".join(cur_lines).strip()
        if tail_body:
            raw_sections.append((cur_title or "Chapter 1", _markdown_body_to_html(tail_body)))
    else:
        body_html = _markdown_body_to_html(text)
        p_blocks = re.findall(r"<(?:p|h[2-6]|blockquote|ul|ol)\b[\s\S]*?</(?:p|h[2-6]|blockquote|ul|ol)>", body_html)
        raw_sections = _split_large_paragraphs_into_chapters(p_blocks or [body_html])

    return {
        "title": meta_title,
        "subtitle": meta_subtitle,
        "author_name": meta_author,
        "chapters": _finalize_chapters(raw_sections),
    }


def _extract_html_or_txt(raw_text: str) -> dict[str, Any]:
    """解析 `.txt` 纯文本或带 HTML 段落标签的手稿输入。"""
    text = raw_text.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")

    # 若本身包含结构化 HTML 标题/段落标签，按 HTML 标题切章后净化
    if re.search(r"<(?:h[1-6]|p|div|section|article|blockquote)\b", text, flags=re.IGNORECASE):
        sanitized_full = sanitize_chapter_html(text)
        parts = re.split(r"(<h[12]\b[^>]*>[\s\S]*?</h[12]>)", sanitized_full, flags=re.IGNORECASE)
        chapters: list[tuple[str, str]] = []
        pending_title = ""
        for part in parts:
            if not part or not part.strip():
                continue
            hm = re.match(r"^<h[12]\b[^>]*>([\s\S]*?)</h[12]>$", part.strip(), flags=re.IGNORECASE)
            if hm:
                pending_title = re.sub(r"\s+", " ", html.unescape(strip_html_tags(hm.group(1)))).strip()
            else:
                chapters.append((pending_title or "Introduction", part))
                pending_title = ""
        if not chapters and sanitized_full:
            p_blocks = re.findall(r"<(?:p|blockquote|ul|ol)\b[\s\S]*?</(?:p|blockquote|ul|ol)>", sanitized_full)
            chapters = _split_large_paragraphs_into_chapters(p_blocks or [sanitized_full])
        return {"title": "", "subtitle": "", "author_name": "", "chapters": _finalize_chapters(chapters)}

    # 若文本内明显出现 Markdown 标题或加粗标记，走 Markdown 解析分支体验更佳
    if re.search(r"(?:^|\n)#{1,3}\s+\S", text):
        return _extract_markdown(text)

    # 纯文本：识别空行之间的独立 Chapter/Part 标题行，其余按空行拼合段落
    raw_paras = [p.strip() for p in re.split(r"\n\s*\n+", text) if p.strip()]
    chapters = []
    cur_title = ""
    cur_blocks: list[str] = []
    flat_blocks: list[str] = []

    for para in raw_paras:
        lines = [ln.strip() for ln in para.splitlines() if ln.strip()]
        if len(lines) == 1 and len(lines[0]) <= 105 and CHAPTER_HEADING_RE.match(lines[0]):
            if cur_title and cur_blocks:
                chapters.append((cur_title, "\n".join(cur_blocks)))
            elif flat_blocks and not chapters:
                chapters.append(("Introduction", "\n".join(flat_blocks)))
                flat_blocks.clear()
            cur_title = lines[0]
            cur_blocks = []
            continue

        # 兼容单行紧接正文的情况：第一行是 Chapter N 且后面还有多行正文
        if len(lines) >= 2 and len(lines[0]) <= 105 and CHAPTER_HEADING_RE.match(lines[0]):
            if cur_title and cur_blocks:
                chapters.append((cur_title, "\n".join(cur_blocks)))
            elif flat_blocks and not chapters:
                chapters.append(("Introduction", "\n".join(flat_blocks)))
                flat_blocks.clear()
            cur_title = lines[0]
            body_para = f"<p>{html.escape(' '.join(lines[1:]))}</p>"
            cur_blocks = [body_para]
            continue

        p_html = f"<p>{html.escape(' '.join(lines))}</p>"
        if cur_title or chapters:
            cur_blocks.append(p_html)
        else:
            flat_blocks.append(p_html)

    if cur_title and cur_blocks:
        chapters.append((cur_title, "\n".join(cur_blocks)))

    if not chapters:
        chapters = _split_large_paragraphs_into_chapters(flat_blocks)

    return {"title": "", "subtitle": "", "author_name": "", "chapters": _finalize_chapters(chapters)}


def parse_manuscript_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """统一入口：解析上传的 `.docx`/`.epub`/`.md`/`.txt` 文件或纯文本书稿，返回标准章节与统计数据。"""
    filename = str(payload.get("filename") or "").strip()
    ext = Path(filename).suffix.lower() if filename else ""
    content_b64 = str(payload.get("content_base64") or "").strip()
    raw_text = str(payload.get("raw_text") or "").strip()

    if content_b64:
        raw_bytes = _decode_base64_bytes(content_b64)
        if ext == ".docx":
            parsed = _extract_docx(raw_bytes)
        elif ext == ".epub":
            parsed = _extract_epub(raw_bytes)
        elif ext in (".md", ".markdown"):
            parsed = _extract_markdown(raw_bytes.decode("utf-8", errors="replace"))
        elif ext in (".txt", ".html", ".htm", ""):
            parsed = _extract_html_or_txt(raw_bytes.decode("utf-8", errors="replace"))
        else:
            raise ValueError(f"Unsupported manuscript file format `{ext}`. Use .docx, .epub, .md, or .txt.")
    elif raw_text:
        if ext in (".md", ".markdown"):
            parsed = _extract_markdown(raw_text)
        else:
            parsed = _extract_html_or_txt(raw_text)
    else:
        raise ValueError("Please upload a manuscript file (.docx, .epub, .md, .txt) or paste your manuscript text.")

    chapters = parsed.get("chapters") or []
    total_words = sum(int(ch.get("word_count") or 0) for ch in chapters)
    if total_words < MIN_MANUSCRIPT_WORDS:
        raise ValueError(
            f"Manuscript appears too short ({total_words} words, minimum {MIN_MANUSCRIPT_WORDS} words). "
            "Please upload a complete .docx, .epub, .md, or .txt manuscript."
        )

    # 按 6x9 标准非虚构专著估算平装总页数（向上取偶数，最低 24 页）
    est_raw = max(24, int(round(total_words / 265)) + 6)
    estimated_pages = est_raw if est_raw % 2 == 0 else est_raw + 1

    final_title = str(payload.get("title") or "").strip() or parsed.get("title") or ""
    if not final_title and filename:
        final_title = Path(filename).stem.replace("_", " ").replace("-", " ").strip().title()
    final_subtitle = str(payload.get("subtitle") or "").strip() or parsed.get("subtitle") or ""
    final_author = str(payload.get("author_name") or "").strip() or parsed.get("author_name") or ""

    return {
        "title": final_title[:200],
        "subtitle": final_subtitle[:250],
        "author_name": final_author[:160],
        "total_word_count": total_words,
        "estimated_pages": estimated_pages,
        "chapters": chapters,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="PublishGuard Manuscript Parser")
    parser.add_argument("--stdin", action="store_true", help="Read JSON payload from stdin")
    args = parser.parse_args()

    if not args.stdin:
        print(json.dumps({"error": "Pass --stdin with JSON payload"}))
        return 1

    try:
        payload = json.loads(sys.stdin.read() or "{}")
        result = parse_manuscript_payload(payload)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
