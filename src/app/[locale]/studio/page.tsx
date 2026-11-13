'use client';

import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Coins,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface ProjectItem {
  id: string;
  title: string;
  subtitle: string;
  genre: string;
  status: string;
  actualWordCount: number;
  guardPassed: boolean;
  guardScore: number;
  coverTheme: string;
  createdAt: string;
}

export default function StudioHomePage() {
  const t = useTranslations('studio.studio');
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/kdp/projects')
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0) {
          setProjects(res.data.projects || []);
          setCredits(res.data.credits ?? 0);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-serif text-2xl font-medium tracking-tight sm:text-3xl">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/studio/profiles"
            className={cn(buttonVariants({ variant: 'outline' }), 'gap-1.5')}
          >
            <Users className="size-4" />
            {t('btn_profiles')}
          </Link>
          <Link href="/studio/new" className={cn(buttonVariants(), 'gap-1.5')}>
            <Plus className="size-4" />
            {t('btn_new')}
          </Link>
        </div>
      </div>

      {/* 顶部积分与安全发布指标条 */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase">
              {t('credits_balance')}
            </CardTitle>
            <Coins className="text-muted-foreground size-4" />
          </CardHeader>
          <CardContent className="flex items-baseline justify-between">
            <div className="text-2xl font-bold">
              {credits === null ? '—' : credits}
            </div>
            <Link
              href="/pricing"
              className="text-primary text-xs font-medium hover:underline"
            >
              Top up / Plans →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase">
              Active Manuscripts
            </CardTitle>
            <BookOpen className="text-muted-foreground size-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{projects.length}</div>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Target 18,000+ words dual-format
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase">
              KDP Firewall
            </CardTitle>
            <ShieldCheck className="size-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">26 Rules Active</div>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Zero-box print + Zero external eBook links
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 项目列表 */}
      {loading ? (
        <div className="text-muted-foreground py-12 text-center text-sm">
          Loading manuscripts...
        </div>
      ) : projects.length === 0 ? (
        <Card className="border-dashed py-12 text-center">
          <CardContent className="space-y-4">
            <BookOpen className="text-muted-foreground mx-auto size-10 opacity-60" />
            <p className="text-muted-foreground mx-auto max-w-md text-sm">
              {t('empty')}
            </p>
            <Link
              href="/studio/new"
              className={cn(buttonVariants(), 'gap-2 rounded-full px-6')}
            >
              <Plus className="size-4" />
              {t('btn_new')}
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((proj) => (
            <Card key={proj.id} className="flex flex-col justify-between">
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="bg-muted rounded px-2 py-0.5 font-mono uppercase">
                    {proj.status}
                  </span>
                  {proj.guardPassed ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <ShieldCheck className="size-3.5" />
                      {proj.guardScore}/100
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-600">
                      <ShieldAlert className="size-3.5" />
                      {proj.guardScore}/100
                    </span>
                  )}
                </div>
                <CardTitle className="line-clamp-2 text-base">
                  {proj.title}
                </CardTitle>
                <CardDescription className="line-clamp-2 text-xs">
                  {proj.subtitle || proj.genre}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between border-t pt-4 text-xs">
                <span className="text-muted-foreground">
                  {proj.actualWordCount > 0
                    ? `${proj.actualWordCount.toLocaleString()} words`
                    : proj.genre}
                </span>
                <Link
                  href={`/studio/${proj.id}`}
                  className={cn(
                    buttonVariants({ variant: 'ghost', size: 'sm' }),
                    'gap-1'
                  )}
                >
                  Open
                  <ArrowRight className="size-3.5" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
