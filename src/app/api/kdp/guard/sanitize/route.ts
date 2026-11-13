import { headers } from 'next/headers';

import { getAuth } from '@/core/auth';
import { sanitizeTextWithCredits } from '@/modules/kdp/service';
import { respData, respErr } from '@/lib/resp';

export async function POST(req: Request) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return respErr('Sign in required to run AI Compliance Sanitizer');
    }

    const body = await req.json().catch(() => ({}));
    const rawText = String(body.raw_text || '').trim();
    if (!rawText) {
      return respErr('raw_text is required');
    }

    const result = await sanitizeTextWithCredits({
      userId: session.user.id,
      rawText,
      mode: body.mode || 'dual',
    });

    return respData(result);
  } catch (err: any) {
    return respErr(err?.message || 'AI Sanitize failed');
  }
}
