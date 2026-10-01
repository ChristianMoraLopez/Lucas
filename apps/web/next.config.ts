import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `next dev` no escribe AGENTS.md / CLAUDE.md en el proyecto
  agentRules: false,
};

// Serwist construye el service worker con esbuild (ver app/serwist/[path]/route.ts)
export default withSerwist(nextConfig);
