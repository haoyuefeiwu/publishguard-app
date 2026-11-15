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
import base64
import hashlib
import json
import os
import shutil
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


def _load_env_files() -> None:
    """按优先级自动加载 .env.local / .env.development / .env，避免直接执行 worker/main.py 漏掉环境变量。"""
    for name in (".env.local", ".env.development", ".env"):
        env_file = APP_ROOT / name
        if not env_file.exists():
            continue
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            key = k.strip()
            val = v.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


_load_env_files()

from book_writer import MissingApiKeyError, generate_chapter_html
from cover_templates import build_ebook_front_cover_html
from epub_compiler import compile_epub
from html_sanitizer import sanitize_chapter_html
from kdp_guard_service import audit_epub_bytes, count_words, run_preflight_audit
from pdf_compiler import compile_paperback_and_bundle, render_cover_front_jpg

LEASE_SECONDS = 240
POLL_SECONDS = float(os.environ.get("WORKER_POLL_SECONDS", "3.0"))
ARTIFACTS_ROOT = Path(os.environ.get("KDP_ARTIFACTS_DIR", str(APP_ROOT / "data" / "kdp-artifacts")))
STOP = False
MAX_ATTEMPTS = 3


class LeaseLostError(RuntimeError):
    """当前 Worker 的任务租约已被抢占或撤销，终止后续写入且不触碰现存任务状态。"""


class GuardVerificationError(RuntimeError):
    """成品 26 项上架前合规审计未通过，拦截交付并触发 100% 积分退还。"""

    def __init__(self, message: str, guard_report: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.guard_report = guard_report or {}


def _on_signal(_signum: int, _frame: Any) -> None:
    global STOP
    STOP = True


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def decrypt_config_value(raw_val: str | None, encryption_key: str | None = None) -> str:
    """解密 config 表中以 enc:v1: 开头的 AES-256-GCM 密文（与 src/lib/crypto.ts 完全对齐）。"""
    if raw_val is None:
        return ""
    text = str(raw_val)
    if not text.startswith("enc:v1:"):
        return text

    secret = (encryption_key if encryption_key is not None else os.environ.get("CONFIG_ENCRYPTION_KEY", "")).strip()
    if not secret:
        print("[worker] 检测到加密 config 项但未配置 CONFIG_ENCRYPTION_KEY，无法解密", file=sys.stderr)
        return ""

    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        packed = base64.b64decode(text[len("enc:v1:") :])
        if len(packed) <= 28:
            return ""
        iv = packed[:12]
        tag = packed[12:28]
        ciphertext = packed[28:]
        key = hashlib.sha256(secret.encode("utf-8")).digest()
        plain = AESGCM(key).decrypt(iv, ciphertext + tag, None)
        return plain.decode("utf-8")
    except Exception as exc:
        print(f"[worker] 解密后台配置失败 ({type(exc).__name__})", file=sys.stderr)
        return ""


def _db_config_lookup(conn: Any, is_sqlite: bool) -> dict[str, str]:
    """从 config 表加载并解密模型与兜底 API 配置，优先使用后台配置，回退环境变量。"""
    keys = {
        "openrouter_api_key": os.environ.get("OPENROUTER_API_KEY", ""),
        "openrouter_base_url": os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        "kdp_writer_model": os.environ.get("KDP_WRITER_MODEL", "anthropic/claude-sonnet-4"),
        "kdp_outline_model": os.environ.get("KDP_OUTLINE_MODEL", "google/gemini-2.5-flash"),
        "fallback_api_key": os.environ.get("FALLBACK_API_KEY") or os.environ.get("DEEPSEEK_API_KEY", ""),
        "fallback_base_url": os.environ.get("FALLBACK_BASE_URL", "https://api.deepseek.com/v1"),
        "fallback_model": os.environ.get("FALLBACK_MODEL", "deepseek-chat"),
    }
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT name, value FROM config
            WHERE name IN (
                'openrouter_api_key', 'openrouter_base_url',
                'kdp_writer_model', 'kdp_outline_model',
                'fallback_api_key', 'fallback_base_url', 'fallback_model'
            )
            """
        )
        for row in cur.fetchall():
            name = row["name"] if isinstance(row, dict) or hasattr(row, "keys") else row[0]
            raw_val = row["value"] if isinstance(row, dict) or hasattr(row, "keys") else row[1]
            if not raw_val:
                continue
            decoded = decrypt_config_value(str(raw_val))
            if decoded.strip():
                keys[name] = decoded.strip()
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
    verify_lease_fn: Any,
    model_cfg: dict[str, str],
) -> dict[str, Any]:
    """执行完整造书编译或快速重打包流水线：章节准备 -> 暂存编译 -> 双重Guard把关 -> 租约校验落盘。"""
    project_id = project["id"]
    job_type = (job.get("job_type") or "generate_book").strip()
    work_dir = ARTIFACTS_ROOT / project_id
    work_dir.mkdir(parents=True, exist_ok=True)
    stage_dir = work_dir / f".stage_{job['id']}"
    if stage_dir.exists():
        shutil.rmtree(stage_dir, ignore_errors=True)
    stage_dir.mkdir(parents=True, exist_ok=True)

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
    cover_theme = project.get("cover_theme", "editorial_split")
    trim_size = project.get("trim_size", "6x9")
    target_pages = int(project.get("target_page_count", 100))
    paper_type = project.get("paper_type", "cream")

    try:
        # 1. 准备全书章节正文（快速重打包绝不调用 LLM，全书生成强制校验真实密钥）
        total = max(1, len(chapters))
        prev_summaries: list[str] = []
        compiled_chapters: list[dict[str, str]] = []
        total_words = 0

        for idx, ch in enumerate(chapters):
            raw_existing = (ch.get("content_html") or "").strip()
            content_html = sanitize_chapter_html(raw_existing)

            if job_type == "recompile_bundle":
                update_progress(10 + int((idx / total) * 40), f"loading_chapter_{idx + 1}_of_{total}")
                if not content_html:
                    raise RuntimeError(
                        f"Missing chapter prose for `{ch['title']}` during bundle recompile."
                    )
                wc = count_words(content_html)
            else:
                pct = 10 + int((idx / total) * 55)
                update_progress(pct, f"writing_chapter_{idx + 1}_of_{total}")
                if not content_html or count_words(content_html) < 900:
                    generated_html = generate_chapter_html(
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
                        strict=True,
                        fallback_api_key=model_cfg.get("fallback_api_key", ""),
                        fallback_base_url=model_cfg.get("fallback_base_url", ""),
                        fallback_model=model_cfg.get("fallback_model", ""),
                    )
                    content_html = sanitize_chapter_html(generated_html)
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

        # 2. 在暂存目录渲染 1600x2560 正面封面图（避免失败污染已有成品）
        update_progress(70, "rendering_cover_artwork")
        front_html_path = stage_dir / "02_eBook_Cover_Front.html"
        front_jpg_path = stage_dir / "02_eBook_Cover_Front.jpg"
        front_html_path.write_text(
            build_ebook_front_cover_html(
                theme=cover_theme,
                title=project["title"],
                subtitle=project.get("subtitle", ""),
                author_name=author_name,
                edition_label=edition_label,
            ),
            encoding="utf-8",
        )
        render_cover_front_jpg(front_html_path, front_jpg_path)
        cover_bytes = front_jpg_path.read_bytes() if front_jpg_path.exists() else None

        # 3. 编译规范 EPUB 3 文件到暂存目录
        update_progress(78, "compiling_epub3")
        epub_path = stage_dir / "01_Kindle_eBook_Upload.epub"
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

        # 4. Chrome Headless 渲染平装内页 PDF + 全展开封面 PDF + 打包 ZIP 到暂存目录
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
            "cover_theme": cover_theme,
        }
        pdf_result = compile_paperback_and_bundle(
            work_dir=stage_dir,
            title=project["title"],
            subtitle=project.get("subtitle", ""),
            author_name=author_name,
            edition_label=edition_label,
            back_blurb=back_blurb,
            chapters=compiled_chapters,
            trim_size=trim_size,
            target_pages=target_pages,
            paper_type=paper_type,
            cover_theme=cover_theme,
            companion_url=project.get("companion_url", ""),
            epub_path=epub_path,
            metadata_checklist=checklist_meta,
        )

        # 5. 双重 Pre-Flight Guard 物理把关（EPUB 二进制结构体检 + 全书正文合规审计）
        update_progress(95, "running_26_rule_guard")
        full_manuscript_html = "\n".join(c["content_html"] for c in compiled_chapters)
        epub_audit = audit_epub_bytes(
            epub_path.read_bytes(),
            title=project["title"],
            subtitle=project.get("subtitle", ""),
            description=back_blurb,
            author_name=author_name,
            primary_category=project.get("genre", "Self-Help"),
            companion_domain=project.get("companion_url", ""),
            other_pen_domains=other_pen_domains,
            existing_pen_titles=existing_titles,
            mode="ebook",
            check_live_collisions=False,
            enforce_min_words=True,
        )
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

        # 合并 EPUB 容器级致命错误（避免重复正文提示，保留容器/压缩/1-bit/spine 等缺陷）
        seen_codes = {e.get("code") for e in guard_res.errors}
        for ee in epub_audit.errors:
            if ee.get("code") not in seen_codes:
                guard_res.errors.append(ee)
                seen_codes.add(ee.get("code"))
        guard_res.passed = len(guard_res.errors) == 0
        guard_res.score = min(guard_res.score, epub_audit.score)

        # 兑现 Guard 零风控退款承诺：若未通过把关，阻断交付并触发全额退分
        if not guard_res.passed:
            first_msg = guard_res.errors[0].get("message", "Pre-Flight Guard check failed") if guard_res.errors else "Pre-Flight Guard failed"
            raise GuardVerificationError(
                f"KDP Guard failed (score={guard_res.score}): {first_msg}",
                guard_report=asdict(guard_res),
            )

        # 6. 仅在仍持有有效租约时，将暂存成品原子替换到正式交付目录
        verify_lease_fn()
        for artifact_name in (
            epub_path.name,
            "02_eBook_Cover_Front.html",
            pdf_result["interior_pdf"],
            pdf_result["cover_wrap_pdf"],
            pdf_result["cover_front_jpg"],
            pdf_result["checklist_json"],
            pdf_result["bundle_zip"],
        ):
            src = stage_dir / artifact_name
            if src.exists():
                os.replace(src, work_dir / artifact_name)

        compiled_at = _utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")
        actual_pages = int(pdf_result["actual_pages"])
        spine_width_in = float(pdf_result["spine_width_in"])
        compiled_snapshot = {
            "title": project["title"],
            "subtitle": project.get("subtitle", ""),
            "author_name": author_name,
            "cover_theme": cover_theme,
            "trim_size": trim_size,
            "target_page_count": target_pages,
            "paper_type": paper_type,
            "actual_pages": actual_pages,
            "spine_width_in": spine_width_in,
            "wrap_dimensions_in": pdf_result.get("wrap_dimensions_in", ""),
            "actual_word_count": total_words,
            "guard_passed": guard_res.passed,
            "guard_score": guard_res.score,
            "job_type": job_type,
            "job_id": job["id"],
            "compiled_at": compiled_at,
        }

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
            "actual_pages": actual_pages,
            "spine_width_in": spine_width_in,
            "compiled_snapshot": compiled_snapshot,
        }
    finally:
        shutil.rmtree(stage_dir, ignore_errors=True)


def _refund_credit_on_failure(cur: Any, credit_id: str, *, is_sqlite: bool = False) -> bool:
    """在任务失败或租约耗尽时原子退还已扣除积分（兼容 PostgreSQL 与 SQLite，绝不重复退款）。"""
    if not credit_id:
        return False
    ph = "?" if is_sqlite else "%s"
    cur.execute(
        f"""
        UPDATE credit
        SET status = 'deleted'
        WHERE id = {ph} AND transaction_type = 'consume' AND status = 'active'
        """,
        (credit_id,),
    )
    if cur.rowcount != 1:
        return False

    cur.execute(f"SELECT consumed_detail FROM credit WHERE id = {ph} LIMIT 1", (credit_id,))
    row = cur.fetchone()
    if not row:
        return False
    consumed_raw = row["consumed_detail"] if isinstance(row, dict) or hasattr(row, "keys") else row[0]
    if not consumed_raw:
        return False
    items = json.loads(consumed_raw)
    if not isinstance(items, list):
        return False
    for item in items:
        amt = int(item.get("creditsConsumed") or 0)
        cid = item.get("creditId")
        if cid and amt > 0:
            cur.execute(
                f"UPDATE credit SET remaining_credits = remaining_credits + {ph} WHERE id = {ph}",
                (amt, cid),
            )
    return True


def _resolve_project_failure_status(cur: Any, project_id: str, *, is_sqlite: bool = False) -> str:
    """若项目已有完整交付包（例如快速重打包失败），保留 ready 状态以避免锁死原有下载。"""
    ph = "?" if is_sqlite else "%s"
    cur.execute(f"SELECT bundle_zip_key FROM kdp_project WHERE id = {ph} LIMIT 1", (project_id,))
    row = cur.fetchone()
    if not row:
        return "failed"
    bkey = row["bundle_zip_key"] if isinstance(row, dict) or hasattr(row, "keys") else row[0]
    return "ready" if (bkey and str(bkey).strip()) else "failed"


def _reap_exhausted_postgres_jobs(conn: Any) -> int:
    """收尾清理 attempts>=3 且租约已过期的僵尸 processing 任务并自动全额退款。"""
    reaped = 0
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, project_id, credit_id
                FROM kdp_job
                WHERE status = 'processing' AND lease_until < NOW() AND attempts >= %s
                FOR UPDATE SKIP LOCKED
                """,
                (MAX_ATTEMPTS,),
            )
            stale_rows = cur.fetchall()
            for row in stale_rows:
                cur.execute(
                    """
                    UPDATE kdp_job
                    SET status = 'failed',
                        error = 'Worker lease expired after max retry attempts',
                        finished_at = NOW()
                    WHERE id = %s AND status = 'processing' AND lease_until < NOW() AND attempts >= %s
                    """,
                    (row["id"], MAX_ATTEMPTS),
                )
                if cur.rowcount == 1:
                    _refund_credit_on_failure(cur, row.get("credit_id") or "", is_sqlite=False)
                    if row.get("project_id"):
                        fallback_status = _resolve_project_failure_status(cur, row["project_id"], is_sqlite=False)
                        cur.execute(
                            "UPDATE kdp_project SET status = %s, updated_at = NOW() WHERE id = %s",
                            (fallback_status, row["project_id"]),
                        )
                    reaped += 1
    return reaped


def run_once_postgres(dsn: str) -> bool:
    """PostgreSQL 模式下收尾超时耗尽任务并安全抢占、执行下一条任务（含严格 lease 护栏）。"""
    import psycopg
    from psycopg.rows import dict_row

    lease_id = str(uuid.uuid4())
    # autocommit=True 确保每条 conn.transaction() 立即独立提交，防止进度/章节更新被外层隐式事务锁成 Savepoint
    with psycopg.connect(dsn, row_factory=dict_row, autocommit=True) as conn:
        _reap_exhausted_postgres_jobs(conn)

        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT pg_try_advisory_xact_lock(hashtext('kdp_job_claim'))")
                cur.execute(
                    r"""
                    SELECT * FROM kdp_job
                    WHERE (status = 'queued' OR (status = 'processing' AND lease_until < NOW()))
                      AND attempts < %s
                    ORDER BY COALESCE(NULLIF(substring(payload_json FROM '"priority"\s*:\s*(-?[0-9]+)'), ''), '0')::int DESC,
                             created_at ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                    """,
                    (MAX_ATTEMPTS,),
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
                if job.get("project_id"):
                    cur.execute(
                        "UPDATE kdp_project SET status = 'generating', updated_at = NOW() WHERE id = %s",
                        (job["project_id"],),
                    )

        def verify_lease() -> None:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE kdp_job SET lease_until = %s WHERE id = %s AND status = 'processing' AND lease = %s",
                    (_utc_now() + timedelta(seconds=LEASE_SECONDS), job["id"], lease_id),
                )
                if cur.rowcount != 1:
                    raise LeaseLostError(f"Lease {lease_id} lost for job {job['id']}")

        def update_progress(pct: int, step: str) -> None:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE kdp_job
                        SET progress_pct = %s, current_step = %s, lease_until = %s
                        WHERE id = %s AND status = 'processing' AND lease = %s
                        """,
                        (pct, step, _utc_now() + timedelta(seconds=LEASE_SECONDS), job["id"], lease_id),
                    )
                    if cur.rowcount != 1:
                        raise LeaseLostError(f"Lease {lease_id} lost updating progress for {job['id']}")

        def save_chapter(ch_id: str, html_str: str, wc: int) -> None:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE kdp_job SET lease_until = %s WHERE id = %s AND status = 'processing' AND lease = %s",
                        (_utc_now() + timedelta(seconds=LEASE_SECONDS), job["id"], lease_id),
                    )
                    if cur.rowcount != 1:
                        raise LeaseLostError(f"Lease {lease_id} lost before saving chapter {ch_id}")
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
                    cur.execute(
                        "SELECT * FROM kdp_pen_profile WHERE id = %s AND user_id = %s",
                        (project["pen_profile_id"], project["user_id"]),
                    )
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
                verify_lease_fn=verify_lease,
                model_cfg=model_cfg,
            )

            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE kdp_job
                        SET status = 'succeeded', progress_pct = 100, current_step = 'done',
                            result_json = %s, finished_at = NOW()
                        WHERE id = %s AND status = 'processing' AND lease = %s
                        """,
                        (json.dumps(result, ensure_ascii=False), job["id"], lease_id),
                    )
                    if cur.rowcount != 1:
                        raise LeaseLostError(f"Lease {lease_id} lost committing job {job['id']}")
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
                            compiled_snapshot_json = %s,
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
                            json.dumps(result.get("compiled_snapshot") or {}, ensure_ascii=False),
                            project["id"],
                        ),
                    )
        except LeaseLostError as exc:
            print(f"[worker] 放弃已失效租约写入: {exc}", file=sys.stderr, flush=True)
        except Exception as exc:
            import traceback
            traceback.print_exc()
            err_result_json = (
                json.dumps({"guard_report": exc.guard_report}, ensure_ascii=False)
                if isinstance(exc, GuardVerificationError) and exc.guard_report
                else None
            )
            with conn.transaction():
                with conn.cursor() as cur:
                    if err_result_json is not None:
                        cur.execute(
                            """
                            UPDATE kdp_job
                            SET status = 'failed', error = %s, result_json = %s, finished_at = NOW()
                            WHERE id = %s AND status = 'processing' AND lease = %s
                            """,
                            (str(exc), err_result_json, job["id"], lease_id),
                        )
                    else:
                        cur.execute(
                            """
                            UPDATE kdp_job
                            SET status = 'failed', error = %s, finished_at = NOW()
                            WHERE id = %s AND status = 'processing' AND lease = %s
                            """,
                            (str(exc), job["id"], lease_id),
                        )
                    if cur.rowcount == 1:
                        _refund_credit_on_failure(cur, job.get("credit_id") or "", is_sqlite=False)
                        if job.get("project_id"):
                            fallback_status = _resolve_project_failure_status(cur, job["project_id"], is_sqlite=False)
                            cur.execute(
                                "UPDATE kdp_project SET status = %s, updated_at = NOW() WHERE id = %s",
                                (fallback_status, job["project_id"]),
                            )
    return True


def _reap_exhausted_sqlite_jobs(cur: Any, now_ms: int) -> int:
    """SQLite 模式收尾 attempts>=3 且租约已过期的僵尸任务并退款。"""
    cur.execute(
        """
        SELECT id, project_id, credit_id
        FROM kdp_job
        WHERE status = 'processing' AND lease_until IS NOT NULL AND lease_until < ? AND attempts >= ?
        """,
        (now_ms, MAX_ATTEMPTS),
    )
    stale_rows = cur.fetchall()
    reaped = 0
    for row in stale_rows:
        rdict = dict(row)
        cur.execute(
            """
            UPDATE kdp_job
            SET status = 'failed',
                error = 'Worker lease expired after max retry attempts',
                finished_at = ?
            WHERE id = ? AND status = 'processing' AND attempts >= ?
            """,
            (now_ms, rdict["id"], MAX_ATTEMPTS),
        )
        if cur.rowcount == 1:
            _refund_credit_on_failure(cur, rdict.get("credit_id") or "", is_sqlite=True)
            if rdict.get("project_id"):
                fallback_status = _resolve_project_failure_status(cur, rdict["project_id"], is_sqlite=True)
                cur.execute(
                    "UPDATE kdp_project SET status = ?, updated_at = ? WHERE id = ?",
                    (fallback_status, now_ms, rdict["project_id"]),
                )
            reaped += 1
    return reaped


def run_once_sqlite(db_path: str) -> bool:
    """SQLite 兼容性领单（支持租约到期重领、attempts>=3 收尾退款与严格 lease 写入护栏）。"""
    clean_path = db_path.removeprefix("file:")
    if not Path(clean_path).exists():
        return False

    conn = sqlite3.connect(clean_path, timeout=15.0)
    conn.row_factory = sqlite3.Row
    try:
        now_ms = int(time.time() * 1000)
        cur = conn.cursor()
        cur.execute("BEGIN IMMEDIATE")
        _reap_exhausted_sqlite_jobs(cur, now_ms)
        cur.execute(
            """
            SELECT * FROM kdp_job
            WHERE (status = 'queued' OR (status = 'processing' AND lease_until IS NOT NULL AND lease_until < ?))
              AND attempts < ?
            ORDER BY CASE WHEN json_valid(payload_json)
                          THEN COALESCE(CAST(json_extract(payload_json, '$.priority') AS INTEGER), 0)
                          ELSE 0 END DESC,
                     created_at ASC
            LIMIT 1
            """,
            (now_ms, MAX_ATTEMPTS),
        )
        row = cur.fetchone()
        if not row:
            conn.commit()
            return False
        job = dict(row)
        lease_id = str(uuid.uuid4())
        cur.execute(
            "UPDATE kdp_job SET status = 'processing', lease = ?, lease_until = ?, attempts = attempts + 1, current_step = 'claimed' WHERE id = ?",
            (lease_id, now_ms + LEASE_SECONDS * 1000, job["id"]),
        )
        if job.get("project_id"):
            cur.execute(
                "UPDATE kdp_project SET status = 'generating', updated_at = ? WHERE id = ?",
                (now_ms, job["project_id"]),
            )
        conn.commit()

        def verify_lease() -> None:
            chk = conn.execute(
                "UPDATE kdp_job SET lease_until = ? WHERE id = ? AND status = 'processing' AND lease = ?",
                (int(time.time() * 1000) + LEASE_SECONDS * 1000, job["id"], lease_id),
            )
            conn.commit()
            if chk.rowcount != 1:
                raise LeaseLostError(f"Lease {lease_id} lost for sqlite job {job['id']}")

        def update_progress(pct: int, step: str) -> None:
            upd = conn.execute(
                "UPDATE kdp_job SET progress_pct = ?, current_step = ?, lease_until = ? WHERE id = ? AND status = 'processing' AND lease = ?",
                (pct, step, int(time.time() * 1000) + LEASE_SECONDS * 1000, job["id"], lease_id),
            )
            conn.commit()
            if upd.rowcount != 1:
                raise LeaseLostError(f"Lease {lease_id} lost updating sqlite job {job['id']}")

        def save_chapter(ch_id: str, html_str: str, wc: int) -> None:
            chk = conn.execute(
                "UPDATE kdp_job SET lease_until = ? WHERE id = ? AND status = 'processing' AND lease = ?",
                (int(time.time() * 1000) + LEASE_SECONDS * 1000, job["id"], lease_id),
            )
            if chk.rowcount != 1:
                conn.rollback()
                raise LeaseLostError(f"Lease {lease_id} lost before saving sqlite chapter {ch_id}")
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
                p_row = conn.execute(
                    "SELECT * FROM kdp_pen_profile WHERE id = ? AND user_id = ?",
                    (project["pen_profile_id"], project["user_id"]),
                ).fetchone()
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
                verify_lease_fn=verify_lease,
                model_cfg=model_cfg,
            )
            done_ms = int(time.time() * 1000)
            # 先结束只读查询可能开启的隐式事务，再开启写锁事务
            conn.rollback()
            cur2 = conn.cursor()
            cur2.execute("BEGIN IMMEDIATE")
            cur2.execute(
                "UPDATE kdp_job SET status = 'succeeded', progress_pct = 100, current_step = 'done', result_json = ?, finished_at = ? WHERE id = ? AND status = 'processing' AND lease = ?",
                (json.dumps(result, ensure_ascii=False), done_ms, job["id"], lease_id),
            )
            if cur2.rowcount != 1:
                conn.rollback()
                raise LeaseLostError(f"Lease {lease_id} lost committing sqlite job {job['id']}")
            cur2.execute(
                """
                UPDATE kdp_project
                SET status = 'ready', actual_word_count = ?, guard_passed = ?, guard_score = ?,
                    epub_key = ?, interior_pdf_key = ?, cover_wrap_pdf_key = ?, cover_front_jpg_key = ?,
                    bundle_zip_key = ?, compiled_snapshot_json = ?, updated_at = ?
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
                    json.dumps(result.get("compiled_snapshot") or {}, ensure_ascii=False),
                    done_ms,
                    project["id"],
                ),
            )
            conn.commit()
        except LeaseLostError as exc:
            conn.rollback()
            print(f"[worker] 放弃已失效 sqlite 租约写入: {exc}", file=sys.stderr, flush=True)
        except Exception as exc:
            conn.rollback()
            fail_ms = int(time.time() * 1000)
            cur_fail = conn.cursor()
            cur_fail.execute("BEGIN IMMEDIATE")
            err_result_json = (
                json.dumps({"guard_report": exc.guard_report}, ensure_ascii=False)
                if isinstance(exc, GuardVerificationError) and exc.guard_report
                else None
            )
            if err_result_json is not None:
                cur_fail.execute(
                    "UPDATE kdp_job SET status = 'failed', error = ?, result_json = ?, finished_at = ? WHERE id = ? AND status = 'processing' AND lease = ?",
                    (str(exc), err_result_json, fail_ms, job["id"], lease_id),
                )
            else:
                cur_fail.execute(
                    "UPDATE kdp_job SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND status = 'processing' AND lease = ?",
                    (str(exc), fail_ms, job["id"], lease_id),
                )
            if cur_fail.rowcount == 1:
                _refund_credit_on_failure(cur_fail, job.get("credit_id") or "", is_sqlite=True)
                if job.get("project_id"):
                    fallback_status = _resolve_project_failure_status(cur_fail, job["project_id"], is_sqlite=True)
                    cur_fail.execute(
                        "UPDATE kdp_project SET status = ?, updated_at = ? WHERE id = ?",
                        (fallback_status, fail_ms, job["project_id"]),
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
