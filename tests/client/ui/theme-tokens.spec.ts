import { describe, expect, it } from 'vitest'
import { css } from '../../../src/client/ui/styles.ts'

/**
 * 画布配色是「亮色默认 + 暗色覆盖」两套，随宿主主题自动切换（宿主在
 * `<body>` 上挂 `data-ds-dark-theme`，亮色＝属性缺席；light/dark/system 的
 * 解析在宿主 ui-theme 里完成，插件不管理状态）。这张表曾经出过一类静默事故：
 * 写了**宿主令牌表里并不存在**的名字（`--dsw-alias-bg-elevated` /
 * `--dsw-alias-border-secondary`），兜底值永远生效，看着像接了宿主、其实是
 * 写死的暗色，亮色下整张画布花掉（次文字更是白底白字）。下面四组断言把这类
 * 事故钉死：结构、双向完整性、令牌名白名单、portal 出去的段落不引用拿不到的变量。
 */

const LIGHT_SELECTOR = '.dsh-canvas-root{'
const DARK_SELECTOR = 'body[data-ds-dark-theme] .dsh-canvas-root{'

/** 从一段 CSS 里抽出全部 `--x: value` 声明。块内无嵌套大括号，按 `;` 切即安全。 */
function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of block.split(';')) {
    const m = part.match(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+)/)
    if (m) map.set(m[1], m[2].trim())
  }
  return map
}

function blockAfter(selector: string): string {
  const at = css.indexOf(selector)
  expect(at, `样式表里应存在 ${selector}`).toBeGreaterThan(-1)
  return css.slice(at + selector.length, css.indexOf('}', at))
}

const light = declarations(blockAfter(LIGHT_SELECTOR))
const dark = declarations(blockAfter(DARK_SELECTOR))

/** 必须「亮暗两套都在场」的画布专属令牌（宿主没有对应语义）。 */
const CANVAS_ONLY = [
  '--dsh-surface', '--dsh-card', '--dsh-soft', '--dsh-slot', '--dsh-mid',
  '--dsh-sunset', '--dsh-dusk', '--dsh-twilight', '--dsh-breeze', '--dsh-on-accent',
  '--dsh-field', '--dsh-hl', '--dsh-hl-edge',
  '--dsh-sunset-solid', '--dsh-on-sunset',
  '--dsh-sheen', '--dsh-sheen-peak',
] as const

/** 可以只写一套、靠宿主别名令牌自动跟随的中性色。 */
const HOST_RIDING = ['--dsh-fg', '--dsh-fg-2', '--dsh-fg-3', '--dsh-hairline'] as const

/** 已安装的 dsh-client-ui-theme 里**真实存在**的令牌名（0.1.5-rc.2）。
 *  再生办法：grep /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/
 *  @deepseek-ai/dsh-client-ui-theme/lib/client.js 里的 `--dsw-…:`。
 *  名字写错不会报错——兜底值永远生效，正是当年那类事故的温床，所以用白名单钉住。 */
const HOST_TOKEN_WHITELIST = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-border-l2',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-state-error-primary',
]

describe('canvas stylesheet: 两套配色', () => {
  it('亮色是默认值，暗色由宿主的 body[data-ds-dark-theme] 覆盖', () => {
    expect(css.indexOf(DARK_SELECTOR)).toBeGreaterThan(css.indexOf(LIGHT_SELECTOR))
    // 「亮色＝属性缺席」：不许出现另一套亮色选择器（宿主不会写它，写了也不生效）。
    expect(css).not.toContain('.dsh-canvas-light')
    expect(css).not.toContain('body:not([data-ds-dark-theme])')
  })

  it('画布专属令牌：亮色有显式值，暗色块逐一覆盖', () => {
    for (const name of CANVAS_ONLY) {
      const l = light.get(name)
      expect(l, `${name} 缺亮色默认值`).toBeTruthy()
      // 显式色，或者**从画布自己的调色板**派生（高亮底取品牌色的淡调那种）。不许出现
      // var(--dsw-…)：那是「看着像接了宿主令牌、其实是写死的另一档」那类静默事故的入口。
      expect(l!, `${name} 的亮色值应是显式色或画布内部派生，而不是宿主令牌引用`).toMatch(
        /^(#[0-9a-fA-F]{3,8}|color-mix\(in srgb, ?var\(--dsh-[a-z0-9-]+\))/,
      )
      expect(l!, `${name} 不许引用宿主令牌`).not.toContain('--dsw-')
      expect(dark.has(name), `${name} 缺暗色覆盖`).toBe(true)
      expect(dark.get(name), `${name} 两套不该同值（那等于没切）`).not.toBe(l)
    }
  })

  it('中性色骑宿主别名令牌（两套值由宿主管），且带无令牌部署的兜底', () => {
    for (const name of HOST_RIDING) {
      const v = light.get(name)
      expect(v, `${name} 应引用宿主令牌`).toMatch(/^var\(--dsw-alias-/)
      expect(v, `${name} 应带兜底色（宿主没挂 ui-theme 时也要可读）`).toMatch(/,\s*#/)
      expect(dark.has(name), `${name} 不应在暗色块重复声明（宿主令牌自己会切）`).toBe(false)
    }
  })
})

describe('canvas stylesheet: 只准引用真实存在的宿主令牌', () => {
  it('每个 var(--dsw-…) 名字都在白名单里', () => {
    const used = [...css.matchAll(/var\((--dsw-[a-zA-Z0-9-]+)/g)].map((m) => m[1])
    expect(used.length, '样式表应真的在吃宿主令牌').toBeGreaterThan(0)
    const fake = [...new Set(used)].filter((n) => !HOST_TOKEN_WHITELIST.includes(n))
    expect(fake, '这些名字不在已安装宿主的令牌表里——兜底值会永远生效，等于写死').toEqual([])
  })
})

describe('canvas stylesheet: portal 出画布根的段落不引用拿不到的变量', () => {
  // 左栏列表 portal 在宿主 <nav> 里，.dsh-canvas-root 上的调色板变量在那儿全是空值，
  // color/background 的整条声明会在计算值阶段被丢弃（当初的紫色错误提示就是这么静默失效的）。
  const FORBIDDEN = [
    ...CANVAS_ONLY, ...HOST_RIDING,
  ]
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => /\.dsh-canvas-nav/.test(m[1]) && !m[1].includes('@keyframes'))

  it('确实存在需要守卫的左栏规则（守卫本身不许空转）', () => {
    expect(rules.length).toBeGreaterThan(5)
  })

  it('左栏规则只用 :root 上的字体栈或宿主令牌', () => {
    const offenders = rules.flatMap((m) =>
      FORBIDDEN.filter((name) => m[2].includes(`var(${name}`)).map((name) => `${m[1].trim().slice(0, 60)} → ${name}`),
    )
    expect(offenders).toEqual([])
  })
})

describe('canvas stylesheet: 强调色实心件上的文字', () => {
  // 实心件上的字**跟着底走**，一族一对：亮色下 breeze 是中蓝、sunset 那族是亮黄，
  // 字取白 / 取深棕；暗色下两者都转亮，各自翻成近黑。这件事故去有三种写法（写死
  // #0A0A0A、借 --dsh-card、写死 #fff），于是亮色下主按钮成了黑字压深橙；后来按钮底
  // 改亮黄，白字在上面对比度只剩 1.8:1。**加一族底就得在这儿登记一对**——漏登记时
  // 下面那条会把它当成「借了别的令牌」抓出来。
  const PAIRS = [
    { fill: '--dsh-sunset', on: '--dsh-on-accent' },
    { fill: '--dsh-breeze', on: '--dsh-on-accent' },
    { fill: '--dsh-sunset-solid', on: '--dsh-on-sunset' },
  ] as const
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => !m[1].includes('@keyframes'))
  /** 一条规则里那枚实心底（若它用的底属于上面某一族）。 */
  const fillOf = (body: string) => PAIRS.find((pair) => body.includes(`background:var(${pair.fill})`))
  const withColor = rules.filter((m) => fillOf(m[2]) !== undefined && /(?:^|;)\s*color:/.test(m[2]))

  it('确实有带文字的实心强调件（守卫本身不许空转）', () => {
    expect(withColor.length).toBeGreaterThan(3)
  })

  it('它们的文字取的是与那一族底配对的那枚令牌', () => {
    const offenders = withColor
      .filter((m) => {
        const pair = fillOf(m[2])
        return pair === undefined || !m[2].includes(`color:var(${pair.on})`)
      })
      .map((m) => m[1].trim().slice(0, 70))
    expect(offenders, '实心强调底上的文字要与底成对，不许写死也不许借别的令牌').toEqual([])
  })
})

describe('canvas stylesheet: 流光带不许写死白色', () => {
  it('光带渐变吃 --dsh-sheen（白扫在亮色卡片上看不见）', () => {
    const shimmer = css.slice(css.indexOf('.dsh-canvas-shimmer::after'), css.indexOf('@keyframes'))
    expect(shimmer).toContain('var(--dsh-sheen-peak)')
    expect(css).not.toContain('rgba(255,255,255')
  })
})
