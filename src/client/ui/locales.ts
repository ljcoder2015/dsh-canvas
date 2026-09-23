/**
 * dsh-canvas — product copy for the browser half (zh / en).
 *
 * Register the namespace in `client/index.tsx` through
 * `ctx.locale.register(NS, { zh, en })`. Both dictionaries carry the identical
 * key set — `en` is typed against `keyof typeof zh`, so a key added to one and
 * forgotten in the other is a compile error rather than an English sentence
 * appearing inside the Chinese UI.
 *
 * The two dictionaries are also the declaration source for the namespace: the
 * merge at the bottom is what makes `t` on a canvas slot component typed to
 * exactly these keys. The framework interpolates `{name}` parameters, so no
 * local formatter is needed.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

export const NS = 'dsh-canvas'

export const zh = {
  // Label / guides
  'canvas.label': '画布',
  'canvas.workbench': '画布工作台',
  'canvas.guide.title': '画布',
  'canvas.guide.description': '把文件夹变成一张可对话的产物画布',
  'canvas.guide.preview': '画布卡片',
  'canvas.guide.preview.description': '以画布卡片的形态查看这份产物',

  // Board chrome
  'canvas.stats': '{cards} 张卡片 · {sources} 条取材',
  'canvas.loading': '正在读取画布…',
  'canvas.empty.projects': '还没有画布项目。',
  'canvas.empty.board': '这个文件夹里还没有产物。',
  'canvas.zoom.in': '放大',
  'canvas.zoom.out': '缩小',

  // Board dock
  'canvas.dock.add': '新增卡片',
  'canvas.dock.keys': '快捷键',
  'canvas.dock.text': '文本',
  'canvas.dock.webapp': '应用',
  'canvas.dock.design': '设计',

  // 取材线拖到空白处放手时弹出的「新增节点」（F4.8）
  'canvas.drop.title': '新增节点',
  'canvas.drop.hint': '点空白处取消',

  // 快捷键说明（表体与键位同在 src/client/shortcuts.ts：印出来的就是按得动的）
  // 一张键一枚行：并排两枚键的行读起来要在脑子里拆开，所以方向与缩放都各占一行。
  'canvas.keys.title': '键盘快捷键',
  'canvas.keys.space': '按住并拖动，平移画布',
  'canvas.keys.up': '画布上移',
  'canvas.keys.left': '画布左移',
  'canvas.keys.down': '画布下移',
  'canvas.keys.right': '画布右移',
  'canvas.keys.zoomOut': '缩小画布',
  'canvas.keys.zoomIn': '放大画布',
  'canvas.keys.wheel': '平移视图；按住 Ctrl / ⌘ 即缩放',
  'canvas.keys.card': '移动卡片',
  'canvas.keys.preview': '全屏预览产物',
  'canvas.key.wheel': '滚轮',
  'canvas.key.dragCard': '拖动卡片',
  'canvas.key.dblclick': '双击卡片',

  // Actions
  'canvas.action.newProject': '新增画布项目',
  'canvas.action.pickProject': '选择文件夹',
  'canvas.action.chat': '对话',
  'canvas.action.manual': '手动输入',
  'canvas.action.link': '建立取材',
  'canvas.action.export': '导出',
  'canvas.action.publish': '发布',
  'canvas.action.arrange': '按取材链摆位',
  'canvas.action.tidy': '归纳整理',
  'canvas.action.grid': '网格整理',
  'canvas.action.reconcile': '引用对账',
  'canvas.action.refresh': '刷新',
  'canvas.action.collapse': '收起',
  'canvas.action.locate': '在画布中定位',
  'canvas.action.joinBoard': '加入画布',
  'canvas.action.remove': '从画布移除',
  'canvas.action.cancel': '取消',
  'canvas.action.confirm': '确认',
  'canvas.action.delete': '删除',
  'canvas.action.retry': '重试',
  'canvas.board.arrange': '自动排版',
  // 清理失效卡片（F1.11）：只在板上真有这种卡时才出现的按钮
  'canvas.board.prune': '清理失效卡片 ({count})',
  'canvas.board.prune.hint':
    '这些卡片的产物确实丢了（改过名或被删）。还没有写过产物的空卡、以及一时读不到的卡都不算在内；移除只是把它们从画布上拿开',
  'canvas.prune.title': '移除 {count} 张失效卡片？',
  'canvas.prune.done': '已移除 {count} 张失效卡片',
  'canvas.prune.partial': '已移除 {removed} 张；还有 {skipped} 张一时读不到，留在板上没有动',

  // Card overlay / panel
  'canvas.panel.latest': '最新一条',
  'canvas.composer.material': '引入其它节点产物',
  'canvas.composer.reference': '引用上游产物文件',
  'canvas.composer.referenceMeta': '文件引用',
  'canvas.composer.noReference': '没有可引用的文件',
  'canvas.composer.drop': '删除这条取材关系',
  // 引用标签的类型名（候选行右侧那枚小注）。标签的长相按它选：代码是纸页、图片是缩略图、
  // 视频是胶片、音频是波形，标记 / 区域是图上的一个点 / 一个框。
  'canvas.ref.type.code': '文件',
  'canvas.ref.type.image': '图片',
  'canvas.ref.type.video': '视频',
  'canvas.ref.type.audio': '音频',
  'canvas.ref.type.mark': '标记',
  'canvas.ref.type.region': '区域',
  'canvas.composer.placeholder': '输入提示词，发送给这张卡片…',
  'canvas.composer.send': '发送',
  // 右上角那颗按钮的两副面孔：行内是「放大」（⤢），放大态是「缩小」（⤡）。同一颗、
  // 同一个位置，只是方向反过来。
  'canvas.composer.enlarge': '放大输入框',
  'canvas.composer.shrink': '缩小输入框',
  'canvas.composer.resize': '拖动改这一条控制带的大小',
  'canvas.composer.empty': '画布上还没有其它卡片。',
  'canvas.composer.model': '模型',
  'canvas.composer.modelLoading': '正在加载模型目录…',
  'canvas.composer.modelEmpty': '该提供方暂无可用模型。',
  'canvas.panel.title': '卡片',
  'canvas.panel.path': '产物',
  'canvas.panel.kind': '形态',
  'canvas.panel.size': '大小',
  'canvas.panel.updated': '更新于',
  'canvas.panel.sources': '取材来源',
  'canvas.panel.noSources': '还没有取材来源。',
  'canvas.panel.downstream': '被谁取材',
  'canvas.panel.intents': '待处理意图',
  'canvas.panel.noIntents': '没有排队中的意图。',
  'canvas.panel.session': '会话',

  // Fullscreen artifact viewer (F3.8)
  'canvas.viewer.loading': '正在读取产物…',
  'canvas.viewer.absent': '产物文件还没生成。',
  'canvas.viewer.tooLarge': '文件过大，无法在此预览。',
  'canvas.viewer.truncated': '内容过大，这里只显示了前一部分。',
  // 文本节点的编辑面（同一弹窗的第二种尺寸，不是第二个弹窗）
  'canvas.viewer.edit': '编辑',
  'canvas.viewer.preview': '预览',
  'canvas.viewer.mode': '预览或编辑',
  'canvas.viewer.save': '保存',
  'canvas.viewer.saved': '已保存',
  'canvas.viewer.dirty': '未保存',
  // 停手即自动落盘（节流），这三种状态把这件事讲明白
  'canvas.viewer.saving': '保存中…',
  'canvas.viewer.autosave': '自动保存',
  'canvas.viewer.draftPreview': '以下渲染的是编辑器里的草稿，尚未落盘。',
  // 预览里的站内链接（宿主注入的闸门拦下并报上来的那一类）。话要说全：这不是
  // 「坏了」，是内联快照里这条地址**无从解析**——然后给出真能走的下一步。
  'canvas.viewer.linkBlocked': '「{href}」指向画布内的文件，预览不跟随：预览是一份内联快照，没有服务器，相对地址没有可解析的基准（跟下去只会把预览顶掉，落到宿主页面的 401 上）。要看它，把该文件建成卡片，或用左栏「打开画布目录」交给文件管理器。',
  'canvas.viewer.linkBlocked.dismiss': '知道了',
  'canvas.viewer.writeBlocked': '写入被拒：这个位置不允许改写文件（权限或沙箱限制），自动保存已暂停——改动仍在编辑器里，没有丢。修好后点「重试」。',
  'canvas.viewer.autosaveOff': '自动保存已暂停',
  'canvas.viewer.retry': '重试',
  'canvas.viewer.discard.title': '有未保存的修改，仍要关闭吗？',
  'canvas.viewer.discard.confirm': '放弃修改',
  'canvas.viewer.discard.cancel': '继续编辑',
  // 元素选择（F3.14）：在跑起来的页面上点一个元素，把它的源码嵌进提示词交给这张卡
  // 的会话去改。三句话各管一件事——工具叫什么、这一击不会落到页面上、发出去之后呢。
  'canvas.pick.tool': '元素选择',
  'canvas.pick.armed': '元素选择：页面暂时变成只读的——鼠标移到哪儿就圈住哪个元素，单击即选中。页面自己的悬停、按钮、输入都收不到这一下；按 Esc 退出。',
  'canvas.pick.title': '修改这个元素',
  'canvas.pick.hint': '在「改动要求：」后面写下要改什么，⌘/Ctrl+Enter 发送',
  'canvas.pick.send': '发送修改',
  'canvas.pick.sending': '发送中…',
  'canvas.pick.sent': '已把这条要求发给这张卡的会话。产物改好后这里会自动刷新——在那之前，预览还是旧的那一份。',
  'canvas.pick.waiting': '等产物…',
  'canvas.pick.waitingHint': '改动正在跑：这一圈上的光扫到停下就是改完了，框会自己收起。',
  'canvas.pick.repick': '先关掉提示词框，再重新选元素',
  'canvas.pick.updated': '产物已更新。',
  'canvas.pick.failed': '发送失败：{message}',
  // 定位块：打包展示节点定位与源码（只是草稿的另一种画法，发出去的提示词不变）。
  'canvas.pick.blockToggle': '展开/收起已附带的节点定位与源码',
  'canvas.pick.requestPlaceholder': '改动要求…',

  // Right-pane artifact tab / fullscreen viewer
  'canvas.view.outside': '这份产物不在任何画布项目中。',

  // Sidebar canvas area
  // 画布区在左栏是一个包裹：header（标题 + 新建）+ 画布列表。标题就是画布区的名字，
  // 新建按钮的文案是动作名（见 canvas.action.*）。收起时包裹整棵不显示，只剩宿主
  // 那一行的图标，点它就等于新建。
  'canvas.manage.new': '画布',
  'canvas.manage.add': '新建画布',
  'canvas.manage.picking': '请在系统选择器中选定一个文件夹…',

  // 画布行的操作菜单（F1.5 修订）：行右侧一枚省略号，点开是「关于这张画布本身」的两个
  // 动作。无障碍名带上画布名——左栏有好几行，只说「画布操作」读不出说的是哪一张。
  // 「删除」说的是画布本身，文案必须把「磁盘上什么都没少」写在前头。
  'canvas.menu.aria': '「{name}」的操作',
  'canvas.menu.open': '打开画布目录',
  'canvas.menu.openFailed': '打不开这个目录：{message}',
  'canvas.menu.remove': '删除画布',
  'canvas.menu.remove.title': '删除这张画布？',
  'canvas.menu.remove.pending': '正在删除画布…',
  'canvas.menu.remove.desc': '只把「{name}」从画布列表里移开：磁盘上的文件夹与文件原样保留，内容不会丢——这个目录里的板面文件也留着，把文件夹重新加成画布，排版与取材关系就从它回来。',

  // Folder picker
  'canvas.picker.title': '选择一个文件夹作为画布项目',
  'canvas.picker.parent': '上一级',
  'canvas.picker.here': '就选这个文件夹',
  'canvas.picker.empty': '这里没有子文件夹。',
  'canvas.picker.name': '项目名称',

  // Notes
  'canvas.note.placeholder': '写下一条共享便签…',
  'canvas.note.add': '加一条便签',

  // Tool live view
  'canvas.tool.title': '画布：{name}',
  'canvas.tool.pending': '等待结果…',
  'canvas.tool.failed': '调用失败：{message}',

  // 文件引入（F5.3）：把上游产物按 @路径 交给卡片会话，读取由模型决定
  'canvas.reference.files': '已把 {count} 个上游产物作为文件引用交给这张卡的会话（要不要读、读哪一段由它决定）',
  'canvas.reference.filesEmpty': '这张卡片还没有取材来源，没有可引用的文件。',
  'canvas.reference.filesNone': '上游产物的路径都写不成 @引用，已在消息里说明。',
  'canvas.reference.skipped': '另有 {count} 个上游的路径无法写成 @引用，已在消息里说明。',

  // Errors and time
  'canvas.error': '操作失败：{message}',
  'canvas.error.unknown': '未知错误',
  'canvas.time.now': '刚刚',
  'canvas.time.minutes': '{n} 分钟前',
  'canvas.time.hours': '{n} 小时前',
  'canvas.time.days': '{n} 天前',
  'canvas.time.months': '{n} 个月前',
  'canvas.time.years': '{n} 年前',
} satisfies Record<string, string>

/** Every dictionary key of the canvas namespace. */
export type CanvasKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-canvas': CanvasKey
  }
}

export const en = {
  // Label / guides
  'canvas.label': 'Canvas',
  'canvas.workbench': 'Canvas workbench',
  'canvas.guide.title': 'Canvas',
  'canvas.guide.description': 'Turn a folder into a canvas of talkative artifacts',
  'canvas.guide.preview': 'Canvas card',
  'canvas.guide.preview.description': 'View this artifact as a canvas card',

  // Board chrome
  'canvas.stats': '{cards} CARDS · {sources} SOURCES',
  'canvas.loading': 'Reading the board…',
  'canvas.empty.projects': 'No canvas projects yet.',
  'canvas.empty.board': 'No artifacts in this folder yet.',
  'canvas.zoom.in': 'Zoom in',
  'canvas.zoom.out': 'Zoom out',

  // Board dock
  'canvas.dock.add': 'New card',
  'canvas.dock.keys': 'Shortcuts',
  'canvas.dock.text': 'Text',
  'canvas.dock.webapp': 'Web app',
  'canvas.dock.design': 'Design',

  // The "new node" popup a source-edge drag opens when it is let go on empty space (F4.8)
  'canvas.drop.title': 'New node',
  'canvas.drop.hint': 'Click empty space to cancel',

  // Shortcut sheet (the rows and the keys live together in src/client/shortcuts.ts)
  // One key per row: a row that prints two keys has to be split apart in the head.
  'canvas.keys.title': 'Keyboard shortcuts',
  'canvas.keys.space': 'Hold and drag to pan',
  'canvas.keys.up': 'Move the board up',
  'canvas.keys.left': 'Move the board left',
  'canvas.keys.down': 'Move the board down',
  'canvas.keys.right': 'Move the board right',
  'canvas.keys.zoomOut': 'Zoom out',
  'canvas.keys.zoomIn': 'Zoom in',
  'canvas.keys.wheel': 'Pan the view; hold Ctrl / ⌘ to zoom',
  'canvas.keys.card': 'Move the card',
  'canvas.keys.preview': 'Open the artifact fullscreen',
  'canvas.key.wheel': 'Wheel',
  'canvas.key.dragCard': 'Drag card',
  'canvas.key.dblclick': 'Double-click',

  // Actions
  'canvas.action.newProject': 'New canvas project',
  'canvas.action.pickProject': 'Choose a folder',
  'canvas.action.chat': 'Chat',
  'canvas.action.manual': 'Type it myself',
  'canvas.action.link': 'Link source',
  'canvas.action.export': 'Export',
  'canvas.action.publish': 'Publish',
  'canvas.action.arrange': 'Arrange by source chain',
  'canvas.action.tidy': 'Tidy up',
  'canvas.action.grid': 'Grid',
  'canvas.action.reconcile': 'Reconcile references',
  'canvas.action.refresh': 'Refresh',
  'canvas.action.collapse': 'Collapse',
  'canvas.action.locate': 'Locate on board',
  'canvas.action.joinBoard': 'Add to canvas',
  'canvas.action.remove': 'Remove from board',
  'canvas.action.cancel': 'Cancel',
  'canvas.action.confirm': 'Confirm',
  'canvas.action.delete': 'Delete',
  'canvas.action.retry': 'Retry',
  'canvas.board.arrange': 'Auto-arrange',
  'canvas.board.prune': 'Clear {count} missing',
  'canvas.board.prune.hint':
    'These artifacts are really gone (renamed or deleted). Seats that never had an artifact, and files no probe could read, are not counted; removing these only takes them off the board',
  'canvas.prune.title': 'Remove {count} missing cards?',
  'canvas.prune.done': 'Removed {count} missing cards',
  'canvas.prune.partial': 'Removed {removed}; {skipped} could not be read just now and were left in place',

  // Card overlay / panel
  'canvas.panel.latest': 'Latest',
  'canvas.composer.material': 'Bring in another node’s artifact',
  'canvas.composer.reference': 'Reference upstream files',
  'canvas.composer.referenceMeta': 'file reference',
  'canvas.composer.noReference': 'Nothing to reference',
  'canvas.composer.drop': 'Remove this material link',
  'canvas.ref.type.code': 'File',
  'canvas.ref.type.image': 'Image',
  'canvas.ref.type.video': 'Video',
  'canvas.ref.type.audio': 'Audio',
  'canvas.ref.type.mark': 'Mark',
  'canvas.ref.type.region': 'Region',
  'canvas.composer.placeholder': 'Type a prompt to send to this card…',
  'canvas.composer.send': 'Send',
  // Two faces of the same corner button: 〔enlarge〕(⤢) on the strip, 〔shrink〕(⤡)
  // once the box is at full size — same button, same spot, opposite direction.
  'canvas.composer.enlarge': 'Enlarge the prompt box',
  'canvas.composer.shrink': 'Shrink the prompt box',
  'canvas.composer.resize': 'Drag to resize this control strip',
  'canvas.composer.empty': 'No other cards on the board yet.',
  'canvas.composer.model': 'Model',
  'canvas.composer.modelLoading': 'Loading the model catalog…',
  'canvas.composer.modelEmpty': 'No models available from this provider.',
  'canvas.panel.title': 'Card',
  'canvas.panel.path': 'Artifact',
  'canvas.panel.kind': 'Kind',
  'canvas.panel.size': 'Size',
  'canvas.panel.updated': 'Updated',
  'canvas.panel.sources': 'Material',
  'canvas.panel.noSources': 'No material yet.',
  'canvas.panel.downstream': 'Feeds into',
  'canvas.panel.intents': 'Queued intents',
  'canvas.panel.noIntents': 'Nothing queued.',
  'canvas.panel.session': 'Session',

  // Fullscreen artifact viewer (F3.8)
  'canvas.viewer.loading': 'Reading the artifact…',
  'canvas.viewer.absent': 'The artifact has not been written yet.',
  'canvas.viewer.tooLarge': 'The file is too large to preview here.',
  'canvas.viewer.truncated': 'The content is large; only its first part is shown.',
  // The text node's editor face — one dialog at two sizes, not two dialogs
  'canvas.viewer.edit': 'Edit',
  'canvas.viewer.preview': 'Preview',
  'canvas.viewer.mode': 'Preview or edit',
  'canvas.viewer.save': 'Save',
  'canvas.viewer.saved': 'Saved',
  'canvas.viewer.dirty': 'Unsaved',
  // Typing settles and the text is written — these three name that behaviour
  'canvas.viewer.saving': 'Saving…',
  'canvas.viewer.autosave': 'Autosave',
  'canvas.viewer.draftPreview': 'This renders the editor buffer, which is not on disk yet.',
  // A link into the canvas, stopped by the guard the host installs. Say the whole
  // thing: this is not a breakage, the address has nothing to resolve against —
  // and then name the two routes that do work.
  'canvas.viewer.linkBlocked': '"{href}" points at a file inside the canvas, and the preview does not follow it: a preview is an inlined snapshot with no server, so a relative address has no base to resolve against (following it would only replace the preview with the host page\'s 401). To open it, make that file a card, or use "Open canvas folder" in the left rail.',
  'canvas.viewer.linkBlocked.dismiss': 'Got it',
  'canvas.viewer.writeBlocked':
    'The write was refused: this location does not allow the file to be replaced (permissions or a sandbox), so autosave has stopped. Your text is still in the editor — nothing is lost. Press Retry once it is fixed.',
  'canvas.viewer.autosaveOff': 'Autosave stopped',
  'canvas.viewer.retry': 'Retry',
  'canvas.viewer.discard.title': 'You have unsaved changes. Close anyway?',
  'canvas.viewer.discard.confirm': 'Discard',
  'canvas.viewer.discard.cancel': 'Keep editing',
  // The element picker (F3.14): click an element on the running page and its own
  // source goes into a prompt handed to this card's conversation.
  'canvas.pick.tool': 'Select element',
  'canvas.pick.armed': 'Selecting an element: the page goes read-only — the element under the pointer is outlined, and a click picks it. The page\'s own hover, buttons and inputs never see that click; press Esc to leave.',
  'canvas.pick.title': 'Edit this element',
  'canvas.pick.hint': 'Write what to change after 改动要求：, then ⌘/Ctrl+Enter',
  'canvas.pick.send': 'Send',
  'canvas.pick.sending': 'Sending…',
  'canvas.pick.sent': 'Handed this request to the card\'s conversation. The preview reloads itself once the artifact is rewritten — until then it is still the old one.',
  'canvas.pick.waiting': 'Waiting…',
  'canvas.pick.waitingHint': 'The change is running: the light sweeping that outline stops when it lands, and the box closes itself.',
  'canvas.pick.repick': 'Close the prompt box before picking another element',
  'canvas.pick.updated': 'The artifact is updated.',
  'canvas.pick.failed': 'Could not send: {message}',
  // The locator block: the node locator & source, packed for display only — the
  // prompt that goes out is byte-for-byte what it always was.
  'canvas.pick.blockToggle': 'Show or hide the attached node locator & source',
  'canvas.pick.requestPlaceholder': 'What to change…',

  // Right-pane artifact tab / fullscreen viewer
  'canvas.view.outside': 'This file is not inside a canvas project.',

  // Sidebar canvas area
  'canvas.manage.new': 'Canvas',
  'canvas.manage.add': 'New canvas',
  'canvas.manage.picking': 'Pick a folder in the system dialog…',

  // A canvas row's action menu (F1.5 revision): the ellipsis on the right of the row. The
  // accessible name carries the canvas name — the column has several rows, and
  // a bare "Canvas actions" cannot say which one.
  'canvas.menu.aria': 'Actions for “{name}”',
  'canvas.menu.open': 'Open canvas folder',
  'canvas.menu.openFailed': 'Could not open this folder: {message}',
  'canvas.menu.remove': 'Delete canvas',
  'canvas.menu.remove.title': 'Delete this canvas?',
  'canvas.menu.remove.pending': 'Deleting canvas…',
  'canvas.menu.remove.desc': 'This only takes “{name}” off the canvas list: the folder and its files stay exactly where they are, nothing on disk is lost — the board file inside that folder stays too, so adding the folder as a canvas again brings the layout and source edges back.',

  // Folder picker
  'canvas.picker.title': 'Choose a folder as a canvas project',
  'canvas.picker.parent': 'Parent',
  'canvas.picker.here': 'Use this folder',
  'canvas.picker.empty': 'No subfolders here.',
  'canvas.picker.name': 'Project name',

  // Notes
  'canvas.note.placeholder': 'Write a shared note…',
  'canvas.note.add': 'Add a note',

  // Tool live view
  'canvas.tool.title': 'Canvas: {name}',
  'canvas.tool.pending': 'Waiting for a result…',
  'canvas.tool.failed': 'The call failed: {message}',

  // Errors and time
  'canvas.error': 'Action failed: {message}',
  'canvas.error.unknown': 'Unknown error',

  // Session references (F5.3–F5.5): the second channel under a source edge
  // File references (F5.3): upstream artifacts handed over as @paths, read on demand
  'canvas.reference.files': 'Handed {count} upstream artifact(s) to this card\'s conversation as file references — reading them is the model\'s call',
  'canvas.reference.filesEmpty': 'This card has no sources yet, so there is no file to reference.',
  'canvas.reference.filesNone': 'None of the upstream paths could be written as an @reference; the message says which.',
  'canvas.reference.skipped': '{count} upstream path(s) could not be written as an @reference; the message says which.',
  'canvas.time.now': 'now',
  'canvas.time.minutes': '{n}min ago',
  'canvas.time.hours': '{n}h ago',
  'canvas.time.days': '{n}d ago',
  'canvas.time.months': '{n}mo ago',
  'canvas.time.years': '{n}y ago',
} satisfies Record<CanvasKey, string>

/** Namespace-bound translate function; params interpolate into `{name}` slots. */
export type Translate = TranslateNS<typeof NS>
