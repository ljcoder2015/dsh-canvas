/**
 * dsh-canvas — the browser half's stylesheet.
 *
 * One injected sheet, one class prefix (`dsh-canvas-`), no element resets, and
 * exactly two global selectors (the sidebar rail rules at the foot, which must
 * reach a host-rendered button): the canvas lives inside a host pane it does
 * not own.
 *
 * Colour ships as **two palettes**. Light is the default (the host's light mode is
 * "no `data-ds-dark-theme` on `body`"); dark arrives by the host putting that
 * attribute there, which is exactly how the host's own token sheets switch. The
 * plugin never decides which one is active — it reads the attribute. Neutrals
 * (text, hairlines) ride the host's real alias tokens, so they follow the host's
 * palette *and* any third-party theme that overrides those aliases; the canvas-only
 * surfaces (board, card, soft/slot, accents, sheen) carry both values here because
 * the host has no token for an endless board. The rest of the system is unchanged:
 * no shadows, hairline layering, capsule buttons, and exactly four accents —
 * sunset (running), dusk, twilight (has news) and breeze (material edges).
 */
const STYLE_ID = 'dsh-canvas-styles'

/** 导出只为测试解析（tests/theme-tokens.spec.ts 把这张表当数据审）；运行时仍走 adoptStyles 注入。 */
export const css = `
/* 画布自己那套变量。**两套配色**：亮色写在前面（宿主亮色模式就是「body 上没有
   data-ds-dark-theme」），暗色由宿主挂上那个属性时覆盖——宿主自己也是这么做
   （ui-theme 那套设计令牌整套按 body[data-ds-dark-theme] 覆盖同名变量）。而
   「现在是亮还是暗」**不归插件管**：ui-theme 解析 light/dark/system（system 走
   prefers-color-scheme），预置引导先把属性写上、ui-layout 的 ThemePresenter
   之后接着维护，插件只读属性、不问配置，于是主题一切换画布跟着换。

   中性色（文字、发丝边）**直接吃宿主的别名令牌**——那些令牌本身就有两套值，
   于是它们自动跟随，连第三方主题（ctx.theme 覆盖同名别名）也一并跟随。
   画布专属的几个（无限画布底 / 卡底 / 悬停选中底 / 凹槽底 / 品牌色 / 流光）
   宿主没有对应语义，就在下面老实写两套。

   ⚠️ v1.38 之前这里写的是 --dsw-alias-bg-elevated 与 --dsw-alias-border-secondary
   两个**宿主的令牌表里并不存在**的名字：兜底值永远生效，看着像接了宿主令牌、
   其实卡底与发丝边是写死的暗色，亮色下必然花（次文字 --dsh-fg-2 更是白底白字）。
   真名是 --dsw-alias-bg-layer-1 与 --dsw-alias-border-l2；「只准用真名」这条已由
   tests/theme-tokens.spec.ts 的白名单钉住。

   画布之外的一切（左栏那一段列表、它的行操作菜单与删除确认框）都走宿主的
   --dsw-* 令牌：那些构件说的是宿主侧栏的事，也该跟着宿主的主题走。它们 portal 在
   宿主 <nav> 里、拿不到画布根上的变量，所以 --dsh-font/--dsh-mono 这两个与主题
   无关的量提在 :root 上。v1.33 之前这里还带一个 .dsh-canvas-floating，是把这套
   变量带过 portal 给右键菜单用的——那两件现在都换成宿主的原语了。 */
:root{
  --dsh-font:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI","Noto Sans SC",sans-serif;
  --dsh-mono:ui-monospace,"Geist Mono","SF Mono",Menlo,monospace;
}

/* ── 亮色（默认那一套） ─────────────────────────────────────────────────── */
.dsh-canvas-root{
  --dsh-surface:#EBEEF2;
  --dsh-card:#FFFFFF;
  --dsh-soft:#F5F6F7;
  --dsh-slot:#E9ECF2;
  --dsh-mid:#CFD3D6;
  --dsh-hairline:var(--dsw-alias-border-l2,#0000001A);
  --dsh-fg:var(--dsw-alias-label-primary,#0F1115);
  --dsh-fg-2:var(--dsw-alias-label-secondary,#61666B);
  --dsh-fg-3:var(--dsw-alias-label-tertiary,#81858C);
  --dsh-sunset:#C25A0A;
  --dsh-dusk:#6D28D9;
  --dsh-twilight:#6D28D9;
  --dsh-breeze:#4176E6;
  --dsh-sheen:#0000000F;
  --dsh-sheen-peak:#0000001F;
  position:absolute;inset:0;display:flex;flex-direction:column;min-width:0;min-height:0;
  background:var(--dsh-surface);color:var(--dsh-fg);font:13px/20px var(--dsh-font);
  -webkit-font-smoothing:antialiased;
}

/* ── 暗色（宿主在 <body> 上挂 data-ds-dark-theme 时覆盖亮色那套） ─────────
   属性由宿主写：预置引导脚本负责首屏之前那一次，ui-layout 的 ThemePresenter
   负责之后每次快照。**亮色＝属性缺席**，所以这里只覆盖，不另开类名。 */
body[data-ds-dark-theme] .dsh-canvas-root{
  --dsh-surface:#0A0A0A;
  --dsh-card:#191919;
  --dsh-soft:#1A1C20;
  --dsh-slot:#0E0F12;
  --dsh-mid:#363A3F;
  --dsh-sunset:#FF7A17;
  --dsh-dusk:#7C3AED;
  --dsh-twilight:#C4B5FD;
  --dsh-breeze:#A0C3EC;
  --dsh-sheen:#FFFFFF14;
  --dsh-sheen-peak:#FFFFFF29;
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
/* 卡片自身的圆角写在 --dsh-card-r 上，因为贴在它内缘的两层（标题行与预览）必须用
   **同心**的圆角，而「同心」这件事只有把半径算出来才是真的：两层都铺满卡片的内容
   盒、都没有边框，所以它们的盒角正好压在边框的内缘上——半径各减掉一个边框宽度
   （8 − 1 = 7），圆心才落在同一点。少了这一步，凡是有底色的那层就会在圆角处**盖掉
   卡片的边框**：后代的背景画在祖先的边框之上（CSS 绘制顺序：祖先的边框先画，流内
   块级后代后画），而卡片按设计不能 overflow:hidden（两个取材端口悬在卡外）。左下、
   右下两角的边框整段消失就是这么来的——标题行没有底色，所以上两角安然无恙。 */
.dsh-canvas-card{--dsh-card-r:8px;--dsh-card-inner-r:calc(var(--dsh-card-r) - 1px);
  position:absolute;width:200px;height:140px;box-sizing:border-box;display:flex;flex-direction:column;
  border:1px solid var(--dsh-hairline);border-radius:var(--dsh-card-r);background:var(--dsh-card);user-select:none;
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
  background:linear-gradient(90deg,transparent 0%,var(--dsh-sheen) 40%,
    var(--dsh-sheen-peak) 50%,var(--dsh-sheen) 60%,transparent 100%);
  transform:skewX(-25deg) translateX(-120%);animation:dsh-canvas-shimmer 1.8s linear infinite}
.dsh-canvas-card-head{flex:none;display:flex;align-items:center;gap:6px;padding:7px 10px 5px;min-width:0;
  border-top-left-radius:var(--dsh-card-inner-r);border-top-right-radius:var(--dsh-card-inner-r)}
.dsh-canvas-card-name{flex:1 1 auto;min-width:0;font:500 12px/16px var(--dsh-font);color:var(--dsh-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-canvas-card-preview{flex:1 1 auto;min-height:0;box-sizing:border-box;padding:0 10px 8px;overflow:hidden;background:var(--dsh-card);
  border-bottom-left-radius:var(--dsh-card-inner-r);border-bottom-right-radius:var(--dsh-card-inner-r)}
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
/* 双击卡片打开：预览就是**整块画布**——对话框铺满画布区（同宽同高、不留边距、不切角），
   内容按形态各由各的组件渲染；图片 / 视频 / iframe 因此拿到画布的全部面积。
   选择器写成 .dsh-canvas-dialog.dsh-canvas-viewer（而不是单独的 .dsh-canvas-viewer）是
   必须的：通用对话框那条 .dsh-canvas-dialog 的宽度 min(520px,100%) 与单类同权重、
   且在文件里更靠后，只写单类会被它顶掉宽度（旧版就栽在这里，预览一直是 520px 宽）。
   注意本文件是 TS 模板字符串——注释里不要出现反引号，会截断字符串（实测踩过两次）。 */
.dsh-canvas-scrim.is-viewer{z-index:9;padding:0}
.dsh-canvas-dialog.dsh-canvas-viewer{width:100%;height:100%;border:none;border-radius:0}
.dsh-canvas-viewer .dsh-canvas-dialog-head{flex:none}
.dsh-canvas-viewer-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:auto}
.dsh-canvas-viewer-truncated{flex:none;padding:7px 16px;border-bottom:1px solid var(--dsh-hairline);
  font:11px/16px var(--dsh-mono);color:var(--dsh-sunset)}
/* 预览面渲染的是编辑器里的缓冲区（草稿比磁盘新）。这一条把话说在前面，否则
   「切到预览还是旧文」会被读成刚才的字丢了。用 breeze 而不是 sunset：它不是
   告警，只是说明你正看着未落盘的那一份。 */
.dsh-canvas-viewer-draft{flex:none;padding:7px 16px;border-bottom:1px solid var(--dsh-hairline);
  font:11px/16px var(--dsh-mono);color:var(--dsh-breeze)}
.dsh-canvas-viewer-note{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:24px;
  color:var(--dsh-fg-3);font:13px/20px var(--dsh-font);text-align:center}
/* 文本节点的编辑面：编辑区就是整块画布面积——预览与编辑是同一弹窗的两种尺寸。 */
.dsh-canvas-viewer-editor{flex:1 1 auto;min-height:0;box-sizing:border-box;width:100%;padding:18px 24px;resize:none;
  border:none;outline:none;background:transparent;color:var(--dsh-fg);
  font:13px/22px var(--dsh-mono);tab-size:2}
.dsh-canvas-viewer-status{font:500 11px/16px var(--dsh-font);color:var(--dsh-fg-3);letter-spacing:.4px}
/* 预览 / 编辑是一条**单选组**，不是一枚标签会翻转的按钮：底槽凹进（slot 面 + 发丝边），
   选中的那一半落成实心拇指（mid 面 + 白字）。旧写法按钮上写的是**另一面**的名字，
   想知道「现在在哪一面」得反推；单选组把这件事直接画出来。
   两半等宽（min-width），所以点的时候指头不用跟着字的宽度挪。 */
.dsh-canvas-modeswitch{display:inline-flex;flex:none;align-items:center;gap:2px;height:24px;box-sizing:border-box;
  padding:2px;border:1px solid var(--dsh-hairline);border-radius:999px;background:var(--dsh-slot)}
.dsh-canvas-modeswitch-opt{display:inline-flex;align-items:center;justify-content:center;height:18px;
  min-width:48px;padding:0 10px;border:none;border-radius:999px;background:transparent;cursor:pointer;
  font:500 11px/18px var(--dsh-font);letter-spacing:.4px;color:var(--dsh-fg-3)}
.dsh-canvas-modeswitch-opt:hover{color:var(--dsh-fg)}
.dsh-canvas-modeswitch-opt[aria-checked=true]{background:var(--dsh-mid);color:var(--dsh-fg)}
.dsh-canvas-modeswitch-opt:focus-visible{outline:1px solid var(--dsh-breeze);outline-offset:1px}
.dsh-canvas-viewer-confirm,.dsh-canvas-viewer-error{flex:none;display:flex;align-items:center;gap:8px;
  padding:8px 16px;border-bottom:1px solid var(--dsh-hairline);font:12px/18px var(--dsh-font);color:var(--dsh-fg-2)}
.dsh-canvas-viewer-error{color:var(--dsh-sunset);flex-wrap:wrap}
.dsh-canvas-viewer-errmain{flex:0 1 auto;min-width:0}
/* 被拒的那次写入把原生错误也留在下面一行：它写着是哪个 syscall、哪条暂存路径——
   对要修的人（或要提 issue 的人）这就是全部诊断，但不该是写作者在正文顶上先读到的东西。 */
.dsh-canvas-viewer-errdetail{flex:1 1 100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font:10px/14px var(--dsh-mono);color:var(--dsh-fg-3)}
.dsh-canvas-media{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto}
.dsh-canvas-media img,.dsh-canvas-media video{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px}
.dsh-canvas-frame{flex:1 1 auto;width:100%;height:100%;border:none;background:#fff}
/* 预览里的链接闸门拦下一条站内链接时，那句话挂在这里（iframe 之上、头顶工具条之下）。
   用 breeze 而不是 sunset：页面本身没错，只是这份地址在内联快照里无从解析。 */
.dsh-canvas-frame-note{flex:none;display:flex;align-items:center;gap:8px;padding:8px 16px;
  border-bottom:1px solid var(--dsh-hairline);background:var(--dsh-slot);
  font:12px/18px var(--dsh-font);color:var(--dsh-breeze)}
.dsh-canvas-frame-notetext{flex:1 1 auto;min-width:0}
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
/* 动作回执（会话引用走了哪条通道）：与错误条同一处、同一副骨架，只是颜色更弱——
   两条不会同时出现（每次动作都先清空回执），所以叠在同一位置是安全的。 */
.dsh-canvas-notice{position:absolute;left:12px;right:12px;top:12px;padding:8px 12px;border-radius:8px;
  border:1px solid var(--dsh-hairline);background:var(--dsh-card);color:var(--dsh-fg-3);font:12px/18px var(--dsh-mono)}

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
.dsh-canvas-dialog-body{padding:12px 14px;font:12px/19px var(--dsh-font);color:var(--dsh-fg-2)}
.dsh-canvas-dialog-error{padding:8px 14px;border-top:1px solid var(--dsh-hairline);font:11px/16px var(--dsh-mono);
  color:var(--dsh-twilight);word-break:break-all}
/* 删除画布的确认框从**侧栏**长出来，要盖住的是整个视口（不是某一块画布），所以这一档
   遮罩改成 fixed。 */
.dsh-canvas-scrim.is-floating{position:fixed;z-index:61;pointer-events:auto}
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
/* 行体与它右侧的操作按钮同住一个 li：按钮绝对定位在行的右端，所以行体照旧铺满
   整个宽度，也不参与布局——露出来的时候标题不会跟着挪一下。 */
.dsh-canvas-navitem{position:relative}
/* 右侧留给操作按钮：常驻的 30px 内边距是给它预留的位子（名字本来就带省略号，
   少这 16px 只是早一点截断），这样按钮露面时不会压住名字，也不必推挤它。 */
.dsh-canvas-navrow{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 30px 6px 20px;
  border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#7D8187);
  font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.dsh-canvas-navrow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#fff)}
.dsh-canvas-navrow[data-active=true]{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.2));
  color:var(--dsw-alias-label-primary,#fff);font-weight:500}
.dsh-canvas-navname{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 行右侧的操作按钮：指针落到这一行才露面（常驻会让列表看起来是一排省略号）。
   行的:hover 与 :focus-within 是两条入口——前者给指针，后者给键盘（Tab 到行体即
   显形，再 Tab 一下就落在按钮上）。与左栏工作区那一段同宽同色：16px 图形、4px
   圆角、三级文字色，悬停升到一级。菜单开着时也留着（data-menu），这时指针可能
   已经移到菜单上，而这一行仍是「正在说哪张画布」的唯一交代。 */
.dsh-canvas-navactions{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:none;align-items:center}
.dsh-canvas-navitem:hover .dsh-canvas-navactions,
.dsh-canvas-navitem:focus-within .dsh-canvas-navactions,
.dsh-canvas-navitem[data-menu=true] .dsh-canvas-navactions{display:inline-flex}
.dsh-canvas-navicon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;padding:0;
  border:none;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary,#7D8187);cursor:pointer}
.dsh-canvas-navicon:hover{color:var(--dsw-alias-label-primary,#fff)}
.dsh-canvas-navempty{padding:2px 8px 6px 20px;font:12px/18px var(--dsh-font);color:var(--dsw-alias-label-secondary,#7D8187);opacity:.7}
/* 打开目录失败的那句话：贴在列表下面，说的还是这一列的事。下一次开菜单即清掉。 */
.dsh-canvas-naverror{padding:2px 8px 6px 20px;font:11px/16px var(--dsh-font);color:var(--dsw-alias-state-error-primary,#C0392B);word-break:break-all}

/* ── 画布行操作菜单与删除确认框（F1.5 修订）────────────────────────────── */
/* 两件浮层都是宿主的原语（Menu / Modal），皮与骨都在宿主那边，本表只管删除
   确认框正文里那几行字——画布根目录、进行中、失败原因。这三行说的是这张画布自己
   的事，宿主不知道它们该长什么样，也就必须由插件给。它们跨 portal 落在 body 上，
   所以只能用宿主的 --dsw-* 令牌与自带兜底的字体栈：画布那套 --dsh-* 变量只活在
   .dsh-canvas-root 里，在这里全是空值。宿主的 Modal 正文已经带了 24px 左右内边距，
   这一层只管字。 */
.dsh-canvas-navmodal-path{font:12px/18px ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-tertiary,#7D8187);
  overflow-wrap:anywhere}
.dsh-canvas-navmodal-status{margin-top:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#7D8187)}
.dsh-canvas-navmodal-error{margin-top:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#C0392B);
  overflow-wrap:anywhere}

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
