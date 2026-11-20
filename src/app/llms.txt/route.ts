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
    path: '/tools',
    title: 'Free Amazon KDP Publishing Tools',
    description:
      'Hub of free pre-upload KDP tools: paperback spine & cover size calculator, title collision checker, and 26-rule compliance guard',
  },
  {
    path: '/tools/kdp-spine-calculator',
    title: 'Free KDP Paperback Spine & Cover Size Calculator',
    description:
      'Calculate exact KDP paperback spine width (0.0025" Cream / 0.002252" White), 0.125" bleed cover dimensions in in/mm/300 DPI px, minimum gutter margins, and downloadable cover guides',
  },
  {
    path: '/tools/kdp-title-checker',
    title: 'Free KDP Title Collision & Subtitle Policy Checker',
    description:
      'Scan Amazon KDP titles and subtitles against the 200-char limit, keyword stuffing rules, and live Apple Books & OpenLibrary bestseller collisions',
  },
  {
    path: '/tools/kdp-guard',
    title: 'Free KDP Pre-Flight Scanner',
    description:
      '26-rule pre-flight firewall detecting Disappointing Customer Experience triggers, Option 1 Title Collisions, thin content traps, and EPUB/DOCX formatting flaws before KDP upload',
  },
  {
    path: '/studio',
    title: 'AI Book Studio & Manuscript Formatter',
    description:
      'Import your own .docx/.epub/.md manuscript ($19 Format & Guard Pass) or build an 18,000+ word monograph ($29) verified with Kindle Previewer 4.0.3',
  },
  {
    path: '/pricing',
    title: 'Pricing',
    description:
      'Format & Guard Pass ($19 / 60 credits), Single Book Pass ($29 / 120 credits), Author Pro ($49/mo or $390/yr), and Publishing Studio ($99/mo or $790/yr)',
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
