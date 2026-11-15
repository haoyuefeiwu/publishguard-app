'use client';

import { useEffect } from 'react';

/**
 * 客户端 GA4 兜底注入器：
 * 当 SSG/ISR 页面在构建期未读取到数据库里的 google_analytics_id 时，
 * 在浏览器挂载后从 /api/config/public 拉取最新配置并注入 gtag.js，
 * 确保后台保存衡量 ID 后无需重新构建静态页面即可立即全站生效。
 */
export function ClientAnalyticsFallback() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (document.getElementById('ga-loader')) return;

    let cancelled = false;
    fetch('/api/config/public')
      .then((res) => res.json())
      .then((json) => {
        if (cancelled || json?.code !== 0) return;
        const gaId = String(json?.data?.google_analytics_id || '').trim();
        if (!gaId || document.getElementById('ga-loader')) return;

        const win = window as unknown as {
          dataLayer?: unknown[];
          gtag?: (...args: unknown[]) => void;
        };
        win.dataLayer = win.dataLayer || [];
        if (typeof win.gtag !== 'function') {
          win.gtag = function gtag(...args: unknown[]) {
            win.dataLayer!.push(args);
          };
        }

        const loader = document.createElement('script');
        loader.id = 'ga-loader';
        loader.async = true;
        loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
        document.head.appendChild(loader);

        win.gtag('js', new Date());
        win.gtag('config', gaId);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
