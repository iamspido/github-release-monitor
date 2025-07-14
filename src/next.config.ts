
import type {NextConfig} from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

// Read and parse the allowed origins from the .env file
const allowedOriginsFromEnv = process.env.ALLOWED_DEV_ORIGINS;
const dynamicAllowedDevOrigins = allowedOriginsFromEnv
  ? allowedOriginsFromEnv.split(',').map(origin => origin.trim())
  : [];

// Define a robust Content Security Policy
const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline';
    script-src-elem 'self' 'unsafe-inline';
    style-src 'self' 'unsafe-inline';
    style-src-elem 'self' 'unsafe-inline';
    img-src 'self' data: https://placehold.co;
    connect-src 'self' https://api.github.com;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
`;

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: dynamicAllowedDevOrigins,
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
  async headers() {
    const securityHeaders = [
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'X-Frame-Options',
        value: 'DENY',
      },
      {
        key: 'Content-Security-Policy',
        value: cspHeader.replace(/\s{2,}/g, ' ').trim(),
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()',
      },
      {
        key: 'Referrer-Policy',
        value: 'no-referrer',
      }
    ];

    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
