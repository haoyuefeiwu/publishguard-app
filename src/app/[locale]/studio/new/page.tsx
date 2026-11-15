'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useRouter } from '@/core/i18n/navigation';
import {
  KDP_COVER_THEMES,
  KDP_PRIMARY_CATEGORIES,
} from '@/modules/kdp/constants';
import { cn } from '@/lib/utils';
import { KdpCoverThumbnail } from '@/components/kdp-cover-thumbnail';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function NewBookProjectPage() {
  const t = useTranslations('studio.studio');
  const router = useRouter();

  const [profiles, setProfiles] = useState<any[]>([]);
  const [penProfileId, setPenProfileId] = useState('');
  const [topicPrompt, setTopicPrompt] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [genre, setGenre] = useState('Self-Help');
  const [companionProduct, setCompanionProduct] = useState('');
  const [companionUrl, setCompanionUrl] = useState('');
  const [trimSize, setTrimSize] = useState('6x9');
  const [targetPageCount, setTargetPageCount] = useState(100);
  const [paperType, setPaperType] = useState('cream');
  const [coverTheme, setCoverTheme] = useState('editorial_split');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const qTopic = (searchParams.get('topic') || '').trim();
    const qCategory = (searchParams.get('category') || '').trim();
    const qDomain = (searchParams.get('domain') || '').trim();
    const qAudience = (searchParams.get('audience') || '').trim();

    if (qTopic) setTopicPrompt(qTopic);
    if (qDomain) setCompanionUrl(qDomain);
    if (qAudience) setTargetAudience(qAudience);
    if (qCategory) {
      const normalizedCat =
        qCategory === 'Body, Mind & Spirit' ? 'Self-Help' : qCategory;
      if (
        (KDP_PRIMARY_CATEGORIES as readonly string[]).includes(normalizedCat)
      ) {
        setGenre(normalizedCat);
      }
    }

    fetch('/api/kdp/profiles')
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0 && res.data.profiles?.length) {
          setProfiles(res.data.profiles);
          setPenProfileId(res.data.profiles[0].id);
        }
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/kdp/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pen_profile_id: penProfileId || undefined,
          topic_prompt: topicPrompt,
          target_audience: targetAudience,
          genre,
          companion_product: companionProduct,
          companion_url: companionUrl,
          trim_size: trimSize,
          target_page_count: targetPageCount,
          paper_type: paperType,
          cover_theme: coverTheme,
          language: 'en',
        }),
      });
      const json = await res.json();
      if (json.code !== 0) {
        throw new Error(json.message || 'Failed to create blueprint');
      }
      toast.success('Collision-proof outline ready! Redirecting...');
      router.push(`/studio/${json.data.project.id}`);
    } catch (err: any) {
      toast.error(err?.message || 'Could not generate outline');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {t('step1_title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          We check Apple Books &amp; OpenLibrary live before locking your
          12-section non-fiction blueprint.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Book Premise &amp; Author Identity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                Book Core Topic / Reader Problem *
              </label>
              <textarea
                required
                rows={3}
                value={topicPrompt}
                onChange={(e) => setTopicPrompt(e.target.value)}
                placeholder="e.g. How thoughtful leaders hold firm interpersonal boundaries with genuine warmth in high-stakes workplace relationships"
                className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Target Audience</label>
                <input
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  placeholder="e.g. Burned-out managers & empathic creators"
                  className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  Primary KDP Category (31 Official White-Listed)
                </label>
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                >
                  {KDP_PRIMARY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                Author Pen Profile (matches copyright &amp; cover)
              </label>
              <select
                value={penProfileId}
                onChange={(e) => setPenProfileId(e.target.value)}
                className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
              >
                <option value="">Default (Evelyn Vance)</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* 高级选项：纸型、目标页数、伴读域名与 4 套封面样板 */}
        <Card>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full items-center justify-between px-6 py-4 text-left"
          >
            <div>
              <div className="text-sm font-medium">
                Advanced Print Spec, Cover Style &amp; Companion Options
              </div>
              <div className="text-muted-foreground mt-0.5 text-xs">
                Defaults: {trimSize === '5.5x8.5' ? '5.5"×8.5"' : '6"×9"'} ·{' '}
                {targetPageCount}pp {paperType} ·{' '}
                {KDP_COVER_THEMES.find((x) => x.id === coverTheme)?.name}
              </div>
            </div>
            {showAdvanced ? (
              <ChevronUp className="text-muted-foreground size-4 shrink-0" />
            ) : (
              <ChevronDown className="text-muted-foreground size-4 shrink-0" />
            )}
          </button>

          {showAdvanced && (
            <CardContent className="space-y-5 border-t pt-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Optional Companion Anchor
                  </label>
                  <input
                    value={companionProduct}
                    onChange={(e) => setCompanionProduct(e.target.value)}
                    placeholder="e.g. Desk tactile stone / audio guide"
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Reader Companion Portal (QR Text Only)
                  </label>
                  <input
                    value={companionUrl}
                    onChange={(e) => setCompanionUrl(e.target.value)}
                    placeholder="https://authorportal.com/audio"
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Trim Size</label>
                  <select
                    value={trimSize}
                    onChange={(e) => setTrimSize(e.target.value)}
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="6x9">
                      6&quot; × 9&quot; (Standard Trade)
                    </option>
                    <option value="5.5x8.5">
                      5.5&quot; × 8.5&quot; (Digest)
                    </option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Target Paperback Pages
                  </label>
                  <select
                    value={targetPageCount}
                    onChange={(e) => setTargetPageCount(Number(e.target.value))}
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value={100}>
                      100 Pages (0.25&quot; Cream Spine)
                    </option>
                    <option value={120}>
                      120 Pages (0.30&quot; Cream Spine)
                    </option>
                    <option value={150}>
                      150 Pages (0.375&quot; Cream Spine)
                    </option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Interior Paper</label>
                  <select
                    value={paperType}
                    onChange={(e) => setPaperType(e.target.value)}
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="cream">Cream (0.0025&quot; / page)</option>
                    <option value="white">White (0.002252&quot; / page)</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {KDP_COVER_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setCoverTheme(theme.id)}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-all',
                      coverTheme === theme.id
                        ? 'border-primary ring-primary/30 ring-2'
                        : 'border-border hover:border-foreground/30'
                    )}
                  >
                    <KdpCoverThumbnail
                      themeId={theme.id}
                      title={
                        topicPrompt.trim().slice(0, 42) ||
                        'Quiet Cadence of Modern Focus'
                      }
                      authorName={
                        profiles.find((p) => p.id === penProfileId)?.fullName ||
                        'Evelyn Vance'
                      }
                      className="mb-2.5"
                    />
                    <div className="text-xs font-semibold">{theme.name}</div>
                    <div className="text-muted-foreground mt-0.5 text-[11px]">
                      {theme.description}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          )}
        </Card>

        <div className="flex justify-end">
          <Button
            type="submit"
            size="lg"
            disabled={creating}
            className="gap-2 rounded-full px-8"
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {t('btn_create_outline')}
          </Button>
        </div>
      </form>
    </div>
  );
}
