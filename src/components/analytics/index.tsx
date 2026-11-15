import { getAllConfigs } from '@/modules/config/service';

import { ClientAnalyticsFallback } from './client-analytics';
import { GoogleAnalytics } from './google-analytics';
import { Plausible } from './plausible';

// 服务端读取 env+DB 配置；若静态预渲染页面构建期尚未写入 GA ID，则由客户端兜底加载。
export async function Analytics() {
  const configs = await getAllConfigs();
  const gaId = configs.google_analytics_id?.trim();
  const plausibleDomain = configs.plausible_domain?.trim();
  const plausibleSrc = configs.plausible_src?.trim();

  return (
    <>
      {gaId ? (
        <GoogleAnalytics measurementId={gaId} />
      ) : (
        <ClientAnalyticsFallback />
      )}
      {plausibleDomain || plausibleSrc ? (
        <Plausible domain={plausibleDomain} src={plausibleSrc || undefined} />
      ) : null}
    </>
  );
}
