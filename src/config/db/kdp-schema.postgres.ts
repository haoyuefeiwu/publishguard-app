/**
 * PublishGuard KDP 业务数据表定义（PostgreSQL 版）。
 * 由 schema.postgres.ts 重新导出，供 Drizzle ORM 与 Worker 协同使用。
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─── 1. 作者笔名与多账户防关联隔离档案 ──────────────────────────────────────

export const kdpPenProfile = pgTable(
  'kdp_pen_profile',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    penNameFirst: text('pen_name_first').notNull(),
    penNameLast: text('pen_name_last').notNull(),
    fullName: text('full_name').notNull(),
    editionLabel: text('edition_label')
      .notNull()
      .default('INDEPENDENT EDITION'),
    companionDomain: text('companion_domain').notNull().default(''),
    lastPublishedAt: timestamp('last_published_at', { withTimezone: true }),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_kdp_profile_user').on(t.userId),
    index('idx_kdp_profile_domain').on(t.userId, t.companionDomain),
  ]
);

// ─── 2. KDP 造书项目主表 ────────────────────────────────────────────────────

export const kdpProject = pgTable(
  'kdp_project',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    penProfileId: text('pen_profile_id').references(() => kdpPenProfile.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    subtitle: text('subtitle').notNull().default(''),
    genre: text('genre').notNull().default('Self-Help'),
    topicPrompt: text('topic_prompt').notNull().default(''),
    targetAudience: text('target_audience').notNull().default(''),
    companionProduct: text('companion_product').notNull().default(''),
    companionUrl: text('companion_url').notNull().default(''),
    targetWordCount: integer('target_word_count').notNull().default(19000),
    actualWordCount: integer('actual_word_count').notNull().default(0),
    trimSize: text('trim_size').notNull().default('6x9'),
    targetPageCount: integer('target_page_count').notNull().default(100),
    paperType: text('paper_type').notNull().default('cream'),
    coverTheme: text('cover_theme').notNull().default('editorial_split'),
    language: text('language').notNull().default('en'),
    status: text('status').notNull().default('draft'),
    guardPassed: boolean('guard_passed').notNull().default(false),
    guardScore: integer('guard_score').notNull().default(0),
    metadataJson: text('metadata_json').notNull().default('{}'),
    epubKey: text('epub_key').notNull().default(''),
    interiorPdfKey: text('interior_pdf_key').notNull().default(''),
    coverWrapPdfKey: text('cover_wrap_pdf_key').notNull().default(''),
    coverFrontJpgKey: text('cover_front_jpg_key').notNull().default(''),
    bundleZipKey: text('bundle_zip_key').notNull().default(''),
    compiledSnapshotJson: text('compiled_snapshot_json')
      .notNull()
      .default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_kdp_project_user').on(t.userId, t.createdAt),
    index('idx_kdp_project_status').on(t.status),
  ]
);

// ─── 3. 书籍结构化章节表 ────────────────────────────────────────────────────

export const kdpChapter = pgTable(
  'kdp_chapter',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => kdpProject.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    chapterIndex: integer('chapter_index').notNull(),
    sectionType: text('section_type').notNull().default('chapter'),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary').notNull().default(''),
    contentHtml: text('content_html').notNull().default(''),
    wordCount: integer('word_count').notNull().default(0),
    status: text('status').notNull().default('outlined'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('idx_kdp_chapter_project_idx').on(t.projectId, t.chapterIndex)]
);

// ─── 4. 异步 AI 造书与编译任务队列 ──────────────────────────────────────────

export const kdpJob = pgTable(
  'kdp_job',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => kdpProject.id, {
      onDelete: 'cascade',
    }),
    userId: text('user_id').notNull(),
    jobType: text('job_type').notNull(),
    status: text('status').notNull().default('queued'),
    progressPct: integer('progress_pct').notNull().default(0),
    currentStep: text('current_step').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lease: text('lease'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    costCredits: integer('cost_credits').notNull().default(0),
    creditId: text('credit_id').notNull().default(''),
    payloadJson: text('payload_json').notNull().default('{}'),
    resultJson: text('result_json').notNull().default('{}'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_kdp_job_queue').on(t.status, t.createdAt),
    index('idx_kdp_job_project').on(t.projectId, t.createdAt),
    index('idx_kdp_job_user').on(t.userId, t.createdAt),
    uniqueIndex('uidx_kdp_job_active_project')
      .on(t.projectId)
      .where(
        sql`status IN ('queued', 'processing') AND project_id IS NOT NULL`
      ),
  ]
);

// ─── 5. 26 项 KDP 零风控体检报告留档 ─────────────────────────────────────────

export const kdpGuardReport = pgTable(
  'kdp_guard_report',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => kdpProject.id, {
      onDelete: 'set null',
    }),
    userId: text('user_id'),
    clientIpHash: text('client_ip_hash').notNull().default(''),
    mode: text('mode').notNull().default('dual'),
    sourceType: text('source_type').notNull().default('text'),
    inputTitle: text('input_title').notNull().default(''),
    inputSubtitle: text('input_subtitle').notNull().default(''),
    passed: boolean('passed').notNull().default(false),
    score: integer('score').notNull().default(0),
    errorsJson: text('errors_json').notNull().default('[]'),
    warningsJson: text('warnings_json').notNull().default('[]'),
    collisionJson: text('collision_json').notNull().default('{}'),
    sanitizedText: text('sanitized_text').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_kdp_report_user').on(t.userId, t.createdAt),
    index('idx_kdp_report_ip').on(t.clientIpHash, t.createdAt),
  ]
);

export type KdpPenProfile = typeof kdpPenProfile.$inferSelect;
export type NewKdpPenProfile = typeof kdpPenProfile.$inferInsert;
export type KdpProject = typeof kdpProject.$inferSelect;
export type NewKdpProject = typeof kdpProject.$inferInsert;
export type KdpChapter = typeof kdpChapter.$inferSelect;
export type NewKdpChapter = typeof kdpChapter.$inferInsert;
export type KdpJob = typeof kdpJob.$inferSelect;
export type NewKdpJob = typeof kdpJob.$inferInsert;
export type KdpGuardReport = typeof kdpGuardReport.$inferSelect;
export type NewKdpGuardReport = typeof kdpGuardReport.$inferInsert;
