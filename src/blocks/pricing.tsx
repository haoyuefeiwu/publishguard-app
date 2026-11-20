'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BookCheck,
  Layers,
  ShieldCheck,
  Sparkles,
  Wand2,
  Zap,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useSession } from '@/core/auth/client';
import { Link, useRouter } from '@/core/i18n/navigation';
import { currentPathWithQuery } from '@/lib/redirect';
import {
  PaymentProviderModal,
  type PaymentProvider,
} from '@/components/payment-provider-modal';
import {
  PricingTable,
  type PricingGroup,
  type PricingPlan,
} from '@/components/pricing-table';

const ALL_PROVIDERS: PaymentProvider[] = [
  'stripe',
  'creem',
  'paypal',
  'alipay',
  'wechat',
];

export function Pricing({ title }: { title?: string } = {}) {
  const t = useTranslations('landing');
  const router = useRouter();
  const { data: session } = useSession();

  const [configs, setConfigs] = useState<Record<string, string>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PricingPlan | null>(null);
  const [loadingProvider, setLoadingProvider] =
    useState<PaymentProvider | null>(null);

  useEffect(() => {
    fetch('/api/config/public', { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0) setConfigs(res.data || {});
      })
      .catch(() => {});
  }, []);

  const enabledProviders = useMemo<PaymentProvider[]>(
    () => ALL_PROVIDERS.filter((p) => configs[`${p}_enabled`] === 'true'),
    [configs]
  );

  const formatFeatures = [
    { icon: Sparkles, label: t('pricing.format_credits') },
    { icon: BookCheck, label: t('pricing.feature_dual_bundle') },
    { icon: ShieldCheck, label: t('pricing.feature_guard_unlimited') },
    { icon: Wand2, label: t('pricing.feature_four_covers') },
  ];

  const singleFeatures = [
    { icon: Sparkles, label: t('pricing.single_credits') },
    { icon: BookCheck, label: t('pricing.feature_dual_bundle') },
    { icon: ShieldCheck, label: t('pricing.feature_guard_unlimited') },
    { icon: Wand2, label: t('pricing.feature_four_covers') },
  ];

  const proFeaturesMonthly = [
    { icon: Sparkles, label: t('pricing.pro_credits') },
    { icon: BookCheck, label: t('pricing.feature_dual_bundle') },
    { icon: ShieldCheck, label: t('pricing.feature_ai_sanitize') },
    { icon: Wand2, label: t('pricing.feature_four_covers') },
  ];

  const proFeaturesYearly = [
    { icon: Sparkles, label: t('pricing.pro_credits_yearly') },
    { icon: BookCheck, label: t('pricing.feature_dual_bundle') },
    { icon: ShieldCheck, label: t('pricing.feature_ai_sanitize') },
    { icon: Wand2, label: t('pricing.feature_four_covers') },
  ];

  const studioFeaturesMonthly = [
    { icon: Sparkles, label: t('pricing.studio_credits') },
    { icon: Layers, label: t('pricing.feature_pen_isolation') },
    { icon: Zap, label: t('pricing.feature_priority_worker') },
    { icon: ShieldCheck, label: t('pricing.feature_ai_sanitize') },
  ];

  const studioFeaturesYearly = [
    { icon: Sparkles, label: t('pricing.studio_credits_yearly') },
    { icon: Layers, label: t('pricing.feature_pen_isolation') },
    { icon: Zap, label: t('pricing.feature_priority_worker') },
    { icon: ShieldCheck, label: t('pricing.feature_ai_sanitize') },
  ];

  const groups: PricingGroup[] = [
    {
      key: 'monthly',
      label: t('pricing.monthly'),
      plans: [
        {
          id: 'format-guard-pass',
          name: t('pricing.format_name'),
          description: t('pricing.format_desc'),
          price: '$19',
          featured: true,
          badge: t('pricing.format_badge'),
          features: formatFeatures,
          productId: 'manuscript_format_pass',
          priceInCents: 1900,
          currency: 'usd',
          credits: 60,
          creditsValidDays: 365,
          buttonText: t('pricing.buy_format'),
        },
        {
          id: 'single-book-pass',
          name: t('pricing.single_name'),
          description: t('pricing.single_desc'),
          price: '$29',
          badge: t('pricing.popular'),
          features: singleFeatures,
          productId: 'single_book_pass',
          priceInCents: 2900,
          currency: 'usd',
          credits: 120,
          creditsValidDays: 365,
          buttonText: t('pricing.buy_once'),
        },
        {
          id: 'author-pro-monthly',
          name: t('pricing.pro_name'),
          description: t('pricing.pro_desc'),
          price: '$49',
          interval: 'mo',
          badge: t('pricing.pro_badge'),
          features: proFeaturesMonthly,
          productId: 'author_pro_monthly',
          priceInCents: 4900,
          currency: 'usd',
          credits: 360,
          creditsValidDays: 31,
          plan: { name: 'Author Pro', interval: 'month', intervalCount: 1 },
          buttonText: t('pricing.start_sub'),
        },
        {
          id: 'studio-monthly',
          name: t('pricing.studio_name'),
          description: t('pricing.studio_desc'),
          price: '$99',
          interval: 'mo',
          features: studioFeaturesMonthly,
          productId: 'studio_monthly',
          priceInCents: 9900,
          currency: 'usd',
          credits: 1000,
          creditsValidDays: 31,
          plan: {
            name: 'Publishing Studio',
            interval: 'month',
            intervalCount: 1,
          },
          buttonText: t('pricing.start_sub'),
        },
      ],
    },
    {
      key: 'yearly',
      label: t('pricing.yearly'),
      plans: [
        {
          id: 'format-guard-pass-yr',
          name: t('pricing.format_name'),
          description: t('pricing.format_desc'),
          price: '$19',
          featured: true,
          badge: t('pricing.format_badge'),
          features: formatFeatures,
          productId: 'manuscript_format_pass',
          priceInCents: 1900,
          currency: 'usd',
          credits: 60,
          creditsValidDays: 365,
          buttonText: t('pricing.buy_format'),
        },
        {
          id: 'single-book-pass-yr',
          name: t('pricing.single_name'),
          description: t('pricing.single_desc'),
          price: '$29',
          badge: t('pricing.popular'),
          features: singleFeatures,
          productId: 'single_book_pass',
          priceInCents: 2900,
          currency: 'usd',
          credits: 120,
          creditsValidDays: 365,
          buttonText: t('pricing.buy_once'),
        },
        {
          id: 'author-pro-yearly',
          name: t('pricing.pro_name'),
          description: t('pricing.pro_desc'),
          price: '$390',
          originalPrice: '$588',
          interval: 'yr',
          badge: t('pricing.pro_badge'),
          features: proFeaturesYearly,
          productId: 'author_pro_yearly',
          priceInCents: 39000,
          currency: 'usd',
          credits: 4320,
          creditsValidDays: 366,
          plan: { name: 'Author Pro', interval: 'year', intervalCount: 1 },
          buttonText: t('pricing.start_sub'),
        },
        {
          id: 'studio-yearly',
          name: t('pricing.studio_name'),
          description: t('pricing.studio_desc'),
          price: '$790',
          originalPrice: '$1,188',
          interval: 'yr',
          badge: t('pricing.best_value'),
          features: studioFeaturesYearly,
          productId: 'studio_yearly',
          priceInCents: 79000,
          currency: 'usd',
          credits: 12000,
          creditsValidDays: 366,
          plan: {
            name: 'Publishing Studio',
            interval: 'year',
            intervalCount: 1,
          },
          buttonText: t('pricing.start_sub'),
        },
      ],
    },
  ];

  async function startCheckout(plan: PricingPlan, provider: PaymentProvider) {
    setLoadingProvider(provider);
    try {
      const res = await fetch('/api/payment/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: plan.productId,
          product_name: plan.productName || plan.name,
          plan_name: plan.plan?.name || plan.name,
          price: plan.priceInCents,
          currency: plan.currency || 'usd',
          type: plan.plan ? 'subscription' : 'one-time',
          description: plan.name,
          plan: plan.plan,
          credits: plan.credits,
          credits_valid_days: plan.creditsValidDays,
          payment_provider: provider,
          redirect: currentPathWithQuery('/studio'),
        }),
      });
      const data = await res.json();
      if (data.code !== 0 || !data.data?.checkout_url) {
        throw new Error(data.message || 'Checkout failed');
      }
      window.location.href = data.data.checkout_url;
    } catch (err: any) {
      toast.error(err?.message || 'Checkout failed');
      setLoadingProvider(null);
    }
  }

  async function handleCheckout(plan: PricingPlan) {
    if (!session?.user) {
      const callbackUrl = encodeURIComponent(currentPathWithQuery('/pricing'));
      router.push(`/sign-in?callbackUrl=${callbackUrl}`);
      return;
    }

    const selectEnabled = configs.select_payment_enabled === 'true';
    const defaultProvider = (configs.default_payment_provider ||
      enabledProviders[0] ||
      'stripe') as PaymentProvider;

    if (selectEnabled && enabledProviders.length > 1) {
      setPendingPlan(plan);
      setModalOpen(true);
      return;
    }

    await startCheckout(plan, defaultProvider);
  }

  function handleProviderSelect(provider: PaymentProvider) {
    if (!pendingPlan) return;
    startCheckout(pendingPlan, provider);
  }

  return (
    <section
      id="pricing"
      className="border-border border-t px-4 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="font-serif text-4xl font-normal tracking-tight sm:text-5xl">
            {title ?? t('pricing.title')}
          </h2>
          <p className="text-muted-foreground mx-auto mt-5 max-w-2xl">
            {t('pricing.description')}
          </p>
          {/* 明确列出 $29 单本通行证真实交付物与样书直达入口 */}
          <div className="border-border bg-muted/30 mx-auto mt-6 max-w-3xl rounded-2xl border px-5 py-3.5 text-left text-xs leading-relaxed sm:flex sm:items-center sm:justify-between sm:gap-4">
            <div>
              <span className="text-foreground font-semibold">
                {t('pricing.deliverables_banner')}
              </span>{' '}
              <span className="text-muted-foreground">
                {t('pricing.deliverables_items')}
              </span>
            </div>
            <Link
              href="/#sample-book"
              className="text-foreground mt-2 inline-flex shrink-0 items-center font-medium underline underline-offset-4 sm:mt-0"
            >
              {t('pricing.deliverables_sample_link')} →
            </Link>
          </div>
        </div>
        <PricingTable groups={groups} onCheckout={handleCheckout} />
      </div>

      <PaymentProviderModal
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
            setPendingPlan(null);
            setLoadingProvider(null);
          }
        }}
        providers={enabledProviders.length ? enabledProviders : ['stripe']}
        loadingProvider={loadingProvider}
        onSelect={handleProviderSelect}
        planName={pendingPlan?.name}
        price={pendingPlan?.price}
      />
    </section>
  );
}
