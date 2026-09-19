/**
 * dsh-canvas — the agent-facing tool set (§3.6).
 *
 * The tools are thin: they resolve *which* card and project the call belongs
 * to, then delegate to a runtime. Two resolution rules, and the difference
 * between them is the whole isolation model:
 *
 * - **Card tools** answer for the card whose conversation is calling. The card
 *   is resolved from `exec.agent` through the live session table — never from a
 *   prompt convention and never from an argument — so a session that is not a
 *   card session is refused (`card/session-missing`) instead of silently acting
 *   on someone else's artifact.
 * - **Board tools** answer for the project the user is currently looking at,
 *   which the client records in the domain global when it switches boards.
 *
 * `execute` returns only the canonical JSON value; the human-readable rendering
 * lives in `output.render`, as the tool pipeline requires.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { CardSummary, ExportFormat } from './types.ts'
import { TOOL_NAMES } from './contract.ts'
import type { CanvasRuntime } from './runtime.ts'
import type { CardRuntime } from './card-runtime.ts'
import type { SessionManager } from './core/session-manager.ts'
import type { CanvasDomain } from './domain.ts'

/** What the tool layer needs from the composition root. */
export interface ToolDeps {
  domain: CanvasDomain
  canvas: CanvasRuntime
  card: CardRuntime
  sessions: SessionManager
}

/** Render blocks for one line-oriented text answer. */
const text = (value: string): ContentBlock[] => [{ type: 'text', text: value }]

/** The canonical summary shape every summary-returning tool declares. */
const SUMMARY_PROPERTIES = {
  cardId: { type: 'string' },
  kind: { type: 'string' },
  path: { type: 'string' },
  summary: { type: 'string' },
  outline: { type: 'array', items: { type: 'string' } },
  bytes: { type: 'number' },
  updatedAt: { type: 'number' },
} as const

/** One summary rendered for the model. */
function renderSummary(summary: CardSummary): string {
  const outline = summary.outline.length === 0 ? '' : `\n结构：${summary.outline.join(' / ')}`
  return `## ${summary.cardId} (${summary.kind})\n路径：${summary.path}\n${summary.summary}${outline}`
}

/**
 * Install the canvas tools.
 *
 * @param ctx - the plugin's context, carrying `tools`.
 * @param deps - the live runtimes to delegate to.
 * @returns nothing; registrations are owned by the calling fiber.
 */
export function registerTools(ctx: Context, deps: ToolDeps): void {
  /** The card whose conversation is calling, or a refusal the model can act on. */
  const callingCard = (agentId: string | undefined) => {
    if (agentId === undefined) return undefined
    return deps.sessions.cardOf(agentId as never)
  }

  /** The project the user is looking at. */
  const activeProject = (): string => {
    const active = deps.domain.global.get().activeProjectId
    if (active === '') {
      throw new Error(
        `no canvas project is open in this session. Open a canvas project first, then retry — or use ${TOOL_NAMES.readBoard} from inside a card conversation.`,
      )
    }
    return active
  }

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.readCard,
      description:
        '读取指定卡片产物的摘要（结构化大纲 + 有界正文）。用于了解画布上另一张卡片当前是什么样子。只读取，不修改。',
      parameters: {
        cardId: { type: 'string', description: '项目内的相对路径，即卡片 id，例如 decks/intro.html', required: true },
      },
      output: {
        schema: { type: 'object', properties: SUMMARY_PROPERTIES, additionalProperties: false },
        render: (_args, value) => text(renderSummary(value as CardSummary)),
      },
      async execute(args, exec) {
        const caller = callingCard(exec.agent?.id)
        if (caller === undefined) throw new Error(`${TOOL_NAMES.readCard} 只能在卡片会话内调用：请先打开这张卡片的对话。`)
        return deps.card.readSummary(caller.project, String(args.cardId), exec.signal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.readSources,
      description:
        '读取当前卡片全部取材来源（上游产物）的摘要，按由近及远排列。改动产物前先调用它，避免与上游脱节。',
      parameters: {
        depth: { type: 'integer', description: '解析链的层数；省略则用部署默认值', },
      },
      output: {
        schema: { type: 'array', items: { type: 'object', properties: SUMMARY_PROPERTIES, additionalProperties: false } },
        render: (_args, value) => {
          const list = value as CardSummary[]
          if (list.length === 0) return text('这张卡片目前没有取材来源。')
          return text(list.map(renderSummary).join('\n\n'))
        },
      },
      async execute(_args, exec) {
        const caller = callingCard(exec.agent?.id)
        if (caller === undefined) throw new Error(`${TOOL_NAMES.readSources} 只能在卡片会话内调用。`)
        return deps.card.readSources(caller.project, caller.cardId, exec.signal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.linkSource,
      description:
        '声明当前卡片的产物取材于另一张卡片（建立一条「取材」边：素材 → 产物）。当你的产物确实使用了另一张卡片的产物时调用。',
      parameters: {
        sourceCardId: { type: 'string', description: '作为素材的上游卡片 id（项目内相对路径）', required: true },
      },
      output: {
        schema: {
          type: 'object',
          properties: { id: { type: 'string' }, upstream: { type: 'string' }, downstream: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const edge = value as { upstream: string; downstream: string }
          return text(`已建立取材关系：${edge.downstream} ← ${edge.upstream}`)
        },
      },
      async execute(args, exec) {
        const caller = callingCard(exec.agent?.id)
        if (caller === undefined) throw new Error(`${TOOL_NAMES.linkSource} 只能在卡片会话内调用。`)
        const edge = await deps.canvas.linkSource(caller.project, String(args.sourceCardId), caller.cardId, exec.signal)
        return { id: edge.id, upstream: edge.upstream, downstream: edge.downstream }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.getSources,
      description: '获取当前卡片的取材链：直接上游、间接上游与下游卡片 id。用于判断改动会影响谁、依赖了谁。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: {
            direct: { type: 'array', items: { type: 'string' } },
            indirect: { type: 'array', items: { type: 'string' } },
            downstream: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const chain = value as { direct: string[]; indirect: string[]; downstream: string[] }
          return text(
            [
              `取材来源（直接）：${chain.direct.join('、') || '无'}`,
              `取材来源（间接）：${chain.indirect.join('、') || '无'}`,
              `下游产物：${chain.downstream.join('、') || '无'}`,
            ].join('\n'),
          )
        },
      },
      async execute(_args, exec) {
        const caller = callingCard(exec.agent?.id)
        if (caller === undefined) throw new Error(`${TOOL_NAMES.getSources} 只能在卡片会话内调用。`)
        return deps.canvas.getSources(caller.project, caller.cardId, exec.signal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.injectCard,
      description:
        '把另一张卡片的产物内容注入当前会话上下文。mode=summary 只注入摘要，mode=full 注入有界全文。用于真正需要原文时，而不是猜测上游写了什么。',
      parameters: {
        cardId: { type: 'string', description: '要被注入的卡片 id', required: true },
        mode: { type: 'string', enum: ['summary', 'full'], description: '注入粒度，默认 summary' },
      },
      output: {
        schema: { type: 'object', properties: SUMMARY_PROPERTIES, additionalProperties: false },
        render: (_args, value) => text(`已注入 ${(value as CardSummary).cardId}：\n\n${renderSummary(value as CardSummary)}`),
      },
      async execute(args, exec) {
        const caller = callingCard(exec.agent?.id)
        if (caller === undefined) throw new Error(`${TOOL_NAMES.injectCard} 只能在卡片会话内调用。`)
        const mode = args.mode === 'full' ? 'full' : 'summary'
        return deps.card.injectCard(caller.project, caller.cardId, String(args.cardId), mode, exec.signal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.readBoard,
      description: '读取画布当前座次、卡片清单与取材边。用于了解整个项目有哪些产物、它们如何互相取材。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            root: { type: 'string' },
            cards: { type: 'array', items: { type: 'string' } },
            sources: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const board = value as { project: string; root: string; cards: string[]; sources: string[] }
          return text(
            [
              `项目：${board.project}（${board.root}）`,
              `卡片 ${board.cards.length} 张：${board.cards.join('、') || '无'}`,
              `取材边 ${board.sources.length} 条：${board.sources.join('、') || '无'}`,
            ].join('\n'),
          )
        },
      },
      async execute(_args, exec) {
        const board = await deps.canvas.readBoard(activeProject(), exec.signal)
        return {
          project: board.project.name,
          root: board.project.root,
          cards: board.cards.map((card) => `${card.id}(${card.kind})`),
          sources: board.sources.map((source) => `${source.downstream} ← ${source.upstream}`),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.arrangeOnBoard,
      description:
        '按语义重新摆位画布。strategy=source-chain 沿取材链从左到右分层（素材在左、产物在右）；grid 平铺；organize 把游离卡片归纳到链条下方。只改座次，不改产物。',
      parameters: {
        strategy: { type: 'string', enum: ['source-chain', 'grid', 'organize'], description: '摆位策略，默认 source-chain' },
      },
      output: {
        schema: { type: 'object', properties: { moved: { type: 'number' } }, additionalProperties: false },
        render: (_args, value) => text(`已重新摆位 ${(value as { moved: number }).moved} 张卡片。`),
      },
      async execute(args, exec) {
        const strategy = args.strategy === 'grid' || args.strategy === 'organize' ? args.strategy : 'source-chain'
        const board = await deps.canvas.arrange(activeProject(), strategy, exec.signal)
        return { moved: board.cards.length }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.organizeBoard,
      description: '归纳收纳画布：把参与取材链的卡片按链条摆好，把游离卡片打包到下方，让画布重新可读。',
      parameters: {},
      output: {
        schema: { type: 'object', properties: { moved: { type: 'number' } }, additionalProperties: false },
        render: (_args, value) => text(`已归纳 ${(value as { moved: number }).moved} 张卡片。`),
      },
      async execute(_args, exec) {
        const board = await deps.canvas.arrange(activeProject(), 'organize', exec.signal)
        return { moved: board.cards.length }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.createOnBoard,
      description:
        '在画布上创建内容：type=note 创建共享便利贴（决策记录），type=card 把项目内的一个产物落成卡片，type=webapp 新建一个应用节点——建文件夹并写入 web components + shadcn 风格的 web 应用脚手架。',
      parameters: {
        type: { type: 'string', enum: ['note', 'card', 'webapp'], description: '创建类型', required: true },
        content: {
          type: 'string',
          description: 'note 为便利贴文字；card 为项目内相对路径；webapp 为应用显示名（文件夹名由它生成）',
          required: true,
        },
        kind: { type: 'string', description: 'type=card 时的形态 id；省略则按文件证据认定' },
        x: { type: 'number', description: '画布 x 坐标；省略则自动找空位' },
        y: { type: 'number', description: '画布 y 坐标；省略则自动找空位' },
      },
      output: {
        schema: {
          type: 'object',
          properties: { type: { type: 'string' }, id: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const created = value as { type: string; id: string }
          if (created.type === 'note') return text(`已创建便利贴 ${created.id}。`)
          if (created.type === 'webapp') return text(`已创建应用 ${created.id}（入口 index.html，文件夹内含脚手架）。`)
          return text(`已在画布上创建卡片 ${created.id}。`)
        },
      },
      async execute(args, exec) {
        const projectId = activeProject()
        const x = typeof args.x === 'number' ? args.x : undefined
        const y = typeof args.y === 'number' ? args.y : undefined
        if (args.type === 'note') {
          const note = await deps.canvas.createNote(
            projectId,
            String(args.content),
            { x: x ?? 48, y: y ?? 48 },
            exec.signal,
          )
          return { type: 'note', id: note.id }
        }
        if (args.type === 'webapp') {
          const card = await deps.card.scaffoldWebapp(
            projectId,
            String(args.content),
            { x: x ?? 48, y: y ?? 170 },
            exec.signal,
          )
          return { type: 'webapp', id: card.id }
        }
        const cardId = String(args.content)
        const kind = typeof args.kind === 'string' ? args.kind : 'file'
        await deps.card.createCard(projectId, cardId, kind, { x: x ?? 48, y: y ?? 170 }, exec.signal)
        return { type: 'card', id: cardId }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.linkSourceOnBoard,
      description: '在画布上直接画一条取材线：from 是素材（上游），to 是产物（下游）。',
      parameters: {
        from: { type: 'string', description: '上游卡片 id（素材）', required: true },
        to: { type: 'string', description: '下游卡片 id（产物）', required: true },
      },
      output: {
        schema: {
          type: 'object',
          properties: { upstream: { type: 'string' }, downstream: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const edge = value as { upstream: string; downstream: string }
          return text(`已连接：${edge.downstream} ← ${edge.upstream}`)
        },
      },
      async execute(args, exec) {
        const edge = await deps.canvas.linkSource(activeProject(), String(args.from), String(args.to), exec.signal)
        return { upstream: edge.upstream, downstream: edge.downstream }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.generateImage,
      description: '为某张图片卡片生成画面。prompt 描述要什么，cardId 指定写进哪张卡片（项目内相对路径）。',
      parameters: {
        prompt: { type: 'string', description: '画面描述', required: true },
        cardId: { type: 'string', description: '目标图片卡片 id', required: true },
      },
      output: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, path: { type: 'string' }, reason: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const result = value as { ok: boolean; path: string; reason: string }
          return text(result.ok ? `已生成：${result.path}` : `生图未完成：${result.reason}`)
        },
      },
      async execute(args, exec) {
        const projectId = activeProject()
        const board = await deps.canvas.readBoard(projectId, exec.signal)
        const cardId = String(args.cardId)
        const result = await deps.card.generateImage(
          board.project,
          cardId,
          String(args.prompt),
          undefined,
          exec.signal,
        )
        return { ok: result.ok, path: result.path, reason: result.reason }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.export,
      description:
        '把一张卡片产物导出为其它格式（html / pdf / pptx / png / svg / zip）。能否导出取决于卡片形态与部署是否提供导出能力，不可行时会返回具体原因。',
      parameters: {
        cardId: { type: 'string', description: '要导出的卡片 id', required: true },
        format: { type: 'string', enum: ['html', 'pdf', 'pptx', 'png', 'svg', 'zip'], description: '目标格式', required: true },
      },
      output: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, path: { type: 'string' }, reason: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const result = value as { ok: boolean; path: string; reason: string }
          return text(result.ok ? `导出完成：${result.path}` : `导出未完成：${result.reason}`)
        },
      },
      async execute(args, exec) {
        const projectId = activeProject()
        const board = await deps.canvas.readBoard(projectId, exec.signal)
        const result = await deps.card.exportCard(projectId, String(args.cardId), args.format as ExportFormat, exec.signal)
        return { ok: result.ok, path: result.path || board.project.root, reason: result.reason }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: TOOL_NAMES.publish,
      description: '把一张卡片产物发布到公开链接（可下线即回收）。发布取决于卡片形态与部署是否提供发布能力。',
      parameters: {
        cardId: { type: 'string', description: '要发布的卡片 id', required: true },
      },
      output: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, url: { type: 'string' }, reason: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, value) => {
          const result = value as { ok: boolean; url: string; reason: string }
          return text(result.ok ? `已发布：${result.url}` : `发布未完成：${result.reason}`)
        },
      },
      async execute(args, exec) {
        const result = await deps.card.publishCard(activeProject(), String(args.cardId), exec.signal)
        return { ok: result.ok, url: result.path, reason: result.reason }
      },
    }),
  )
}
