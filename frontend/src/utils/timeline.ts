import type { Cue, CueFollowMode } from '@/types/cue'
import { cueTotalSeconds, round1 } from '@/utils/fade'
import { sortCues } from '@/utils/cueOrder'

/**
 * 执行时间轴：以场次计划开始时刻为零点，按接续方式逐条累计
 * 每条 Cue 的预计执行时刻，并估算全场结束时刻。
 *
 * 接续规则：
 * - 第一条 Cue：在场次计划开始时刻执行；
 * - follow（跟随）：上一条执行时刻 + followDelaySec；
 * - hang（挂起）：上一条执行时刻 + 上一条的渐亮 + 保持 + 渐暗（上一条整段走完）；
 * - manual（手动等待）：手动点无法预知等待时长，估算时按「上一条渐暗结束即可接上」处理，
 *   即与 hang 相同的最早可执行时刻；走场面板中仍会停下来等人点 GO。
 */

/** 一条 Cue 在时间轴上的预计时刻 */
export interface CueTiming {
  cueId: string
  cueNo: string
  /** 接续方式 */
  followMode: CueFollowMode
  /** 跟随秒数（follow 模式） */
  followDelaySec: number
  /** 相对计划开始时刻的偏移（秒） */
  offsetSec: number
  /** 预计执行时刻，格式 `HH:mm`（跨天追加 `+1d`） */
  clock: string
  /** 本条走完（渐暗结束）相对计划开始的偏移（秒） */
  endOffsetSec: number
}

/** 整场的执行时间轴 */
export interface SessionTimeline {
  /** 各条 Cue 的预计时刻（按时间轴顺序） */
  timings: CueTiming[]
  /** 最后一条渐暗结束相对计划开始的偏移（秒） */
  finishOffsetSec: number
  /** 全场预计结束时刻，格式 `HH:mm`（跨天追加 `+Nd`）；无计划开始时为 null */
  finishClock: string | null
  /** 是否存在有效的计划开始时刻 */
  hasStart: boolean
  /** 是否存在有效的计划结束时刻 */
  hasPlannedEnd: boolean
  /** 晚于计划结束的秒数；未超出或缺少计划结束时为 0 */
  overrunSec: number
  /** 是否超出计划结束 */
  overrun: boolean
}

/** `HH:mm` → 当日分钟数；非法返回 null */
export function parseClockToMinutes(clock: string | null | undefined): number | null {
  if (!clock) return null
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(clock.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** 相对零点的秒数偏移 → `HH:mm`，超过 24 小时追加 `+Nd` */
export function formatOffsetClock(offsetSec: number, startMinutes: number | null): string {
  if (startMinutes === null) {
    const total = Math.max(0, Math.round(offsetSec))
    const hh = Math.floor(total / 3600)
    const mm = Math.floor((total % 3600) / 60)
    return `+${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  const totalMinutes = startMinutes + Math.max(0, offsetSec) / 60
  const day = Math.floor(totalMinutes / 1440)
  const within = Math.round(totalMinutes - day * 1440)
  const hh = Math.floor(within / 60)
  const mm = within % 60
  const base = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  return day > 0 ? `${base}+${day}d` : base
}

/** 接续方式的简短说明（相对上一条） */
export function followGapText(cue: Pick<Cue, 'followMode' | 'followDelaySec'>, previous?: Pick<Cue, 'fadeInSec' | 'holdSec' | 'fadeOutSec'> | null): string {
  if (!previous) return '场次开始'
  if (cue.followMode === 'follow') return `跟随 +${round1(Math.max(0, cue.followDelaySec))}s`
  if (cue.followMode === 'hang') return '挂上一条渐暗'
  return '手动等待'
}

/**
 * 计算一场戏的执行时间轴。
 * @param cues 该场全部 Cue（顺序无关，内部按落库位次排序）
 * @param plannedStart 场次计划开始时刻 `HH:mm`
 * @param plannedEnd 场次计划结束时刻 `HH:mm`
 */
export function buildTimeline(cues: readonly Cue[], plannedStart?: string | null, plannedEnd?: string | null): SessionTimeline {
  const ordered = sortCues(cues)
  const startMinutes = parseClockToMinutes(plannedStart ?? null)
  const endMinutes = parseClockToMinutes(plannedEnd ?? null)

  const timings: CueTiming[] = []
  let cursor = 0

  ordered.forEach((cue, index) => {
    if (index > 0) {
      const previous = ordered[index - 1]
      if (cue.followMode === 'follow') {
        cursor = round1(cursor + Math.max(0, cue.followDelaySec))
      } else {
        // manual 估算与 hang 相同：上一条整段（渐亮 + 保持 + 渐暗）走完
        cursor = round1(cursor + cueTotalSeconds(previous))
      }
    }

    timings.push({
      cueId: cue.id,
      cueNo: cue.cueNo,
      followMode: cue.followMode,
      followDelaySec: cue.followDelaySec,
      offsetSec: cursor,
      clock: formatOffsetClock(cursor, startMinutes),
      endOffsetSec: round1(cursor + cueTotalSeconds(cue))
    })
  })

  const finishOffsetSec = timings.length > 0 ? timings[timings.length - 1].endOffsetSec : 0
  const finishClock = timings.length > 0 ? formatOffsetClock(finishOffsetSec, startMinutes) : null

  let overrunSec = 0
  if (startMinutes !== null && endMinutes !== null) {
    let plannedSpan = endMinutes - startMinutes
    if (plannedSpan < 0) plannedSpan += 1440 // 计划结束跨午夜
    overrunSec = Math.max(0, round1(finishOffsetSec - plannedSpan * 60))
  }

  return {
    timings,
    finishOffsetSec,
    finishClock,
    hasStart: startMinutes !== null,
    hasPlannedEnd: endMinutes !== null,
    overrunSec,
    overrun: overrunSec > 0
  }
}
