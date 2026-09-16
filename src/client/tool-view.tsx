/**
 * dsh-canvas — the code live view for `canvas.*` tool calls (F7.2).
 *
 * While a card's agent works, its board calls go past the user as ordinary tool
 * cards. The product doc gives the canvas its own rendering of those calls on
 * the keyed `tool.call.toolview` seat, so a `canvas.arrange_on_board` shows what
 * it is moving instead of a JSON blob.
 *
 * One honest caveat, stated where it matters: the seat's owner is not a
 * dependency of this package, so its exact prop shape is not readable at build
 * time. This component therefore reads a small set of candidate field names and
 * degrades to the tool's own name — and the registration goes through
 * `slots.inject`, so if the seat's owner is absent or renamed, this file
 * contributes nothing instead of drawing a broken card. Aligning the reader
 * with the owner's published contract is a follow-up, not a placeholder.
 */
import type { ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { TOOL_NAMES } from '../contract.ts'
import type { Translate } from './locales.ts'
import { foreignSeats } from './seats.ts'

/** The slot key the tool-call card lives on. */
const TOOLVIEW_SLOT = 'tool.call.toolview'

/** Props this view understands; every field is optional because the owner's shape is not ours. */
export interface CanvasToolViewProps {
  /** The wire tool name, in whichever field the owner uses. */
  name?: unknown
  toolName?: unknown
  /** How the call stands, in whichever field the owner uses. */
  status?: unknown
  state?: unknown
  running?: unknown
  /** The call's arguments and its outcome, in whichever field the owner uses. */
  args?: unknown
  arguments?: unknown
  input?: unknown
  result?: unknown
  output?: unknown
  error?: unknown
  /** The framework-injected translate seat of this package's namespace, when the seat carries one. */
  t?: Translate
  children?: ReactNode
}

const CANDIDATES = {
  name: ['name', 'toolName', 'tool', 'id'],
  status: ['status', 'state', 'phase'],
  args: ['args', 'arguments', 'input', 'parameters'],
  result: ['result', 'output', 'value'],
  error: ['error', 'failure'],
} as const

/** Read the first present, non-empty field of one candidate group. */
function pick(props: CanvasToolViewProps, group: keyof typeof CANDIDATES): unknown {
  for (const key of CANDIDATES[group]) {
    const value = (props as Record<string, unknown>)[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

/** A short, safe rendering of any value the owner passed. */
function short(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value.length > 240 ? `${value.slice(0, 240)}…` : value
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.length > 240 ? `${text.slice(0, 240)}…` : text
  } catch {
    return String(value)
  }
}

/**
 * Render one canvas tool call.
 *
 * The frames are the only thing this view owns: the tool name, whether the call
 * is still running, and whatever came back. Nothing here re-derives a board.
 *
 * @param props - the seat's props, read defensively (see the module note).
 * @returns the card, or `null` when the props name no tool this view knows.
 */
export function CanvasToolView(props: CanvasToolViewProps) {
  const name = typeof pick(props, 'name') === 'string' ? (pick(props, 'name') as string) : ''
  const t = props.t
  const label = t === undefined ? name : t('canvas.tool.title', { name })

  const status = pick(props, 'status')
  const error = pick(props, 'error')
  const result = pick(props, 'result')
  const running = props.running === true || status === 'running' || status === 'pending'

  const phase =
    error !== undefined
      ? t === undefined
        ? short(error)
        : t('canvas.tool.failed', { message: short(error) })
      : running
        ? (t?.('canvas.tool.pending') ?? '')
        : short(result)

  return (
    <div className="dsh-canvas-panel">
      <div className="dsh-canvas-panel-head">
        <span className="dsh-canvas-panel-title">{label}</span>
        <span className="dsh-canvas-dot" data-state={error !== undefined ? 'missing' : running ? 'running' : 'idle'} />
      </div>
      {phase === '' ? null : <div className="dsh-canvas-field-value">{phase}</div>}
      {short(pick(props, 'args')) === '' ? null : (
        <div className="dsh-canvas-block">
          <span className="dsh-canvas-eyebrow">args</span>
          <div className="dsh-canvas-field-value">{short(pick(props, 'args'))}</div>
        </div>
      )}
    </div>
  )
}

/**
 * Take over the rendering of every `canvas.*` tool call.
 *
 * One keyed entry per tool name, so a board call renders as a canvas card and
 * every other tool keeps whatever the product already gives it.
 *
 * @param ctx - the client root context.
 * @returns nothing; the contributions live and die with the caller's fiber.
 */
export function registerToolViews(ctx: ClientContext): void {
  const seats = foreignSeats(ctx)
  const names = Object.values(TOOL_NAMES)

  ctx.effect(
    () =>
      seats.inject(TOOLVIEW_SLOT, () => {
        const disposers = names.map((name) =>
          seats.register({ name: TOOLVIEW_SLOT, key: name }, (props: never) => (
            <CanvasToolView {...(props as CanvasToolViewProps)} />
          )),
        )
        return () => {
          for (const dispose of disposers) dispose()
        }
      }),
    'dsh-canvas: tool views',
  )
}
