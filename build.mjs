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
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'

/** Module loader identity — must match package name, index.ts `name` and cordis.patch.yml. */
const PLUGIN_ID = '@ljcoder2015/dsh-canvas'

mkdirSync('lib', { recursive: true })
/**
 * Design previewer runtime assets (设计节点)：CanvasKit 的 WASM 与 UMD 脚本。
 * 拷贝是可选的——`canvaskit-wasm` 装上才拷，没装预览器走 2D canvas 回退，
 * 资产路由对缺失文件如实 404。
 */
mkdirSync('lib/assets', { recursive: true })
const canvaskitDir = 'node_modules/canvaskit-wasm/bin/full'
for (const file of ['canvaskit.js', 'canvaskit.wasm']) {
  const source = `${canvaskitDir}/${file}`
  if (existsSync(source)) copyFileSync(source, `lib/assets/${file}`)
}
/**
 * The OpenPencil renderer's bundled fonts (Inter 等)。它的 fontManager 走根路径
 * `/Inter-Regular.ttf` 取字，在宿主里必然 404；预览器改从本路由预载并
 * `fontManager.markLoaded` 注入。拷平到 assets 根——资产路由只放行单段路径。
 * 没装包就不拷——文字回落 fontResolver 的在线路径。
 */
const fontDir = 'node_modules/@open-pencil/core/assets'
if (existsSync(fontDir)) {
  for (const file of ['Inter-Regular.ttf', 'Inter-Medium.ttf', 'Inter-SemiBold.ttf', 'Inter-Bold.ttf']) {
    const source = `${fontDir}/${file}`
    if (existsSync(source)) copyFileSync(source, `lib/assets/${file}`)
  }
}
/**
 * CJK 回落字体（设计节点）：OpenPencil 的 bundled 字体没有中文字形，远程
 * 回落走 Google Fonts（国内不可达）→ 中文渲染空白。仓库内 vendored 一份
 * Noto Sans SC（OFL 许可，见 assets/fonts/），预览器经 fontManager 注入，
 * `setCJKFallbackFamily` 声明回落族后中文完全走本地，不碰远程源。
 */
if (existsSync('assets/fonts/NotoSansSC-Regular.ttf')) {
  copyFileSync('assets/fonts/NotoSansSC-Regular.ttf', 'lib/assets/NotoSansSC-Regular.ttf')
}
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
  // 设计预览引擎按 URL 动态 import，必须原样保留 import() 语法（CJS 输出
  // 默认会改写成 require，浏览器里跑不了 ESM chunk）。
  supported: { 'dynamic-import': true },
  external: [...dshExternal, 'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'scheduler'],
  banner: { js: `window.__ModuleLoader__.load({ id: '${PLUGIN_ID}', factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
})

/**
 * 设计预览引擎（设计节点，P3）：独立 ESM chunk，经资产路由出。场景图 +
 * OpenPencil 渲染器 + yoga 布局整体打包——yoga 入口带顶层 await，client.js
 * 的 CJS 格式装不下；且场景图类身份必须全页唯一，graph 在这份 chunk 里
 * 创建、也在它里面渲染。node:* 只出现在 core 的非浏览器分支（动态 import），
 * 标 external 让打包通过，浏览器里永远执行不到。
 */
await build({
  entryPoints: ['src/client/artifact/viewers/design-engine.ts'], outfile: 'lib/assets/design-engine.js',
  bundle: true, format: 'esm', platform: 'browser', target: ['es2022'], sourcemap: true,
  // core 的 editor 分支有 node 才走的动态 import（本地字体访问等），两种写法
  // 都出现：`node:fs` 与裸 `fs`。标 external 让打包通过，浏览器里永远执行不到。
  external: ['node:fs/promises', 'node:path', 'node:url', 'fs', 'path', 'url'],
  logLevel: 'info',
})
