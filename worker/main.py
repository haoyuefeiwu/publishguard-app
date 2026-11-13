#!/usr/bin/env python3
"""
PublishGuard 持久化异步出版 Worker。
架构特性：
- 生产环境使用 PostgreSQL `pg_advisory_xact_lock` + `FOR UPDATE OF j SKIP LOCKED` + `240s lease` 心跳并发安全领单；
- 本地无 Postgres 时自动兼容 SQLite 队列轮询，确保单机即可全链路闭环；
- 执行全本长文生成、26 项 Pre-Flight Guard 审计、EPUB 3 编译与 Chrome Headless 6×9 印刷级双轨交付打包；
- 若任务最终异常失败且关联 `credit_id`，自动回滚退还用户对应积分。
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sqlite3
import sys
import time
import uuid
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

WORKER_DIR = Path(__file__).resolve().parent
APP_ROOT = WORKER_DIR.parent
sys.path.insert(0, str(WORKER_DIR))

from book_writer import generate_chapter_html
from cover_templates import build_ebook_front_cover_html
from epub_compiler import compile_epub
from kdp_guard_service import count_words, run_preflight_audit
from pdf_compiler import compile_paperback_and_bundle, render_cover_front_jpg

LEASE_SECONDS = 240
POLL_SECONDS = float(os.environ.get("WORKER_POLL_SECONDS", "3.0"))
ARTIFACTS_ROOT = Path(os.environ.get("KDP_ARTIFACTS_DIR", str(APP_ROOT / "data" / "kdp-artifacts")))
STOP = False


def _on_signal(_signum: int, _frame: Any) -> None:
    global STOP
    STOP = True


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _db_config_lookup(conn: Any, is_sqlite: bool) -> dict[str, str]:
    """从 config 表加载 OpenRouter / 模型配置，支持环境变量覆盖。"""
    keys = {
        "openrouter_api_key": os.environ.get("OPENROUTER_API_KEY", ""),
        "openrouter_base_url": os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        "kdp_writer_model": os.environ.get("KDP_WRITER_MODEL", "anthropic/claude-sonnet-4"),
        "kdp_outline_model": os.environ.get("KDP_OUTLINE_MODEL", "google/gemini-2.5-flash"),
    }
    try:
        cur = conn.cursor()
        cur.execute("SELECT name, value FROM config WHERE name IN ('openrouter_api_key', 'openrouter_base_url', 'kdp_writer_model', 'kdp_outline_model')")
        for name, val in cur.fetchall():
            # 仅当值非加密密文且非空时直接读取（加密配置建议通过环境变量或明文透传 payload）
            if val and not str(val).startswith("enc:"):
                keys[name] = str(val)
    except Exception:
        pass
    return keys


def _execute_book_pipeline(
    *,
    job: dict[str, Any],
    project: dict[str, Any],
    chapters: list[dict[str, Any]],
    pen_profile: dict[str, Any] | None,
    other_pen_domains: list[str],
    existing_titles: list[str],
    update_progress: Any,
    save_chapter_fn: Any,
    model_cfg: dict[str, str],
) -> dict[str, Any]:
    """执行完整造书编译流水线：逐章撰写 -> 26项Guard审计 -> 封面JPG -> EPUB 3 -> 印刷PDF+ZIP。"""
    project_id = project["id"]
    work_dir = ARTIFACTS_ROOT / project_id
    work_dir.mkdir(parents=True, exist_ok=True)

    author_name = (
        pen_profile["full_name"]
        if pen_profile and pen_profile.get("full_name")
        else "Evelyn Vance"
    )
    edition_label = (
        pen_profile["edition_label"]
        if pen_profile and pen_profile.get("edition_label")
        else "INDEPENDENT EDITION"
    )
    meta = json.loads(project.get("metadata_json") or "{}")

    # 1. 逐章撰写尚无正文或需要生成的章节
    total = max(1, len(chapters))
    prev_summaries: list[str] = []
    compiled_chapters: list[dict[str, str]] = []
    total_words = 0

    for idx, ch in enumerate(chapters):
        pct = 10 + int((idx / total) * 55)
        update_progress(pct, f"writing_chapter_{idx + 1}_of_{total}")

        content_html = (ch.get("content_html") or "").strip()
        if not content_html or count_words(content_html) < 900:
            content_html = generate_chapter_html(
                book_title=project["title"],
                subtitle=project.get("subtitle", ""),
                chapter_title=ch["title"],
                chapter_summary=ch.get("summary", ""),
                section_type=ch.get("section_type", "chapter"),
                prev_summaries=prev_summaries,
                companion_product=project.get("companion_product", ""),
                target_words=1650 if ch.get("section_type") == "chapter" else 1350,
                api_key=model_cfg.get("openrouter_api_key", ""),
                base_url=model_cfg.get("openrouter_base_url", "https://openrouter.ai/api/v1"),
                model=model_cfg.get("kdp_writer_model", "anthropic/claude-sonnet-4"),
            )
            wc = count_words(content_html)
            save_chapter_fn(ch["id"], content_html, wc)
        else:
            wc = count_words(content_html)

        total_words += wc
        if ch.get("summary"):
            prev_summaries.append(f"{ch['title']}: {ch['summary']}")
        compiled_chapters.append(
            {
                "title": ch["title"],
                "slug": ch["slug"],
                "content_html": content_html,
            }
        )

    # 2. 先渲染 1600x2560 高清正面封面（EPUB 内嵌用）
    update_progress(70, "rendering_cover_artwork")
    front_html_path = work_dir / "02_eBook_Cover_Front.html"
    front_jpg_path = work_dir / "02_eBook_Cover_Front.jpg"
    front_html_path.write_text(
        build_ebook_front_cover_html(
            theme=project.get("cover_theme", "editorial_split"),
            title=project["title"],
            subtitle=project.get("subtitle", ""),
            author_name=author_name,
            edition_label=edition_label,
        ),
        encoding="utf-8",
    )
    render_cover_front_jpg(front_html_path, front_jpg_path)
    cover_bytes = front_jpg_path.read_bytes() if front_jpg_path.exists() else None

    # 3. 编译规范 EPUB 3 文件
    update_progress(78, "compiling_epub3")
    epub_path = work_dir / "01_Kindle_eBook_Upload.epub"
    compile_epub(
        output_epub_path=epub_path,
        title=project["title"],
        subtitle=project.get("subtitle", ""),
        author_name=author_name,
        language=project.get("language", "en"),
        chapters=compiled_chapters,
        cover_jpg_bytes=cover_bytes,
        companion_url=project.get("companion_url", ""),
    )

    # 4. Chrome Headless 二分锁页渲染平装内页 PDF + 全展开封面 PDF + 打包 ZIP
    update_progress(86, "compiling_paperback_pdf")
    back_blurb = str(meta.get("back_blurb") or project.get("topic_prompt") or "")
    checklist_meta = {
        "title": project["title"],
        "subtitle": project.get("subtitle", ""),
        "author": author_name,
        "primary_category": project.get("genre", "Self-Help"),
        "subcategory_hint": meta.get("subcategory_hint", ""),
        "keywords": meta.get("keywords", []),
        "description": back_blurb,
        "cover_theme": project.get("cover_theme", "editorial_split"),
    }
    pdf_result = compile_paperback_and_bundle(
        work_dir=work_dir,
        title=project["title"],
        subtitle=project.get("subtitle", ""),
        author_name=author_name,
        edition_label=edition_label,
        back_blurb=back_blurb,
        chapters=compiled_chapters,
        trim_size=project.get("trim_size", "6x9"),
        target_pages=int(project.get("target_page_count", 100)),
        paper_type=project.get("paper_type", "cream"),
        cover_theme=project.get("cover_theme", "editorial_split"),
        companion_url=project.get("companion_url", ""),
        epub_path=epub_path,
        metadata_checklist=checklist_meta,
    )

    # 5. 运行最终 26 项 Pre-Flight Guard 物理把关
    update_progress(95, "running_26_rule_guard")
    full_manuscript_html = "\n".join(c["content_html"] for c in compiled_chapters)
    guard_res = run_preflight_audit(
        title=project["title"],
        subtitle=project.get("subtitle", ""),
        description=back_blurb,
        author_name=author_name,
        primary_category=project.get("genre", "Self-Help"),
        manuscript_text=full_manuscript_html,
        companion_domain=project.get("companion_url", ""),
        other_pen_domains=other_pen_domains,
        existing_pen_titles=existing_titles,
        mode="dual",
        check_live_collisions=True,
        enforce_min_words=True,
    )

    return {
        "actual_word_count": total_words,
        "guard_passed": guard_res.passed,
        "guard_score": guard_res.score,
        "guard_report": asdict(guard_res),
        "epub_key": f"{project_id}/{epub_path.name}",
        "interior_pdf_key": f"{project_id}/{pdf_result['interior_pdf']}",
        "cover_wrap_pdf_key": f"{project_id}/{pdf_result['cover_wrap_pdf']}",
        "cover_front_jpg_key": f"{project_id}/{pdf_result['cover_front_jpg']}",
        "bundle_zip_key": f"{project_id}/{pdf_result['bundle_zip']}",
        "actual_pages": int(pdf_result["actual_pages"]),
        "spine_width_in": pdf_result["spine_width_in"],
    }


def _refund_credit_on_failure_pg(cur: Any, credit_id: str) -> None:
    """在 Postgres 事务中失败退还已扣除积分（与 credits/service.ts revoke 语义一致）。"""
    if not credit_id:
        return
    cur.execute(
        "SELECT consumed_detail FROM credit WHERE id = %s AND transaction_type = 'consume' AND status = 'active' LIMIT 1",
        (credit_id,),
    )
    row = cur.fetchone()
    if not row or not row[0]:
        return
    items = json.loads(row[0])
    for item in items:
        cur.execute(
            "UPDATE credit SET remaining_credits = remaining_credits + %s WHERE id = %s",
            (int(item["creditsConsumed"]), item["creditId"]),
        )
    cur.execute("UPDATE credit SET status = 'deleted' WHERE id = %s", (credit_id,))


def run_once_postgres(dsn: str) -> bool:
    """PostgreSQL 模式下使用 SKIP LOCKED 安全抢占并执行一条 queued 任务。"""
    import psycopg
    from psycopg.rows import dict_row

    lease_id = str(uuid.uuid4())
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT pg_try_advisory_xact_lock(hashtext('kdp_job_claim'))")
                cur.execute(
                    """
                    SELECT * FROM kdp_job
                    WHERE (status = 'queued' OR (status = 'processing' AND lease_until < NOW()))
                      AND attempts < 3
                    ORDER BY created_at ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                    """
                )
                job = cur.fetchone()
                if not job:
                    return False

                lease_until = _utc_now() + timedelta(seconds=LEASE_SECONDS)
                cur.execute(
                    """
                    UPDATE kdp_job
                    SET status = 'processing',
                        lease = %s,
                        lease_until = %s,
                        attempts = attempts + 1,
                        current_step = 'claimed'
                    WHERE id = %s
                    """,
                    (lease_id, lease_until, job["id"]),
                )

        # 开始处理（主流程）
        def update_progress(pct: int, step: str) -> None:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE kdp_job SET progress_pct = %s, current_step = %s, lease_until = %s WHERE id = %s",
                        (pct, step, _utc_now() + timedelta(seconds=LEASE_SECONDS), job["id"]),
                    )

        def save_chapter(ch_id: str, html_str: str, wc: int) -> None:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE kdp_chapter SET content_html = %s, word_count = %s, status = 'generated', updated_at = NOW() WHERE id = %s",
                        (html_str, wc, ch_id),
                    )

        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM kdp_project WHERE id = %s", (job["project_id"],))
                project = cur.fetchone()
                if not project:
                    raise ValueError(f"Project not found: {job['project_id']}")

                cur.execute("SELECT * FROM kdp_chapter WHERE project_id = %s ORDER BY chapter_index ASC", (project["id"],))
                chapters = cur.fetchall()

                pen_profile = None
                if project.get("pen_profile_id"):
                    cur.execute("SELECT * FROM kdp_pen_profile WHERE id = %s", (project["pen_profile_id"],))
                    pen_profile = cur.fetchone()

                cur.execute(
                    "SELECT companion_domain FROM kdp_pen_profile WHERE user_id = %s AND id != %s",
                    (project["user_id"], project.get("pen_profile_id") or ""),
                )
                other_domains = [r["companion_domain"] for r in cur.fetchall() if r.get("companion_domain")]

                cur.execute(
                    "SELECT title FROM kdp_project WHERE user_id = %s AND id != %s",
                    (project["user_id"], project["id"]),
                )
                existing_titles = [r["title"] for r in cur.fetchall() if r.get("title")]

                model_cfg = _db_config_lookup(conn, False)

            result = _execute_book_pipeline(
                job=job,
                project=project,
                chapters=chapters,
                pen_profile=pen_profile,
                other_pen_domains=other_domains,
                existing_titles=existing_titles,
                update_progress=update_progress,
                save_chapter_fn=save_chapter,
                model_cfg=model_cfg,
            )

            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE kdp_project
                        SET status = 'ready',
                            actual_word_count = %s,
                            guard_passed = %s,
                            guard_score = %s,
                            epub_key = %s,
                            interior_pdf_key = %s,
                            cover_wrap_pdf_key = %s,
                            cover_front_jpg_key = %s,
                            bundle_zip_key = %s,
                            updated_at = NOW()
                        WHERE id = %s
                        """,
                        (
                            result["actual_word_count"],
                            result["guard_passed"],
                            result["guard_score"],
                            result["epub_key"],
                            result["interior_pdf_key"],
                            result["cover_wrap_pdf_key"],
                            result["cover_front_jpg_key"],
                            result["bundle_zip_key"],
                            project["id"],
                        ),
                    )
                    cur.execute(
                        "UPDATE kdp_job SET status = 'succeeded', progress_pct = 100, current_step = 'done', result_json = %s, finished_at = NOW() WHERE id = %s",
                        (json.dumps(result, ensure_ascii=False), job["id"]),
                    )
        except Exception as exc:
            with conn.transaction():
                with conn.cursor() as cur:
                    _refund_credit_on_failure_pg(cur, job.get("credit_id") or "")
                    cur.execute(
                        "UPDATE kdp_job SET status = 'failed', error = %s, finished_at = NOW() WHERE id = %s",
                        (str(exc), job["id"]),
                    )
                    if job.get("project_id"):
                        cur.execute(
                            "UPDATE kdp_project SET status = 'failed', updated_at = NOW() WHERE id = %s",
                            (job["project_id"],),
                        )
    return True


def run_once_sqlite(db_path: str) -> bool:
    """SQLite 兼容性领单（方便无 Postgres 的本地快速端到端自测）。"""
    clean_path = db_path.removeprefix("file:")
    if not Path(clean_path).exists():
        return False

    conn = sqlite3.connect(clean_path, timeout=15.0)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        cur.execute("BEGIN IMMEDIATE")
        cur.execute(
            "SELECT * FROM kdp_job WHERE status = 'queued' AND attempts < 3 ORDER BY created_at ASC LIMIT 1"
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            return False
        job = dict(row)
        lease_id = str(uuid.uuid4())
        now_ms = int(time.time() * 1000)
        cur.execute(
            "UPDATE kdp_job SET status = 'processing', lease = ?, lease_until = ?, attempts = attempts + 1, current_step = 'claimed' WHERE id = ?",
            (lease_id, now_ms + LEASE_SECONDS * 1000, job["id"]),
        )
        conn.commit()

        def update_progress(pct: int, step: str) -> None:
            conn.execute(
                "UPDATE kdp_job SET progress_pct = ?, current_step = ? WHERE id = ?",
                (pct, step, job["id"]),
            )
            conn.commit()

        def save_chapter(ch_id: str, html_str: str, wc: int) -> None:
            conn.execute(
                "UPDATE kdp_chapter SET content_html = ?, word_count = ?, status = 'generated', updated_at = ? WHERE id = ?",
                (html_str, wc, int(time.time() * 1000), ch_id),
            )
            conn.commit()

        try:
            proj_row = conn.execute("SELECT * FROM kdp_project WHERE id = ?", (job["project_id"],)).fetchone()
            if not proj_row:
                raise ValueError(f"Project not found: {job['project_id']}")
            project = dict(proj_row)
            chapters = [dict(r) for r in conn.execute("SELECT * FROM kdp_chapter WHERE project_id = ? ORDER BY chapter_index ASC", (project["id"],)).fetchall()]
            pen_profile = None
            if project.get("pen_profile_id"):
                p_row = conn.execute("SELECT * FROM kdp_pen_profile WHERE id = ?", (project["pen_profile_id"],)).fetchone()
                pen_profile = dict(p_row) if p_row else None
            other_domains = [
                r["companion_domain"]
                for r in conn.execute(
                    "SELECT companion_domain FROM kdp_pen_profile WHERE user_id = ? AND id != ?",
                    (project["user_id"], project.get("pen_profile_id") or ""),
                ).fetchall()
                if r["companion_domain"]
            ]
            existing_titles = [
                r["title"]
                for r in conn.execute(
                    "SELECT title FROM kdp_project WHERE user_id = ? AND id != ?",
                    (project["user_id"], project["id"]),
                ).fetchall()
                if r["title"]
            ]
            model_cfg = _db_config_lookup(conn, True)
            result = _execute_book_pipeline(
                job=job,
                project=project,
                chapters=chapters,
                pen_profile=pen_profile,
                other_pen_domains=other_domains,
                existing_titles=existing_titles,
                update_progress=update_progress,
                save_chapter_fn=save_chapter,
                model_cfg=model_cfg,
            )
            now_ms = int(time.time() * 1000)
            conn.execute(
                """
                UPDATE kdp_project
                SET status = 'ready', actual_word_count = ?, guard_passed = ?, guard_score = ?,
                    epub_key = ?, interior_pdf_key = ?, cover_wrap_pdf_key = ?, cover_front_jpg_key = ?, bundle_zip_key = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    result["actual_word_count"],
                    1 if result["guard_passed"] else 0,
                    result["guard_score"],
                    result["epub_key"],
                    result["interior_pdf_key"],
                    result["cover_wrap_pdf_key"],
                    result["cover_front_jpg_key"],
                    result["bundle_zip_key"],
                    now_ms,
                    project["id"],
                ),
            )
            conn.execute(
                "UPDATE kdp_job SET status = 'succeeded', progress_pct = 100, current_step = 'done', result_json = ?, finished_at = ? WHERE id = ?",
                (json.dumps(result, ensure_ascii=False), now_ms, job["id"]),
            )
            conn.commit()
        except Exception as exc:
            conn.execute(
                "UPDATE kdp_job SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
                (str(exc), int(time.time() * 1000), job["id"]),
            )
            if job.get("project_id"):
                conn.execute(
                    "UPDATE kdp_project SET status = 'failed', updated_at = ? WHERE id = ?",
                    (int(time.time() * 1000), job["project_id"]),
                )
            conn.commit()
        return True
    finally:
        conn.close()


def main() -> int:
    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)

    parser = argparse.ArgumentParser(description="PublishGuard KDP Worker")
    parser.add_argument("--once", action="store_true", help="Process at most one job and exit")
    args = parser.parse_args()

    provider = (os.environ.get("DATABASE_PROVIDER") or "postgres").lower()
    dsn = os.environ.get("DATABASE_URL") or "file:data/local.db"

    while not STOP:
        did_work = False
        try:
            if provider in ("postgres", "postgresql") and dsn.startswith("postgres"):
                did_work = run_once_postgres(dsn)
            else:
                did_work = run_once_sqlite(dsn)
        except Exception as exc:
            print(f"[worker] poll error: {exc}", file=sys.stderr, flush=True)

        if args.once:
            break
        if not did_work:
            time.sleep(POLL_SECONDS)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
