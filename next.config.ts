import type { NextConfig } from 'next';

const collectionHeaders = [
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/credentials/collect', headers: collectionHeaders },
      { source: '/cards/add', headers: collectionHeaders },
    ];
  },
};

export default nextConfig;
