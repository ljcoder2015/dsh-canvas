/**
 * dsh-canvas — the browser half's stylesheet.
 *
 * One injected sheet, one class prefix (`dsh-canvas-`), no global selectors and
 * no element resets: the canvas lives inside a host pane it does not own.
 *
 * Colour rides the host's theme tokens first and falls back to the canvas's own
 * dark working surface second, so the board follows a themed deployment while
 * still rendering correctly in one that ships no tokens. The tokens are the
 * confirmed canvas system: a single dark surface with no shadows, layered by
 * hairlines, buttons always capsules, and exactly four accents —
 * sunset (running), dusk, twilight (has news) and breeze (material edges).
 */
const STYLE_ID = 'dsh-canvas-styles'

const css = `
.dsh-canvas-root{
  --dsh-surface:var(--dsw-alias-bg-base,#0A0A0A);
  --dsh-card:var(--dsw-alias-bg-elevated,#191919);
  --dsh-soft:#1A1C20;
  --dsh-slot:#0E0F12;
  --dsh-hairline:var(--dsw-alias-border-secondary,#212327);
  --dsh-mid:#363A3F;
  --dsh-fg:var(--dsw-alias-label-primary,#FFFFFF);
  --dsh-fg-2:#DADBDF;
  --dsh-fg-3:var(--dsw-alias-label-secondary,#7D8187);
  --dsh-sunset:#FF7A17;
  --dsh-dusk:#7C3AED;
  --dsh-twilight:#C4B5FD;
  --dsh-breeze:#A0C3EC;
  --dsh-font:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI","Noto Sans SC",sans-serif;
  --dsh-mono:ui-monospace,"Geist Mono","SF Mono",Menlo,monospace;
  position:absolute;inset:0;display:flex;flex-direction:column;min-width:0;min-height:0;
  background:var(--dsh-surface);color:var(--dsh-fg);font:13px/20px var(--dsh-font);
  -webkit-font-smoothing:antialiased;
}

/* ── header ─────────────────────────────────────────────────────────────── */
.dsh-canvas-head{display:flex;align-items:center;gap:8px;height:40px;padding:0 10px;flex:none;border-bottom:1px solid var(--dsh-hairline)}
.dsh-canvas-picker-btn{display:flex;align-items:center;gap:6px;min-width:0;padding:4px 10px;border:1px solid var(--dsh-hairline);border-radius:999px;background:transparent;color:var(--dsh-fg);font:500 12px/18px var(--dsh-font);cursor:pointer}
.dsh-canvas-picker-btn:hover{background:var(--dsh-soft)}
.dsh-canvas-picker-btn[disabled]{opacity:.5;cursor:default}
.dsh-canvas-picker-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px}
.dsh-canvas-stats{margin-left:auto;font:500 10px/14px var(--dsh-mono);letter-spacing:1.3px;color:var(--dsh-fg-3);text-transform:uppercase;white-space:nowrap}

/* ── surface ────────────────────────────────────────────────────────────── */
.dsh-canvas-body{position:relative;flex:1 1 auto;min-height:0;overflow:hidden}
.dsh-canvas-surface{position:absolute;inset:0;overflow:hidden;cursor:grab;
  background-image:radial-gradient(circle,var(--dsh-hairline) 1px,transparent 1px);
  background-size:calc(28px * var(--dsh-z)) calc(28px * var(--dsh-z));
  background-position:calc(var(--dsh-px) + 14px) calc(var(--dsh-py) + 14px)}
.dsh-canvas-surface.is-panning{cursor:grabbing}
.dsh-canvas-surface.is-linking{cursor:crosshair}
.dsh-canvas-layer{position:absolute;left:0;top:0;transform-origin:0 0}

/* ── card ───────────────────────────────────────────────────────────────── */
.dsh-canvas-card{position:absolute;width:200px;height:140px;box-sizing:border-box;display:flex;flex-direction:column;
  border:1px solid var(--dsh-hairline);border-radius:8px;background:var(--dsh-card);overflow:hidden;user-select:none;
  transition:border-color .12s ease,background .12s ease}
.dsh-canvas-card:hover{border-color:var(--dsh-mid)}
.dsh-canvas-card.is-selected{background:var(--dsh-soft);border-color:var(--dsh-mid)}
.dsh-canvas-card.is-absent .dsh-canvas-card-preview{opacity:.35}
.dsh-canvas-card-preview{height:76px;flex:none;box-sizing:border-box;padding:8px 10px;overflow:hidden;background:var(--dsh-slot);border-bottom:1px solid var(--dsh-hairline)}
.dsh-canvas-card-preview-line{font:11px/15px var(--dsh-mono);color:var(--dsh-fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-canvas-card-preview-line:first-child{color:var(--dsh-fg-2)}
.dsh-canvas-card-foot{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;gap:2px;padding:0 10px;min-width:0}
.dsh-canvas-card-name{font:500 12px/16px var(--dsh-font);color:var(--dsh-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-canvas-card-meta{font:10px/14px var(--dsh-mono);letter-spacing:.6px;color:var(--dsh-fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-canvas-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsh-fg-3)}
.dsh-canvas-dot[data-state=running]{background:var(--dsh-sunset)}
.dsh-canvas-dot[data-state=notified]{background:var(--dsh-twilight)}
.dsh-canvas-dot[data-state=idle]{background:var(--dsh-mid)}
.dsh-canvas-dot[data-state=missing]{background:var(--dsh-fg-3);opacity:.5}
.dsh-canvas-status{display:inline-flex;align-items:center;gap:5px;min-width:0}
.dsh-canvas-port{position:absolute;top:50%;width:16px;height:16px;margin-top:-8px;border-radius:50%;
  border:1px solid var(--dsh-mid);background:var(--dsh-surface);color:var(--dsh-fg-3);
  font:11px/14px var(--dsh-mono);text-align:center;cursor:crosshair;opacity:0}
.dsh-canvas-card:hover .dsh-canvas-port{opacity:1}
.dsh-canvas-port:hover{border-color:var(--dsh-breeze);color:var(--dsh-breeze)}
.dsh-canvas-port[data-side=in]{left:-8px}
.dsh-canvas-port[data-side=out]{right:-8px}

/* ── edges ──────────────────────────────────────────────────────────────── */
.dsh-canvas-edges{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.dsh-canvas-edge{fill:none;stroke:var(--dsh-breeze);stroke-width:1.5;stroke-dasharray:5 5;stroke-linecap:round}
.dsh-canvas-edge.is-active{stroke-width:2.5;stroke-dasharray:none}
.dsh-canvas-edge-hit{fill:none;stroke:transparent;stroke-width:16;pointer-events:stroke;cursor:pointer}

/* ── note ───────────────────────────────────────────────────────────────── */
.dsh-canvas-note{position:absolute;width:180px;box-sizing:border-box;padding:10px;border-radius:8px;
  border:1px solid var(--dsh-hairline);background:var(--dsh-card);color:var(--dsh-fg-2);font:12px/18px var(--dsh-font);white-space:pre-wrap;word-break:break-word}
.dsh-canvas-note-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;
  font:500 9px/12px var(--dsh-mono);letter-spacing:1.3px;text-transform:uppercase;color:var(--dsh-fg-3)}

/* ── card session overlay ───────────────────────────────────────────────── */
.dsh-canvas-overlay{position:absolute;width:380px;box-sizing:border-box;padding:10px 12px;border-radius:8px;
  border:1px solid var(--dsh-mid);background:var(--dsh-card)}
.dsh-canvas-overlay-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;
  font:500 9px/12px var(--dsh-mono);letter-spacing:1.3px;text-transform:uppercase;color:var(--dsh-fg-3)}
.dsh-canvas-overlay-head .dsh-canvas-spacer{margin-left:auto}
.dsh-canvas-overlay-line{font:12px/18px var(--dsh-font);color:var(--dsh-fg-2);max-height:36px;overflow:hidden}
.dsh-canvas-overlay-line.is-muted{color:var(--dsh-fg-3)}

/* ── floating chrome ────────────────────────────────────────────────────── */
.dsh-canvas-toolbar{position:absolute;display:flex;align-items:center;gap:2px;padding:4px;border-radius:999px;
  border:1px solid var(--dsh-hairline);background:var(--dsh-card)}
.dsh-canvas-toolbar.is-horizontal{flex-direction:row}
.dsh-canvas-chipbtn{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 12px;border:none;border-radius:999px;
  background:transparent;color:var(--dsh-fg-2);font:500 12px/16px var(--dsh-font);cursor:pointer;white-space:nowrap}
.dsh-canvas-chipbtn:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
.dsh-canvas-chipbtn[data-primary=true]{background:var(--dsh-sunset);color:#0A0A0A}
.dsh-canvas-chipbtn[data-primary=true]:hover{filter:brightness(1.08);background:var(--dsh-sunset)}
.dsh-canvas-chipbtn[disabled]{opacity:.45;cursor:default}
.dsh-canvas-chipbtn svg{display:block}
.dsh-canvas-zoombar{position:absolute;right:12px;bottom:12px;display:flex;flex-direction:column;gap:2px;padding:4px;border-radius:999px;
  border:1px solid var(--dsh-hairline);background:var(--dsh-card)}
.dsh-canvas-iconbtn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:50%;
  background:transparent;color:var(--dsh-fg-2);cursor:pointer}
.dsh-canvas-iconbtn:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
.dsh-canvas-zoomlevel{font:500 10px/28px var(--dsh-mono);color:var(--dsh-fg-3);text-align:center;letter-spacing:.6px}
.dsh-canvas-minimap{position:absolute;left:12px;bottom:12px;width:132px;height:84px;box-sizing:border-box;
  border:1px solid var(--dsh-hairline);border-radius:8px;background:var(--dsh-slot);overflow:hidden}
.dsh-canvas-minimap-card{position:absolute;width:10px;height:7px;border-radius:1px;background:var(--dsh-mid)}
.dsh-canvas-minimap-card.is-selected{background:var(--dsh-sunset)}

/* ── empty / error ──────────────────────────────────────────────────────── */
.dsh-canvas-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;color:var(--dsh-fg-3)}
.dsh-canvas-empty-title{font:500 13px/20px var(--dsh-font);color:var(--dsh-fg-2)}
.dsh-canvas-error{position:absolute;left:12px;right:12px;top:12px;padding:8px 12px;border-radius:8px;
  border:1px solid var(--dsh-hairline);background:var(--dsh-card);color:var(--dsh-twilight);font:12px/18px var(--dsh-mono)}

/* ── folder picker ──────────────────────────────────────────────────────── */
.dsh-canvas-scrim{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:5}
.dsh-canvas-dialog{width:min(520px,100%);max-height:100%;display:flex;flex-direction:column;border:1px solid var(--dsh-hairline);
  border-radius:8px;background:var(--dsh-card);overflow:hidden}
.dsh-canvas-dialog-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsh-hairline);
  font:500 12px/18px var(--dsh-font);color:var(--dsh-fg)}
.dsh-canvas-dialog-path{padding:8px 14px;border-bottom:1px solid var(--dsh-hairline);font:10px/16px var(--dsh-mono);
  letter-spacing:.6px;color:var(--dsh-fg-3);word-break:break-all}
.dsh-canvas-dialog-list{flex:1 1 auto;overflow:auto;padding:6px}
.dsh-canvas-row{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:7px 10px;border:none;border-radius:8px;
  background:transparent;color:var(--dsh-fg-2);font:12px/18px var(--dsh-font);text-align:left;cursor:pointer}
.dsh-canvas-row:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
.dsh-canvas-row-meta{margin-left:auto;font:10px/14px var(--dsh-mono);color:var(--dsh-fg-3)}
.dsh-canvas-dialog-foot{display:flex;align-items:center;gap:8px;padding:12px 14px;border-top:1px solid var(--dsh-hairline)}
.dsh-canvas-input{flex:1 1 auto;height:28px;box-sizing:border-box;padding:0 10px;border:1px solid var(--dsh-hairline);border-radius:999px;
  background:var(--dsh-slot);color:var(--dsh-fg);font:12px/18px var(--dsh-font)}
.dsh-canvas-input:focus{outline:none;border-color:var(--dsh-mid)}

/* ── card panel (conversation view ring) ────────────────────────────────── */
.dsh-canvas-panel{display:flex;flex-direction:column;gap:16px;padding:20px;overflow:auto;height:100%;box-sizing:border-box;color:var(--dsh-fg);
  background:var(--surface-primary,var(--dsh-surface));font:13px/20px var(--dsh-font)}
.dsh-canvas-panel-head{display:flex;align-items:center;gap:10px;min-width:0}
.dsh-canvas-panel-title{font:500 14px/20px var(--dsh-font);color:var(--dsh-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-canvas-eyebrow{font:500 9px/14px var(--dsh-mono);letter-spacing:1.4px;text-transform:uppercase;color:var(--dsh-fg-3)}
.dsh-canvas-fields{display:flex;flex-direction:column;gap:6px}
.dsh-canvas-field{display:flex;gap:10px;min-width:0}
.dsh-canvas-field-key{flex:none;width:64px;font:9px/18px var(--dsh-mono);letter-spacing:1.2px;text-transform:uppercase;color:var(--dsh-fg-3)}
.dsh-canvas-field-value{flex:1 1 auto;min-width:0;font:12px/18px var(--dsh-mono);color:var(--dsh-fg-2);word-break:break-all}
.dsh-canvas-block{border:1px solid var(--dsh-hairline);border-radius:8px;background:var(--dsh-card);padding:10px 12px}
.dsh-canvas-block .dsh-canvas-eyebrow{margin-bottom:8px;display:block}
.dsh-canvas-chain{display:flex;flex-direction:column;gap:6px}
.dsh-canvas-chain-row{display:flex;align-items:center;gap:8px;min-width:0;font:12px/18px var(--dsh-font);color:var(--dsh-fg-2)}
.dsh-canvas-chain-arrow{color:var(--dsh-breeze);font:12px/18px var(--dsh-mono)}
.dsh-canvas-muted{color:var(--dsh-fg-3)}
.dsh-canvas-panel-actions{display:flex;flex-wrap:wrap;gap:6px}
`

/** Inject the canvas stylesheet once. */
export function adoptStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = css
  document.head.appendChild(style)
}
