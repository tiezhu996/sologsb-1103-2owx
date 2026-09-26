/** Cue 触发方式（由谁喊点） */
export const CUE_TRIGGERS = ['手动', '跟音乐', '跟台词'] as const
export type CueTrigger = (typeof CUE_TRIGGERS)[number]

/** Cue 接续方式：与上一条提示点之间如何衔接 */
export const CUE_FOLLOW_MODES = ['manual', 'follow', 'hang'] as const
export type CueFollowMode = (typeof CUE_FOLLOW_MODES)[number]

/** 接续方式的中文标签 */
export const CUE_FOLLOW_LABELS: Record<CueFollowMode, string> = {
  /** 手动等待：等人喊点才执行 */
  manual: '手动等待',
  /** 跟随：上一条执行后若干秒自动接上 */
  follow: '跟随',
  /** 挂起：等上一条渐暗结束就接上 */
  hang: '挂起'
}

/** Cue 提示点：一次灯光状态变更的指令 */
export interface Cue {
  /** 主键 */
  id: string
  /** 所属场次 */
  sessionId: string
  /** Cue 编号，形如 `Q12` / `Q12.5` */
  cueNo: string
  /** 提示语，例如「国王入场，收面光」 */
  label: string
  /** 触发方式 */
  trigger: CueTrigger
  /** 接续方式 */
  followMode: CueFollowMode
  /** 接续秒数：仅 follow 模式使用，上一条执行后延迟若干秒接上 */
  followDelaySec: number
  /** 渐亮时长（秒） */
  fadeInSec: number
  /** 渐暗时长（秒） */
  fadeOutSec: number
  /** 保持时长（秒） */
  holdSec: number
  /** 备注 */
  note: string
  /** 时间轴落库位次，拖拽调整先后时写回 */
  orderIndex: number
  createdAt: number
  updatedAt: number
}

/** 新建 Cue 时提交的字段集合 */
export type CueDraft = Omit<Cue, 'id' | 'createdAt' | 'updatedAt' | 'orderIndex'> & {
  /** 不传时由 store 按 cueNo 自动定位落库位次 */
  orderIndex?: number
}

/** 相邻两条 Cue 之间的过渡衔接 */
export interface AdjacentTransition {
  fromCueId: string
  fromCueNo: string
  toCueId: string
  toCueNo: string
  /** 上一条渐暗 + 下一条渐亮（秒），越小越接近硬切 */
  gapSec: number
  /** 是否为近乎硬切的衔接 */
  overlap: boolean
}

/** 一场戏的过渡时长汇总 */
export interface CueOrderSummary {
  totalFadeInSec: number
  totalFadeOutSec: number
  totalHoldSec: number
  /** 全场过渡总时长（秒） */
  totalSec: number
  adjacent: AdjacentTransition[]
}

/** 生成一个空的 Cue 草稿 */
export function createEmptyCueDraft(sessionId: string, cueNo: string): CueDraft {
  return {
    sessionId,
    cueNo,
    label: '',
    trigger: '手动',
    followMode: 'manual',
    followDelaySec: 0,
    fadeInSec: 3,
    fadeOutSec: 3,
    holdSec: 5,
    note: ''
  }
}
