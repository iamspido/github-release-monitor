import createNextIntlPlugin from 'next-intl/plugin';
import { readFileSync } from 'fs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const isProd = process.env.NODE_ENV === 'production';
const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isProd && { output: 'standalone' }),
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version ?? '0.0.0',
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default withNextIntl(nextConfig);
