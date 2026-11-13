'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  Plus,
  ShieldAlert,
  UserPlus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface PenProfile {
  id: string;
  penNameFirst: string;
  penNameLast: string;
  fullName: string;
  editionLabel: string;
  companionDomain: string;
  lastPublishedAt: string | null;
  domainConflict: boolean;
  cooldownActive: boolean;
  daysRemaining: number;
}

export default function PenProfilesPage() {
  const t = useTranslations('studio.profiles');
  const [profiles, setProfiles] = useState<PenProfile[]>([]);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [edition, setEdition] = useState('INDEPENDENT EDITION');
  const [domain, setDomain] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function loadProfiles() {
    const res = await fetch('/api/kdp/profiles');
    const json = await res.json();
    if (json.code === 0) setProfiles(json.data.profiles || []);
  }

  useEffect(() => {
    loadProfiles();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/kdp/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pen_name_first: first,
          pen_name_last: last,
          edition_label: edition,
          companion_domain: domain,
        }),
      });
      const json = await res.json();
      if (json.code !== 0) throw new Error(json.message);
      toast.success('Pen profile added with strict domain isolation');
      setFirst('');
      setLast('');
      setDomain('');
      await loadProfiles();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add profile');
    } finally {
      setSubmitting(false);
    }
  }

  async function markPublishedToday(id: string) {
    const res = await fetch('/api/kdp/profiles', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, mark_published: true }),
    });
    const json = await res.json();
    if (json.code === 0) {
      toast.success('7-day KDP cadence cooldown timer started');
      await loadProfiles();
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {t('title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4" />
            {t('btn_add')}
          </CardTitle>
          <CardDescription className="text-xs">
            Rule 10 &amp; 23: Always use realistic First + Last human pen names
            (never &quot;Studio&quot; or &quot;Press&quot;) and bind a unique
            domain per KDP account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="grid gap-3 sm:grid-cols-4">
            <input
              required
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              placeholder="First Name (e.g. Evelyn)"
              className="border-input bg-background rounded-lg border px-3 py-2 text-sm"
            />
            <input
              required
              value={last}
              onChange={(e) => setLast(e.target.value)}
              placeholder="Last Name (e.g. Vance)"
              className="border-input bg-background rounded-lg border px-3 py-2 text-sm"
            />
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Unique Domain (optional)"
              className="border-input bg-background rounded-lg border px-3 py-2 text-sm"
            />
            <Button type="submit" disabled={submitting} className="gap-1.5">
              <Plus className="size-4" />
              {t('btn_add')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {profiles.map((p) => (
          <Card key={p.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{p.fullName}</CardTitle>
                <CardDescription className="mt-0.5 text-xs">
                  Imprint: Independently published by {p.fullName} (
                  {p.editionLabel})
                </CardDescription>
              </div>
              {p.cooldownActive ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="size-3.5" />
                  {t('cooldown_wait', { days: p.daysRemaining })}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-3.5" />
                  {t('cooldown_safe')}
                </span>
              )}
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Companion Domain:</span>
                <span className="font-mono">
                  {p.companionDomain || 'None (Isolated)'}
                </span>
              </div>
              {p.domainConflict && (
                <div className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg p-2.5 font-medium">
                  <ShieldAlert className="size-4 shrink-0" />
                  {t('domain_conflict')}
                </div>
              )}
              <div className="flex justify-end border-t pt-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => markPublishedToday(p.id)}
                  className="gap-1.5 text-xs"
                >
                  <CalendarCheck2 className="size-3.5" />
                  Mark Published Today (Start 7d Guard)
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
