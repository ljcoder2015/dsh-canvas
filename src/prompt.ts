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
import type { CardId, CardSummary, Project } from './types.ts'
import { TOOL_NAMES } from './contract.ts'

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
      'Vocabulary: a **card** is one artifact plus its board seat; a **session** is that card\'s conversation; a **source** (取材) is the statement "this artifact builds on that artifact" — material at the upstream end, product at the downstream end. There is exactly one relationship type, and it is directed.',
      '',
      `The \`${TOOL_NAMES.readCard}\`, \`${TOOL_NAMES.readSources}\`, \`${TOOL_NAMES.linkSource}\`, \`${TOOL_NAMES.getSources}\`, \`${TOOL_NAMES.injectCard}\` and \`${TOOL_NAMES.export}\` tools act on *the card whose conversation is calling them*. Outside a card conversation they are refused — that is the intended behavior, not a fault, and the fix is to open the card first rather than to retry.`,
      `\`${TOOL_NAMES.readBoard}\`, \`${TOOL_NAMES.arrangeOnBoard}\`, \`${TOOL_NAMES.createOnBoard}\`, \`${TOOL_NAMES.organizeBoard}\` and \`${TOOL_NAMES.linkSourceOnBoard}\` are board-wide and work in any conversation inside a canvas project.`,
    ].join('\n'),
  })
}

/** What one card session needs to describe itself. */
export interface CardScopeInput {
  project: Project
  cardId: CardId
  /** Kind id resolved by the kind registry. */
  kind: string
  /** Human label of that kind. */
  kindLabel: string
  /** Formatted source-chain block, resolved when the context is assembled. */
  material: () => string
}

/**
 * Install one card's prompt facts inside its agent scope.
 *
 * @param agentCtx - the agent's own context, before the agent is published.
 * @param input - the card's identity, kind, and a lazy material reader.
 */
export function installCardScope(agentCtx: Context, input: CardScopeInput): void {
  const { project, cardId, kind, kindLabel } = input

  agentCtx.systemPrompt.section({
    name: CARD_SECTION,
    order: CARD_SECTION_ORDER,
    text: [
      '## This conversation',
      '',
      `Conversation for the canvas card \`${cardId}\` (kind: ${kindLabel} / \`${kind}\`) in project **${project.name}**.`,
      '',
      `- The artifact is the file \`${cardId}\`, relative to the project root \`${project.root}\`. Its absolute path is available as the \`canvas_card_path\` variable.`,
      '- Write the artifact by editing that file with the ordinary file tools. The canvas re-reads it from disk whenever the board is read, so no export or publish step is needed for the card to be up to date.',
      '- Producing a *new* artifact rather than editing this one is a different card. Say so and let the user create it, instead of overwriting this card\'s artifact.',
      project.style.tone.trim() === '' ? '' : `- Tone of voice for this project: ${project.style.tone}.`,
      project.style.font.trim() === '' ? '' : `- Type family for this project: ${project.style.font}.`,
      project.style.palette.length === 0 ? '' : `- Palette for this project: ${project.style.palette.join(', ')}.`,
      '',
      '### Material this artifact sources from',
      '',
      'The block below is the *current* digest of every artifact this one is declared to source from (取材). Treat it as material you may build on, not as text to copy: if an upstream artifact changed, this digest changed with it.',
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
      summary: boundContextSummary(`取材 ${source.cardId}`),
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
