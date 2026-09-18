/**
 * dsh-canvas — the browser half's stylesheet.
 *
 * One injected sheet, one class prefix (`dsh-canvas-`), no element resets, and
 * exactly two global selectors (the sidebar rail rules at the foot, which must
 * reach a host-rendered button): the canvas lives inside a host pane it does
 * not own.
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

/* ── surface ────────────────────────────────────────────────────────────── */
/* 画布没有头部：命名、新建与切换画布都归左栏的画布管理区，页面只留画布本体，
   所以这一层就是整块画布，从第一个像素起都能按住空格拖动。

   指针的两套语义在这里分工：**默认是选择箭头**（点卡片即选中，拖卡片即移动），
   平移要按住空格——那时整块表面（含卡片与端口）都换成抓手，拖动的是取景框而不是
   卡片。空格按住这件事由 canvas-view 记成 is-space 这个类。 */
.dsh-canvas-body{position:relative;flex:1 1 auto;min-height:0;overflow:hidden}
.dsh-canvas-surface{position:absolute;inset:0;overflow:hidden;cursor:default;
  background-image:radial-gradient(circle,var(--dsh-hairline) 1px,transparent 1px);
  background-size:calc(28px * var(--dsh-z)) calc(28px * var(--dsh-z));
  background-position:calc(var(--dsh-px) + 14px) calc(var(--dsh-py) + 14px)}
/* 空格按住：整块表面连同卡片都变抓手（端口除外——它是取材的手势，别被覆盖）。 */
.dsh-canvas-surface.is-space,.dsh-canvas-surface.is-space .dsh-canvas-card{cursor:grab}
.dsh-canvas-surface.is-panning,.dsh-canvas-surface.is-panning .dsh-canvas-card{cursor:grabbing}
.dsh-canvas-surface.is-linking{cursor:crosshair}
.dsh-canvas-layer{position:absolute;left:0;top:0;transform-origin:0 0}

/* ── card ───────────────────────────────────────────────────────────────── */
/* 节点样式对齐参考稿：标题行在顶（只有名字，没有状态点），预览铺满其余全部，
   取材端口悬在左右两侧的垂直中点。卡上不解释状态——运行由流光说，静止就是
   「没事发生」；边框只归用户自己的两个动作（悬停、选中）。 */
.dsh-canvas-card{position:absolute;width:200px;height:140px;box-sizing:border-box;display:flex;flex-direction:column;
  border:1px solid var(--dsh-hairline);border-radius:8px;background:var(--dsh-card);user-select:none;
  transition:border-color .12s ease,background .12s ease}
.dsh-canvas-card:hover{border-color:var(--dsh-mid)}
.dsh-canvas-card.is-selected{background:var(--dsh-soft);border-color:var(--dsh-mid)}
.dsh-canvas-card.is-absent .dsh-canvas-card-preview{opacity:.35}
/* 生成中（会话 running）：整张卡片亮起**流光**——一道斜切 25° 的光带从左扫到右，
   1.8s 一趟，不停顿。名字与预览照常显示（陈旧不等于假：卡上留着的是最近一次真正
   存在过的产物），光的往复本身就是「正在产出新内容」的整句话。卡面只微亮一档、
   边框不变色：边框归悬停与选中，随运行变色会让卡片看起来像被框起来警告。

   光带画在独立的子层 .dsh-canvas-shimmer 上，不用卡片自己的 ::after：卡片不能
   overflow:hidden——两个取材端口是悬在卡外的，裁了就没法拖线了。 */
.dsh-canvas-card.is-working{background:var(--dsh-slot)}
.dsh-canvas-shimmer{position:absolute;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none}
.dsh-canvas-shimmer::after{content:'';position:absolute;top:0;left:0;width:100%;height:100%;
  background:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.08) 40%,
    rgba(255,255,255,.16) 50%,rgba(255,255,255,.08) 60%,rgba(255,255,255,0) 100%);
  transform:skewX(-25deg) translateX(-120%);animation:dsh-canvas-shimmer 1.8s linear infinite}
.dsh-canvas-card-head{flex:none;display:flex;align-items:center;gap:6px;padding:7px 10px 5px;min-width:0}
.dsh-canvas-card-name{flex:1 1 auto;min-width:0;font:500 12px/16px var(--dsh-font);color:var(--dsh-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-canvas-card-preview{flex:1 1 auto;min-height:0;box-sizing:border-box;padding:0 10px 8px;overflow:hidden;background:var(--dsh-card)}
.dsh-canvas-card-preview-line{font:11px/16px var(--dsh-mono);color:var(--dsh-fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-canvas-card-preview-line:first-child{color:var(--dsh-fg-2)}
.dsh-canvas-card-meta{font:10px/14px var(--dsh-mono);letter-spacing:.6px;color:var(--dsh-fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 状态点只剩左侧的实时卡片（tool-view.tsx）在用——画布卡片上那枚已经去掉：
   那边用流光说「在跑」，不再用灯。 */
.dsh-canvas-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsh-fg-3)}
.dsh-canvas-dot[data-state=running]{background:var(--dsh-sunset);animation:dsh-canvas-pulse 1.4s ease-in-out infinite}
.dsh-canvas-dot[data-state=notified]{background:var(--dsh-twilight)}
.dsh-canvas-dot[data-state=idle]{background:var(--dsh-mid)}
.dsh-canvas-dot[data-state=missing]{background:var(--dsh-fg-3);opacity:.5}
.dsh-canvas-port{position:absolute;top:50%;width:16px;height:16px;margin-top:-8px;border-radius:50%;
  border:1px solid var(--dsh-mid);background:var(--dsh-surface);color:var(--dsh-fg-3);
  font:11px/14px var(--dsh-mono);text-align:center;cursor:crosshair;opacity:0}
.dsh-canvas-card:hover .dsh-canvas-port{opacity:1}
.dsh-canvas-card.is-selected .dsh-canvas-port{opacity:1}
.dsh-canvas-port:hover{border-color:var(--dsh-breeze);color:var(--dsh-breeze)}
/* 端口整体悬在卡片外侧，与卡片边缘留 12px 间距（16px 端口 + 12px 间隙 = 28px）。 */
.dsh-canvas-port[data-side=in]{left:-28px}
.dsh-canvas-port[data-side=out]{right:-28px}

/* ── edges ──────────────────────────────────────────────────────────────── */
.dsh-canvas-edges{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
/* 取材线只有一副样子：1px 细线、实线、无箭头、breeze 色。**拖拽中的那一根也是这副
   样子**——它就是这条线本身，只是另一头还跟着手，所以这里没有 pending 变体（那个类
   只作工具标记）。整层 pointer-events:none：线只负责看，永远不拦指针。 */
.dsh-canvas-edge{fill:none;stroke:var(--dsh-breeze);stroke-width:1;stroke-linecap:round;opacity:.85}
/* 选中卡片时它的连线提亮一档：只动不透明度，线型与常态完全一致。 */
.dsh-canvas-edge.is-active{opacity:1}

/* 线放到空白处放手时开的那张「新增节点」：钉在放手点（画布坐标）上，随画布一起
   平移；外层用 scale(1/z) 抵消取景缩放，字号不随视图变。弹层往屏上空间更大的那一
   侧张开（flip 在放手那一刻算定），线头因此不会被弹层自己盖住。 */
.dsh-canvas-dropzone{position:absolute;transform:scale(var(--dsh-inv,1));transform-origin:0 0}
.dsh-canvas-dropmenu{position:absolute;left:0;top:0;z-index:7;transform:translate(10px,10px)}
.dsh-canvas-dropmenu[data-flip-x=true]{transform:translate(calc(-100% - 10px),10px)}
.dsh-canvas-dropmenu[data-flip-y=true]{transform:translate(10px,calc(-100% - 10px))}
.dsh-canvas-dropmenu[data-flip-x=true][data-flip-y=true]{transform:translate(calc(-100% - 10px),calc(-100% - 10px))}
.dsh-canvas-dropmenu-title{padding:4px 10px 5px;font:500 10px/14px var(--dsh-mono);letter-spacing:1.2px;
  text-transform:uppercase;color:var(--dsh-fg-3)}
.dsh-canvas-dropmenu-hint{padding:5px 10px 4px;font:11px/16px var(--dsh-font);color:var(--dsh-fg-3)}

/* ── note ───────────────────────────────────────────────────────────────── */
.dsh-canvas-note{position:absolute;width:180px;box-sizing:border-box;padding:10px;border-radius:8px;
  border:1px solid var(--dsh-hairline);background:var(--dsh-card);color:var(--dsh-fg-2);font:12px/18px var(--dsh-font);white-space:pre-wrap;word-break:break-word}
.dsh-canvas-note-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;
  font:500 9px/12px var(--dsh-mono);letter-spacing:1.3px;text-transform:uppercase;color:var(--dsh-fg-3)}

/* ── card session overlay / composer ─────────────────────────────────────── */
.dsh-canvas-overlay{position:absolute;width:380px;box-sizing:border-box;padding:10px 12px;border-radius:8px;
  border:1px solid var(--dsh-mid);background:var(--dsh-card)}
.dsh-canvas-overlay-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;
  font:500 9px/12px var(--dsh-mono);letter-spacing:1.3px;text-transform:uppercase;color:var(--dsh-fg-3)}
.dsh-canvas-overlay-head .dsh-canvas-spacer{margin-left:auto}
.dsh-canvas-spacer{margin-left:auto}

/* 选中卡片下方的那条控制带：取材 chips 与 ⊕ 引入入口 → 提示词输入框 → 模型席位、
   状态点与发送。chips 是「一条 chip = 一条取材边」，所以每枚右上角都挂着自己的删除钮
   （卡片上没有 overflow:hidden，角标才探得出去；文字的截断交给内部的 label）。 */
.dsh-canvas-composer{display:flex;flex-direction:column;gap:8px}
.dsh-canvas-composer-materials{display:flex;align-items:center;flex-wrap:wrap;gap:7px}
.dsh-canvas-chip{position:relative;display:inline-flex;align-items:center;max-width:170px;height:26px;box-sizing:border-box;
  padding:0 8px 0 12px;border:1px solid color-mix(in srgb,var(--dsh-breeze) 45%,transparent);border-radius:999px;
  font:12px/24px var(--dsh-font);color:var(--dsh-breeze)}
.dsh-canvas-chip-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-canvas-chipdrop{position:absolute;top:-6px;right:-6px;display:inline-flex;align-items:center;justify-content:center;
  width:16px;height:16px;box-sizing:border-box;padding:0;border:1px solid var(--dsh-mid);border-radius:50%;
  background:var(--dsh-card);color:var(--dsh-fg-3);font:11px/1 var(--dsh-font);cursor:pointer;z-index:1}
.dsh-canvas-chipdrop:hover{background:var(--dsh-sunset);border-color:var(--dsh-sunset);color:#0A0A0A}
.dsh-canvas-composer-materialzone{position:relative;display:inline-flex}
.dsh-canvas-composer-materialzone .dsh-canvas-chipbtn{height:26px;padding:0 9px;font:14px/24px var(--dsh-font)}
.dsh-canvas-menu.is-raised{position:absolute;left:0;bottom:28px;z-index:7;box-shadow:none}
.dsh-canvas-composer-menuempty{display:block;padding:7px 10px;font:12px/18px var(--dsh-font);color:var(--dsh-fg-3);white-space:nowrap}
.dsh-canvas-composer-expand{margin-left:auto}
.dsh-canvas-composer-input{flex:none;box-sizing:border-box;width:100%;min-height:54px;max-height:120px;padding:6px 10px;resize:none;
  border:1px solid var(--dsh-hairline);border-radius:8px;background:var(--dsh-slot);
  color:var(--dsh-fg);font:12px/18px var(--dsh-font)}
.dsh-canvas-composer-input:focus{outline:none;border-color:var(--dsh-mid)}
.dsh-canvas-composer-input.is-modal{flex:1 1 auto;min-height:0;max-height:none;font:13px/21px var(--dsh-font)}
.dsh-canvas-composer-foot{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-canvas-modelzone{position:relative;display:inline-flex;flex:none}
.dsh-canvas-modelbtn{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 9px;border:none;border-radius:999px;
  background:transparent;color:var(--dsh-fg-3);font:500 11px/22px var(--dsh-font);cursor:pointer;white-space:nowrap;max-width:150px;
  overflow:hidden;text-overflow:ellipsis}
.dsh-canvas-modelbtn:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
.dsh-canvas-modelmenu{left:0;bottom:26px;max-height:280px;overflow:auto;z-index:8}
.dsh-canvas-modelgroup{padding:6px 8px 3px;font:500 9px/12px var(--dsh-mono);letter-spacing:1.2px;text-transform:uppercase;color:var(--dsh-fg-3)}
.dsh-canvas-menu .dsh-canvas-row[data-current=true]{color:var(--dsh-fg)}
.dsh-canvas-menu .dsh-canvas-row[data-current=true]::after{content:'✓';margin-left:auto;color:var(--dsh-sunset)}

/* 全屏提示词弹窗：这是**唯一**写提示词的地方（⤢），不是跳转到会话聊天页。 */
.dsh-canvas-scrim.is-modal{z-index:8}
.dsh-canvas-promptmodal{width:min(720px,100%);height:min(480px,100%)}
.dsh-canvas-promptmodal .dsh-canvas-dialog-head .dsh-canvas-chipbtn{margin-left:auto}

/* ── fullscreen artifact viewer (F3.8) ──────────────────────────────────── */
/* 双击卡片打开：一块近满屏的对话框，内容按形态各由各的组件渲染。
   内边距只给正文；图片 / 视频 / iframe 要尽量大，其余要能滚。 */
.dsh-canvas-scrim.is-viewer{z-index:9;padding:24px}
.dsh-canvas-viewer{width:min(1080px,100%);height:min(86vh,100%)}
.dsh-canvas-viewer .dsh-canvas-dialog-head{flex:none}
.dsh-canvas-viewer-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:auto}
.dsh-canvas-viewer-truncated{flex:none;padding:7px 16px;border-bottom:1px solid var(--dsh-hairline);
  font:11px/16px var(--dsh-mono);color:var(--dsh-sunset)}
.dsh-canvas-viewer-note{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:24px;
  color:var(--dsh-fg-3);font:13px/20px var(--dsh-font);text-align:center}
.dsh-canvas-media{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto}
.dsh-canvas-media img,.dsh-canvas-media video{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px}
.dsh-canvas-frame{flex:1 1 auto;width:100%;height:100%;border:none;background:#fff}
.dsh-canvas-pre{flex:none;margin:0;padding:16px 20px;font:12px/19px var(--dsh-mono);color:var(--dsh-fg-2);
  white-space:pre-wrap;word-break:break-word}
.dsh-canvas-tablewrap{flex:1 1 auto;min-height:0;padding:12px 16px;overflow:auto}
.dsh-canvas-table{border-collapse:collapse;font:12px/18px var(--dsh-mono);color:var(--dsh-fg-2)}
.dsh-canvas-table th,.dsh-canvas-table td{border:1px solid var(--dsh-hairline);padding:5px 10px;text-align:left;
  max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-canvas-table th{position:sticky;top:0;background:var(--dsh-soft);color:var(--dsh-fg);font-weight:500}

/* Markdown 渲染（markdown 形态的全屏视图）。标记由 renderMarkdown 生成——
   先整体转义再拼标签——所以这里的排版类不会遇到外来属性。 */
.dsh-canvas-md{flex:none;padding:20px 28px 28px;max-width:820px;font:14px/24px var(--dsh-font);color:var(--dsh-fg-2)}
.dsh-canvas-md>*:first-child{margin-top:0}
.dsh-canvas-md h1,.dsh-canvas-md h2,.dsh-canvas-md h3,.dsh-canvas-md h4{margin:26px 0 10px;color:var(--dsh-fg);
  font-weight:600;line-height:1.35}
.dsh-canvas-md h1{font-size:22px}.dsh-canvas-md h2{font-size:18px}
.dsh-canvas-md h3{font-size:15px}.dsh-canvas-md h4{font-size:14px}
.dsh-canvas-md p{margin:10px 0}
.dsh-canvas-md ul,.dsh-canvas-md ol{margin:10px 0;padding-left:22px}
.dsh-canvas-md li{margin:4px 0}
.dsh-canvas-md a{color:var(--dsh-breeze);text-decoration:none}
.dsh-canvas-md a:hover{text-decoration:underline}
.dsh-canvas-md blockquote{margin:12px 0;padding:2px 14px;border-left:3px solid var(--dsh-mid);color:var(--dsh-fg-3)}
.dsh-canvas-md hr{margin:20px 0;border:none;border-top:1px solid var(--dsh-hairline)}
.dsh-canvas-md pre{margin:12px 0;padding:12px 14px;border-radius:8px;background:var(--dsh-slot);
  border:1px solid var(--dsh-hairline);overflow:auto}
.dsh-canvas-md pre code{font:12px/19px var(--dsh-mono);color:var(--dsh-fg-2);background:none;padding:0}
.dsh-canvas-md code{font:12px/19px var(--dsh-mono);background:var(--dsh-soft);border-radius:4px;padding:1px 5px;color:var(--dsh-fg)}

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
.dsh-canvas-zoombar{position:absolute;left:12px;bottom:12px;display:flex;flex-direction:row;align-items:center;gap:2px;padding:4px;border-radius:999px;
  border:1px solid var(--dsh-hairline);background:var(--dsh-card)}
.dsh-canvas-iconbtn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:50%;
  background:transparent;color:var(--dsh-fg-2);cursor:pointer}
.dsh-canvas-iconbtn:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
.dsh-canvas-zoomlevel{font:500 10px/28px var(--dsh-mono);color:var(--dsh-fg-3);text-align:center;letter-spacing:.6px;min-width:34px}
.dsh-canvas-minimap{position:absolute;right:12px;bottom:12px;width:132px;height:84px;box-sizing:border-box;
  border:1px solid var(--dsh-hairline);border-radius:8px;background:var(--dsh-slot);overflow:hidden}
.dsh-canvas-minimap-card{position:absolute;width:10px;height:7px;border-radius:1px;background:var(--dsh-mid)}
.dsh-canvas-minimap-card.is-selected{background:var(--dsh-sunset)}

/* ── bottom dock ────────────────────────────────────────────────────────── */
/* 底部中央的 dock：左「新增」、右「快捷键」，都向上弹层。挂在空态之上
   （DOM 顺序在空态之后），所以空画布上也能点到。 */
.dsh-canvas-dockzone{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:5}
/* 宽度靠 padding 撑开，不要写 width:N%。dockzone 是绝对定位且自身没有宽度
   （shrink-to-fit），dock 的百分比会解析到它身上，与内容互相依赖成循环；
   浏览器按 auto 破环后胶囊只有十几像素，加号的 hover 圆就会溢出胶囊，
   而且菜单开合会带着胶囊宽度一起抖。左右各留 14px，圆钮 hover 时有余量。 */
.dsh-canvas-dock{display:flex;align-items:center;justify-content:center;box-sizing:border-box;height:36px;
  gap:4px;padding:0 14px;border-radius:999px;border:1px solid var(--dsh-hairline);background:var(--dsh-card)}
.dsh-canvas-dockbtn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:50%;
  background:transparent;color:var(--dsh-fg-2);cursor:pointer}
.dsh-canvas-dockbtn:hover{background:var(--dsh-soft);color:var(--dsh-fg)}
/* 新增是 dock 里的主按钮：实心圆 + 画布的强调色（与卡片上那枚 primary 胶囊同源），
   落在一排幽灵钮的最左。写成两个类是为了让底色/尺寸的覆盖稳稳压过 .dsh-canvas-dockbtn
   的幽灵底与 hover（同权重就靠书写顺序，太脆）。 */
.dsh-canvas-dockbtn.dsh-canvas-dockadd{width:26px;height:26px;background:var(--dsh-sunset);color:#0A0A0A}
.dsh-canvas-dockbtn.dsh-canvas-dockadd:hover{background:var(--dsh-sunset);color:#0A0A0A;filter:brightness(1.08)}
.dsh-canvas-dockbtn.dsh-canvas-dockadd:active{filter:brightness(.94)}
.dsh-canvas-menu{display:flex;flex-direction:column;min-width:150px;padding:4px;border-radius:12px;
  border:1px solid var(--dsh-hairline);background:var(--dsh-card)}
.dsh-canvas-menu .dsh-canvas-row svg{flex:none;color:var(--dsh-fg-3)}
/* 快捷键说明弹层：左列键帽、右列动作，一 key 一行。键帽按等宽字排（键位上本来就是
   等宽的手感），宽度用 min-width 兜住单字符；键帽列再钉一个 86px 的下限——一 key
   一行之后行数变多，右列若还各自起头就看不出是一张表了（英文的长键名如
   Double-click 比 86 宽时会自己长出去，宁可那一行不齐也不截字）。 */
.dsh-canvas-keys{min-width:268px;max-width:320px;padding:8px 10px;gap:4px}
.dsh-canvas-keys-title{padding:0 0 3px;font:500 10px/14px var(--dsh-mono);letter-spacing:1.2px;
  text-transform:uppercase;color:var(--dsh-fg-3)}
.dsh-canvas-keys-row{display:flex;align-items:center;gap:8px}
.dsh-canvas-keys-caps{display:flex;align-items:center;gap:3px;flex:none;min-width:86px}
.dsh-canvas-keys-caps kbd{min-width:16px;padding:1px 5px;border:1px solid var(--dsh-hairline);border-radius:4px;
  background:var(--dsh-soft);color:var(--dsh-fg);font:11px/15px var(--dsh-mono);text-align:center;white-space:nowrap}
.dsh-canvas-keys-label{flex:1 1 auto;font:12px/17px var(--dsh-font);color:var(--dsh-fg-2)}

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

/* ── main column seat ───────────────────────────────────────────────────── */
/* 主区域的画布席位。宿主的主栏不自带定位祖先，而画布本体是 position:absolute
   铺满父容器的，所以这一层既要撑满主栏，也要做那个参照。 */
.dsh-canvas-seat{position:relative;display:flex;flex-direction:column;flex:1 1 auto;height:100%;min-width:0;min-height:0;overflow:hidden}

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

/* ── motion ─────────────────────────────────────────────────────────────── */
/* 动作只有一套语义：光在动 = 正在生成。流光一趟 1.8s、匀速不停顿——光带自左
   （-120%，此时只有 gradient 透明的尾巴在卡内）扫到右（+120%），亮点正好从卡上
   横穿一次。 */
@keyframes dsh-canvas-shimmer{from{transform:skewX(-25deg) translateX(-120%)}to{transform:skewX(-25deg) translateX(120%)}}
@keyframes dsh-canvas-pulse{0%,100%{opacity:1}50%{opacity:.3}}
@media (prefers-reduced-motion:reduce){
  /* 减少动态效果下**不熄灭流光**，只把动感降下来：速度减半、光带减淡。曾经的做法是
     animation:none 加光带停在正中——实测那样整张卡片看上去毫无反馈，与「卡住」无从
     区分，而光在动是这张卡唯一的进行中信号（减少，不等于抹掉）。左侧的实时卡片（见
     tool-view）仍按用户偏好停掉状态点的脉动。 */
  .dsh-canvas-shimmer::after{animation-duration:3.6s;opacity:.6}
  .dsh-canvas-dot[data-state=running]{animation:none}
}

/* ── sidebar 画布区（F1.7）──────────────────────────────────────────────── */
/* 画布在左栏是一个包裹：header（标题 + 新建按钮）与画布列表。宿主的面板行只渲染
   一枚按钮（图形 + 文字），塞不下第二枚按钮，也塞不下一棵列表；所以行只在**收起**
   时露面——那时它就是「画布」的图标，点一下即新建；展开态由包裹接管（canvas-nav.tsx
   经 createPortal 把它挂进宿主的列表容器，位置仍在流的原位）。

   取宿主的主题令牌（--dsw-*，都带兜底），因为这一段落在侧栏表面上，不是画布那块
   深色底：侧栏换主题时它跟着换。字号行高对齐宿主的面板行，两段看起来是同一列里
   的东西。 */
.dsh-canvas-navpane{flex:none;display:flex;flex-direction:column;gap:2px}
.dsh-canvas-navhead{display:flex;align-items:center;gap:8px;box-sizing:border-box;min-height:36px;padding:7px 8px;
  color:var(--dsw-alias-label-secondary,#7D8187)}
.dsh-canvas-navtitle{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font:500 14px/22px var(--dsh-font)}
.dsh-canvas-navadd{display:flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;padding:0;
  border:none;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.dsh-canvas-navadd:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.18));color:var(--dsw-alias-label-primary,#fff)}
.dsh-canvas-navlist{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.dsh-canvas-navrow{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 8px 6px 20px;
  border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#7D8187);
  font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.dsh-canvas-navrow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#fff)}
.dsh-canvas-navrow[data-active=true]{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.2));
  color:var(--dsw-alias-label-primary,#fff);font-weight:500}
.dsh-canvas-navname{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-canvas-navempty{padding:2px 8px 6px 20px;font:12px/18px var(--dsh-font);color:var(--dsw-alias-label-secondary,#7D8187);opacity:.7}

/* ── sidebar rail（本表仅有的全局选择器，两条，特此记名）────────────────── */
/* 折叠是宿主在框架元素上发布的一个稳定属性（data-sidebar-collapsed），而宿主的
   按钮类名是打包哈希、插件够不到；能控制的只有按钮里的图形，于是 :has() 从图形
   反选按钮：展开态把宿主那一行整行藏掉（它的标题与包裹的 header 是同一句话，不该
   写两遍；display:none 连无障碍树与 Tab 焦点一起移除），收起态还给它，并把包裹
   整棵藏起来——rail 只有 36px，本来也摆不下列表，那时图标就是唯一入口。 */
button:has(svg.dsh-canvas-nav-anchor){display:none}
[data-sidebar-collapsed] button:has(svg.dsh-canvas-nav-anchor){display:flex}
[data-sidebar-collapsed] .dsh-canvas-navpane{display:none}
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
