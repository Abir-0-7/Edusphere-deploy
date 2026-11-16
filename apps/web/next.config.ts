import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {},
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/ocr/:path*',
        // A dedicated HTTP worker gets its own policy; the page keeps its nonce CSP.
        headers: [{
          key: 'Content-Security-Policy',
          value: "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'",
        }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
