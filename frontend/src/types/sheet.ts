import type { FixturePosition, FixtureType } from '@/types/fixture'
import type { CueFollowMode, CueTrigger } from '@/types/cue'

/** 排演表中的一行通道明细（生成时快照，便于历史留档） */
export interface SheetChannelLine {
  channel: number
  position: FixturePosition
  fixtureType: FixtureType
  gel: string
  intensity: number
  colorTempK: number
  focusNote: string
}

/** 排演表中的一条 Cue 条目 */
export interface SheetCueLine {
  cueId: string
  cueNo: string
  label: string
  trigger: CueTrigger
  /** 接续方式（生成时快照；老表没有此字段，按手动等待估算） */
  followMode?: CueFollowMode
  /** 跟随延迟秒数（生成时快照） */
  followDelaySec?: number
  /** 生成时按全场时间轴估算的预计执行时刻 `HH:mm:ss`；老表没有此字段 */
  estTime?: string
  fadeInSec: number
  fadeOutSec: number
  holdSec: number
  note: string
  channels: SheetChannelLine[]
}

/** 排演表（RehearsalSheet）：勾选若干 Cue 组合出的可导出表 */
export interface RehearsalSheet {
  /** 主键 */
  id: string
  /** 所属场次 */
  sessionId: string
  /** 排演表编号，形如 `RS-20250925-01` */
  sheetNo: string
  /** 生成时间，ISO 字符串 */
  generatedAt: string
  /** 生成时勾选的 Cue id 列表 */
  includedCueIds: string[]
  /** 制表备注 */
  note: string
  /** 生成时的条目快照 */
  cueLines: SheetCueLine[]
}

/** 生成排演表时提交的字段集合 */
export interface SheetDraft {
  sessionId: string
  cueIds: string[]
  note: string
}
