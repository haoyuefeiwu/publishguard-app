import { envConfigs } from '@/config';
import { defaultLocale } from '@/config/locale';
import { getBlogPosts } from '@/content/posts';

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
      '26-rule pre-flight firewall detecting Disappointing Customer Experience triggers, Option 1 Title Collisions, thin content traps, and EPUB/DOCX formatting flaws before KDP upload',
  },
  {
    path: '/studio',
    title: 'AI Book Studio',
    description:
      'End-to-end 18,000+ word monograph drafting, EPUB 3.0 & Print PDF compilation verified with Kindle Previewer 4.0.3',
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
    description:
      'Amazon KDP compliance guides, Kindle Previewer diagnostics, and publishing checklists',
  },
  {
    path: '/llms-full.txt',
    title: 'Full Knowledge Corpus (llms-full.txt)',
    description: 'Complete Markdown corpus for LLM & RAG indexing',
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
      lines.push(
        `- [${post.title}](${app_url}/blog/${post.slug}): ${post.description}`
      );
    }
  }

  lines.push('');

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
