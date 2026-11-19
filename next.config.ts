import type { NextConfig } from 'next';

const collectionHeaders = [
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  // The card page calls the Kernel API from the browser. Expose the API origin
  // the server and scripts use, so a link is always sent to the API that
  // created it. It is an origin, not a secret. Next.js inlines it at build time.
  env: { KERNEL_API_BASE_URL: process.env.KERNEL_API_BASE_URL ?? '' },
  async headers() {
    return [
      { source: '/credentials/collect', headers: collectionHeaders },
      { source: '/cards/add', headers: collectionHeaders },
    ];
  },
};

export default nextConfig;
