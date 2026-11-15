import { ArrowUpRight, Calendar } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';

export type RelatedBlogPostItem = {
  slug: string;
  title: string;
  description?: string;
  date?: string;
};

export type RelatedBlogPostsProps = {
  title: string;
  subtitle?: string;
  viewAllLabel: string;
  posts: RelatedBlogPostItem[];
};

/**
 * 博客文末相关合规指南卡片列表（纯 Props 驱动，无内置 i18n 读取）。
 */
export function RelatedBlogPosts({
  title,
  subtitle,
  viewAllLabel,
  posts,
}: RelatedBlogPostsProps) {
  if (!posts.length) {
    return null;
  }

  return (
    <section
      aria-labelledby="related-blog-guides-heading"
      className="border-border mt-12 border-t pt-10"
    >
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="related-blog-guides-heading"
            className="text-foreground text-xl font-semibold tracking-tight"
          >
            {title}
          </h2>
          {subtitle && (
            <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>
          )}
        </div>
        <Link
          href="/blog"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium transition-colors"
        >
          <span>{viewAllLabel}</span>
          <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group border-border bg-card hover:border-foreground/25 flex flex-col justify-between rounded-xl border p-4 transition-colors"
          >
            <div className="space-y-1.5">
              <h3 className="text-foreground line-clamp-2 text-sm leading-snug font-semibold group-hover:underline group-hover:underline-offset-4">
                {post.title}
              </h3>
              {post.description && (
                <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                  {post.description}
                </p>
              )}
            </div>
            {post.date && (
              <div className="text-muted-foreground mt-3 inline-flex items-center gap-1.5 text-[11px]">
                <Calendar className="size-3" />
                <span>{post.date}</span>
              </div>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
