import type { MetadataRoute } from 'next';

import { envConfigs } from '@/config';
import { defaultLocale, locales } from '@/config/locale';
import { getBlogPosts } from '@/content/posts';

// 动态生成站点地图，确保中台实时发布的数据库文章无需重建镜像即可被搜索引擎收录
export const dynamic = 'force-dynamic';

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

  const posts = (await getBlogPosts(defaultLocale)).map((post) => {
    const blogPath = `/blog/${encodeURIComponent(post.slug)}`;
    // 本地 MDX 文章具备多语言版本，数据库自动发文当前仅提供英文主版本
    if (post.source === 'local') {
      return entry(blogPath, {
        lastModified: post.createdAt,
        changeFrequency: 'monthly',
        priority: 0.6,
      });
    }
    return {
      url: localeUrl(blogPath, defaultLocale),
      lastModified: post.createdAt,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    };
  });

  return [...pages, ...posts];
}
