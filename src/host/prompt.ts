/**
 * dsh-canvas — card-session prompt contributions (§4.5).
 *
 * Two registrations, at two scopes:
 *
 * - A **global** section tells any agent that the canvas tools exist and what
 *   the card/product/material vocabulary means. Tools that only work inside a
 *   card session must say so, or the model will call them from a plain
 *   conversation and read the refusal as a malfunction.
 * - A **card-scoped** section plus dynamic context, installed inside the
 *   agent's own context by `installCardScope`, carries the facts the model
 *   needs every turn: which artifact it is editing, how to write it back, and
 *   what material its artifact is allowed to draw on.
 *
 * The scope is the isolation mechanism: a registration made through
 * `agentCtx` exists only for that agent, unwinds with it, and shadows a global
 * entry of the same name — so a card's facts can never leak into another
 * card's requests.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage, boundContextSummary } from '@deepseek-ai/dsh-llm'
import type { CardId, CardSummary, Project } from '../types.ts'
import { renderFileReferences, type FileReference } from '../core/artifact/file-reference.ts'
import { TOOL_NAMES } from '../contract.ts'

/** Plugin identity used on every injected message source. */
export const PLUGIN_ID = 'dsh-canvas'

/** Section name of the global tool guidance. */
export const GLOBAL_SECTION = 'dsh-canvas:tools'

/** Section name of the card's own context block. */
export const CARD_SECTION = 'dsh-canvas:card'

/** Dynamic-context name carrying the current upstream digests. */
export const UPSTREAM_CONTEXT = 'dsh-canvas:upstreams'

/** Order of the global tool guidance, alongside the harness's own tool sections. */
const GLOBAL_SECTION_ORDER = 2950

/** Order of the card section, inside the same band. */
const CARD_SECTION_ORDER = 2955

/** Order of the upstream dynamic context. */
const UPSTREAM_CONTEXT_ORDER = 130

/**
 * The design preset: what a design card's conversation knows without asking
 * (F3.16). Board sizes come first because "什么尺寸" is the first decision
 * every design instruction implies — the menu gives the ***width***, the
 * ***height*** follows the content, because one page is one continuous board
 * (v1.55: no per-screen split) — then the layer discipline that keeps a
 * document navigable — semantic names, text as text — and finally the
 * edit-loop etiquette: read before writing, batch the ops.
 */
const DESIGN_PRESET = [
  'Artboard sizes (scene-graph frames). Take the **width** from this menu and let the **height follow the content**, unless the user names a size:',
  '手机屏 375 宽、平板 834 宽、桌面 / 官网 1440 宽——网页与应用的长页面**高度按内容给**（1440×2600、375×3200 都是常态，一屏高不是上限）。固定规格的稿件照旧整块给出：海报 1242×1660、社交方图 1080×1080、幻灯片 1920×1080、横幅 1920×600.',
  'No pagination: a web page or an app lives on **one artboard** — everything below the fold stays in that same continuous column, exactly how the browser will scroll it, never compressed to fit one screen. Do not split one page into per-screen boards (首屏 / 第二屏 / 第三屏): the user scrolls one page, they do not flip between screens. Several artboards are right only when the user asks for screens side by side (多屏对比 / 流程走查) or when the deliverable is a sequence by nature (幻灯片的每一页、海报系列).',
  'Layer discipline — the scene graph is a **module tree, not a flat pile**: decompose each artboard into module frames first (导航栏 / 侧边栏 / 内容区 / 页脚 / 表单区 / 卡片组…, each named for what the module is), then hang every element **inside its module frame** — an element sitting directly on the artboard is a smell; the only legal board-level nodes are the board background and full-bleed decorations. Nest deeper where it pays (列表的每一项是一个子 frame). The **artboard clips its overflow** — one board per page (a text page, an app page, a slide, a poster…), content spilling past the board edge simply does not render; module frames do **not** clip, so an element may overhang its module and still show as long as it stays inside the artboard. Child x/y are **relative to the parent frame** (the renderer walks the tree and accumulates). text stays type `text` with its string in `text`, never flattened; keep one frame per board and no stray root nodes.',
  'Edit loop: `canvas_design_read` first (ops must reference real node ids), then one `canvas_design_edit` batch of upsert/setProps/move/delete/reorder — small batches, geometry in layer coordinates (relative to the parent frame, x/y is the top-left), colors as #RRGGBB[AA].',
].join(' ')

/**
 * Register the canvas tool guidance globally.
 *
 * Deliberately states the cards-only precondition in the tool's own words
 * rather than leaving it implicit: `canvas_*` resolves *which card is asking*
 * from the calling agent, so the same call outside a card session is refused
 * on purpose.
 */
export function registerGlobalPrompt(ctx: Context): void {
  ctx.systemPrompt.section({
    name: GLOBAL_SECTION,
    order: GLOBAL_SECTION_ORDER,
    text: [
      '## Canvas workspace',
      '',
      `This deployment has the canvas plugin (${PLUGIN_ID}). A canvas project is a directory on disk; every artifact in it is a card, and every card owns one conversation.`,
      '',
      'Vocabulary: a **card** is one artifact plus its board seat; a **session** is that card\'s conversation; a **source** (引用) is the statement "this artifact builds on that artifact" — material at the upstream end, product at the downstream end. There is exactly one relationship type, and it is directed.',
      '',
      'A source edge (引用) carries material in two forms, and they answer different questions. The upstream **artifact** can be *named* as a file reference (`canvas_reference_files`): the board injects its workspace-relative path as an `@` token and you read it with the ordinary file tools when it matters — that is the cheap, always-current form. The same artifact can also be *summarized into this conversation* on demand (`canvas_read_sources`, `canvas_inject_card`), which costs context whether or not you wanted it but puts the material in front of you without a read.',
      '',
      `The \`${TOOL_NAMES.readCard}\`, \`${TOOL_NAMES.readSources}\`, \`${TOOL_NAMES.referenceFiles}\`, \`${TOOL_NAMES.linkSource}\`, \`${TOOL_NAMES.getSources}\` and \`${TOOL_NAMES.injectCard}\` tools act on *the card whose conversation is calling them*. Outside a card conversation they are refused — that is the intended behavior, not a fault, and the fix is to open the card first rather than to retry.`,
      `\`${TOOL_NAMES.readBoard}\`, \`${TOOL_NAMES.arrangeOnBoard}\`, \`${TOOL_NAMES.organizeBoard}\`, \`${TOOL_NAMES.createOnBoard}\`, \`${TOOL_NAMES.linkSourceOnBoard}\`, \`${TOOL_NAMES.generateImage}\`, \`${TOOL_NAMES.export}\` and \`${TOOL_NAMES.publish}\` are board-wide: they answer for the canvas the user has open — and inside a card conversation, where the project is certain, for that card's canvas.`,
    ].join('\n'),
  })
}

/** What one card session needs to describe itself. */
export interface CardScopeInput {
  project: Project
  /** The card's seat id — six random letters, not a file name. */
  cardId: CardId
  /** Path of the card's artifact, relative to the project root. */
  file: string
  /** Kind id resolved by the kind registry. */
  kind: string
  /** Human label of that kind. */
  kindLabel: string
  /** Formatted material block — the card's direct upstreams, one hop (F5.8). */
  material: () => string
}

/**
 * Install one card's prompt facts inside its agent scope.
 *
 * @param agentCtx - the agent's own context, before the agent is published.
 * @param input - the card's identity, kind, and a lazy material reader.
 */
export function installCardScope(agentCtx: Context, input: CardScopeInput): void {
  const { project, cardId, file, kind, kindLabel } = input

  agentCtx.systemPrompt.section({
    name: CARD_SECTION,
    order: CARD_SECTION_ORDER,
    text: [
      '## This conversation',
      '',
      `Conversation for the canvas card \`${cardId}\` (kind: ${kindLabel} / \`${kind}\`) in project **${project.name}**. The card id is only a seat identity — the artifact lives at the file below.`,
      '',
      `- The artifact is the file \`${file}\`, relative to the project root \`${project.root}\`. Its absolute path is available as the \`canvas_card_path\` variable.`,
      kind === 'design'
        ? `- This is a **design** card: the artifact is a scene-graph design document (.design, v2). Do not edit the file with text tools — read the document with \`${TOOL_NAMES.designRead}\` and change it with \`${TOOL_NAMES.designEdit}\` batches. ${DESIGN_PRESET}`
        : '- Write the artifact by editing that file with the ordinary file tools. The canvas re-reads it from disk whenever the board is read, so no export or publish step is needed for the card to be up to date.',
      `- **A change belongs to this artifact.** This conversation has exactly one product — the file above — so a turn that asks for a change means rewriting *that* file. "再改一下 / 换成… / 加上… / 调一下" is a revision of what is already here, not a new artifact: work in place. (Where the artifact is the entry file of a site or an app, its sibling files are this same artifact and are edited as such — the line that must not be crossed is starting a *second* deliverable: no \`-v2\` / \`-copy\` / alternate file left for the user to pick between, and no seating another card (\`${TOOL_NAMES.createOnBoard}\`) for a change to this one.) A multi-turn conversation is meant to converge on one artifact that gets better; a new file per turn scatters the thread the user is holding, and the board ends up showing two cards where they asked for one thing fixed.`,
      '- Creating a card is the user\'s move, not yours: cards are seated on the board by them (dragging out a node, or asking for one), and a conversation never creates one as a side effect of wanting to write something. So the one case where another card is the right answer is when the user asks for a *separate* deliverable outright — then say so in words and let them create it, rather than forking silently or overwriting this artifact with something that is not it.',
      project.style.tone.trim() === '' ? '' : `- Tone of voice for this project: ${project.style.tone}.`,
      project.style.font.trim() === '' ? '' : `- Type family for this project: ${project.style.font}.`,
      project.style.palette.length === 0 ? '' : `- Palette for this project: ${project.style.palette.join(', ')}.`,
      '',
      '### Material this artifact sources from',
      '',
      'The block below names the artifacts this one is declared to source from (引用) — **one hop**: the material it builds on directly, as workspace-relative paths, which is exactly what the `@file` grammar denotes. Read any of them with the ordinary file tools: they are references, not content, and nothing has been copied into this conversation on your behalf.',
      '',
      'Nothing further up the chain is listed, on purpose. Those artifacts are upstream of *your* upstream, and the product in between is expected to have absorbed them — so work from what is named here, and from that artifact\'s own content, rather than guessing at its ancestors. If an instruction really reaches past them, `canvas_get_sources` names the whole chain, and `canvas_read_card` reads any one artifact on it.',
      '',
      `When a name is not enough — you want the material in front of you without spending a read — \`${TOOL_NAMES.readSources}\` returns a digest of every upstream listed above, \`${TOOL_NAMES.readCard}\` returns one artifact, and \`${TOOL_NAMES.injectCard}\` pushes one into this conversation. \`${TOOL_NAMES.referenceFiles}\` re-states the upstream files as \`@\` tokens, which is what to call after a long exchange has pushed the block out of sight.`,
    ]
      .filter((line) => line !== '')
      .join('\n'),
  })

  agentCtx.systemPrompt.variable('canvas_card_path', () => `${project.root.replace(/\/+$/, '')}/${cardId}`)
  agentCtx.systemPrompt.variable('canvas_card_id', () => cardId)
  agentCtx.systemPrompt.variable('canvas_project', () => project.name)

  // Upstream digests are dynamic: the artifact behind them may be rewritten by
  // a *different* card's conversation while this one is open, so the text is
  // resolved per assembly instead of frozen at registration.
  agentCtx.systemPrompt.context({
    name: UPSTREAM_CONTEXT,
    order: UPSTREAM_CONTEXT_ORDER,
    text: () => input.material(),
  })
}

/**
 * Build the message that tells a downstream session its material changed (F5.7).
 *
 * Injected, never delivered as a turn: the policy exists so an open downstream
 * conversation is not left reasoning about a version of the material that no
 * longer exists, not so the plugin can spend the user's tokens unprompted.
 */
export function upstreamChangedMessage(upstream: CardId, downstream: CardId, digest: string): UserMessage {
  const body =
    digest === ''
      ? `Material changed: canvas card \`${upstream}\` was rewritten. Call \`${TOOL_NAMES.readCard}\` if you need its new content before continuing.`
      : `Material changed: canvas card \`${upstream}\` was rewritten, and \`${downstream}\` is declared to source from it. Its new digest:\n\n${digest}`
  return createUserMessage({
    content: [{ type: 'text', text: body }],
    source: {
      kind: 'plugin',
      plugin: PLUGIN_ID,
      form: 'snapshot',
      sections: [{ name: UPSTREAM_CONTEXT, text: body }],
    },
  })
}

/**
 * Build the message that hands a downstream session its material as file names.
 *
 * The source is `kind: 'plugin'`, never `kind: 'user'`: the board is naming the
 * files, not putting words in the user's mouth, and the harness's own `@file`
 * guidance already tells the model how to treat such tokens. The body carries
 * no file content at all — a reference is an offer to read, and its whole value
 * is that it costs nothing until the model accepts.
 */
export function referenceMessage(
  references: readonly FileReference[],
  skipped: readonly string[],
): UserMessage {
  const body = renderFileReferences(references, skipped)
  return createUserMessage({
    content: [{ type: 'text', text: body }],
    source: {
      kind: 'plugin',
      plugin: PLUGIN_ID,
      form: 'notice',
      summary: boundContextSummary(`引用 ${references.map((reference) => reference.cardId).join(' / ')}`),
    },
  })
}

/**
 * Render one digest as a material entry: identity, path, structure, body (F5.2).
 *
 * The path and the outline are the parts an agent cannot recover from the
 * summary text alone, so they lead instead of trailing the body.
 */
function renderMaterialEntry(summary: CardSummary): string {
  const outline = summary.outline.length === 0 ? '' : `\n  结构：${summary.outline.join(' / ')}`
  return `- **${summary.cardId}** (${summary.kind}) → ${summary.path}${outline}\n  ${summary.summary.replace(/\n/g, '\n  ')}`
}

/**
 * Render the material block from upstream digests (F5.2).
 *
 * Used by the pull path — `canvas_inject_card` in `summary` mode — where the
 * digests are read at the moment of injection and are therefore current.
 *
 * Deliberately *not* wired into the per-turn material context in
 * {@link installCardScope}: that context is assembled synchronously, so serving
 * digests from it would mean caching them, and nothing in this deployment
 * invalidates such a cache — a card whose artifact is rewritten by an ordinary
 * file edit would keep feeding the prompt a stale digest. The context carries
 * the chain (which cards, which kinds) and points the model at
 * `canvas_read_sources`, which reads through and cannot go stale.
 *
 * Empty when the card sources from nothing — an empty contribution is dropped
 * rather than leaving a heading with no content.
 */
export function renderMaterial(summaries: readonly CardSummary[]): string {
  if (summaries.length === 0) return ''
  return ['### Sourced material', '', ...summaries.map(renderMaterialEntry)].join('\n')
}

/**
 * Build the message that carries an explicit card-to-card injection.
 *
 * `agent.inject` writes durable context without waking an idle agent, which is
 * exactly the semantics an injection wants: the model sees the material on its
 * next request, and no turn is started behind the user's back.
 */
export function injectionMessage(source: CardSummary, mode: 'summary' | 'full', body: string): UserMessage {
  const text =
    mode === 'full'
      ? `Material injected from canvas card \`${source.cardId}\` (${source.kind}) — full content:\n\n${body}`
      : `Material injected from canvas card \`${source.cardId}\` (${source.kind}).\n\n${body}`
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'plugin',
      plugin: PLUGIN_ID,
      form: 'notice',
      summary: boundContextSummary(`引用 ${source.cardId}`),
    },
  })
}

/**
 * Build the user's own prompt, typed into a card's composer on the board.
 *
 * The source is `kind: 'user'` — the words are the user's, not the plugin's —
 * which is the same attribution the harness's own conversation composer uses.
 * Delivery is the caller's business: {@link userPromptMessage} is handed to
 * `agent.followup`, so a prompt typed while the agent runs queues as the next
 * turn instead of racing the active one.
 */
export function userPromptMessage(prompt: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  })
}
