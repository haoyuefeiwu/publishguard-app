import { envConfigs } from '@/config';
import { defaultLocale } from '@/config/locale';
import { getBlogPost, getBlogPosts } from '@/content/posts';

export const revalidate = 3600;

const STATIC_PAGES: { path: string; title: string; description: string }[] = [
  { path: '', title: 'Home', description: 'Landing page' },
  { path: '/pricing', title: 'Pricing', description: 'Pricing plans' },
  { path: '/blog', title: 'Blog', description: 'Blog posts and articles' },
];

export async function GET() {
  const { app_url, app_name, app_description } = envConfigs;
  const posts = await getBlogPosts(defaultLocale);

  const lines: string[] = [
    `# ${app_name}`,
    '',
    `> ${app_description}`,
    '',
    '## Pages',
    '',
    ...STATIC_PAGES.map(
      (p) => `- [${p.title}](${app_url}${p.path}): ${p.description}`
    ),
  ];

  if (posts.length > 0) {
    lines.push('', '## Blog Posts', '');

    for (const post of posts) {
      const detail = await getBlogPost(post.slug, defaultLocale);
      lines.push(`### ${post.title}`, '');
      lines.push(`URL: ${app_url}/blog/${post.slug}`);
      if (post.description) lines.push(`Description: ${post.description}`);
      lines.push('');

      if (detail?.content) {
        lines.push(detail.content, '');
      }

      lines.push('---', '');
    }
  }

  lines.push('');

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
