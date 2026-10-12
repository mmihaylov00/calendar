// Loads admin TypeScript modules (web/admin/*.ts) in Node through Vite's SSR loader, so the tests run on every
// supported Node version (Node 20 has no TypeScript type stripping) and extensionless imports resolve the same
// way as in the build. The Vite server is closed once the modules are evaluated.
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Import the given repository paths ("/web/admin/caps.ts", …) and return their module namespaces. */
export async function loadWebModules(...paths) {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    define: { __APP_VERSION__: '"test"' },
  });
  try {
    const out = [];
    for (const p of paths) out.push(await server.ssrLoadModule(p));
    return out;
  } finally {
    await server.close();
  }
}
