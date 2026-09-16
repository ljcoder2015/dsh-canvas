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
  'canvas.zoom.reset': '适应画布',

  // Actions
  'canvas.action.newProject': '新增画布项目',
  'canvas.action.pickProject': '选择文件夹',
  'canvas.action.open': '打开',
  'canvas.action.chat': '对话',
  'canvas.action.link': '建立取材',
  'canvas.action.unlink': '解除取材',
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

  // Card state
  'canvas.status.running': '运行中',
  'canvas.status.notified': '有通知',
  'canvas.status.idle': '空闲',
  'canvas.status.missing': '文件已不在',

  // Card overlay / panel
  'canvas.panel.latest': '最新一条',
  'canvas.panel.none': '还没有消息。打开对话开始。',
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

  // Session view ring
  'canvas.view.label': '画布卡片',
  'canvas.view.unbound': '当前会话不属于任何画布卡片。',
  'canvas.view.noSession': '这条会话还没有绑定的产物。',
  'canvas.view.outside': '这份产物不在任何画布项目中。',

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
  'canvas.zoom.reset': 'Fit board',

  // Actions
  'canvas.action.newProject': 'New canvas project',
  'canvas.action.pickProject': 'Choose a folder',
  'canvas.action.open': 'Open',
  'canvas.action.chat': 'Chat',
  'canvas.action.link': 'Link source',
  'canvas.action.unlink': 'Unlink source',
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

  // Card state
  'canvas.status.running': 'Running',
  'canvas.status.notified': 'Has news',
  'canvas.status.idle': 'Idle',
  'canvas.status.missing': 'File is gone',

  // Card overlay / panel
  'canvas.panel.latest': 'Latest',
  'canvas.panel.none': 'No messages yet. Open the conversation to start.',
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

  // Session view ring
  'canvas.view.label': 'Canvas card',
  'canvas.view.unbound': 'The current session is not bound to a canvas card.',
  'canvas.view.noSession': 'This conversation has no bound artifact.',
  'canvas.view.outside': 'This file is not inside a canvas project.',

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
