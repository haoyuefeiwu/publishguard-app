#!/usr/bin/env python3
"""
PublishGuard 章节 HTML 白名单安全净化器（基于 Python 标准库 html.parser，零第三方依赖）。
用途：
1. 防止恶意 <script>、<iframe>、<svg>、<style>、on* 事件属性、style 内联或 javascript: URL 进入章节表、前端预览、EPUB 3 与 Chrome Headless PDF 渲染器；
2. 遵循 KDP 规范：保留纯粹的非虚构专著排版标签，剥离外部可点击链接（仅保留 http/https 纯文本域名）。
"""

from __future__ import annotations

import html
from html.parser import HTMLParser
import re
from urllib.parse import urlparse

ALLOWED_TAGS: frozenset[str] = frozenset(
    {
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "br",
        "hr",
        "blockquote",
        "em",
        "i",
        "strong",
        "b",
        "u",
        "sub",
        "sup",
        "ul",
        "ol",
        "li",
        "span",
        "div",
        "pre",
        "code",
    }
)

VOID_TAGS: frozenset[str] = frozenset({"br", "hr"})

DROP_WITH_CONTENT_TAGS: frozenset[str] = frozenset(
    {
        "script",
        "style",
        "iframe",
        "frame",
        "frameset",
        "object",
        "embed",
        "applet",
        "svg",
        "math",
        "form",
        "input",
        "button",
        "textarea",
        "select",
        "option",
        "meta",
        "link",
        "base",
        "noscript",
        "template",
        "title",
        "head",
    }
)

SAFE_CLASS_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


def _clean_class_attr(raw: str | None) -> str:
    if not raw:
        return ""
    tokens = [tok for tok in raw.split() if SAFE_CLASS_TOKEN_RE.match(tok)]
    return " ".join(tokens)


def _extract_safe_http_domain(href: str | None) -> str:
    """仅允许从显式 http/https 链接中提取纯文本展示域名，拒绝 javascript:/data:/file: 等危险协议。"""
    if not href:
        return ""
    candidate = href.strip()
    if not candidate.lower().startswith(("http://", "https://")):
        return ""
    parsed = urlparse(candidate)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.netloc:
        return ""
    return re.sub(r"^https?://", "", candidate, flags=re.IGNORECASE).rstrip("/")


class _ChapterSanitizerParser(HTMLParser):
    def __init__(self) -> None:
        # convert_charrefs=True 统一解码实体后再安全重编码，阻断编码混淆绕过
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.open_tags: list[str] = []
        self.drop_stack: list[str] = []
        self.anchor_stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        low = tag.lower()
        if low in DROP_WITH_CONTENT_TAGS:
            self.drop_stack.append(low)
            return
        if self.drop_stack:
            return
        if low == "a":
            href = ""
            for k, v in attrs:
                if k and k.lower() == "href":
                    href = _extract_safe_http_domain(v)
                    break
            self.anchor_stack.append(href)
            return
        if low not in ALLOWED_TAGS:
            return

        attr_str = ""
        for k, v in attrs:
            if k and k.lower() == "class":
                cleaned_cls = _clean_class_attr(v)
                if cleaned_cls:
                    attr_str = f' class="{html.escape(cleaned_cls, quote=True)}"'
                break

        if low in VOID_TAGS:
            self.parts.append(f"<{low} />")
            return

        self.parts.append(f"<{low}{attr_str}>")
        self.open_tags.append(low)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        low = tag.lower()
        if low in VOID_TAGS and not self.drop_stack:
            self.parts.append(f"<{low} />")

    def handle_endtag(self, tag: str) -> None:
        low = tag.lower()
        if self.drop_stack:
            if low in self.drop_stack:
                while self.drop_stack:
                    popped = self.drop_stack.pop()
                    if popped == low:
                        break
            return
        if low == "a":
            if self.anchor_stack:
                domain = self.anchor_stack.pop()
                if domain:
                    self.parts.append(f' (<span class="url-text">{html.escape(domain)}</span>)')
            return
        if low not in ALLOWED_TAGS or low in VOID_TAGS:
            return
        if low in self.open_tags:
            while self.open_tags:
                top = self.open_tags.pop()
                self.parts.append(f"</{top}>")
                if top == low:
                    break

    def handle_data(self, data: str) -> None:
        if self.drop_stack or not data:
            return
        self.parts.append(html.escape(data, quote=False))

    def handle_comment(self, _data: str) -> None:
        # 丢弃所有 HTML 注释，避免条件注释或隐藏载荷穿透
        return

    def handle_decl(self, _decl: str) -> None:
        return

    def handle_pi(self, _data: str) -> None:
        return

    def finalize(self) -> str:
        while self.open_tags:
            top = self.open_tags.pop()
            self.parts.append(f"</{top}>")
        return "".join(self.parts).strip()


def sanitize_chapter_html(raw_html: str | None) -> str:
    """按严格白名单净化章节 HTML，保留合规专著排版结构并清除一切脚本、事件处理器与外部协议属性。"""
    if not raw_html:
        return ""
    cleaned_input = str(raw_html).replace("\x00", "")
    parser = _ChapterSanitizerParser()
    parser.feed(cleaned_input)
    parser.close()
    return parser.finalize()
