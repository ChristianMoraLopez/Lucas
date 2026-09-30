import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {};

// Serwist construye el service worker con esbuild (ver app/serwist/[path]/route.ts)
export default withSerwist(nextConfig);
