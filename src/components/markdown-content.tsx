// 服务端数据库博客 Markdown 渲染器。
// 本地 MDX 文章通过 mdx-components.tsx 渲染——下方样式与排版保持一致。
import type { ReactNode } from 'react';
import MarkdownIt from 'markdown-it';

import { envConfigs } from '@/config';
import { cn } from '@/lib/utils';

function generateHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function getAppHosts(): Set<string> {
  const hosts = new Set<string>(['getpublishguard.com']);
  try {
    const parsed = new URL(envConfigs.app_url);
    hosts.add(parsed.hostname.replace(/^www\./, '').toLowerCase());
  } catch {
    // 环境变量格式异常时回退到默认主域名
  }
  return hosts;
}

const APP_HOSTS = getAppHosts();

function isInternalHref(href: string): boolean {
  if (href.startsWith('/') || href.startsWith('#')) {
    return true;
  }
  if (!href.startsWith('http://') && !href.startsWith('https://')) {
    return false;
  }
  try {
    const host = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
    return APP_HOSTS.has(host);
  } catch {
    return false;
  }
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
});

// 为所有标题生成稳定锚点 ID，方便文中跳转与导航
md.renderer.rules.heading_open = function (tokens, idx) {
  const token = tokens[idx];
  const level = token.markup.length;
  const nextToken = tokens[idx + 1];

  if (nextToken && nextToken.type === 'inline') {
    return `<h${level} id="${generateHeadingId(nextToken.content)}">`;
  }
  return `<h${level}>`;
};

// 仅对站外链接追加 nofollow 与新窗口打开；站内链接保持权重自然传递与同窗口跳转
md.renderer.rules.link_open = function (tokens, idx, options, _env, renderer) {
  const token = tokens[idx];
  const href = token.attrGet('href');
  if (
    href &&
    (href.startsWith('http://') || href.startsWith('https://')) &&
    !isInternalHref(href)
  ) {
    token.attrSet('rel', 'nofollow noopener');
    token.attrSet('target', '_blank');
  }
  return renderer.renderToken(tokens, idx, options);
};

// Shared typography for rendered markdown — also used by the admin rich-text
// editor so what you edit matches what the public pages render.
export const markdownStyles = cn(
  'text-[15px] leading-7 text-foreground/90',
  '[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-foreground md:[&_h1]:text-2xl',
  '[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground md:[&_h2]:text-xl',
  '[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:text-foreground',
  '[&_p]:mt-2 [&_p]:leading-7',
  '[&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline',
  '[&_ul]:mt-2 [&_ul]:ml-6 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:marker:text-muted-foreground',
  '[&_ol]:mt-2 [&_ol]:ml-6 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:marker:text-muted-foreground',
  '[&_li]:leading-7',
  '[&_strong]:font-semibold [&_strong]:text-foreground',
  '[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-[0.4rem] [&_code]:py-[0.2rem] [&_code]:font-mono [&_code]:text-sm [&_code]:text-foreground',
  '[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_hr]:my-8 [&_hr]:border-border',
  '[&_img]:my-4 [&_img]:rounded-xl',
  '[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2'
);

/**
 * 在第 2 个二级标题段落结束之后切分 Markdown，以便在读者滚动中段插入工具转化 CTA。
 * 若二级标题不足 2 个，则返回整段不做切分。
 */
function splitMarkdownMidArticle(content: string): {
  before: string;
  after: string | null;
} {
  if (!content) return { before: '', after: null };

  const lines = content.split('\n');
  const h2LineIndexes: number[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trimStart();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^##\s+/.test(trimmed)) {
      h2LineIndexes.push(i);
    }
  }

  // 有 3 个及以上 ## 标题时，放在第 3 个 ## 标题前（读者看完核心分析与对比后立即看到 CTA）；
  // 只有 2 个 ## 标题时，放在第 2 个 ## 标题前。
  const splitLine =
    h2LineIndexes.length >= 3
      ? h2LineIndexes[2]
      : h2LineIndexes.length === 2
        ? h2LineIndexes[1]
        : -1;

  if (splitLine <= 0) {
    return { before: content, after: null };
  }

  return {
    before: lines.slice(0, splitLine).join('\n'),
    after: lines.slice(splitLine).join('\n'),
  };
}

export function MarkdownContent({
  content,
  className,
  midArticleSlot,
}: {
  content: string;
  className?: string;
  midArticleSlot?: ReactNode;
}) {
  const { before, after } = midArticleSlot
    ? splitMarkdownMidArticle(content)
    : { before: content, after: null };

  const beforeHtml = before ? md.render(before) : '';
  const afterHtml = after ? md.render(after) : '';

  if (!midArticleSlot || !afterHtml) {
    return (
      <div
        className={cn(markdownStyles, className)}
        dangerouslySetInnerHTML={{ __html: beforeHtml }}
      />
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div
        className={markdownStyles}
        dangerouslySetInnerHTML={{ __html: beforeHtml }}
      />
      {midArticleSlot}
      <div
        className={markdownStyles}
        dangerouslySetInnerHTML={{ __html: afterHtml }}
      />
    </div>
  );
}
