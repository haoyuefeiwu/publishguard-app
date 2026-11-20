import { headers } from 'next/headers';

import { getAuth } from '@/core/auth';
import { importManuscriptProject } from '@/modules/kdp/service';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData, respErr } from '@/lib/resp';

const ALLOWED_EXTENSIONS = new Set([
  '.docx',
  '.epub',
  '.md',
  '.markdown',
  '.txt',
]);
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function getSafeExtension(filename: string): string {
  const clean = filename.trim().toLowerCase();
  const dot = clean.lastIndexOf('.');
  return dot === -1 ? '' : clean.slice(dot);
}

export async function POST(req: Request) {
  const limited = enforceMinIntervalRateLimit(req, {
    intervalMs: 1500,
    keyPrefix: 'kdp_project_import',
  });
  if (limited) return limited;

  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const contentType = req.headers.get('content-type') || '';
    let payload: Record<string, any> = {};
    let filename = '';
    let contentBase64 = '';

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (file && file instanceof File) {
        if (file.size > MAX_UPLOAD_BYTES) {
          return respErr('Manuscript file exceeds 15MB limit');
        }
        filename = file.name || 'manuscript.txt';
        const ext = getSafeExtension(filename);
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          return respErr(
            'Unsupported file format. Please upload .docx, .epub, .md, or .txt.'
          );
        }
        const buf = Buffer.from(await file.arrayBuffer());
        contentBase64 = buf.toString('base64');
      }
      payload = {
        pen_profile_id: String(form.get('pen_profile_id') || ''),
        title: String(form.get('title') || ''),
        subtitle: String(form.get('subtitle') || ''),
        author_name: String(form.get('author_name') || ''),
        genre: String(form.get('genre') || 'Self-Help'),
        description: String(form.get('description') || ''),
        companion_url: String(form.get('companion_url') || ''),
        trim_size: String(form.get('trim_size') || '6x9'),
        target_page_count: form.get('target_page_count')
          ? Number(form.get('target_page_count'))
          : 0,
        paper_type: String(form.get('paper_type') || 'cream'),
        cover_theme: String(form.get('cover_theme') || 'editorial_split'),
        language: String(form.get('language') || 'en'),
        raw_text: String(form.get('raw_text') || ''),
      };
    } else {
      const rawJson = await req.json().catch(() => ({}));
      payload = rawJson && typeof rawJson === 'object' ? rawJson : {};
      filename = String(payload.filename || '').trim();
      if (filename) {
        const ext = getSafeExtension(filename);
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          return respErr(
            'Unsupported file format. Please upload .docx, .epub, .md, or .txt.'
          );
        }
      }
      if (
        typeof payload.content_base64 === 'string' &&
        payload.content_base64
      ) {
        let cleaned = payload.content_base64.trim();
        const commaIdx = cleaned.indexOf(',');
        if (cleaned.startsWith('data:') && commaIdx !== -1) {
          cleaned = cleaned.slice(commaIdx + 1).trim();
        }
        if (
          cleaned.length > 21 * 1024 * 1024 ||
          Buffer.byteLength(cleaned, 'base64') > MAX_UPLOAD_BYTES
        ) {
          return respErr('Manuscript file exceeds 15MB limit');
        }
        contentBase64 = cleaned;
      }
    }

    const rawText = String(payload.raw_text || '').trim();
    if (!contentBase64 && !rawText) {
      return respErr(
        'Please upload a .docx/.epub/.md/.txt file or paste your manuscript text.'
      );
    }

    const result = await importManuscriptProject({
      userId: session.user.id,
      userEmail: session.user.email,
      penProfileId: payload.pen_profile_id || undefined,
      title:
        typeof payload.title === 'string' ? payload.title.slice(0, 200) : '',
      subtitle:
        typeof payload.subtitle === 'string'
          ? payload.subtitle.slice(0, 250)
          : '',
      authorName:
        typeof payload.author_name === 'string'
          ? payload.author_name.slice(0, 160)
          : '',
      genre:
        typeof payload.genre === 'string' && payload.genre.trim()
          ? payload.genre.trim()
          : 'Self-Help',
      description:
        typeof payload.description === 'string'
          ? payload.description.slice(0, 8000)
          : '',
      companionUrl:
        typeof payload.companion_url === 'string'
          ? payload.companion_url.slice(0, 300)
          : '',
      trimSize: payload.trim_size || '6x9',
      targetPageCount:
        payload.target_page_count !== undefined
          ? Number(payload.target_page_count)
          : 0,
      paperType: payload.paper_type || 'cream',
      coverTheme: payload.cover_theme || 'editorial_split',
      language: payload.language || 'en',
      filename,
      contentBase64: contentBase64 || undefined,
      rawText: rawText ? rawText.slice(0, 1_500_000) : undefined,
    });

    return respData(result);
  } catch (err: any) {
    return respErr(err?.message || 'Failed to import manuscript');
  }
}
