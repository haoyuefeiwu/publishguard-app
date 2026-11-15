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


def test_sqlite_worker_claims_and_completes_book_job(tmp_path: Path, monkeypatch) -> None:
    # 单元测试隔离外部 LLM 密钥，保持队列抢单与编译测试确定性且快速执行
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    monkeypatch.setenv("FALLBACK_API_KEY", "")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    db_file = tmp_path / "test_queue.db"
    artifacts_dir = tmp_path / "artifacts"
    monkeypatch.setattr(worker_main, "ARTIFACTS_ROOT", artifacts_dir)

    conn = sqlite3.connect(db_file)
    conn.executescript(
        """
        CREATE TABLE config (name TEXT UNIQUE NOT NULL, value TEXT);
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
            '{"back_blurb":"Clear practical framework for everyday composure."}', '', '', '', '', '', 0, 0
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
    check.close()

    assert job_row["status"] == "succeeded", f"Job failed: {job_row.get('error')}"
    assert job_row["progress_pct"] == 100
    assert proj_row["status"] == "ready"
    assert proj_row["guard_passed"] == 1
    assert proj_row["guard_score"] == 100
    assert proj_row["actual_word_count"] >= 15000
    assert (artifacts_dir / proj_row["bundle_zip_key"]).exists()
    assert (artifacts_dir / proj_row["epub_key"]).exists()
    assert (artifacts_dir / proj_row["interior_pdf_key"]).exists()
    assert (artifacts_dir / proj_row["cover_wrap_pdf_key"]).exists()


def _create_queue_db_with_credits(db_file: Path) -> sqlite3.Connection:
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
            '{}', '', '', '', '', '', 0, 0
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
        "INSERT INTO kdp_project VALUES ('p1', 'u1', NULL, 'T1', 'S1', 'Self-Help', 'A', 'B', '', '', 18000, 0, '6x9', 80, 'cream', 'ivory_monograph', 'en', 'queued', 0, 0, '{}', '', '', '', '', '', 0, 0)"
    )
    conn.execute(
        "INSERT INTO kdp_project VALUES ('p2', 'u2', NULL, 'T2', 'S2', 'Self-Help', 'A', 'B', '', '', 18000, 0, '6x9', 80, 'cream', 'ivory_monograph', 'en', 'queued', 0, 0, '{}', '', '', '', '', '', 0, 0)"
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
        }

    monkeypatch.setattr(worker_main, "_execute_book_pipeline", fake_ok_pipeline)
    assert worker_main.run_once_sqlite(f"file:{db_file}") is True
    assert claimed_jobs == ["job-high"]
