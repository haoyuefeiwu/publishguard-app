import type { MetadataRoute } from 'next';

import { envConfigs } from '@/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/settings', '/api/', '/*?*'],
      },
    ],
    sitemap: `${envConfigs.app_url}/sitemap.xml`,
  };
}
