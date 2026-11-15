/**
 * PublishGuard KDP 业务数据表定义（SQLite 版，用于无 Postgres 时的本地快速开发与构建）。
 * 字段命名与类型和 kdp-schema.postgres.ts 保持 100% 一致。
 */

import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const sqliteNow = sql`(unixepoch() * 1000)`;

export const kdpPenProfile = sqliteTable(
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
    lastPublishedAt: integer('last_published_at', { mode: 'timestamp_ms' }),
    notes: text('notes').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sqliteNow)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sqliteNow)
      .notNull(),
  },
  (t) => [
    index('idx_kdp_profile_user').on(t.userId),
    index('idx_kdp_profile_domain').on(t.userId, t.companionDomain),
  ]
);

export const kdpProject = sqliteTable(
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
    guardPassed: integer('guard_passed', { mode: 'boolean' })
      .notNull()
      .default(false),
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
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sqliteNow)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sqliteNow)
      .notNull(),
  },
  (t) => [
    index('idx_kdp_project_user').on(t.userId, t.createdAt),
    index('idx_kdp_project_status').on(t.status),
  ]
);

export const kdpChapter = sqliteTable(
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
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sqliteNow)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sqliteNow)
      .notNull(),
  },
  (t) => [index('idx_kdp_chapter_project_idx').on(t.projectId, t.chapterIndex)]
);

export const kdpJob = sqliteTable(
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
    leaseUntil: integer('lease_until', { mode: 'timestamp_ms' }),
    costCredits: integer('cost_credits').notNull().default(0),
    creditId: text('credit_id').notNull().default(''),
    payloadJson: text('payload_json').notNull().default('{}'),
    resultJson: text('result_json').notNull().default('{}'),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sqliteNow)
      .notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
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

export const kdpGuardReport = sqliteTable(
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
    passed: integer('passed', { mode: 'boolean' }).notNull().default(false),
    score: integer('score').notNull().default(0),
    errorsJson: text('errors_json').notNull().default('[]'),
    warningsJson: text('warnings_json').notNull().default('[]'),
    collisionJson: text('collision_json').notNull().default('{}'),
    sanitizedText: text('sanitized_text').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sqliteNow)
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
