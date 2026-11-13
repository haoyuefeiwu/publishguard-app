/**
 * PublishGuard 权威商品与积分定价目录。
 * 结账路由以此文件为唯一价格、积分与周期权威来源，彻底忽略前端提交的价格或积分字段。
 */

import { PaymentInterval, PaymentType } from '@/core/payment/types';

export type PricingPlanInfo = {
  name: string;
  interval: PaymentInterval;
  intervalCount: number;
};

export type PricingProduct = {
  productId: string;
  productName: string;
  planName: string;
  description: string;
  type: PaymentType;
  priceInCents: number;
  currency: string;
  credits: number;
  creditsValidDays?: number;
  plan?: PricingPlanInfo;
};

/**
 * 获批商业漏斗定价矩阵：
 * - Single Book Pass（$29 一次性买断，120 积分）：恰好完成 1 本双轨专著 + 2 次局部洗稿重写
 * - Author Pro（$49/月 或 $390/年，每月 360 积分）：匹配 KDP 安全节奏（每月约 3 本）
 * - Publishing Studio（$99/月 或 $790/年，每月 1,000 积分）：多笔名矩阵隔离 + 最高优先级渲染
 */
export const pricingCatalog: Record<string, PricingProduct> = {
  single_book_pass: {
    productId: 'single_book_pass',
    productName: 'Single Book Pass',
    planName: 'Single Book Pass',
    description:
      'One-time pass with 120 credits (1 full dual-format book + rewrites)',
    type: PaymentType.ONE_TIME,
    priceInCents: 2900,
    currency: 'usd',
    credits: 120,
    creditsValidDays: 365,
  },
  author_pro_monthly: {
    productId: 'author_pro_monthly',
    productName: 'Author Pro',
    planName: 'Author Pro Monthly',
    description: '360 credits / month — built for safe weekly KDP cadence',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 4900,
    currency: 'usd',
    credits: 360,
    creditsValidDays: 31,
    plan: {
      name: 'Author Pro',
      interval: PaymentInterval.MONTH,
      intervalCount: 1,
    },
  },
  author_pro_yearly: {
    productId: 'author_pro_yearly',
    productName: 'Author Pro',
    planName: 'Author Pro Yearly',
    description: '4,320 credits / year — save 33% on Author Pro',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 39000,
    currency: 'usd',
    credits: 4320,
    creditsValidDays: 366,
    plan: {
      name: 'Author Pro',
      interval: PaymentInterval.YEAR,
      intervalCount: 1,
    },
  },
  studio_monthly: {
    productId: 'studio_monthly',
    productName: 'Publishing Studio',
    planName: 'Publishing Studio Monthly',
    description:
      '1,000 credits / month — multi-pen-name isolation & priority worker queue',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 9900,
    currency: 'usd',
    credits: 1000,
    creditsValidDays: 31,
    plan: {
      name: 'Publishing Studio',
      interval: PaymentInterval.MONTH,
      intervalCount: 1,
    },
  },
  studio_yearly: {
    productId: 'studio_yearly',
    productName: 'Publishing Studio',
    planName: 'Publishing Studio Yearly',
    description: '12,000 credits / year — save 33% on Publishing Studio',
    type: PaymentType.SUBSCRIPTION,
    priceInCents: 79000,
    currency: 'usd',
    credits: 12000,
    creditsValidDays: 366,
    plan: {
      name: 'Publishing Studio',
      interval: PaymentInterval.YEAR,
      intervalCount: 1,
    },
  },
};

export function getPricingProduct(productId: string): PricingProduct | null {
  if (!productId) return null;
  return pricingCatalog[productId] ?? null;
}

export function listPricingProducts(): PricingProduct[] {
  return Object.values(pricingCatalog);
}
