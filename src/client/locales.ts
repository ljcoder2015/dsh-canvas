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
  'canvas.dock.image': '图片',
  'canvas.dock.vector': '矢量图片',

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
  'canvas.action.expand': '展开卡片会话',
  'canvas.action.collapse': '收起',
  'canvas.action.locate': '在画布中定位',
  'canvas.action.joinBoard': '加入画布',
  'canvas.action.remove': '从画布移除',
  'canvas.action.cancel': '取消',
  'canvas.action.confirm': '确认',
  'canvas.action.delete': '删除',
  'canvas.action.retry': '重试',
  'canvas.board.arrange': '自动排版',

  // Card overlay / panel
  'canvas.panel.latest': '最新一条',
  'canvas.composer.material': '引入其它节点产物',
  'canvas.composer.drop': '删除这条取材关系',
  'canvas.composer.placeholder': '输入提示词，发送给这张卡片…',
  'canvas.composer.send': '发送',
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
  'canvas.viewer.save': '保存',
  'canvas.viewer.saved': '已保存',
  'canvas.viewer.dirty': '未保存',
  'canvas.viewer.discard.title': '有未保存的修改，仍要关闭吗？',
  'canvas.viewer.discard.confirm': '放弃修改',
  'canvas.viewer.discard.cancel': '继续编辑',

  // Right-pane artifact tab / fullscreen viewer
  'canvas.view.outside': '这份产物不在任何画布项目中。',

  // Sidebar canvas area
  // 画布区在左栏是一个包裹：header（标题 + 新建）+ 画布列表。标题就是画布区的名字，
  // 新建按钮的文案是动作名（见 canvas.action.*）。收起时包裹整棵不显示，只剩宿主
  // 那一行的图标，点它就等于新建。
  'canvas.manage.new': '画布',
  'canvas.manage.add': '新建画布',
  'canvas.manage.picking': '请在系统选择器中选定一个文件夹…',

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
  'canvas.dock.image': 'Image',
  'canvas.dock.vector': 'Vector image',

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
  'canvas.action.expand': 'Expand card session',
  'canvas.action.collapse': 'Collapse',
  'canvas.action.locate': 'Locate on board',
  'canvas.action.joinBoard': 'Add to canvas',
  'canvas.action.remove': 'Remove from board',
  'canvas.action.cancel': 'Cancel',
  'canvas.action.confirm': 'Confirm',
  'canvas.action.delete': 'Delete',
  'canvas.action.retry': 'Retry',
  'canvas.board.arrange': 'Auto-arrange',

  // Card overlay / panel
  'canvas.panel.latest': 'Latest',
  'canvas.composer.material': 'Bring in another node’s artifact',
  'canvas.composer.drop': 'Remove this material link',
  'canvas.composer.placeholder': 'Type a prompt to send to this card…',
  'canvas.composer.send': 'Send',
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
  'canvas.viewer.save': 'Save',
  'canvas.viewer.saved': 'Saved',
  'canvas.viewer.dirty': 'Unsaved',
  'canvas.viewer.discard.title': 'You have unsaved changes. Close anyway?',
  'canvas.viewer.discard.confirm': 'Discard',
  'canvas.viewer.discard.cancel': 'Keep editing',

  // Right-pane artifact tab / fullscreen viewer
  'canvas.view.outside': 'This file is not inside a canvas project.',

  // Sidebar canvas area
  'canvas.manage.new': 'Canvas',
  'canvas.manage.add': 'New canvas',
  'canvas.manage.picking': 'Pick a folder in the system dialog…',

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
  'canvas.time.now': 'now',
  'canvas.time.minutes': '{n}min ago',
  'canvas.time.hours': '{n}h ago',
  'canvas.time.days': '{n}d ago',
  'canvas.time.months': '{n}mo ago',
  'canvas.time.years': '{n}y ago',
} satisfies Record<CanvasKey, string>

/** Namespace-bound translate function; params interpolate into `{name}` slots. */
export type Translate = TranslateNS<typeof NS>
