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
      };
    } else {
      payload = await req.json().catch(() => ({}));
    }

    if (
      !epubBase64 &&
      !payload.title?.trim() &&
      !payload.subtitle?.trim() &&
      !payload.description?.trim() &&
      !payload.manuscript_text?.trim()
    ) {
      return respErr(
        'Please enter a book title, manuscript snippet, or upload an EPUB file.'
      );
    }

    const { report, audit } = await runAndRecordGuardScan({
      userId: session?.user?.id || null,
      projectId: payload.project_id || null,
      clientIp,
      title: payload.title,
      subtitle: payload.subtitle,
      description: payload.description,
      authorName: payload.author_name,
      primaryCategory: payload.primary_category,
      manuscriptText: payload.manuscript_text,
      epubBase64: epubBase64 || payload.epub_base64 || undefined,
      companionDomain: payload.companion_domain,
      mode: payload.mode || 'dual',
      checkLiveCollisions: payload.check_live_collisions !== false,
    });

    return respData({ reportId: report.id, audit });
  } catch (err: any) {
    return respErr(err?.message || 'KDP Guard audit failed');
  }
}
