import type { Cue, CueFollowMode } from '@/types/cue'
import { sortCues } from '@/utils/cueOrder'

/** 参与时刻估算的最小字段集合（Cue 与排演表条目快照共用） */
export interface SchedulableCue {
  fadeInSec: number
  holdSec: number
  fadeOutSec: number
  followMode?: CueFollowMode
  followDelaySec?: number
}

/** 时间轴上一条 Cue 的预计执行记录 */
export interface ScheduleEntry {
  /** 距场次计划开始时刻的偏移（秒） */
  offsetSec: number
  /** 预计执行完毕的偏移（秒） */
  endOffsetSec: number
}

/** 带 Cue 身份的估算记录 */
export interface CueScheduleItem extends ScheduleEntry {
  cueId: string
  cueNo: string
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 老数据没有接续方式，一律按手动等待估算 */
export function resolveFollowMode(mode: CueFollowMode | undefined): CueFollowMode {
  return mode ?? '手动等待'
}

/** 接续方式的展示文本 */
export function formatFollowMode(cue: Pick<SchedulableCue, 'followMode' | 'followDelaySec'>): string {
  const mode = resolveFollowMode(cue.followMode)
  if (mode === '跟随') return `跟随上一条 ${round1(Math.max(0, cue.followDelaySec ?? 0))}s 接上`
  if (mode === '挂起') return '挂起，等上一条渐暗结束接上'
  return '手动等待，等人点'
}

/**
 * 从场次计划开始时刻往后累计，逐条估算执行偏移：
 * - 手动等待：上一条执行完毕后等人点（估算不计等待，紧跟其后）
 * - 跟随：上一条开始执行后 followDelaySec 秒接上
 * - 挂起：上一条渐暗结束（执行完毕）即接上
 */
export function scheduleTimeline(input: readonly SchedulableCue[]): ScheduleEntry[] {
  const entries: ScheduleEntry[] = []
  input.forEach((cue, index) => {
    const previous = entries[index - 1]
    let offsetSec = 0
    if (previous) {
      offsetSec =
        resolveFollowMode(cue.followMode) === '跟随'
          ? previous.offsetSec + Math.max(0, cue.followDelaySec ?? 0)
          : previous.endOffsetSec
    }
    const duration = Math.max(0, cue.fadeInSec) + Math.max(0, cue.holdSec) + Math.max(0, cue.fadeOutSec)
    entries.push({ offsetSec: round1(offsetSec), endOffsetSec: round1(offsetSec + duration) })
  })
  return entries
}

/** 一场戏按落库位次排序后的逐条时刻估算 */
export function scheduleCues(cues: readonly Cue[]): CueScheduleItem[] {
  const ordered = sortCues(cues)
  return scheduleTimeline(ordered).map((entry, index) => ({
    ...entry,
    cueId: ordered[index].id,
    cueNo: ordered[index].cueNo
  }))
}

/** 全场预计用时（秒）：所有条目执行完毕的最晚偏移 */
export function scheduleTotalSec(entries: readonly ScheduleEntry[]): number {
  return round1(entries.reduce((max, entry) => Math.max(max, entry.endOffsetSec), 0))
}

/** `HH:mm` → 当天秒数；留空或非法返回 null */
export function clockToSeconds(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 3600 + minutes * 60
}

/** 当天秒数 → `HH:mm:ss`，跨过午夜自动回绕 */
export function secondsToClock(totalSec: number): string {
  const day = 24 * 3600
  const safe = ((Math.round(totalSec) % day) + day) % day
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(Math.floor(safe / 3600))}:${pad(Math.floor((safe % 3600) / 60))}:${pad(safe % 60)}`
}

/** 计划开始时刻 + 偏移秒 → 预计时钟时刻；计划开始缺失时返回 null */
export function offsetToClock(plannedStart: string, offsetSec: number): string | null {
  const start = clockToSeconds(plannedStart)
  if (start === null) return null
  return secondsToClock(start + offsetSec)
}

/**
 * 预计结束晚于计划结束的超出秒数；无法计算或未超出返回 null。
 * 计划结束不晚于计划开始时按跨午夜处理。
 */
export function plannedOverrunSec(plannedStart: string, plannedEnd: string, totalSec: number): number | null {
  const start = clockToSeconds(plannedStart)
  const end = clockToSeconds(plannedEnd)
  if (start === null || end === null) return null
  const plannedDuration = end > start ? end - start : end + 24 * 3600 - start
  const overrun = totalSec - plannedDuration
  return overrun > 0 ? Math.round(overrun) : null
}
