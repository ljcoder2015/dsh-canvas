/**
 * dsh-canvas — Host Typert manifest.
 *
 * The manifest tells the model layer what this package offers. It is not
 * generated: the descriptors come straight from {@link DSH_CANVAS_INVOCATIONS}
 * — the same array the browser half mounts — so the two faces cannot describe
 * different contracts. The member list below is documentation for the model,
 * and `tests/contract.spec.ts` asserts the identity of the shared array.
 */
import type { TypertContribution, TypertMemberModel, TypertServiceModel } from '@deepseek-ai/dsh-typert-registry'
import { DSH_CANVAS_INVOCATIONS } from './contract.ts'

/** Package identity — must match `package.json`, `build.mjs` and `cordis.patch.yml`. */
export const TYPERT_PACKAGE = 'dsh-canvas'

/** One documented method of a Remote service. */
const member = (name: string, signature: string, summary: string): TypertMemberModel => ({
  kind: 'method',
  name,
  signature,
  summary,
})

/** The `canvas` namespace: seating, source edges, notes. */
const CANVAS_MEMBERS: readonly TypertMemberModel[] = [
  member('listProjects', 'listProjects(signal?): Promise<Project[]>', '列出所有画布项目。'),
  member('createProject', 'createProject(name, path, signal?): Promise<ProjectBinding>', '把目录绑定为新画布项目，并扫描其中的产物。'),
  member('removeProject', 'removeProject(projectId, signal?): Promise<boolean>', '移除画布项目（不删除磁盘文件）。'),
  member('listFolders', 'listFolders(path, signal?): Promise<FolderEntry[]>', '列出目录下的可选文件夹，供选择器使用。'),
  member('setActiveProject', 'setActiveProject(projectId, signal?): Promise<Project>', '记录用户当前打开的画布：画布级工具按它取项目。'),
  member('readBoard', 'readBoard(projectId, signal?): Promise<BoardSnapshot>', '读取画布座次、取材边与便利贴。'),
  member('setViewport', 'setViewport(projectId, viewport, signal?): Promise<Project>', '记录画布视图状态。'),
  member('setStyle', 'setStyle(projectId, style, signal?): Promise<StyleProfile>', '设置项目风格档案。'),
  member('moveCard', 'moveCard(projectId, cardId, position, signal?): Promise<BoardCard>', '移动一张卡片。'),
  member('arrange', 'arrange(projectId, strategy, signal?): Promise<BoardSnapshot>', '按取材链、网格或归纳策略重新摆位。'),
  member('linkSource', 'linkSource(projectId, upstream, downstream, signal?): Promise<BoardSource>', '建立一条取材边：下游产物取材于上游产物。'),
  member('unlinkSource', 'unlinkSource(projectId, sourceId, signal?): Promise<boolean>', '删除一条取材边。'),
  member('getSources', 'getSources(projectId, cardId, signal?): Promise<SourceChain>', '解析一张卡片的取材链（直接上游、间接上游、下游）。'),
  member('reconcile', 'reconcile(projectId, signal?): Promise<BoardSource[]>', '按产物内的引用对账，补齐自动取材边。'),
  member('createNote', 'createNote(projectId, text, position, signal?): Promise<Note>', '在画布上创建共享便利贴。'),
  member('removeNote', 'removeNote(projectId, noteId, signal?): Promise<boolean>', '删除便利贴。'),
]

/** The `card` namespace: artifact digests, writes, injection, export. */
const CARD_MEMBERS: readonly TypertMemberModel[] = [
  member('createCard', 'createCard(projectId, cardId, kind, position, signal?): Promise<BoardCard>', '在画布上新建一张卡片。'),
  member('scaffoldWebapp', 'scaffoldWebapp(projectId, name, position, signal?): Promise<BoardCard>', '新建应用节点：建一个文件夹，写入 web components + shadcn 风格的 web 应用脚手架，并落成卡片。'),
  member('removeCard', 'removeCard(projectId, cardId, signal?): Promise<boolean>', '从画布移除卡片（不删除磁盘文件）。'),
  member('readSummary', 'readSummary(projectId, cardId, signal?): Promise<CardSummary>', '读取一张卡片产物的摘要。'),
  member('readArtifact', 'readArtifact(projectId, cardId, signal?): Promise<ArtifactView>', '读取一张卡片产物的全屏视图载荷（全文或媒体 data URL）。'),
  member('readSources', 'readSources(projectId, cardId, signal?): Promise<CardSummary[]>', '读取一张卡片的全部取材来源摘要。'),
  member('injectCard', 'injectCard(projectId, cardId, sourceCardId, mode, signal?): Promise<CardSummary>', '把上游产物注入卡片会话。'),
  member('openSession', 'openSession(projectId, cardId, signal?): Promise<SessionBinding>', '打开（或复用）卡片绑定的 Agent 会话。'),
  member('releaseSession', 'releaseSession(projectId, cardId, signal?): Promise<boolean>', '释放卡片会话；日志保留，重开即续。'),
  member('writeText', 'writeText(projectId, cardId, content, signal?): Promise<WriteResult>', '整文件写回产物（F8.1 双击改字）。'),
  member('editText', 'editText(projectId, cardId, content, version, signal?): Promise<WriteResult>', '带版本守卫的整文件替换：内容已被改动则失败。'),
  member('queueIntent', 'queueIntent(projectId, cardId, kind, payload, image, signal?): Promise<PendingIntent[]>', '把结构化编辑意图排队，供卡片会话下一轮取用。'),
  member('readPending', 'readPending(projectId, cardId, signal?): Promise<PendingIntent[]>', '读取排队中的结构化意图。'),
  member('exportCard', 'exportCard(projectId, cardId, format, signal?): Promise<ExportResult>', '导出产物为指定格式。'),
  member('publishCard', 'publishCard(projectId, cardId, signal?): Promise<ExportResult>', '把产物发布到子域名。'),
  member('sendMessage', 'sendMessage(projectId, cardId, prompt, signal?): Promise<SessionBinding>', '把用户在卡片输入框里写的提示词提交给卡片会话，作为下一轮对话。'),
  member('readLastPrompt', 'readLastPrompt(projectId, cardId, signal?): Promise<LastPrompt>', '读取用户对该卡片会话最近一条自己发出的消息（F3.9，供输入框回填）。'),
]

/** The one contribution this package makes to the Host registry. */
export const TYPERT_MANIFEST: TypertContribution = {
  package: TYPERT_PACKAGE,
  face: 'host',
  schemas: [],
  model: {
    services: [
      {
        key: 'canvas',
        exportName: 'CanvasRuntime',
        summary: '画布座次、项目与取材链。',
        description: '画布座次、项目与取材链。',
        tags: [],
        members: CANVAS_MEMBERS,
        types: [],
      } satisfies TypertServiceModel,
      {
        key: 'card',
        exportName: 'CardRuntime',
        summary: '卡片产物读写、注入与导出。',
        description: '卡片产物读写、注入与导出。',
        tags: [],
        members: CARD_MEMBERS,
        types: [],
      } satisfies TypertServiceModel,
    ],
    events: [],
    objects: [],
  },
  invocations: DSH_CANVAS_INVOCATIONS,
}
