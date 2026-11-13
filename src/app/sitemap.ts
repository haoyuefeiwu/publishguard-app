import type { MetadataRoute } from 'next';

import { envConfigs } from '@/config';
import { defaultLocale, locales } from '@/config/locale';
import { getBlogPosts } from '@/content/posts';

const STATIC_PATHS = [
  '',
  '/tools/kdp-guard',
  '/pricing',
  '/blog',
  '/privacy-policy',
  '/terms-of-service',
];

function localeUrl(path: string, locale: string): string {
  const prefix = locale === defaultLocale ? '' : `/${locale}`;
  return `${envConfigs.app_url}${prefix}${path}`;
}

function entry(
  path: string,
  options: Partial<MetadataRoute.Sitemap[number]> = {}
): MetadataRoute.Sitemap[number] {
  return {
    url: localeUrl(path, defaultLocale),
    alternates: {
      languages: Object.fromEntries(
        locales.map((locale) => [locale, localeUrl(path, locale)])
      ),
    },
    ...options,
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = STATIC_PATHS.map((path) =>
    entry(path, {
      changeFrequency: path === '/blog' ? 'daily' : 'weekly',
      priority: path === '' ? 1 : 0.8,
    })
  );

  const posts = (await getBlogPosts(defaultLocale)).map((post) =>
    entry(`/blog/${post.slug}`, {
      lastModified: post.createdAt,
      changeFrequency: 'monthly',
      priority: 0.6,
    })
  );

  return [...pages, ...posts];
}
