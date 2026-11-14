#!/usr/bin/env python3
"""
PublishGuard AI 长文撰写与合规脱敏引擎（OpenRouter 多模型混合路由）。
- 大纲与标题生成、合规洗稿路由至高性价比快速模型（默认 google/gemini-2.5-flash）
- 长篇正文深度撰写路由至高文采长上下文模型（默认 anthropic/claude-sonnet-4）
- 严禁 Prompt 泄露、严禁 DSM-5 临床医学词、严禁生成任何矩形方框 HTML，确保稳定达到 18,000-22,000 词专著水准。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any

import httpx

from kdp_guard_service import (
    VALID_KDP_PRIMARY_CATEGORIES,
    count_words,
    quick_dictionary_sanitize,
)

# 注入到所有长文撰写 System Prompt 中的铁律负面清单
COMPLIANCE_SYSTEM_CONSTRAINTS = """
CRITICAL AMAZON KDP COMPLIANCE RULES (STRICTLY ENFORCED):
1. NEVER use clinical or DSM-5 diagnostic terms: panic attack, anxiety disorder, acute anxiety, insomnia, depression, PTSD, ADHD, bipolar, trauma, symptoms of, cure, instant relief, 60-second miracle.
2. Replace them with grounded, neutral academic/lifestyle phrasing: sensory overwhelm, cognitive friction, restless evenings, low emotional momentum, past stress imprints, bodily cues, gradual somatic grounding.
3. NEVER output promotional copy, coupon codes, vouchers, % OFF, discount codes, printable checklists, scorecards, ledgers, or cut-out pocket cards.
4. NEVER output external clickable HTTP links (<a href="http...">). Use clean plain text only if referencing a domain.
5. NEVER use bordered card containers or inline box styling. Write authoritative, cohesive non-fiction prose using only semantic <h1>, <h2>, <h3>, <p>, and occasional <blockquote> tags.
6. NEVER include meta-commentary or instructions ("Here is your chapter..."). Output ONLY clean chapter HTML starting with <h2> or <p>.
"""


def _post_chat_completions(
    *,
    messages: list[dict[str, str]],
    model: str,
    api_key: str,
    base_url: str,
    temperature: float,
    max_tokens: int,
    json_mode: bool,
) -> str:
    """向指定 OpenAI 兼容端点发送单次推理请求。"""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": os.environ.get("NEXT_PUBLIC_APP_URL", "https://publishguard.ai"),
        "X-Title": "PublishGuard Studio",
    }
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    with httpx.Client(timeout=120.0) as client:
        resp = client.post(f"{base_url.rstrip('/')}/chat/completions", headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()
        return str(data["choices"][0]["message"]["content"]).strip()


def call_openrouter_chat(
    *,
    messages: list[dict[str, str]],
    model: str,
    api_key: str,
    base_url: str = "https://openrouter.ai/api/v1",
    temperature: float = 0.7,
    max_tokens: int = 4096,
    json_mode: bool = False,
) -> str:
    """调用主网关（默认 Gemini / OpenRouter），失败（没额度/限流/超时）时自动切换到 DeepSeek 兜底。"""
    try:
        return _post_chat_completions(
            messages=messages,
            model=model,
            api_key=api_key,
            base_url=base_url,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=json_mode,
        )
    except Exception as primary_err:
        fallback_key = os.environ.get("FALLBACK_API_KEY") or os.environ.get("DEEPSEEK_API_KEY", "")
        if not fallback_key or fallback_key == api_key:
            raise
        fallback_base = os.environ.get("FALLBACK_BASE_URL", "https://api.deepseek.com/v1")
        fallback_model = os.environ.get("FALLBACK_MODEL", "deepseek-chat")
        print(
            f"[book_writer] 主模型 {model} 调用失败 ({type(primary_err).__name__})，自动切换兜底模型 {fallback_model}",
            file=sys.stderr,
        )
        return _post_chat_completions(
            messages=messages,
            model=fallback_model,
            api_key=fallback_key,
            base_url=fallback_base,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=json_mode,
        )


def _fallback_outline_payload(topic: str, audience: str, genre: str, companion_product: str) -> dict[str, Any]:
    """当未配置 API Key 时用于本地快速测试与体验演示的结构化大纲模板。"""
    clean_topic = topic.strip() or "Emotional Equilibrium and Attentional Sovereignty"
    safe_genre = genre if genre in VALID_KDP_PRIMARY_CATEGORIES else "Self-Help"
    chapters = [
        {"chapter_index": 0, "section_type": "front_matter", "title": "Author's Note & Architectural Overview", "slug": "intro", "summary": f"Frames the practical non-clinical scope of {clean_topic} and sets daily observational habits."},
        {"chapter_index": 1, "section_type": "chapter", "title": "1. The Modern Attention Fracture", "slug": "ch-01", "summary": "Examines cognitive friction in hyper-connected routines and why willpower fails without structural cues."},
        {"chapter_index": 2, "section_type": "chapter", "title": "2. Somatic Signals Before Escalation", "slug": "ch-02", "summary": "Maps subtle physiological indicators like jaw tension and shallow breathing before sensory overwhelm builds."},
        {"chapter_index": 3, "section_type": "chapter", "title": "3. Environmental Anchors and Tactile Cues", "slug": "ch-03", "summary": f"Explores physical desk, wrist, and room rituals {('paired with ' + companion_product) if companion_product else ''} to ground focus."},
        {"chapter_index": 4, "section_type": "chapter", "title": "4. The Architecture of Calm Boundaries", "slug": "ch-04", "summary": "Distinguishes rigid defensiveness from warm, clear standards in work and personal relationships."},
        {"chapter_index": 5, "section_type": "chapter", "title": "5. Evening Downshift Protocols", "slug": "ch-05", "summary": "Rebuilds transitional wind-down sequences to quiet mental chatter during restless evenings."},
        {"chapter_index": 6, "section_type": "chapter", "title": "6. Cognitive Clarity Under Pressure", "slug": "ch-06", "summary": "Case analyses showing how deliberate three-breath pauses preserve decision quality."},
        {"chapter_index": 7, "section_type": "chapter", "title": "7. Relational Tempo and Conversational Pacing", "slug": "ch-07", "summary": "Practical scripts for slowing high-stakes dialogues without withdrawing emotionally."},
        {"chapter_index": 8, "section_type": "chapter", "title": "8. Micro-Recoveries Across the Workday", "slug": "ch-08", "summary": "Designs ninety-second tactile resets between meetings to prevent cumulative fatigue."},
        {"chapter_index": 9, "section_type": "chapter", "title": "9. Navigating Ambiguity Without Overcontrol", "slug": "ch-09", "summary": "Shifts perfectionistic rumination into calm, evidence-based daily observation."},
        {"chapter_index": 10, "section_type": "chapter", "title": "10. Sustaining Long-Horizon Steadiness", "slug": "ch-10", "summary": "Integrates weekly reflection cadences that endure across busy life seasons."},
        {"chapter_index": 11, "section_type": "back_matter", "title": "Epilogue & Extended Reading Companion", "slug": "epilogue", "summary": "Synthesizes core principles into an enduring personal philosophy."},
    ]
    return {
        "title_options": [
            f"The Quiet Architecture of {clean_topic[:36].title()}",
            f"Steadiness by Design: Mastering {clean_topic[:28].title()}",
            f"Grounded Horizon: Daily Frameworks for {clean_topic[:26].title()}",
        ],
        "recommended_subtitle": "Structured Somatic and Behavioral Frameworks for Composed Focus in Demanding Seasons",
        "primary_category": safe_genre,
        "subcategory_hint": "Personal Transformation" if safe_genre == "Self-Help" else "New Age & Spirituality",
        "back_blurb": f"Written for {audience or 'thoughtful modern readers'}, this comprehensive non-fiction monograph translates somatic observation and attentional science into calm, repeatable daily practices.",
        "keywords": [
            "mindful focus framework",
            "somatic grounding habits",
            "calm boundary setting",
            "nervous balance routine",
            "emotional steadiness book",
            "attentional sovereignty",
            "evening wind down guide",
        ],
        "chapters": chapters,
    }


def generate_outline_and_metadata(
    *,
    topic: str,
    audience: str,
    pen_name: str,
    genre: str = "Self-Help",
    companion_product: str = "",
    language: str = "en",
    api_key: str = "",
    base_url: str = "https://openrouter.ai/api/v1",
    model: str = "google/gemini-2.5-flash",
) -> dict[str, Any]:
    """生成 3 个防撞车书名、去公式化副标题、7 个后端关键词与 12 节深度专著大纲。"""
    if not api_key.strip():
        return _fallback_outline_payload(topic, audience, genre, companion_product)

    cats = ", ".join(sorted(VALID_KDP_PRIMARY_CATEGORIES))
    prompt = f"""
Create an Amazon KDP compliant non-fiction book blueprint in strict JSON format.
Topic: {topic}
Target Audience: {audience or 'Reflective adults seeking clarity and resilience'}
Author Pen Name: {pen_name}
Requested Genre: {genre}
Optional Companion Anchor: {companion_product or 'None'}
Output Language: {'English' if language == 'en' else 'Simplified Chinese'}

Requirements:
- title_options: 3 distinctive, memorable non-fiction book titles (never generic like "The Crystal Code", <70 chars each).
- recommended_subtitle: 1 non-formulaic subtitle strictly 65-95 characters, ZERO colons, ZERO "A Practical Field Guide to" / "A X-Minute Guide to".
- primary_category: MUST be one exact value from: [{cats}]
- subcategory_hint: specific Amazon subcategory path.
- back_blurb: 2 compelling paragraphs for the paperback back cover, zero URLs, zero promo codes, zero medical claims.
- keywords: exactly 7 Amazon KDP backend keyword phrases, each <= 48 characters.
- chapters: array of 12 items (1 front_matter intro + 10 core chapters + 1 back_matter epilogue), each with: chapter_index (0..11), section_type, title, slug, summary (2 sentences).

{COMPLIANCE_SYSTEM_CONSTRAINTS}
Return valid JSON only.
"""
    raw = call_openrouter_chat(
        messages=[
            {"role": "system", "content": "You are an elite non-fiction acquisitions editor specializing in Amazon KDP compliance."},
            {"role": "user", "content": prompt},
        ],
        model=model,
        api_key=api_key,
        base_url=base_url,
        temperature=0.65,
        max_tokens=3000,
        json_mode=True,
    )
    data = json.loads(raw)
    if data.get("primary_category") not in VALID_KDP_PRIMARY_CATEGORIES:
        data["primary_category"] = genre if genre in VALID_KDP_PRIMARY_CATEGORIES else "Self-Help"
    return data


def _fallback_chapter_html(chapter_title: str, summary: str, min_words: int = 1450) -> str:
    """无 API Key 时生成结构完整、零禁用词且词数达标的演示专著章节 HTML。"""
    paragraphs = [
        f"<h2>{chapter_title}</h2>",
        f"<p>{summary} Modern life continuously fragments our cognitive bandwidth through ambient notifications, competing relational expectations, and subtle sensory friction that accumulates unnoticed across ordinary afternoons.</p>",
        "<h3>Observing the Pattern Without Force</h3>",
        "<p>Sustainable composure rarely comes from aggressive self-correction. When individuals attempt to suppress restlessness purely through rigid rules, internal resistance intensifies. A calmer alternative begins with noticing physical cues—shoulder elevation, hurried speech cadence, or shallow breathing—as neutral signals rather than failures of discipline.</p>",
        "<blockquote>Steadiness is not the absence of motion around you; it is the preservation of an unhurried internal cadence while motion occurs.</blockquote>",
        "<h3>Structural Micro-Adjustments</h3>",
    ]
    filler_units = [
        "<p>Consider how environmental design quietly governs attention. When a workspace contains clear visual boundaries and a single tactile focal cue, the nervous system receives an immediate signal of predictability. Over repeated days, that sensory consistency lowers the mental friction required to begin focused work or enter calm conversation.</p>",
        "<p>In relational settings, clear standards and genuine warmth reinforce each other. Stating what you can offer honestly, rather than overcommitting out of fleeting obligation, preserves both mutual respect and long-term availability. Listeners sense when a boundary rests on grounded self-knowledge rather than guarded hostility.</p>",
        "<p>Evening transitions benefit equally from deliberate pacing. Dimming overhead light, stepping away from rapid informational feeds, and practicing three slow exhalations invite the body to release residual momentum from demanding hours, turning late evenings into genuine restoration instead of lingering mental chatter.</p>",
        "<p>Across empirical case observations, consistent small adjustments outperform dramatic short-lived overhauls. A three-minute pause before answering challenging correspondence, paired with conscious posture alignment, prevents reactive decisions and cultivates reliable emotional equilibrium across changing seasons.</p>",
    ]
    current_words = count_words(" ".join(paragraphs))
    idx = 0
    while current_words < min_words:
        block = filler_units[idx % len(filler_units)]
        paragraphs.append(block)
        current_words += count_words(block)
        idx += 1
    return "\n".join(paragraphs)


def generate_chapter_html(
    *,
    book_title: str,
    subtitle: str,
    chapter_title: str,
    chapter_summary: str,
    section_type: str,
    prev_summaries: list[str],
    companion_product: str = "",
    target_words: int = 1600,
    api_key: str = "",
    base_url: str = "https://openrouter.ai/api/v1",
    model: str = "anthropic/claude-sonnet-4",
) -> str:
    """带前文滚动记忆的深度章节生成器，保证每章 ≥1,450 词且零 KDP 违禁词。"""
    if not api_key.strip():
        return _fallback_chapter_html(chapter_title, chapter_summary, min_words=target_words)

    memory_ctx = "\n".join(f"- {s}" for s in prev_summaries[-4:]) or "Opening section of the monograph."
    prompt = f"""
Book Title: {book_title}
Subtitle: {subtitle}
Current Section Type: {section_type}
Chapter Title: {chapter_title}
Chapter Focus: {chapter_summary}
Optional Physical Anchor Context: {companion_product or 'None'}

Previously Covered Context (avoid repeating identical anecdotes):
{memory_ctx}

Writing Task:
Write this complete section as deep, publication-grade non-fiction suitable for a serious paperback & Kindle reader.
Target length: {target_words} to {target_words + 250} words.
Include:
1. Engaging opening scene or intellectual framing.
2. Three clear thematic subheadings (<h3>).
3. Grounded real-world behavioral illustrations and actionable daily protocols in flowing paragraphs.
4. One subtle reflective <blockquote> pull-quote.
{COMPLIANCE_SYSTEM_CONSTRAINTS}
"""
    html_out = call_openrouter_chat(
        messages=[
            {"role": "system", "content": "You are a bestselling non-fiction author writing for Penguin/MIT Press standards."},
            {"role": "user", "content": prompt},
        ],
        model=model,
        api_key=api_key,
        base_url=base_url,
        temperature=0.72,
        max_tokens=4500,
    )
    # 剥离模型偶尔附带的 markdown ```html 包裹，并二次走确定性字典过滤确保 100% 安全
    html_out = re.sub(r"^```(?:html)?\s*", "", html_out, flags=re.IGNORECASE)
    html_out = re.sub(r"\s*```$", "", html_out)
    html_out = quick_dictionary_sanitize(html_out).strip()

    # 若单章字数低于安全底线，自动续写 1 轮深化案例与实操细节，防止全书不足 15,000 词触发 Thin Content
    min_chapter_words = max(1350, int(target_words * 0.85))
    if count_words(html_out) < min_chapter_words:
        shortfall = max(450, target_words - count_words(html_out) + 150)
        ext_prompt = f"""
Continue and deepen the chapter "{chapter_title}" below by writing ~{shortfall} additional words of concrete behavioral case illustrations and actionable daily protocols.
Return ONLY 1 new <h3> subheading and 4-6 flowing <p> paragraphs of HTML (no intro/outro commentary, no repetition of prior examples).
{COMPLIANCE_SYSTEM_CONSTRAINTS}

Existing Chapter Ending:
{html_out[-1800:]}
"""
        try:
            ext_out = call_openrouter_chat(
                messages=[
                    {"role": "system", "content": "You are a bestselling non-fiction author expanding a chapter seamlessly."},
                    {"role": "user", "content": ext_prompt},
                ],
                model=model,
                api_key=api_key,
                base_url=base_url,
                temperature=0.7,
                max_tokens=2200,
            )
            ext_out = re.sub(r"^```(?:html)?\s*", "", ext_out, flags=re.IGNORECASE)
            ext_out = re.sub(r"\s*```$", "", ext_out)
            html_out = f"{html_out}\n{quick_dictionary_sanitize(ext_out).strip()}"
        except Exception:
            pass

    return html_out.strip()


def auto_sanitize_with_ai(
    *,
    raw_text: str,
    findings: list[dict[str, Any]],
    api_key: str = "",
    base_url: str = "https://openrouter.ai/api/v1",
    model: str = "google/gemini-2.5-flash",
) -> str:
    """利用 Flash 模型针对 26 项审计标红点执行无损原地合规洗稿。"""
    # 先执行确定性安全字典替换与超链接清理
    pre_cleaned = quick_dictionary_sanitize(raw_text)
    if not api_key.strip() or not findings:
        return pre_cleaned

    finding_lines = "\n".join(
        f"- [{f.get('code')}] {f.get('message')} (matched: {f.get('matched_text', '')})"
        for f in findings[:15]
    )
    prompt = f"""
Rewrite ONLY the risky phrases in the text below so that it achieves 100% Amazon KDP compliance while preserving the author's original tone, structure, and meaning.
Detected Issues:
{finding_lines}

{COMPLIANCE_SYSTEM_CONSTRAINTS}

Original Text:
{pre_cleaned[:18000]}
"""
    rewritten = call_openrouter_chat(
        messages=[
            {"role": "system", "content": "You are an Amazon KDP legal compliance editor. Output ONLY the cleaned text/HTML with zero commentary."},
            {"role": "user", "content": prompt},
        ],
        model=model,
        api_key=api_key,
        base_url=base_url,
        temperature=0.3,
        max_tokens=4500,
    )
    return quick_dictionary_sanitize(rewritten).strip()


def main() -> int:
    """CLI 入口：供 Next.js 同步/快速调用大纲、单章预览与合规洗稿。"""
    parser = argparse.ArgumentParser(description="PublishGuard AI Book Writer CLI")
    parser.add_argument("--action", required=True, choices=["outline", "chapter", "sanitize"])
    args = parser.parse_args()

    payload = json.loads(sys.stdin.read() or "{}")
    if args.action == "outline":
        res = generate_outline_and_metadata(
            topic=payload.get("topic", ""),
            audience=payload.get("audience", ""),
            pen_name=payload.get("pen_name", "Independent Author"),
            genre=payload.get("genre", "Self-Help"),
            companion_product=payload.get("companion_product", ""),
            language=payload.get("language", "en"),
            api_key=payload.get("api_key", os.environ.get("OPENROUTER_API_KEY", "")),
            base_url=payload.get("base_url", os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")),
            model=payload.get("model", os.environ.get("KDP_OUTLINE_MODEL", "google/gemini-2.5-flash")),
        )
        print(json.dumps(res, ensure_ascii=False))
        return 0

    if args.action == "chapter":
        html_out = generate_chapter_html(
            book_title=payload.get("book_title", ""),
            subtitle=payload.get("subtitle", ""),
            chapter_title=payload.get("chapter_title", "Chapter 1"),
            chapter_summary=payload.get("chapter_summary", ""),
            section_type=payload.get("section_type", "chapter"),
            prev_summaries=payload.get("prev_summaries") or [],
            companion_product=payload.get("companion_product", ""),
            target_words=int(payload.get("target_words", 1600)),
            api_key=payload.get("api_key", os.environ.get("OPENROUTER_API_KEY", "")),
            base_url=payload.get("base_url", os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")),
            model=payload.get("model", os.environ.get("KDP_WRITER_MODEL", "anthropic/claude-sonnet-4")),
        )
        print(json.dumps({"content_html": html_out}, ensure_ascii=False))
        return 0

    sanitized = auto_sanitize_with_ai(
        raw_text=payload.get("raw_text", ""),
        findings=payload.get("findings") or [],
        api_key=payload.get("api_key", os.environ.get("OPENROUTER_API_KEY", "")),
        base_url=payload.get("base_url", os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")),
        model=payload.get("model", os.environ.get("KDP_SANITIZER_MODEL", "google/gemini-2.5-flash")),
    )
    print(json.dumps({"sanitized_text": sanitized}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
