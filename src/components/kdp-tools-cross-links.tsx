import { ArrowRight, Ruler, SearchCheck, ShieldCheck } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';

export interface CrossLinkLabels {
  heading: string;
  viewAll: string;
  openTool: string;
  spineTitle: string;
  spineDesc: string;
  titleTitle: string;
  titleDesc: string;
  guardTitle: string;
  guardDesc: string;
}

/**
 * 免费 KDP 工具矩阵交叉导流模块（纯展示组件，文案由外部页面/Block 传入）。
 */
export function KdpToolsCrossLinks({
  current,
  labels,
}: {
  current: 'guard' | 'spine' | 'title';
  labels: CrossLinkLabels;
}) {
  const cards = [
    {
      id: 'spine' as const,
      href: '/tools/kdp-spine-calculator',
      title: labels.spineTitle,
      description: labels.spineDesc,
      icon: Ruler,
    },
    {
      id: 'title' as const,
      href: '/tools/kdp-title-checker',
      title: labels.titleTitle,
      description: labels.titleDesc,
      icon: SearchCheck,
    },
    {
      id: 'guard' as const,
      href: '/tools/kdp-guard',
      title: labels.guardTitle,
      description: labels.guardDesc,
      icon: ShieldCheck,
    },
  ].filter((c) => c.id !== current);

  return (
    <section className="border-border mt-12 border-t pt-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-xl font-semibold tracking-tight">
          {labels.heading}
        </h2>
        <Link
          href="/tools"
          className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          {labels.viewAll}
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.id}
              href={card.href}
              className="border-border bg-card hover:border-primary/40 group flex flex-col justify-between rounded-2xl border p-5 transition-colors"
            >
              <div className="space-y-2">
                <div className="text-primary flex items-center gap-2 text-sm font-semibold">
                  <Icon className="size-4 shrink-0" />
                  <span>{card.title}</span>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {card.description}
                </p>
              </div>
              <div className="text-primary mt-4 inline-flex items-center gap-1 text-xs font-medium transition-transform group-hover:translate-x-0.5">
                <span>{labels.openTool}</span>
                <ArrowRight className="size-3.5" />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
