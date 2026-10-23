import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // typedRoutes is off deliberately: almost every link here is built from an
  // import id (`/imports/${id}`), which a statically-typed route literal cannot
  // express without casting at each call site.
  typedRoutes: false,
  // Document tabs accept PDF/JPG/PNG up to 20 MB; leave headroom for multipart.
  experimental: {
    serverActions: {
      bodySizeLimit: '21mb',
    },
  },
}

export default nextConfig
