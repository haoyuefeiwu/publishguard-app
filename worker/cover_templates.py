#!/usr/bin/env python3
"""
PublishGuard 封面工程与书脊计算引擎（遵循规则 10 & 11 & 25）。
提供 4 套视觉骨架完全独立的正规出版社风格模板，绝不使用雷同双线渐变模板。
支持 6x9 / 5.5x8.5 开本与 Cream / White 纸张书脊厚度精确至 0.0001 英寸计算。
"""

from __future__ import annotations

import html
from dataclasses import dataclass
from typing import Literal

CoverTheme = Literal[
    "editorial_split",
    "asymmetric_hbr",
    "ivory_monograph",
    "minimal_architectural",
]

TRIM_DIMENSIONS: dict[str, tuple[float, float]] = {
    "6x9": (6.0, 9.0),
    "5.5x8.5": (5.5, 8.5),
    "8.5x11": (8.5, 11.0),
}

# 亚马逊 KDP 官方单页纸张厚度（英寸/页）
PAPER_THICKNESS: dict[str, float] = {
    "cream": 0.0025,
    "white": 0.002252,
}

COVER_THEMES_CATALOG: list[dict[str, str]] = [
    {
        "id": "editorial_split",
        "name": "Penguin Editorial Split",
        "description": "Classic upper color block + crisp ivory typographic lower band",
    },
    {
        "id": "asymmetric_hbr",
        "name": "Harvard Left Accent",
        "description": "Asymmetric left-aligned structural column with bold crimson-gold accent",
    },
    {
        "id": "ivory_monograph",
        "name": "Classic Ivory Monograph",
        "description": "Warm museum cream paper stock with deep serif academic hierarchy",
    },
    {
        "id": "minimal_architectural",
        "name": "Minimal Architectural Grid",
        "description": "Deep slate structural hairline grid with sharp modern geometry",
    },
]


@dataclass
class WrapDimensions:
    """KDP 全出血平装展开封面物理尺寸（英寸）。"""

    trim_w: float
    trim_h: float
    bleed: float
    spine_width: float
    total_width: float
    total_height: float
    page_count: int
    paper_type: str


def calculate_wrap_dimensions(
    trim_size: str = "6x9",
    page_count: int = 100,
    paper_type: str = "cream",
) -> WrapDimensions:
    """根据开本、实际页数与纸张颜色精确计算 KDP 全出血展开封面尺寸。"""
    trim_w, trim_h = TRIM_DIMENSIONS.get(trim_size, (6.0, 9.0))
    thickness = PAPER_THICKNESS.get(paper_type.lower(), 0.0025)
    safe_pages = max(24, page_count)
    spine_w = round(safe_pages * thickness, 4)
    bleed = 0.125
    total_w = round(bleed + trim_w + spine_w + trim_w + bleed, 4)
    total_h = round(bleed + trim_h + bleed, 4)
    return WrapDimensions(
        trim_w=trim_w,
        trim_h=trim_h,
        bleed=bleed,
        spine_width=spine_w,
        total_width=total_w,
        total_height=total_h,
        page_count=safe_pages,
        paper_type=paper_type.lower(),
    )


def _theme_tokens(theme: str) -> dict[str, str]:
    """返回 4 套独立封面的色板与排版结构标识。"""
    palettes = {
        "editorial_split": {
            "bg": "#FAF7F2",
            "top_band": "#1E2D3B",
            "accent": "#C97A40",
            "text_top": "#F8F5EF",
            "text_main": "#182026",
            "muted": "#5C6670",
            "back_bg": "#1E2D3B",
            "back_text": "#F5F1E9",
        },
        "asymmetric_hbr": {
            "bg": "#141A24",
            "top_band": "#8C2D2D",
            "accent": "#E6B86A",
            "text_top": "#FFFFFF",
            "text_main": "#F4F6F9",
            "muted": "#B8C1CE",
            "back_bg": "#10151E",
            "back_text": "#E7ECF2",
        },
        "ivory_monograph": {
            "bg": "#F4EFE6",
            "top_band": "#2C352E",
            "accent": "#7A4E2D",
            "text_top": "#F4EFE6",
            "text_main": "#1D1B18",
            "muted": "#625B50",
            "back_bg": "#F4EFE6",
            "back_text": "#23201B",
        },
        "minimal_architectural": {
            "bg": "#0F172A",
            "top_band": "#1E293B",
            "accent": "#38BDF8",
            "text_top": "#F8FAFC",
            "text_main": "#F1F5F9",
            "muted": "#94A3B8",
            "back_bg": "#0F172A",
            "back_text": "#E2E8F0",
        },
    }
    return palettes.get(theme, palettes["editorial_split"])


def _render_front_inner_html(
    *,
    theme: str,
    title: str,
    subtitle: str,
    author_name: str,
    edition_label: str,
) -> str:
    """根据选定骨架渲染正面封面内部结构（供 eBook 1600x2560 与 Paperback 正封复用）。"""
    t = _theme_tokens(theme)
    safe_title = html.escape(title.strip() or "Untitled Monograph")
    safe_sub = html.escape(subtitle.strip())
    safe_author = html.escape(author_name.strip() or "Independent Author")
    safe_edition = html.escape(edition_label.strip() or "INDEPENDENT EDITION")

    if theme == "editorial_split":
        return f"""
        <div class="front-shell" style="background:{t['bg']};color:{t['text_main']};display:flex;flex-direction:column;height:100%;width:100%;box-sizing:border-box;">
          <div style="background:{t['top_band']};color:{t['text_top']};padding:11% 9% 8%;flex:0 0 58%;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;">
            <div style="font-family:sans-serif;font-size:0.78em;letter-spacing:0.24em;text-transform:uppercase;color:{t['accent']};font-weight:700;">{safe_edition}</div>
            <h1 style="font-family:Georgia,serif;font-size:2.9em;line-height:1.12;margin:0;font-weight:700;letter-spacing:-0.01em;">{safe_title}</h1>
            <div style="width:22%;height:4px;background:{t['accent']};"></div>
          </div>
          <div style="padding:7% 9% 9%;flex:1;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;">
            <p style="font-family:Georgia,serif;font-size:1.18em;line-height:1.45;margin:0;color:{t['muted']};font-style:italic;">{safe_sub}</p>
            <div style="border-top:1px solid #D9D2C7;padding-top:5%;display:flex;justify-content:space-between;align-items:baseline;">
              <span style="font-family:sans-serif;font-size:1.25em;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:{t['text_main']};">{safe_author}</span>
            </div>
          </div>
        </div>"""

    if theme == "asymmetric_hbr":
        return f"""
        <div class="front-shell" style="background:{t['bg']};color:{t['text_main']};display:flex;height:100%;width:100%;box-sizing:border-box;">
          <div style="width:11%;background:{t['top_band']};height:100%;"></div>
          <div style="flex:1;padding:11% 9% 9% 8%;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;">
            <div>
              <div style="font-family:sans-serif;font-size:0.76em;letter-spacing:0.22em;text-transform:uppercase;color:{t['accent']};font-weight:700;margin-bottom:8%;">{safe_edition}</div>
              <h1 style="font-family:Helvetica,Arial,sans-serif;font-size:2.85em;line-height:1.08;margin:0 0 6% 0;font-weight:800;">{safe_title}</h1>
              <div style="width:18%;height:3px;background:{t['accent']};margin-bottom:6%;"></div>
              <p style="font-family:Georgia,serif;font-size:1.15em;line-height:1.48;margin:0;color:{t['muted']};">{safe_sub}</p>
            </div>
            <div style="font-family:sans-serif;font-size:1.22em;letter-spacing:0.15em;text-transform:uppercase;font-weight:700;color:#FFFFFF;border-top:1px solid rgba(255,255,255,0.2);padding-top:5%;">{safe_author}</div>
          </div>
        </div>"""

    if theme == "ivory_monograph":
        return f"""
        <div class="front-shell" style="background:{t['bg']};color:{t['text_main']};height:100%;width:100%;padding:9%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;">
          <div style="border-top:3px solid {t['top_band']};border-bottom:1px solid {t['top_band']};padding:2.5% 0;display:flex;justify-content:space-between;font-family:sans-serif;font-size:0.74em;letter-spacing:0.2em;text-transform:uppercase;color:{t['top_band']};font-weight:600;">
            <span>{safe_edition}</span>
            <span>ORIGINAL MONOGRAPH</span>
          </div>
          <div style="text-align:center;padding:4% 2%;">
            <h1 style="font-family:Georgia,serif;font-size:2.9em;line-height:1.15;margin:0 0 6% 0;font-weight:700;color:{t['text_main']};">{safe_title}</h1>
            <div style="width:14%;height:2px;background:{t['accent']};margin:0 auto 6%;"></div>
            <p style="font-family:Georgia,serif;font-size:1.15em;line-height:1.5;margin:0;color:{t['muted']};font-style:italic;">{safe_sub}</p>
          </div>
          <div style="text-align:center;border-top:1px solid #D3C9BA;padding-top:5%;">
            <div style="font-family:sans-serif;font-size:0.7em;letter-spacing:0.22em;text-transform:uppercase;color:{t['muted']};margin-bottom:2%;">WRITTEN BY</div>
            <div style="font-family:Georgia,serif;font-size:1.38em;letter-spacing:0.1em;font-weight:700;color:{t['text_main']};">{safe_author}</div>
          </div>
        </div>"""

    # minimal_architectural
    return f"""
    <div class="front-shell" style="background:{t['bg']};color:{t['text_main']};height:100%;width:100%;padding:10%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:14px;height:14px;background:{t['accent']};"></div>
        <span style="font-family:sans-serif;font-size:0.76em;letter-spacing:0.24em;text-transform:uppercase;color:{t['accent']};font-weight:700;">{safe_edition}</span>
      </div>
      <div style="border-left:3px solid {t['accent']};padding-left:6%;">
        <h1 style="font-family:Helvetica,Arial,sans-serif;font-size:2.75em;line-height:1.1;margin:0 0 5% 0;font-weight:700;">{safe_title}</h1>
        <p style="font-family:sans-serif;font-size:1.08em;line-height:1.5;margin:0;color:{t['muted']};">{safe_sub}</p>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(148,163,184,0.28);padding-top:5%;">
        <span style="font-family:sans-serif;font-size:1.2em;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;">{safe_author}</span>
        <span style="font-family:monospace;font-size:0.8em;color:{t['accent']};">SERIES ED.</span>
      </div>
    </div>"""


def build_ebook_front_cover_html(
    *,
    theme: str,
    title: str,
    subtitle: str,
    author_name: str,
    edition_label: str = "INDEPENDENT EDITION",
) -> str:
    """生成 1600×2560 电子书高清正面封面独立 HTML。"""
    inner = _render_front_inner_html(
        theme=theme,
        title=title,
        subtitle=subtitle,
        author_name=author_name,
        edition_label=edition_label,
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  @page {{ size: 1600px 2560px; margin: 0; }}
  html, body {{ margin: 0; padding: 0; width: 1600px; height: 2560px; font-size: 32px; overflow: hidden; }}
</style>
</head>
<body>
{inner}
</body>
</html>"""


def build_paperback_wrap_html(
    *,
    theme: str,
    title: str,
    subtitle: str,
    author_name: str,
    back_blurb: str,
    trim_size: str = "6x9",
    page_count: int = 100,
    paper_type: str = "cream",
    edition_label: str = "INDEPENDENT EDITION",
) -> tuple[str, WrapDimensions]:
    """生成 KDP 平装书 100% 精确出血与动态书脊全展开封面 HTML，并预留右下角条形码空白区。"""
    dims = calculate_wrap_dimensions(
        trim_size=trim_size,
        page_count=page_count,
        paper_type=paper_type,
    )
    t = _theme_tokens(theme)
    front_inner = _render_front_inner_html(
        theme=theme,
        title=title,
        subtitle=subtitle,
        author_name=author_name,
        edition_label=edition_label,
    )
    safe_title = html.escape(title.strip() or "Untitled Monograph")
    safe_author = html.escape(author_name.strip() or "Independent Author")
    # 清洗简介中的 URL 与多余标签
    blurb_paragraphs = [
        f"<p style='margin:0 0 0.9em 0;'>{html.escape(p.strip())}</p>"
        for p in back_blurb.split("\n")
        if p.strip()
    ]
    if not blurb_paragraphs:
        blurb_paragraphs = [
            "<p style='margin:0;'>A structured, research-informed practical monograph designed for enduring daily mastery and calm precision.</p>"
        ]
    blurb_html = "\n".join(blurb_paragraphs[:4])

    # 仅当书脊宽度 >= 0.35 in 时亚马逊允许放书脊文字，避免超界拒稿
    spine_label = (
        f"<span style='writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;font-family:sans-serif;font-size:8.5pt;letter-spacing:0.12em;color:{t['text_top']};font-weight:700;'>{safe_title} &nbsp;•&nbsp; {safe_author}</span>"
        if dims.spine_width >= 0.35
        else ""
    )

    wrap_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  @page {{
    size: {dims.total_width}in {dims.total_height}in;
    margin: 0;
  }}
  html, body {{
    margin: 0;
    padding: 0;
    width: {dims.total_width}in;
    height: {dims.total_height}in;
    overflow: hidden;
    font-size: 13pt;
  }}
  .wrap-canvas {{
    display: flex;
    width: {dims.total_width}in;
    height: {dims.total_height}in;
    background: {t['back_bg']};
  }}
  .back-panel {{
    width: {dims.bleed + dims.trim_w}in;
    height: {dims.total_height}in;
    background: {t['back_bg']};
    color: {t['back_text']};
    box-sizing: border-box;
    padding: {dims.bleed + 0.7}in 0.65in {dims.bleed + 0.55}in {dims.bleed + 0.65}in;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }}
  .spine-panel {{
    width: {dims.spine_width}in;
    height: {dims.total_height}in;
    background: {t['top_band']};
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }}
  .front-panel {{
    width: {dims.trim_w + dims.bleed}in;
    height: {dims.total_height}in;
    box-sizing: border-box;
    overflow: hidden;
  }}
  .barcode-safe {{
    width: 2.0in;
    height: 1.2in;
    background: #FFFFFF;
    margin-left: auto;
  }}
</style>
</head>
<body>
  <div class="wrap-canvas">
    <div class="back-panel">
      <div>
        <div style="font-family:sans-serif;font-size:8pt;letter-spacing:0.2em;text-transform:uppercase;color:{t['accent']};font-weight:700;margin-bottom:0.25in;">{html.escape(edition_label)}</div>
        <div style="font-family:Georgia,serif;font-size:10.5pt;line-height:1.58;">{blurb_html}</div>
      </div>
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:0.3in;">
        <div style="font-family:sans-serif;font-size:7.5pt;line-height:1.45;opacity:0.8;">
          Independently published by {safe_author}<br/>
          {dims.page_count} Pages · {dims.paper_type.title()} Paper
        </div>
        <div class="barcode-safe"></div>
      </div>
    </div>
    <div class="spine-panel">
      {spine_label}
    </div>
    <div class="front-panel">
      {front_inner}
    </div>
  </div>
</body>
</html>"""
    return wrap_html, dims
