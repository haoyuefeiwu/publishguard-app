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
