import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { headers } from 'next/headers';

import { getAuth } from '@/core/auth';
import { getArtifactsRoot, getProjectDetail } from '@/modules/kdp/service';

const ASSET_MAP = {
  bundle: {
    field: 'bundleZipKey',
    contentType: 'application/zip',
    filename: 'KDP_Ready_Bundle.zip',
  },
  epub: {
    field: 'epubKey',
    contentType: 'application/epub+zip',
    filename: '01_Kindle_eBook_Upload.epub',
  },
  interior: {
    field: 'interiorPdfKey',
    contentType: 'application/pdf',
    filename: '01_Interior_Manuscript_Print.pdf',
  },
  cover_wrap: {
    field: 'coverWrapPdfKey',
    contentType: 'application/pdf',
    filename: '03_Paperback_Cover_Wrap.pdf',
  },
  cover_front: {
    field: 'coverFrontJpgKey',
    contentType: 'image/jpeg',
    filename: '02_eBook_Cover_Front.jpg',
  },
} as const;

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id } = await context.params;
  const detail = await getProjectDetail(session.user.id, id);
  if (!detail) {
    return new Response('Not found', { status: 404 });
  }

  const url = new URL(req.url);
  const typeParam = (url.searchParams.get('type') ||
    'bundle') as keyof typeof ASSET_MAP;
  const spec = ASSET_MAP[typeParam];
  if (!spec) {
    return new Response('Invalid asset type', { status: 400 });
  }

  const relKey = String((detail.project as any)[spec.field] || '');
  if (!relKey) {
    return new Response('Asset not generated yet', { status: 404 });
  }

  const rootDir = resolve(
    /*turbopackIgnore: true*/ process.cwd(),
    getArtifactsRoot()
  );
  const fullPath = resolve(/*turbopackIgnore: true*/ rootDir, relKey);
  if (
    (!fullPath.startsWith(rootDir + sep) && fullPath !== rootDir) ||
    !existsSync(fullPath)
  ) {
    return new Response('Asset file missing', { status: 404 });
  }

  const fileBytes = await readFile(fullPath);
  const inline = url.searchParams.get('inline') === '1';

  return new Response(fileBytes, {
    status: 200,
    headers: {
      'Content-Type': spec.contentType,
      'Content-Disposition': inline
        ? `inline; filename="${spec.filename}"`
        : `attachment; filename="${spec.filename}"`,
      'Cache-Control': 'private, no-cache, must-revalidate',
    },
  });
}
