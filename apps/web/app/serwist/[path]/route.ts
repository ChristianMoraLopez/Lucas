import { spawnSync } from 'node:child_process';
import { createSerwistRoute } from '@serwist/turbopack';

// La revisión de lo que se precarga cambia con cada commit (y en Vercel, con cada deploy)
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout?.trim() ?? crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: 'app/sw.ts',
  useNativeEsbuild: true,
  additionalPrecacheEntries: [{ url: '/sin-conexion', revision }],
});
