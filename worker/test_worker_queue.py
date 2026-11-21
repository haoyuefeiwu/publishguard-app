#!/usr/bin/env python3
"""
PublishGuard Worker 队列端到端集成测试：
验证 Worker 从数据库抢占 queued 任务、生成多章正文、编译 EPUB 3 与印刷级 PDF、
执行 26 项 Pre-Flight Guard 放行并将产物与状态写回数据库全流程。
"""

from __future__ import annotations

import os
import sqlite3
import sys
import uuid
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(WORKER_DIR))

import main as worker_main


def _create_queue_db_with_credits(db_file: Path) -> sqlite3.Connection:
    """初始化与生产结构一致的测试用 SQLite 队列数据库。"""
    conn = sqlite3.connect(db_file)
    conn.executescript(
        """
        CREATE TABLE config (name TEXT UNIQUE NOT NULL, value TEXT);
        CREATE TABLE credit (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            transaction_type TEXT NOT NULL,
            credits INTEGER NOT NULL,
            remaining_credits INTEGER NOT NULL,
            status TEXT NOT NULL,
            consumed_detail TEXT
        );
        CREATE TABLE kdp_pen_profile (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            pen_name_first TEXT NOT NULL,
            pen_name_last TEXT NOT NULL,
            full_name TEXT NOT NULL,
            edition_label TEXT NOT NULL,
            companion_domain TEXT NOT NULL,
            last_published_at INTEGER,
            notes TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE kdp_project (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            pen_profile_id TEXT,
            title TEXT NOT NULL,
            subtitle TEXT NOT NULL,
            genre TEXT NOT NULL,
            topic_prompt TEXT NOT NULL,
            target_audience TEXT NOT NULL,
            companion_product TEXT NOT NULL,
            companion_url TEXT NOT NULL,
            target_word_count INTEGER NOT NULL,
            actual_word_count INTEGER NOT NULL,
            trim_size TEXT NOT NULL,
            target_page_count INTEGER NOT NULL,
            paper_type TEXT NOT NULL,
            cover_theme TEXT NOT NULL,
            language TEXT NOT NULL,
            status TEXT NOT NULL,
            guard_passed INTEGER NOT NULL,
            guard_score INTEGER NOT NULL,
            metadata_json TEXT NOT NULL,
            epub_key TEXT NOT NULL,
            interior_pdf_key TEXT NOT NULL,
            cover_wrap_pdf_key TEXT NOT NULL,
            cover_front_jpg_key TEXT NOT NULL,
            bundle_zip_key TEXT NOT NULL,
            compiled_snapshot_json TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE kdp_chapter (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            chapter_index INTEGER NOT NULL,
            section_type TEXT NOT NULL,
            title TEXT NOT NULL,
            slug TEXT NOT NULL,
            summary TEXT NOT NULL,
            content_html TEXT NOT NULL,
            word_count INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE kdp_job (
            id TEXT PRIMARY KEY,
            project_id TEXT,
            user_id TEXT NOT NULL,
            job_type TEXT NOT NULL,
            status TEXT NOT NULL,
            progress_pct INTEGER NOT NULL,
            current_step TEXT NOT NULL,
            attempts INTEGER NOT NULL,
            lease TEXT,
            lease_until INTEGER,
            cost_credits INTEGER NOT NULL,
            credit_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            result_json TEXT NOT NULL,
            error TEXT,
            created_at INTEGER NOT NULL,
            finished_at INTEGER
        );
        """
    )
    return conn


def test_sqlite_worker_claims_and_completes_book_job(tmp_path: Path, monkeypatch) -> None:
    """SQLite Worker 应校验严格模式密钥、净化章节 XSS 载荷、完成全链路编译并落盘快照。"""
    import json
    import book_writer

    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test-strict-key")
    monkeypatch.setenv("FALLBACK_API_KEY", "")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    monkeypatch.delenv("KDP_ALLOW_DEMO_TEMPLATE", raising=False)

    def fake_llm_chat(**kwargs):
        base_html = book_writer._fallback_chapter_html(
            "Grounded Cadence",
            "Structured behavioral discipline.",
            min_words=1600,
        )
        return base_html + '\n<script>alert("xss")</script><img src=x onerror=alert(1)>'

    monkeypatch.setattr(book_writer, "_post_chat_completions", fake_llm_chat)

    db_file = tmp_path / "test_queue.db"
    artifacts_dir = tmp_path / "artifacts"
    monkeypatch.setattr(worker_main, "ARTIFACTS_ROOT", artifacts_dir)

    conn = _create_queue_db_with_credits(db_file)
    user_id = "user-test-1"
    prof_id = str(uuid.uuid4())
    proj_id = str(uuid.uuid4())
    job_id = str(uuid.uuid4())

    conn.execute(
        "INSERT INTO kdp_pen_profile VALUES (?, ?, 'Evelyn', 'Vance', 'Evelyn Vance', 'INDEPENDENT EDITION', 'https://evelynbooks.com/audio', NULL, '', 0, 0)",
        (prof_id, user_id),
    )
    conn.execute(
        """
        INSERT INTO kdp_project VALUES (
            ?, ?, ?, 'The Quiet Architecture of Presence',
            'Structured Behavioral Frameworks for Composed Focus in Daily Dialogue',
            'Self-Help', 'Attentional focus', 'Professionals', '', 'https://evelynbooks.com/audio',
            18000, 0, '6x9', 80, 'cream', 'ivory_monograph', 'en', 'queued', 0, 0,
            '{"back_blurb":"Clear practical framework for everyday composure."}', '', '', '', '', '', '{}', 0, 0
        )
        """,
        (proj_id, user_id, prof_id),
    )
    # 写入 10 节大纲确保整本纯正正文词数 > 15,000 词，满足 26 项硬放行红线
    for i in range(10):
        conn.execute(
            "INSERT INTO kdp_chapter VALUES (?, ?, ?, ?, 'chapter', ?, ?, 'Core structural discipline', '', 0, 'outlined', 0, 0)",
            (str(uuid.uuid4()), proj_id, user_id, i, f"Chapter {i + 1}: Grounded Cadence", f"ch-{i+1}"),
        )
    conn.execute(
        "INSERT INTO kdp_job VALUES (?, ?, ?, 'generate_book', 'queued', 0, 'queued', 0, NULL, NULL, 100, '', '{}', '{}', NULL, 0, NULL)",
        (job_id, proj_id, user_id),
    )
    conn.commit()
    conn.close()

    claimed = worker_main.run_once_sqlite(f"file:{db_file}")
    assert claimed is True

    check = sqlite3.connect(db_file)
    check.row_factory = sqlite3.Row
    job_row = dict(check.execute("SELECT * FROM kdp_job WHERE id = ?", (job_id,)).fetchone())
    proj_row = dict(check.execute("SELECT * FROM kdp_project WHERE id = ?", (proj_id,)).fetchone())
    ch_rows = [dict(r) for r in check.execute("SELECT content_html FROM kdp_chapter WHERE project_id = ?", (proj_id,)).fetchall()]
    check.close()

    assert job_row["status"] == "succeeded", f"Job failed: {job_row.get('error')}"
    assert job_row["progress_pct"] == 100
    assert proj_row["status"] == "ready"
    assert proj_row["guard_passed"] == 1
    assert proj_row["guard_score"] == 100
    assert proj_row["actual_word_count"] >= 15000
    assert all("<script" not in r["content_html"].lower() and "onerror" not in r["content_html"].lower() for r in ch_rows)

    snap = json.loads(proj_row["compiled_snapshot_json"])
    assert snap["title"] == "The Quiet Architecture of Presence"
    assert snap["job_type"] == "generate_book"
    assert snap["actual_pages"] >= 20
    assert snap["spine_width_in"] > 0
    assert snap["wrap_dimensions_in"]
    assert snap["guard_score"] == 100

    assert (artifacts_dir / proj_row["bundle_zip_key"]).exists()
    assert (artifacts_dir / proj_row["epub_key"]).exists()
    assert (artifacts_dir / proj_row["interior_pdf_key"]).exists()
    assert (artifacts_dir / proj_row["cover_wrap_pdf_key"]).exists()


def test_sqlite_worker_refunds_credits_on_failure_and_isolates_pen_profile(tmp_path: Path, monkeypatch) -> None:
    """SQLite 任务失败必须自动退还已扣积分，且 Worker 不得跨用户读取他人的 pen_profile。"""
    import json

    db_file = tmp_path / "refund_idor.db"
    conn = _create_queue_db_with_credits(db_file)

    grant_id = "grant-1"
    consume_id = "consume-1"
    user_id = "user-a"
    other_user = "user-b"
    other_prof = "prof-b"
    proj_id = "proj-a"
    job_id = "job-a"

    conn.execute("INSERT INTO credit VALUES (?, ?, 'grant', 125, 25, 'active', NULL)", (grant_id, user_id))
    conn.execute(
        "INSERT INTO credit VALUES (?, ?, 'consume', -100, 0, 'active', ?)",
        (consume_id, user_id, json.dumps([{"creditId": grant_id, "creditsConsumed": 100}])),
    )
    conn.execute(
        "INSERT INTO kdp_pen_profile VALUES (?, ?, 'Secret', 'Author', 'Secret Author', 'ED', 'https://b.com', NULL, 'PRIVATE NOTE', 0, 0)",
        (other_prof, other_user),
    )
    conn.execute(
        """
        INSERT INTO kdp_project VALUES (
            ?, ?, ?, 'Safe Title', 'Safe Sub', 'Self-Help', 'Focus', 'Adults', '', '',
            18000, 0, '6x9', 80, 'cream', 'ivory_monograph', 'en', 'queued', 0, 0,
            '{}', '', '', '', '', '', '{}', 0, 0
        )
        """,
        (proj_id, user_id, other_prof),
    )
    conn.execute(
        "INSERT INTO kdp_job VALUES (?, ?, ?, 'generate_book', 'queued', 0, 'queued', 0, NULL, NULL, 100, ?, '{}', '{}', NULL, 1, NULL)",
        (job_id, proj_id, user_id, consume_id),
    )
    conn.commit()
    conn.close()

    observed_profiles = []

    def fake_pipeline(**kwargs):
        observed_profiles.append(kwargs.get("pen_profile"))
        raise RuntimeError("Simulated Render Crash")

    monkeypatch.setattr(worker_main, "_execute_book_pipeline", fake_pipeline)
    claimed = worker_main.run_once_sqlite(f"file:{db_file}")
    assert claimed is True
    assert observed_profiles == [None]

    check = sqlite3.connect(db_file)
    check.row_factory = sqlite3.Row
    grant_row = dict(check.execute("SELECT * FROM credit WHERE id = ?", (grant_id,)).fetchone())
    consume_row = dict(check.execute("SELECT * FROM credit WHERE id = ?", (consume_id,)).fetchone())
    job_row = dict(check.execute("SELECT * FROM kdp_job WHERE id = ?", (job_id,)).fetchone())
    proj_row = dict(check.execute("SELECT * FROM kdp_project WHERE id = ?", (proj_id,)).fetchone())
    check.close()

    assert grant_row["remaining_credits"] == 125
    assert consume_row["status"] == "deleted"
    assert job_row["status"] == "failed"
    assert proj_row["status"] == "failed"


def test_sqlite_worker_respects_priority_queue_ordering(tmp_path: Path, monkeypatch) -> None:
    """高优先级（如 Studio 套餐 priority=100）任务应先于早提交的普通任务被抢占。"""
    db_file = tmp_path / "priority.db"
    conn = _create_queue_db_with_credits(db_file)

    conn.execute(
        "INSERT INTO kdp_project VALUES ('p1', 'u1', NULL, 'T1', 'S1', 'Self-Help', 'A', 'B', '', '', 18000, 0, '6x9', 80, 'cream', 'ivory_monograph', 'en', 'queued', 0, 0, '{}', '', '', '', '', '', '{}', 0, 0)"
    )
    conn.execute(
        "INSERT INTO kdp_project VALUES ('p2', 'u2', NULL, 'T2', 'S2', 'Self-Help', 'A', 'B', '', '', 18000, 0, '6x9', 80, 'cream', 'ivory_monograph', 'en', 'queued', 0, 0, '{}', '', '', '', '', '', '{}', 0, 0)"
    )
    conn.execute(
        "INSERT INTO kdp_job VALUES ('job-low', 'p1', 'u1', 'generate_book', 'queued', 0, 'queued', 0, NULL, NULL, 100, '', '{\"priority\": 0}', '{}', NULL, 1000, NULL)"
    )
    conn.execute(
        "INSERT INTO kdp_job VALUES ('job-high', 'p2', 'u2', 'generate_book', 'queued', 0, 'queued', 0, NULL, NULL, 100, '', '{\"priority\": 100}', '{}', NULL, 2000, NULL)"
    )
    conn.commit()
    conn.close()

    claimed_jobs = []

    def fake_ok_pipeline(**kwargs):
        claimed_jobs.append(kwargs["job"]["id"])
        return {
            "actual_word_count": 18000,
            "guard_passed": True,
            "guard_score": 100,
            "epub_key": "x.epub",
            "interior_pdf_key": "x.pdf",
            "cover_wrap_pdf_key": "w.pdf",
            "cover_front_jpg_key": "f.jpg",
            "bundle_zip_key": "b.zip",
            "compiled_snapshot": {"title": kwargs["project"]["title"]},
        }

    monkeypatch.setattr(worker_main, "_execute_book_pipeline", fake_ok_pipeline)
    assert worker_main.run_once_sqlite(f"file:{db_file}") is True
    assert claimed_jobs == ["job-high"]


def test_sqlite_worker_fails_and_refunds_when_no_api_key(tmp_path: Path, monkeypatch) -> None:
    """严格付费模式缺少所有模型密钥时必须明确报错并全额退还积分，绝不交付模板样稿。"""
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    monkeypatch.setenv("FALLBACK_API_KEY", "")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    monkeypatch.delenv("KDP_ALLOW_DEMO_TEMPLATE", raising=False)

    db_file = tmp_path / "no_key.db"
    artifacts_dir = tmp_path / "artifacts"
    monkeypatch.setattr(worker_main, "ARTIFACTS_ROOT", artifacts_dir)
    conn = _create_queue_db_with_credits(db_file)

    conn.execute("INSERT INTO credit VALUES ('grant-1', 'u1', 'grant', 150, 50, 'active', NULL)")
    conn.execute(
        "INSERT INTO credit VALUES ('consume-1', 'u1', 'consume', -100, 0, 'active', ?)",
        ('[{"creditId": "grant-1", "creditsConsumed": 100}]',),
    )
    conn.execute(
        """
        INSERT INTO kdp_project VALUES (
            'proj-nk', 'u1', NULL, 'Quiet Composure', 'Practical Daily Equilibrium in Work',
            'Self-Help', 'Composure', 'Adults', '', '', 18000, 0, '6x9', 80, 'cream',
            'ivory_monograph', 'en', 'queued', 0, 0, '{}', '', '', '', '', '', '{}', 0, 0
        )
        """
    )
    conn.execute(
        "INSERT INTO kdp_chapter VALUES ('ch-1', 'proj-nk', 'u1', 0, 'chapter', 'Chapter 1', 'ch-1', 'Summary', '', 0, 'outlined', 0, 0)"
    )
    conn.execute(
        "INSERT INTO kdp_job VALUES ('job-nk', 'proj-nk', 'u1', 'generate_book', 'queued', 0, 'queued', 0, NULL, NULL, 100, 'consume-1', '{}', '{}', NULL, 1, NULL)"
    )
    conn.commit()
    conn.close()

    assert worker_main.run_once_sqlite(f"file:{db_file}") is True

    check = sqlite3.connect(db_file)
    check.row_factory = sqlite3.Row
    job = dict(check.execute("SELECT * FROM kdp_job WHERE id = 'job-nk'").fetchone())
    proj = dict(check.execute("SELECT * FROM kdp_project WHERE id = 'proj-nk'").fetchone())
    grant = dict(check.execute("SELECT * FROM credit WHERE id = 'grant-1'").fetchone())
    consume = dict(check.execute("SELECT * FROM credit WHERE id = 'consume-1'").fetchone())
    check.close()

    assert job["status"] == "failed"
    assert "api key" in (job["error"] or "").lower()
    assert proj["status"] == "failed"
    assert proj["bundle_zip_key"] == ""
    assert grant["remaining_credits"] == 150
    assert consume["status"] == "deleted"


def test_sqlite_worker_guard_failure_blocks_delivery_refunds_and_keeps_ready_bundle(tmp_path: Path, monkeypatch) -> None:
    """已有 ready 成书再次重编触发 Guard 阻断时，必须退款、保留原 ready 状态与下载包并清理临时暂存目录。"""
    import json
    import book_writer

    db_file = tmp_path / "guard_preserve.db"
    artifacts_dir = tmp_path / "artifacts"
    monkeypatch.setattr(worker_main, "ARTIFACTS_ROOT", artifacts_dir)
    proj_dir = artifacts_dir / "proj-ready"
    proj_dir.mkdir(parents=True, exist_ok=True)
    existing_zip = proj_dir / "old_bundle.zip"
    existing_zip.write_bytes(b"existing-ready-bundle")

    conn = _create_queue_db_with_credits(db_file)
    conn.execute("INSERT INTO credit VALUES ('grant-1', 'u1', 'grant', 50, 40, 'active', NULL)")
    conn.execute(
        "INSERT INTO credit VALUES ('consume-recomp', 'u1', 'consume', -10, 0, 'active', ?)",
        ('[{"creditId": "grant-1", "creditsConsumed": 10}]',),
    )
    conn.execute(
        """
        INSERT INTO kdp_project VALUES (
            'proj-ready', 'u1', NULL, 'Existing Book', 'Stable Subtitle Over Sixty Five Characters Long Here For Compliance',
            'Self-Help', 'Focus', 'Adults', '', '', 18000, 16500, '6x9', 80, 'cream',
            'ivory_monograph', 'en', 'ready', 1, 100, '{}',
            'proj-ready/old.epub', 'proj-ready/old_int.pdf', 'proj-ready/old_wrap.pdf',
            'proj-ready/old.jpg', 'proj-ready/old_bundle.zip', '{"title":"Existing Book"}', 0, 0
        )
        """
    )
    dirty_text = book_writer._fallback_chapter_html("Chapter 1", "Summary", min_words=1600)
    # 植入高危临床违禁词 panic attacks 触发 Guard 硬阻断
    dirty_text = dirty_text.replace("<p>", "<p>Guaranteed cure for panic attacks and insomnia. </p><p>", 1)
    for i in range(10):
        conn.execute(
            "INSERT INTO kdp_chapter VALUES (?, 'proj-ready', 'u1', ?, 'chapter', ?, ?, 'Summary', ?, 1620, 'generated', 0, 0)",
            (f"ch-{i}", i, f"Chapter {i+1}: Discipline", f"ch-{i+1}", dirty_text),
        )
    conn.execute(
        "INSERT INTO kdp_job VALUES ('job-recomp', 'proj-ready', 'u1', 'recompile_bundle', 'queued', 0, 'queued', 0, NULL, NULL, 10, 'consume-recomp', '{}', '{}', NULL, 1, NULL)"
    )
    conn.commit()
    conn.close()

    assert worker_main.run_once_sqlite(f"file:{db_file}") is True

    check = sqlite3.connect(db_file)
    check.row_factory = sqlite3.Row
    job = dict(check.execute("SELECT * FROM kdp_job WHERE id = 'job-recomp'").fetchone())
    proj = dict(check.execute("SELECT * FROM kdp_project WHERE id = 'proj-ready'").fetchone())
    grant = dict(check.execute("SELECT * FROM credit WHERE id = 'grant-1'").fetchone())
    consume = dict(check.execute("SELECT * FROM credit WHERE id = 'consume-recomp'").fetchone())
    check.close()

    assert job["status"] == "failed"
    parsed_res = json.loads(job["result_json"])
    assert parsed_res.get("guard_report", {}).get("passed") is False
    assert grant["remaining_credits"] == 50
    assert consume["status"] == "deleted"
    # 原 ready 成书下载键与状态不得被破坏
    assert proj["status"] == "ready"
    assert proj["bundle_zip_key"] == "proj-ready/old_bundle.zip"
    assert existing_zip.read_bytes() == b"existing-ready-bundle"
    assert not list(proj_dir.glob(".stage_*"))


def test_sqlite_worker_reaps_exhausted_expired_lease_and_refunds(tmp_path: Path) -> None:
    """attempts >= MAX_ATTEMPTS 且租约已过期的僵尸任务必须在下次轮询收尾为 failed 并退款。"""
    import time

    db_file = tmp_path / "reap_exhausted.db"
    conn = _create_queue_db_with_credits(db_file)
    conn.execute("INSERT INTO credit VALUES ('grant-1', 'u1', 'grant', 100, 0, 'active', NULL)")
    conn.execute(
        "INSERT INTO credit VALUES ('consume-z', 'u1', 'consume', -100, 0, 'active', ?)",
        ('[{"creditId": "grant-1", "creditsConsumed": 100}]',),
    )
    conn.execute(
        "INSERT INTO kdp_project VALUES ('proj-z', 'u1', NULL, 'T', 'S', 'Self-Help', 'A', 'B', '', '', 18000, 0, '6x9', 80, 'cream', 'ivory_monograph', 'en', 'generating', 0, 0, '{}', '', '', '', '', '', '{}', 0, 0)"
    )
    expired_ms = int(time.time() * 1000) - 60_000
    conn.execute(
        "INSERT INTO kdp_job VALUES ('job-z', 'proj-z', 'u1', 'generate_book', 'processing', 45, 'writing_chapter_3', 3, 'dead-lease', ?, 100, 'consume-z', '{}', '{}', NULL, 1, NULL)",
        (expired_ms,),
    )
    conn.commit()
    conn.close()

    # 无新 queued 任务，仅触发僵尸收尾后返回 False
    assert worker_main.run_once_sqlite(f"file:{db_file}") is False

    check = sqlite3.connect(db_file)
    check.row_factory = sqlite3.Row
    job = dict(check.execute("SELECT * FROM kdp_job WHERE id = 'job-z'").fetchone())
    proj = dict(check.execute("SELECT * FROM kdp_project WHERE id = 'proj-z'").fetchone())
    grant = dict(check.execute("SELECT * FROM credit WHERE id = 'grant-1'").fetchone())
    consume = dict(check.execute("SELECT * FROM credit WHERE id = 'consume-z'").fetchone())
    check.close()

    assert job["status"] == "failed"
    assert "max retry attempts" in (job["error"] or "").lower()
    assert proj["status"] == "failed"
    assert grant["remaining_credits"] == 100
    assert consume["status"] == "deleted"


def test_sqlite_worker_reclaims_expired_lease_and_fences_stale_worker(tmp_path: Path, monkeypatch) -> None:
    """过期租约（attempts < 3）可被新 Worker 重领，且中途租约被抢走的旧 Worker 写入与退款必须全部被栅栏拦截。"""
    import time

    db_file = tmp_path / "lease_fence.db"
    conn = _create_queue_db_with_credits(db_file)
    conn.execute("INSERT INTO credit VALUES ('grant-1', 'u1', 'grant', 100, 0, 'active', NULL)")
    conn.execute(
        "INSERT INTO credit VALUES ('consume-l', 'u1', 'consume', -100, 0, 'active', ?)",
        ('[{"creditId": "grant-1", "creditsConsumed": 100}]',),
    )
    conn.execute(
        "INSERT INTO kdp_project VALUES ('proj-l', 'u1', NULL, 'T', 'S', 'Self-Help', 'A', 'B', '', '', 18000, 0, '6x9', 80, 'cream', 'ivory_monograph', 'en', 'generating', 0, 0, '{}', '', '', '', '', '', '{}', 0, 0)"
    )
    conn.execute(
        "INSERT INTO kdp_chapter VALUES ('ch-l', 'proj-l', 'u1', 0, 'chapter', 'Ch 1', 'ch-1', 'Sum', '', 0, 'outlined', 0, 0)"
    )
    expired_ms = int(time.time() * 1000) - 60_000
    conn.execute(
        "INSERT INTO kdp_job VALUES ('job-l', 'proj-l', 'u1', 'generate_book', 'processing', 20, 'writing_chapter_1', 1, 'old-lease', ?, 100, 'consume-l', '{}', '{}', NULL, 1, NULL)",
        (expired_ms,),
    )
    conn.commit()
    conn.close()

    def hijacked_pipeline(**kwargs):
        # 模拟另一台新 Worker 抢走当前租约；旧 Worker 紧接着调用 save_chapter 必须抛出 LeaseLostError
        c = sqlite3.connect(db_file)
        c.execute("UPDATE kdp_job SET lease = 'newer-worker-lease', attempts = 2 WHERE id = 'job-l'")
        c.commit()
        c.close()
        kwargs["save_chapter_fn"]("ch-l", "<p>Stale content</p>", 2)
        return {}

    monkeypatch.setattr(worker_main, "_execute_book_pipeline", hijacked_pipeline)
    assert worker_main.run_once_sqlite(f"file:{db_file}") is True

    check = sqlite3.connect(db_file)
    check.row_factory = sqlite3.Row
    job = dict(check.execute("SELECT * FROM kdp_job WHERE id = 'job-l'").fetchone())
    ch = dict(check.execute("SELECT * FROM kdp_chapter WHERE id = 'ch-l'").fetchone())
    grant = dict(check.execute("SELECT * FROM credit WHERE id = 'grant-1'").fetchone())
    consume = dict(check.execute("SELECT * FROM credit WHERE id = 'consume-l'").fetchone())
    check.close()

    # 新租约未被旧 Worker 覆盖成 failed，也未错退积分或写入陈旧章节 HTML
    assert job["status"] == "processing"
    assert job["lease"] == "newer-worker-lease"
    assert job["attempts"] == 2
    assert ch["content_html"] == ""
    assert grant["remaining_credits"] == 0
    assert consume["status"] == "active"


def test_sqlite_worker_recompile_bundle_uses_zero_llm_calls(tmp_path: Path, monkeypatch) -> None:
    """recompile_bundle 任务不得触发任何 LLM 写作调用，应基于修改后的书名/封面重新打包并更新快照。"""
    import json
    import book_writer

    # 清空 LLM 密钥并给底层的模型请求设下断言炸弹，确保 0 次模型调用
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    monkeypatch.setenv("FALLBACK_API_KEY", "")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    monkeypatch.delenv("KDP_ALLOW_DEMO_TEMPLATE", raising=False)

    def fail_if_llm_called(**kwargs):
        raise AssertionError("recompile_bundle 不应调用任何 LLM 接口")

    monkeypatch.setattr(book_writer, "_post_chat_completions", fail_if_llm_called)

    db_file = tmp_path / "recompile.db"
    artifacts_dir = tmp_path / "artifacts"
    monkeypatch.setattr(worker_main, "ARTIFACTS_ROOT", artifacts_dir)
    conn = _create_queue_db_with_credits(db_file)

    prof_id = "prof-rec"
    proj_id = "proj-rec"
    conn.execute(
        "INSERT INTO kdp_pen_profile VALUES (?, 'u1', 'Evelyn', 'Vance', 'Evelyn Vance', 'INDEPENDENT EDITION', 'https://evelynbooks.com/audio', NULL, '', 0, 0)",
        (prof_id,),
    )
    conn.execute(
        """
        INSERT INTO kdp_project VALUES (
            ?, 'u1', ?, 'Revised Quiet Architecture',
            'Structured Behavioral Frameworks for Composed Focus in Daily Dialogue',
            'Self-Help', 'Attentional focus', 'Professionals', '', 'https://evelynbooks.com/audio',
            18000, 16120, '6x9', 80, 'cream', 'slate_monolith', 'en', 'ready', 1, 100,
            '{"back_blurb":"Clear practical framework for everyday composure."}',
            'old/e.epub', 'old/i.pdf', 'old/w.pdf', 'old/f.jpg', 'old/b.zip',
            '{"title":"Old Title","cover_theme":"ivory_monograph"}', 0, 0
        )
        """,
        (proj_id, prof_id),
    )
    clean_chapter = book_writer._fallback_chapter_html("Chapter 1", "Structural discipline", min_words=1600)
    for i in range(10):
        conn.execute(
            "INSERT INTO kdp_chapter VALUES (?, ?, 'u1', ?, 'chapter', ?, ?, 'Summary', ?, 1612, 'generated', 0, 0)",
            (f"ch-rec-{i}", proj_id, i, f"Chapter {i+1}: Discipline", f"ch-{i+1}", clean_chapter),
        )
    conn.execute(
        "INSERT INTO kdp_job VALUES ('job-rec', ?, 'u1', 'recompile_bundle', 'queued', 0, 'queued', 0, NULL, NULL, 10, '', '{}', '{}', NULL, 1, NULL)",
        (proj_id,),
    )
    conn.commit()
    conn.close()

    assert worker_main.run_once_sqlite(f"file:{db_file}") is True

    check = sqlite3.connect(db_file)
    check.row_factory = sqlite3.Row
    job = dict(check.execute("SELECT * FROM kdp_job WHERE id = 'job-rec'").fetchone())
    proj = dict(check.execute("SELECT * FROM kdp_project WHERE id = ?", (proj_id,)).fetchone())
    check.close()

    assert job["status"] == "succeeded", f"Recompile failed: {job.get('error')}"
    snap = json.loads(proj["compiled_snapshot_json"])
    assert snap["title"] == "Revised Quiet Architecture"
    assert snap["cover_theme"] == "slate_monolith"
    assert snap["job_type"] == "recompile_bundle"
    assert (artifacts_dir / proj["bundle_zip_key"]).exists()
    assert (artifacts_dir / proj["cover_wrap_pdf_key"]).exists()


def test_worker_decrypts_enc_v1_aes_gcm_secrets(tmp_path: Path, monkeypatch) -> None:
    """Worker 必须兼容 TypeScript lib/crypto.ts 的 enc:v1: AES-256-GCM 密文并在密钥缺失时安全返回空串。"""
    import base64
    import hashlib
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    secret = "test-config-encryption-key-32-chars"
    monkeypatch.setenv("CONFIG_ENCRYPTION_KEY", secret)

    def ts_encrypt(plaintext: str) -> str:
        key = hashlib.sha256(secret.encode("utf-8")).digest()
        iv = b"\x01" * 12
        ct_and_tag = AESGCM(key).encrypt(iv, plaintext.encode("utf-8"), None)
        ct, tag = ct_and_tag[:-16], ct_and_tag[-16:]
        packed = iv + tag + ct
        return "enc:v1:" + base64.b64encode(packed).decode("ascii")

    enc_openrouter = ts_encrypt("sk-or-secret-xyz")
    enc_deepseek = ts_encrypt("sk-ds-secret-123")
    assert worker_main.decrypt_config_value(enc_openrouter) == "sk-or-secret-xyz"
    assert worker_main.decrypt_config_value("plain-legacy-value") == "plain-legacy-value"

    db_file = tmp_path / "enc_cfg.db"
    conn = _create_queue_db_with_credits(db_file)
    conn.execute("INSERT INTO config VALUES ('openrouter_api_key', ?)", (enc_openrouter,))
    conn.execute("INSERT INTO config VALUES ('fallback_api_key', ?)", (enc_deepseek,))
    conn.commit()
    cfg = worker_main._db_config_lookup(conn, True)
    assert cfg["openrouter_api_key"] == "sk-or-secret-xyz"
    assert cfg["fallback_api_key"] == "sk-ds-secret-123"

    # 错误或缺失加密密钥时安全降级为空字符串，绝不透传密文本身给 API
    monkeypatch.setenv("CONFIG_ENCRYPTION_KEY", "wrong-key")
    assert worker_main.decrypt_config_value(enc_openrouter) == ""
    conn.close()


def test_sqlite_worker_compile_manuscript_uses_zero_llm_and_refunds_on_guard_block(tmp_path: Path, monkeypatch) -> None:
    """compile_manuscript 任务严禁调用 LLM，应支持人类作者自定义书名与自然页数编译；遇违禁词须拦截并 100% 退还 60 积分。"""
    import json
    import book_writer

    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    monkeypatch.setenv("FALLBACK_API_KEY", "")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    monkeypatch.delenv("KDP_ALLOW_DEMO_TEMPLATE", raising=False)

    def fail_if_llm_called(**kwargs):
        raise AssertionError("compile_manuscript 不得调用任何 LLM 接口")

    monkeypatch.setattr(book_writer, "_post_chat_completions", fail_if_llm_called)

    db_file = tmp_path / "import_compile.db"
    artifacts_dir = tmp_path / "artifacts"
    monkeypatch.setattr(worker_main, "ARTIFACTS_ROOT", artifacts_dir)
    conn = _create_queue_db_with_credits(db_file)

    # 1) 正常人类原创导入书稿（~6,000 词，<15k 仍应放行！不设 Pen Profile 而使用 author_name_override）
    proj_id = "proj-import-ok"
    conn.execute(
        """
        INSERT INTO kdp_project VALUES (
            ?, 'u1', NULL, 'Quiet Fieldcraft Monograph',
            'Focused Work Routines for Independent Creators',
            'Self-Help', 'Imported manuscript', '', '', '',
            6000, 6000, '6x9', 0, 'cream', 'editorial_split', 'en', 'manuscript_ready', 1, 100,
            '{"source_mode":"imported_manuscript","author_name_override":"Clara Chen","back_blurb":"Clean human treatise on sustained creative discipline."}',
            '', '', '', '', '', '{}', 0, 0
        )
        """,
        (proj_id,),
    )
    prose_chapter = "<p>" + " ".join(["attention", "structure", "calm", "cadence", "discipline"] * 300) + "</p>"
    for i in range(4):
        conn.execute(
            "INSERT INTO kdp_chapter VALUES (?, ?, 'u1', ?, 'chapter', ?, ?, 'Summary', ?, 1500, 'imported', 0, 0)",
            (f"ch-imp-{i}", proj_id, i, f"Chapter {i+1}: Craft", f"ch-{i+1}", prose_chapter),
        )
    conn.execute(
        "INSERT INTO kdp_job VALUES ('job-imp-ok', ?, 'u1', 'compile_manuscript', 'queued', 0, 'queued', 0, NULL, NULL, 60, '', '{}', '{}', NULL, 1, NULL)",
        (proj_id,),
    )

    # 2) 包含严重临床医学词汇的导入书稿 -> 必须被 Guard 拦截失败且 100% 退还 60 积分
    bad_proj_id = "proj-import-bad"
    grant_id = "grant-60"
    consume_id = "consume-60"
    conn.execute("INSERT INTO credit VALUES (?, 'u2', 'grant', 60, 0, 'active', NULL)", (grant_id,))
    conn.execute(
        "INSERT INTO credit VALUES (?, 'u2', 'consume', -60, 0, 'active', ?)",
        (consume_id, json.dumps([{"creditId": grant_id, "creditsConsumed": 60}])),
    )
    conn.execute(
        """
        INSERT INTO kdp_project VALUES (
            ?, 'u2', NULL, 'Forbidden Medical Guide',
            'Instant Cure', 'Self-Help', 'Imported', '', '', '',
            500, 500, '6x9', 0, 'cream', 'editorial_split', 'en', 'manuscript_ready', 0, 20,
            '{"source_mode":"imported_manuscript","author_name_override":"Clara Chen","back_blurb":"Practical habits."}',
            '', '', '', '', '', '{}', 0, 0
        )
        """,
        (bad_proj_id,),
    )
    conn.execute(
        "INSERT INTO kdp_chapter VALUES ('ch-imp-bad', ?, 'u2', 0, 'chapter', 'Chapter 1: Risky', 'ch-1', 'Summary', '<p>Guaranteed fast ADHD and insomnia medical cure right now.</p>', 9, 'imported', 0, 0)",
        (bad_proj_id,),
    )
    conn.execute(
        "INSERT INTO kdp_job VALUES ('job-imp-bad', ?, 'u2', 'compile_manuscript', 'queued', 0, 'queued', 0, NULL, NULL, 60, ?, '{}', '{}', NULL, 2, NULL)",
        (bad_proj_id, consume_id),
    )
    conn.commit()
    conn.close()

    assert worker_main.run_once_sqlite(f"file:{db_file}") is True
    assert worker_main.run_once_sqlite(f"file:{db_file}") is True

    check = sqlite3.connect(db_file)
    check.row_factory = sqlite3.Row
    job_ok = dict(check.execute("SELECT * FROM kdp_job WHERE id = 'job-imp-ok'").fetchone())
    proj_ok = dict(check.execute("SELECT * FROM kdp_project WHERE id = ?", (proj_id,)).fetchone())
    job_bad = dict(check.execute("SELECT * FROM kdp_job WHERE id = 'job-imp-bad'").fetchone())
    grant_after = dict(check.execute("SELECT * FROM credit WHERE id = ?", (grant_id,)).fetchone())
    consume_after = dict(check.execute("SELECT * FROM credit WHERE id = ?", (consume_id,)).fetchone())
    check.close()

    assert job_ok["status"] == "succeeded", f"Imported compile failed: {job_ok.get('error')}"
    snap = json.loads(proj_ok["compiled_snapshot_json"])
    assert snap["author_name"] == "Clara Chen"
    assert snap["actual_pages"] >= 20
    assert snap["actual_pages"] % 2 == 0
    assert (artifacts_dir / proj_ok["bundle_zip_key"]).exists()

    checklist_json = json.loads((artifacts_dir / proj_id / "04_KDP_Metadata_Checklist.json").read_text(encoding="utf-8"))
    disclosure = checklist_json["ai_generated_disclosure"]
    assert disclosure["text_content"] == "Review required — confirm how the imported manuscript was created."
    assert "including content you later edited" in disclosure["guidance"]

    assert job_bad["status"] == "failed"
    assert "KDP Guard failed" in (job_bad["error"] or "")
    assert grant_after["remaining_credits"] == 60
    assert consume_after["status"] == "deleted"
