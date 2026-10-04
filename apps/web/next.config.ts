import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `next dev` no escribe AGENTS.md / CLAUDE.md en el proyecto
  agentRules: false,
  // La imagen de las cuentas compartidas lee sus fuentes y el logo del disco
  outputFileTracingIncludes: {
    '/r/[token]/imagen': ['./assets/og/**', './public/brand/luks-logo-plano.svg'],
    '/c/[accountId]/liquidar/imagen': ['./assets/og/**', './public/brand/luks-logo-plano.svg'],
    '/r/[token]/historia': ['./assets/og/**', './public/brand/luks-logo-plano.svg'],
    '/historia': ['./assets/og/**', './public/brand/luks-logo-plano.svg'],
  },
};

// Serwist construye el service worker con esbuild (ver app/serwist/[path]/route.ts)
export default withSerwist(nextConfig);
