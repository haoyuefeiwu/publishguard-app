import { headers } from 'next/headers';
import { desc, eq } from 'drizzle-orm';

import { getAuth } from '@/core/auth';
import { db } from '@/core/db';
import { kdpGuardReport } from '@/config/db/schema';
import { runAndRecordGuardScan } from '@/modules/kdp/service';
import { getClientIpFromCtx } from '@/lib/cookie';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr } from '@/lib/resp';

export async function GET() {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return respErr('Unauthorized');
    }

    const reports = await db()
      .select()
      .from(kdpGuardReport)
      .where(eq(kdpGuardReport.userId, session.user.id))
      .orderBy(desc(kdpGuardReport.createdAt))
      .limit(20);

    return respData({ reports });
  } catch (err: any) {
    return respErr(err?.message || 'Failed to load guard reports');
  }
}

export async function POST(req: Request) {
  const limited = enforceMinIntervalRateLimit(req, {
    intervalMs: 1200,
    keyPrefix: 'kdp_guard_scan',
  });
  if (limited) return limited;

  try {
    const auth = getAuth();
    const hdrs = await headers();
    const session = await auth.api.getSession({ headers: hdrs });
    const clientIp = getClientIpFromCtx({ headers: hdrs });

    const contentType = req.headers.get('content-type') || '';
    let payload: Record<string, any> = {};
    let epubBase64 = '';

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (file && file instanceof File) {
        if (file.size > 15 * 1024 * 1024) {
          return respErr('EPUB file exceeds 15MB limit');
        }
        const buf = Buffer.from(await file.arrayBuffer());
        epubBase64 = buf.toString('base64');
      }
      payload = {
        title: String(form.get('title') || ''),
        subtitle: String(form.get('subtitle') || ''),
        description: String(form.get('description') || ''),
        author_name: String(form.get('author_name') || ''),
        primary_category: String(form.get('primary_category') || ''),
        manuscript_text: String(form.get('manuscript_text') || ''),
        companion_domain: String(form.get('companion_domain') || ''),
        mode: String(form.get('mode') || 'dual'),
        lang: String(form.get('lang') || 'en'),
      };
    } else {
      const rawJson = await req.json().catch(() => ({}));
      payload = rawJson && typeof rawJson === 'object' ? rawJson : {};
      if (typeof payload.epub_base64 === 'string' && payload.epub_base64) {
        let cleanedB64 = payload.epub_base64.trim();
        const commaIdx = cleanedB64.indexOf(',');
        if (cleanedB64.startsWith('data:') && commaIdx !== -1) {
          cleanedB64 = cleanedB64.slice(commaIdx + 1).trim();
        }
        if (cleanedB64.length > 21 * 1024 * 1024) {
          return respErr('EPUB file exceeds 15MB limit');
        }
        const decodedBytes = Buffer.byteLength(cleanedB64, 'base64');
        if (decodedBytes > 15 * 1024 * 1024) {
          return respErr('EPUB file exceeds 15MB limit');
        }
        epubBase64 = cleanedB64;
      }
    }

    if (
      !epubBase64 &&
      !String(payload.title || '').trim() &&
      !String(payload.subtitle || '').trim() &&
      !String(payload.description || '').trim() &&
      !String(payload.manuscript_text || '').trim()
    ) {
      return respErr(
        'Please enter a book title, manuscript snippet, or upload an EPUB file.'
      );
    }

    const lang = String(payload.lang || '')
      .toLowerCase()
      .startsWith('zh')
      ? 'zh'
      : 'en';

    const { report, audit } = await runAndRecordGuardScan({
      userId: session?.user?.id || null,
      projectId: payload.project_id || null,
      clientIp,
      title:
        typeof payload.title === 'string' ? payload.title.slice(0, 500) : '',
      subtitle:
        typeof payload.subtitle === 'string'
          ? payload.subtitle.slice(0, 500)
          : '',
      description:
        typeof payload.description === 'string'
          ? payload.description.slice(0, 10_000)
          : '',
      authorName:
        typeof payload.author_name === 'string'
          ? payload.author_name.slice(0, 300)
          : '',
      primaryCategory:
        typeof payload.primary_category === 'string'
          ? payload.primary_category.slice(0, 200)
          : '',
      manuscriptText:
        typeof payload.manuscript_text === 'string'
          ? payload.manuscript_text.slice(0, 1_500_000)
          : '',
      epubBase64: epubBase64 || undefined,
      companionDomain:
        typeof payload.companion_domain === 'string'
          ? payload.companion_domain.slice(0, 300)
          : '',
      mode: payload.mode || 'dual',
      lang,
      checkLiveCollisions: payload.check_live_collisions !== false,
    });

    return respData({ reportId: report.id, audit });
  } catch (err: any) {
    const rawMsg = String(err?.message || 'KDP Guard audit failed');
    const safeMsg = /traceback|file\s+["']|\/app\/|\/users\//i.test(rawMsg)
      ? 'Audit engine failed to process this file. Please verify your .epub container and try again.'
      : rawMsg;
    return respErr(safeMsg);
  }
}
