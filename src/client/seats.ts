/**
 * dsh-canvas — contributing to seats this package does not own.
 *
 * Two of the surfaces the product doc places the canvas on belong to other
 * packages: the conversation view ring (`conversation.view`) and the tool-call
 * card (`tool.call.toolview`). Neither package is a dependency of this one, so
 * their entries in `SlotMap` cannot be read — and declaring them here would be
 * this package claiming to own a contract it does not.
 *
 * What the runtime actually requires is a string key. This module is the single
 * place that says so out loud, and it is what lets every one of these
 * contributions go through `slots.inject`: if the owning package is absent, the
 * seat is never declared, the callback never runs, and the canvas simply does
 * not contribute. Absence is a no-op, never a crash.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReactNode } from 'react'

/** One registration, at the level of detail this package needs. */
export interface ForeignRegistration {
  /** The seat being contributed into. */
  name: string
  /** `list` seats identify an entry by id; `keyed` seats by key. */
  id?: string
  key?: string
  /** `list` seats order entries by this. */
  order?: number
  /** `list` seats read a thunked label so a language change needs no re-registration. */
  label?: () => string
  /** The registrant's injected business face. */
  inject?: () => object
}

/** The registry surface used for foreign seats. */
export interface ForeignSeats {
  /** Run the callback once the seat exists; a no-op while it never does. */
  inject(key: string, callback: () => () => void): () => void
  register(options: ForeignRegistration, component: (props: never) => ReactNode): () => void
}

/**
 * View the slot registry at its string-keyed runtime contract.
 *
 * @param ctx - the client root context.
 * @returns the same registry, typed for seats this package does not own.
 */
export function foreignSeats(ctx: ClientContext): ForeignSeats {
  return ctx.slots as unknown as ForeignSeats
}
