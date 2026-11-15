import { BRAND_CONFIG } from './brand';

export const AUTH_SECRET_PLACEHOLDER =
  'shipany-dev-secret-change-in-production';

export const envConfigs: Record<string, string> = {
  // 应用基础信息
  app_url: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  app_name: process.env.NEXT_PUBLIC_APP_NAME ?? BRAND_CONFIG.name,
  app_domain: process.env.NEXT_PUBLIC_APP_DOMAIN ?? BRAND_CONFIG.domain,
  app_description:
    process.env.NEXT_PUBLIC_APP_DESCRIPTION ?? BRAND_CONFIG.tagline,
  app_logo: process.env.NEXT_PUBLIC_APP_LOGO ?? '/logo.svg',

  // 数据库配置
  database_url: process.env.DATABASE_URL ?? '',
  database_auth_token: process.env.DATABASE_AUTH_TOKEN ?? '',
  database_provider: process.env.DATABASE_PROVIDER ?? 'postgres',
  db_schema: process.env.DB_SCHEMA ?? 'public',
  db_singleton_enabled: process.env.DB_SINGLETON_ENABLED ?? 'false',
  db_max_connections: process.env.DB_MAX_CONNECTIONS ?? '5',

  // 认证配置
  auth_url: process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '',
  auth_secret: process.env.AUTH_SECRET ?? '',

  // 支付 - Stripe
  stripe_secret_key: process.env.STRIPE_SECRET_KEY ?? '',
  stripe_publishable_key: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
  stripe_signing_secret: process.env.STRIPE_SIGNING_SECRET ?? '',

  // 支付 - PayPal
  paypal_client_id: process.env.PAYPAL_CLIENT_ID ?? '',
  paypal_client_secret: process.env.PAYPAL_CLIENT_SECRET ?? '',
  paypal_webhook_id: process.env.PAYPAL_WEBHOOK_ID ?? '',
  paypal_environment: process.env.PAYPAL_ENVIRONMENT ?? 'production',

  // 支付 - 支付宝
  alipay_app_id: process.env.ALIPAY_APP_ID ?? '',
  alipay_private_key: process.env.ALIPAY_PRIVATE_KEY ?? '',
  alipay_public_key: process.env.ALIPAY_PUBLIC_KEY ?? '',
  alipay_notify_url: process.env.ALIPAY_NOTIFY_URL ?? '',

  // 支付 - 微信支付
  wechat_app_id: process.env.WECHAT_APP_ID ?? '',
  wechat_mch_id: process.env.WECHAT_MCH_ID ?? '',
  wechat_api_v3_key: process.env.WECHAT_API_V3_KEY ?? '',
  wechat_private_key: process.env.WECHAT_PRIVATE_KEY ?? '',
  wechat_serial_no: process.env.WECHAT_SERIAL_NO ?? '',
  wechat_notify_url: process.env.WECHAT_NOTIFY_URL ?? '',
  wechat_platform_cert: process.env.WECHAT_PLATFORM_CERT ?? '',

  // 邮件 - Resend
  resend_api_key: process.env.RESEND_API_KEY ?? '',
  resend_sender_email:
    process.env.RESEND_SENDER_EMAIL ?? process.env.RESEND_EMAIL_FROM ?? '',

  // 邮件 - Cloudflare
  cloudflare_email_api_token: process.env.CLOUDFLARE_EMAIL_API_TOKEN ?? '',
  cloudflare_email_account_id: process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID ?? '',
  cloudflare_email_sender_email:
    process.env.CLOUDFLARE_EMAIL_SENDER_EMAIL ?? '',

  // 对象存储 - S3/R2
  storage_endpoint: process.env.STORAGE_ENDPOINT ?? '',
  storage_region: process.env.STORAGE_REGION ?? 'auto',
  storage_access_key: process.env.STORAGE_ACCESS_KEY ?? '',
  storage_secret_key: process.env.STORAGE_SECRET_KEY ?? '',
  storage_bucket: process.env.STORAGE_BUCKET ?? '',
  storage_public_domain: process.env.STORAGE_PUBLIC_DOMAIN ?? '',
  inline_image_max_kb: process.env.INLINE_IMAGE_MAX_KB ?? '2048',

  // AI 与 PublishGuard 模型路由配置
  replicate_api_token: process.env.REPLICATE_API_TOKEN ?? '',
  openrouter_api_key: process.env.OPENROUTER_API_KEY ?? '',
  openrouter_base_url:
    process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  kdp_outline_model: process.env.KDP_OUTLINE_MODEL ?? 'google/gemini-2.5-flash',
  kdp_writer_model: process.env.KDP_WRITER_MODEL ?? 'anthropic/claude-sonnet-4',
  kdp_sanitizer_model:
    process.env.KDP_SANITIZER_MODEL ?? 'google/gemini-2.5-flash',
  kdp_artifacts_dir: process.env.KDP_ARTIFACTS_DIR ?? 'data/kdp-artifacts',

  // Growth Platform 自动发文内部同步配置
  growth_internal_token: process.env.GROWTH_INTERNAL_TOKEN ?? '',
  growth_draft_author_email: process.env.GROWTH_DRAFT_AUTHOR_EMAIL ?? '',

  // 国际化默认语言（主站默认英文，内置简体中文切换）
  locale: process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? BRAND_CONFIG.defaultLocale,
};
