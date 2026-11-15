/**
 * PublishGuard 品牌与产品常量配置。
 * 修改域名或重命名品牌时只需更新此处与环境变量，全站落地页、邮件及编译资产将自动同步。
 */
export const BRAND_CONFIG = {
  name: process.env.NEXT_PUBLIC_APP_NAME || 'PublishGuard',
  domain: process.env.NEXT_PUBLIC_APP_DOMAIN || 'getpublishguard.com',
  tagline: 'Amazon KDP Pre-Flight Compliance & AI Book Studio',
  supportEmail:
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@getpublishguard.com',
  defaultLocale: process.env.NEXT_PUBLIC_DEFAULT_LOCALE || 'en',
  // 品牌色与排版默认值
  heroBadge: '26-Rule Amazon KDP Firewall + Dual-Format Studio',
} as const;
