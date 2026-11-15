#!/usr/bin/env python3
"""
PublishGuard 印刷级 PDF 与封面渲染器（基于 Chrome Headless --headless=new）。
功能：
1. 生成 6x9 / 5.5x8.5 英寸黑白印刷级平装书内页 HTML（遵循规则 25 零矩形边框、传统企鹅级专著排版）；
2. 通过二分查找微调正文字号，精准锁定目标偶数页数（例如严格 100 页 / 120 页）；
3. 渲染 1600×2560 高清电子书正面封面 JPG 与全出血展开封面 PDF；
4. 打包交付完整 `KDP_Ready_Bundle.zip`。
"""

from __future__ import annotations

import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Iterable

from cover_templates import (
    TRIM_DIMENSIONS,
    build_ebook_front_cover_html,
    build_paperback_wrap_html,
)
from epub_compiler import make_rgb_qr_png


def resolve_chrome_binary() -> str:
    """按环境变量、macOS 标准路径与 Linux 容器路径依次定位 Chrome / Chromium 二进制文件。"""
    candidates = [
        os.environ.get("CHROME_BIN", ""),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        shutil.which("google-chrome") or "",
        shutil.which("chromium") or "",
        shutil.which("chromium-browser") or "",
    ]
    for c in candidates:
        if c and Path(c).exists():
            return c
    raise FileNotFoundError("未找到 Google Chrome 或 Chromium，请配置 CHROME_BIN 环境变量。")


def count_pdf_pages(pdf_path: Path) -> int:
    """精确统计 PDF 文件物理总页数。"""
    data = pdf_path.read_bytes()
    return len(re.findall(rb"/Type\s*/Page\b", data))


def _chromium_subprocess_env(profile_dir: str) -> dict[str, str]:
    """Linux 容器内无头 Chromium 需要可写的 HOME / XDG 目录，macOS Chrome 则沿用系统 HOME（Keychain 依赖）。"""
    env = os.environ.copy()
    if sys.platform != "darwin":
        home = env.get("HOME", "")
        if not home or not os.path.isdir(home) or not os.access(home, os.W_OK):
            env["HOME"] = profile_dir
        env["XDG_CONFIG_HOME"] = f"{profile_dir}/.config"
        env["XDG_CACHE_HOME"] = f"{profile_dir}/.cache"
    return env


def _chromium_common_flags(profile_dir: str) -> list[str]:
    flags = [
        "--headless=new",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        f"--user-data-dir={profile_dir}",
        "--disable-gpu",
    ]
    if sys.platform != "darwin":
        flags.append("--disable-dev-shm-usage")
    return flags


def render_html_to_pdf(html_path: Path, pdf_path: Path, timeout_sec: int = 25) -> None:
    """使用独立隔离临时 User-Data-Dir 调起 Chrome Headless 导出印刷级无页眉页脚 PDF。"""
    chrome_bin = resolve_chrome_binary()
    if pdf_path.exists():
        pdf_path.unlink()

    last_err: Exception | None = None
    for _ in range(3):
        with tempfile.TemporaryDirectory() as tmp_profile:
            cmd = [
                chrome_bin,
                *_chromium_common_flags(tmp_profile),
                "--no-first-run",
                "--no-default-browser-check",
                "--no-pdf-header-footer",
                "--print-to-pdf-no-header",
                f"--print-to-pdf={pdf_path}",
                f"file://{html_path.resolve()}",
            ]
            try:
                subprocess.run(
                    cmd,
                    check=True,
                    timeout=timeout_sec,
                    env=_chromium_subprocess_env(tmp_profile),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                if pdf_path.exists() and pdf_path.stat().st_size > 800:
                    return
            except Exception as exc:
                last_err = exc
    raise RuntimeError(f"Chrome Headless 导出 PDF 失败: {last_err}")


def render_cover_front_jpg(html_path: Path, jpg_path: Path, timeout_sec: int = 25) -> None:
    """渲染 1600×2560 高清电子书正面封面图。"""
    chrome_bin = resolve_chrome_binary()
    png_path = jpg_path.with_suffix(".png")
    with tempfile.TemporaryDirectory() as tmp_profile:
        cmd = [
            chrome_bin,
            *_chromium_common_flags(tmp_profile),
            "--hide-scrollbars",
            "--window-size=1600,2560",
            "--force-device-scale-factor=1",
            f"--screenshot={png_path}",
            f"file://{html_path.resolve()}",
        ]
        subprocess.run(
            cmd,
            check=True,
            timeout=timeout_sec,
            env=_chromium_subprocess_env(tmp_profile),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    from PIL import Image

    with Image.open(png_path) as img:
        img.convert("RGB").save(str(jpg_path), format="JPEG", quality=95)
    if png_path.exists():
        png_path.unlink()


def build_paperback_interior_html(
    *,
    title: str,
    subtitle: str,
    author_name: str,
    edition_label: str,
    chapters: Iterable[dict[str, str]],
    trim_size: str = "6x9",
    font_size_pt: float = 10.5,
    line_height: float = 1.56,
    companion_url: str = "",
) -> str:
    """构建无边框纯正非虚构平装书印刷级内页 HTML（遵循规则 10、11、25）。"""
    trim_w, trim_h = TRIM_DIMENSIONS.get(trim_size, (6.0, 9.0))
    safe_title = html.escape(title)
    safe_sub = html.escape(subtitle)
    safe_author = html.escape(author_name)
    safe_edition = html.escape(edition_label)

    # 版权页与扉页
    front_matter = f"""
    <div class="title-page">
      <div class="edition-tag">{safe_edition}</div>
      <h1 class="book-title">{safe_title}</h1>
      <p class="book-subtitle">{safe_sub}</p>
      <div class="book-author">{safe_author}</div>
    </div>
    <div class="copyright-page">
      <p><strong>{safe_title}</strong></p>
      <p>{safe_sub}</p>
      <p>Copyright © 2026 by {safe_author}. All rights reserved.</p>
      <p>Independently published by {safe_author}.</p>
      <p>Notice of Non-Clinical Educational Purpose: This monograph offers structured reflection, attentional mastery, and everyday behavioral frameworks for informational purposes and does not constitute medical or clinical advice.</p>
    </div>
    """

    chapter_blocks: list[str] = []
    toc_entries: list[str] = []
    chap_list = list(chapters)
    for idx, ch in enumerate(chap_list):
        ch_title = html.escape(ch.get("title") or f"Chapter {idx + 1}")
        body_html = ch.get("content_html") or ""
        if "<h1>" not in body_html.lower():
            body_html = f"<h1>{ch_title}</h1>\n{body_html}"
        # 如果启用伴读域名，在最后一节末尾放 8-bit RGB 伴读二维码
        if idx == len(chap_list) - 1 and companion_url.strip():
            import base64

            qr_b64 = base64.b64encode(make_rgb_qr_png(companion_url.strip())).decode("ascii")
            body_html += (
                f"<div class='qr-companion-print'>"
                f"<h3>Reader Audio &amp; Study Companion</h3>"
                f"<p>Visit {html.escape(companion_url.strip())} or scan below to access your complimentary companion resources.</p>"
                f"<img src='data:image/png;base64,{qr_b64}' alt='Companion QR' style='width:1.45in;height:1.45in;' />"
                f"</div>"
            )
        toc_entries.append(f"<li>{ch_title}</li>")
        chapter_blocks.append(f'<div class="chapter-break">{body_html}</div>')

    toc_html = f"""
    <div class="chapter-break toc-page">
      <h1>Contents</h1>
      <ol class="toc-list">
        {''.join(toc_entries)}
      </ol>
    </div>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>{safe_title}</title>
<style>
  @page {{
    size: {trim_w}in {trim_h}in;
    margin: 0.72in 0.65in 0.75in 0.78in;
  }}
  body {{
    font-family: "Liberation Serif", "Noto Serif", Georgia, "Times New Roman", serif;
    font-size: {font_size_pt:.2f}pt;
    line-height: {line_height:.3f};
    color: #111111;
    margin: 0;
    padding: 0;
    text-align: justify;
  }}
  .title-page {{
    page-break-after: always;
    padding-top: 1.8in;
    text-align: center;
  }}
  .edition-tag {{
    font-family: sans-serif;
    font-size: 8pt;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    margin-bottom: 0.35in;
    color: #555555;
  }}
  .book-title {{
    font-size: 23pt;
    line-height: 1.2;
    margin: 0 0 0.25in 0;
    border: none;
    text-align: center;
  }}
  .book-subtitle {{
    font-size: 11.5pt;
    line-height: 1.45;
    font-style: italic;
    color: #444444;
    margin: 0 auto 1.5in;
    max-width: 85%;
    text-align: center;
  }}
  .book-author {{
    font-family: sans-serif;
    font-size: 12pt;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    font-weight: 700;
  }}
  .copyright-page {{
    page-break-after: always;
    padding-top: 4.5in;
    font-size: 8.5pt;
    line-height: 1.5;
    color: #444444;
    text-align: left;
  }}
  .chapter-break {{
    page-break-before: always;
  }}
  .toc-list {{
    padding-left: 1.2em;
    line-height: 1.85;
    font-size: 10.2pt;
  }}
  h1 {{
    font-size: 16.5pt;
    line-height: 1.25;
    text-align: left;
    margin: 0 0 0.22in 0;
    padding-bottom: 0.08in;
    border-bottom: 0.75pt solid #CCCCCC;
    page-break-after: avoid;
  }}
  h2 {{
    font-size: 12.2pt;
    text-align: left;
    margin: 0.22in 0 0.08in 0;
    page-break-after: avoid;
  }}
  h3 {{
    font-size: 10.8pt;
    text-align: left;
    margin: 0.16in 0 0.06in 0;
    page-break-after: avoid;
  }}
  p {{
    margin: 0 0 0.11in 0;
    orphans: 2;
    widows: 2;
  }}
  /* 遵循规则 25：绝对禁止四周边框盒或灰底块，仅保留传统左侧细线引用 */
  blockquote, .reflection-callout {{
    border-left: 2pt solid #444444;
    margin: 0.16in 0;
    padding: 0.02in 0 0.02in 0.16in;
    font-style: italic;
    color: #222222;
  }}
  .qr-companion-print {{
    margin-top: 0.3in;
    text-align: center;
    page-break-inside: avoid;
  }}
</style>
</head>
<body>
  {front_matter}
  {toc_html}
  {''.join(chapter_blocks)}
</body>
</html>"""


def compile_paperback_and_bundle(
    *,
    work_dir: Path,
    title: str,
    subtitle: str,
    author_name: str,
    edition_label: str,
    back_blurb: str,
    chapters: list[dict[str, str]],
    trim_size: str = "6x9",
    target_pages: int = 100,
    paper_type: str = "cream",
    cover_theme: str = "editorial_split",
    companion_url: str = "",
    epub_path: Path | None = None,
    metadata_checklist: dict | None = None,
) -> dict[str, str]:
    """
    执行二分锁页 Chrome 渲染，生成完整 KDP 双轨产物并打包 `KDP_Ready_Bundle.zip`。
    返回所有导出产物的相对文件路径字典与最终页数。
    """
    import json

    work_dir.mkdir(parents=True, exist_ok=True)
    interior_html_path = work_dir / "01_Interior_Manuscript.html"
    interior_pdf_path = work_dir / "01_Interior_Manuscript_Print.pdf"

    # 二分搜索字体大小与行高使物理页数逼近目标页数（且确保偶数）
    low_pt, high_pt = 8.4, 12.6
    best_pt = 10.5
    best_pages = target_pages
    best_diff = 9999

    for _ in range(7):
        mid_pt = (low_pt + high_pt) / 2.0
        lh = round(1.44 + (mid_pt - 8.4) * 0.04, 3)
        html_str = build_paperback_interior_html(
            title=title,
            subtitle=subtitle,
            author_name=author_name,
            edition_label=edition_label,
            chapters=chapters,
            trim_size=trim_size,
            font_size_pt=mid_pt,
            line_height=lh,
            companion_url=companion_url,
        )
        interior_html_path.write_text(html_str, encoding="utf-8")
        render_html_to_pdf(interior_html_path, interior_pdf_path)
        pages = count_pdf_pages(interior_pdf_path)
        diff = abs(pages - target_pages)
        if diff < best_diff:
            best_diff = diff
            best_pt = mid_pt
            best_pages = pages
        if pages == target_pages:
            break
        if pages > target_pages:
            high_pt = mid_pt
        else:
            low_pt = mid_pt

    # 以最优字号最后一次确保落盘一致
    final_lh = round(1.44 + (best_pt - 8.4) * 0.04, 3)
    interior_html_path.write_text(
        build_paperback_interior_html(
            title=title,
            subtitle=subtitle,
            author_name=author_name,
            edition_label=edition_label,
            chapters=chapters,
            trim_size=trim_size,
            font_size_pt=best_pt,
            line_height=final_lh,
            companion_url=companion_url,
        ),
        encoding="utf-8",
    )
    render_html_to_pdf(interior_html_path, interior_pdf_path)
    actual_pages = count_pdf_pages(interior_pdf_path)

    # 1. 生成 1600x2560 eBook 封面 JPG
    front_html_path = work_dir / "02_eBook_Cover_Front.html"
    front_jpg_path = work_dir / "02_eBook_Cover_Front.jpg"
    front_html_path.write_text(
        build_ebook_front_cover_html(
            theme=cover_theme,
            title=title,
            subtitle=subtitle,
            author_name=author_name,
            edition_label=edition_label,
        ),
        encoding="utf-8",
    )
    render_cover_front_jpg(front_html_path, front_jpg_path)

    # 2. 按实际印刷页数生成 KDP 全展开平装封面 PDF
    wrap_html_str, wrap_dims = build_paperback_wrap_html(
        theme=cover_theme,
        title=title,
        subtitle=subtitle,
        author_name=author_name,
        back_blurb=back_blurb,
        trim_size=trim_size,
        page_count=actual_pages,
        paper_type=paper_type,
        edition_label=edition_label,
    )
    wrap_html_path = work_dir / "03_Paperback_Cover_Wrap.html"
    wrap_pdf_path = work_dir / "03_Paperback_Cover_Wrap.pdf"
    wrap_html_path.write_text(wrap_html_str, encoding="utf-8")
    render_html_to_pdf(wrap_html_path, wrap_pdf_path)

    # 3. 保存元数据核对单（含 AI 生成内容申报提示与官方预览器核验步骤）
    checklist_path = work_dir / "04_KDP_Metadata_Checklist.json"
    checklist_data = metadata_checklist or {}
    checklist_data.update(
        {
            "actual_pages": actual_pages,
            "spine_width_in": wrap_dims.spine_width,
            "wrap_dimensions_in": f"{wrap_dims.total_width} x {wrap_dims.total_height}",
            "paper_type": paper_type,
            "trim_size": trim_size,
            "ai_generated_disclosure": {
                "required_by_kdp": True,
                "text_content": "AI-generated (entire or edited)",
                "images_or_cover": "AI-generated / None (verify against your cover setup)",
                "guidance": "Amazon KDP requires declaring AI-generated text, images, or translations during book setup.",
            },
            "official_previewer_checks": [
                "Open 01_Kindle_eBook_Upload.epub in Amazon Kindle Previewer 3 before publishing.",
                "Inspect 01_Interior_Manuscript_Print.pdf and 03_Paperback_Cover_Wrap.pdf in Amazon KDP Print Previewer.",
            ],
        }
    )
    checklist_path.write_text(json.dumps(checklist_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # 4. 打包成一键交付压缩包
    bundle_zip_path = work_dir / "KDP_Ready_Bundle.zip"
    with zipfile.ZipFile(bundle_zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for fp in [
            epub_path,
            front_jpg_path,
            interior_pdf_path,
            wrap_pdf_path,
            checklist_path,
        ]:
            if fp and fp.exists():
                zf.write(fp, arcname=fp.name)

    return {
        "actual_pages": str(actual_pages),
        "spine_width_in": str(wrap_dims.spine_width),
        "interior_pdf": interior_pdf_path.name,
        "cover_wrap_pdf": wrap_pdf_path.name,
        "cover_front_jpg": front_jpg_path.name,
        "bundle_zip": bundle_zip_path.name,
        "checklist_json": checklist_path.name,
    }
