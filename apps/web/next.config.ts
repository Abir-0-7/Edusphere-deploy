import type { NextConfig } from 'next';

const cyberverseDocument = '/games/cyberverse/index.html';

const nextConfig: NextConfig = {
  async redirects() {
    // The standalone export has its own demo. A direct navigation instead
    // enters the protected game page, which loads a same-origin frame.
    return [
      {
        source: cyberverseDocument,
        missing: [{ type: 'header', key: 'sec-fetch-dest', value: 'iframe' }],
        destination: '/games/cyberverse',
        permanent: false,
      },
      {
        source: cyberverseDocument,
        missing: [{ type: 'header', key: 'sec-fetch-site', value: 'same-origin' }],
        destination: '/games/cyberverse',
        permanent: false,
      },
    ];
  },
  turbopack: {},
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: cyberverseDocument,
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
          },
        ],
      },
      {
        source: '/ocr/:path*',
        // A dedicated HTTP worker gets its own policy; the page keeps its nonce CSP.
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'",
          },
        ],
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
