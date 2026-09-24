/**
 * dsh-canvas — 给一个还没有产物的文本座位落下第一份空文件（F3.12 × F3.14）。
 *
 * 只做两步，而且**次序是这段代码的全部内容**：先写一份空的，再回读一次。
 *
 * - 写在前：卡片的真源是盘上那个文件，先有文件才有「产物」可言；编辑面读的是回读回来
 *   的那一份 payload，所以写与读之间少一步都不行。
 * - 读在后：写回去的**空**字不算数，能落笔的只有盘上那一份。回读一次，编辑面拿到的就
 *   是「刚刚落下的那个文件」，而不是我们以为它长什么样。
 *
 * 单独成文件是为了判据能真跑一遍：这一小段是「手动输入」在空座位上唯一会写盘的地方，
 * 而它错起来没有声音——顺序反了、内容写成非空、或者干脆没回读，界面上都只是「没反应」。
 * 需要的两个动作在这里被收成一个窄接口（`BlankTextWire`），所以单测可以拿一个假的来跑，
 * 不必起弹窗、不必连后端。
 */
import type { ArtifactView } from '../../../types.ts'

/** 这一段要的那两个动作——收窄到接口，是为了判据能不碰真宿主地跑它一遍。 */
export interface BlankTextWire {
  /** 整篇写回（`bridge.writeText`）：这里写的是**空**的一份。 */
  writeText(projectId: string, cardId: string, content: string): Promise<unknown>
  /** 读一次产物（`bridge.readArtifact`）：写完之后的那一份，才是编辑面要吃的事实。 */
  readArtifact(projectId: string, cardId: string): Promise<ArtifactView>
}

/** 落一份空文件并回读；返回**盘上**那一份（写失败的抛错照原样交给调用方）。 */
export async function seedBlankText(
  wire: BlankTextWire,
  projectId: string,
  cardId: string,
): Promise<ArtifactView> {
  await wire.writeText(projectId, cardId, '')
  return wire.readArtifact(projectId, cardId)
}
