/**
 * dsh-canvas build.
 *
 * Produces the two halves of the dual-side plugin:
 *   - lib/index.js    host half (ESM, Node 22) — loaded by the cordis.patch.yml row
 *   - lib/client.js   client half (CJS, browser) — registered by window.__ModuleLoader__.load
 *
 * `@deepseek-ai/*` and react are externalized: the harness provides them at
 * runtime, so bundling them would duplicate the host's own module instances.
 * Declaration files are emitted separately by `tsc -p tsconfig.build.json`.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

/** Module loader identity — must match package name, index.ts `name` and cordis.patch.yml. */
const PLUGIN_ID = 'dsh-canvas'

mkdirSync('lib', { recursive: true })
/**
 * The whole `@deepseek-ai/*` scope is harness-provided, not just `dsh-*`:
 * `cordis` and `schemastery` ship with the host too. Enumerating them by hand
 * silently bundled `@deepseek-ai/schemastery` into the host half, giving the
 * plugin a second `Schema` class identity next to the harness's own copy.
 */
const dshExternal = ['@deepseek-ai/*']

await build({
  entryPoints: ['src/index.ts'], outfile: 'lib/index.js', bundle: true, format: 'esm',
  platform: 'node', target: ['node22'], sourcemap: true, external: dshExternal, logLevel: 'info',
})

await build({
  entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', bundle: true, format: 'cjs',
  platform: 'browser', target: ['es2022'], sourcemap: true, jsx: 'automatic',
  external: [...dshExternal, 'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'scheduler'],
  banner: { js: `window.__ModuleLoader__.load({ id: '${PLUGIN_ID}', factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
})
