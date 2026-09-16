/**
 * dsh-canvas — Client plugin entry (browser half).
 *
 * The boot order here is not incidental; it is the whole file:
 *
 * 1. The stylesheet and the dictionaries go first, because every seat
 *    registered below renders copy and needs its classes to exist.
 * 2. The seats are registered **synchronously**, before the Remote mount
 *    resolves. A registration that waited on an `await` could miss its seat's
 *    declaration and silently never render, so the bridge is created empty and
 *    attached to once the namespaces arrive — a call made in the gap reports
 *    that plainly instead of throwing a property error.
 * 3. Only then is the Remote mounted, and the last thing is the wiring that
 *    needs the mounted faces.
 *
 * Everything runs through `ctx.effect`, so unloading the plugin takes the
 * dictionaries, the tab types, the seats and the in-flight calls with it and
 * leaves the product exactly as it was.
 */
import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { DSH_CANVAS_REMOTE } from './remote.ts'
import { NS, en, zh } from './locales.ts'
import { CanvasBridge } from './bridge.ts'
import { adoptStyles } from './styles.ts'
import { registerCanvasTabs } from './canvas-tab.ts'
import { registerToolViews } from './tool-view.tsx'
import { CardSessionView, type CardSessionViewProps } from './card-panel.tsx'
import { foreignSeats } from './seats.ts'

/** Required browser services: the Remote gateway, copy, sessions, and both sidebar halves. */
export const inject = ['slots', 'remote', 'locale', 'sessions', 'sidebarRight', 'sidebarRightTabs']

/**
 * The seat the card's face rides in the conversation view ring.
 *
 * Owned by the conversation package, which is not a dependency here, so it is
 * addressed through `seats.ts` and contributed only if the seat exists.
 */
const CONVERSATION_VIEW_SLOT = 'conversation.view'

/**
 * Read the two services this half needs off a context that declares one of them
 * twice.
 *
 * Both halves of the harness ship a package registering a Context member under
 * the key `sessions` — a `SessionStore` on the host, an `ISessions` read face in
 * the browser — so a program with both installed merges to the host's type. The
 * browser half is what runs here, so it says so once, here, rather than casting
 * at each use.
 *
 * @param ctx - the client root context.
 * @returns the browser faces of the sessions domain and the Remote gateway.
 */
function clientFaces(ctx: ClientContext): { sessions: ISessions; remote: TypertClientRemote } {
  return ctx as unknown as { sessions: ISessions; remote: TypertClientRemote }
}

/** Start the canvas: copy, seats, Remote, wiring. */
export function apply(ctx: ClientContext): void {
  adoptStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-canvas: dictionaries')

  // One abort signal for every call this plugin makes: unloading cancels the
  // in-flight board reads rather than letting them resolve into a dead tree.
  const abort = new AbortController()
  ctx.effect(() => () => abort.abort(), 'dsh-canvas: remote calls')

  const bridge = new CanvasBridge(abort.signal)
  const t = ctx.locale.bind(NS)
  const faces = clientFaces(ctx)

  // ── seats (synchronous, so no declaration can be missed) ──────────────────

  const roots = registerCanvasTabs(ctx, {
    bridge,
    activateSession: (sessionId: string) => faces.sessions.open(sessionId as SessionId),
    cardSession: (sessionId: string) => faces.sessions.binding(sessionId as SessionId)?.session,
  })

  registerToolViews(ctx)

  const seats = foreignSeats(ctx)
  ctx.effect(
    () =>
      seats.inject(CONVERSATION_VIEW_SLOT, () =>
        seats.register(
          {
            name: CONVERSATION_VIEW_SLOT,
            id: 'dsh-canvas:card',
            order: 30,
            label: () => ctx.locale.bind(NS)('canvas.view.label'),
            inject: () => ({
              bridge,
              t,
              openResource: (address: string) => ctx.sidebarRight.openResource(address),
            }),
          },
          // The seat is contributed through `seats.ts` because its owner is not
          // a dependency, so its props arrive untyped and the component's own
          // interface — framework `sessionId` plus this entry's inject face —
          // is what describes them.
          (props: never) => <CardSessionView {...(props as unknown as CardSessionViewProps)} />,
        ),
      ),
    'dsh-canvas: card view',
  )

  // ── Remote mount ──────────────────────────────────────────────────────────

  ctx.effect(async () => {
    const dispose = await faces.remote.$mount(DSH_CANVAS_REMOTE)
    bridge.attach(faces.remote.canvas, faces.remote.card)
    // Warm the project-root cache: it is what the tab types' `canOpen` veto
    // consults, and it must already hold an answer by the first routing
    // decision rather than the one after it.
    void roots.refresh()
    return () => {
      void dispose()
    }
  }, 'dsh-canvas: remote')
}
