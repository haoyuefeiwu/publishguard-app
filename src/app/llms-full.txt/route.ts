import { envConfigs } from '@/config';
import { defaultLocale } from '@/config/locale';
import { getBlogPost, getBlogPosts } from '@/content/posts';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

const STATIC_PAGES: { path: string; title: string; description: string }[] = [
  {
    path: '',
    title: 'Home',
    description:
      'PublishGuard — Ban-Proof Amazon KDP Pre-Flight Compliance & AI Book Studio',
  },
  {
    path: '/tools/kdp-guard',
    title: 'Free KDP Pre-Flight Scanner',
    description:
      '26-rule KDP compliance & title collision firewall (3 credits per anonymous daily scan)',
  },
  {
    path: '/studio',
    title: 'AI Book Studio',
    description:
      'Structured 18,000+ word manuscript generation and EPUB/Print PDF KDP bundle compilation (verified on Kindle Previewer 4.0.3)',
  },
  {
    path: '/pricing',
    title: 'Pricing',
    description:
      'Single Book Pass ($29 / 120 credits), Author Pro ($49/mo or $390/yr), and Publishing Studio ($99/mo or $790/yr)',
  },
  {
    path: '/blog',
    title: 'Blog',
    description: 'Amazon KDP compliance guides and publishing playbooks',
  },
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
