<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NTag } from 'naive-ui'
import FadeBar from '@/components/common/FadeBar.vue'
import { useCueStore } from '@/stores/cueStore'
import { useSessionStore } from '@/stores/sessionStore'
import { CUE_FOLLOW_LABELS, type Cue } from '@/types/cue'
import { cueTotalSeconds, formatSeconds } from '@/utils/fade'
import { buildTimeline } from '@/utils/timeline'

/**
 * 走场面板：按时间轴顺序逐条走 Cue。
 * - 第一条从高亮开始，点「开始」执行；
 * - follow（跟随）到点（上一条后若干秒）自动推进；
 * - hang（挂起）等上一条渐暗（整段过渡）结束自动接上；
 * - manual（手动等待）停住，等人点「GO」。
 */
const route = useRoute()
const router = useRouter()
const cueStore = useCueStore()
const sessionStore = useSessionStore()

const sessionId = computed(() => String(route.params.id ?? ''))
const session = computed(() => sessionStore.sessionById(sessionId.value))
const cues = computed(() => (sessionId.value ? cueStore.sortedCuesOfSession(sessionId.value) : []))

const timeline = computed(() =>
  session.value ? buildTimeline(cues.value, session.value.plannedStart, session.value.plannedEnd) : null
)
const timingByCueId = computed(() => new Map((timeline.value?.timings ?? []).map((item) => [item.cueId, item])))

/* ---------------- 走场状态 ---------------- */
/** 是否已开始（首条已执行） */
const started = ref(false)
/** 是否全部走完（末条渐暗结束） */
const finished = ref(false)
/** 当前高亮的 Cue 下标：未开始为 0；自动衔接飞行中停在刚执行的那条；手动等待时为下一条 */
const currentIndex = ref(0)
/** 是否正停在手动等待上（等人点 GO） */
const waitingManual = ref(false)
/** 各条实际执行的时间戳（ms） */
const firedAt = ref<number[]>([])
/** 开始（首条 GO）的时间戳 */
const startAt = ref<number | null>(null)
/** 末条渐暗结束的时间戳 */
const endedAt = ref<number | null>(null)
/** 驱动倒计时刷新 */
const nowTick = ref(Date.now())

let autoTimer: ReturnType<typeof setTimeout> | null = null
let endTimer: ReturnType<typeof setTimeout> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null

function clearTimers(): void {
  if (autoTimer !== null) {
    clearTimeout(autoTimer)
    autoTimer = null
  }
  if (endTimer !== null) {
    clearTimeout(endTimer)
    endTimer = null
  }
}

function startTicker(): void {
  if (tickTimer !== null) return
  tickTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 200)
}

function stopTicker(): void {
  if (tickTimer !== null) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}

onBeforeUnmount(() => {
  clearTimers()
  stopTicker()
})

/** 执行指定下标，并安排其后的自动衔接或结束计时 */
function fire(index: number): void {
  const ts = Date.now()
  if (index === 0) startAt.value = ts
  const nextFired = [...firedAt.value]
  nextFired[index] = ts
  firedAt.value = nextFired
  currentIndex.value = index
  waitingManual.value = false
  startTicker()

  const cue = cues.value[index]
  if (!cue) return

  if (index >= cues.value.length - 1) {
    // 末条：渐暗结束即全场结束
    endTimer = setTimeout(() => {
      endedAt.value = Date.now()
      finished.value = true
      waitingManual.value = false
      stopTicker()
      nowTick.value = Date.now()
    }, cueTotalSeconds(cue) * 1000)
    return
  }

  const next = cues.value[index + 1]
  const waitSec = next.followMode === 'follow' ? Math.max(0, next.followDelaySec) : next.followMode === 'hang' ? cueTotalSeconds(cue) : null
  if (waitSec === null) {
    waitingManual.value = true
    currentIndex.value = index + 1
    return
  }
  autoTimer = setTimeout(() => fire(index + 1), waitSec * 1000)
}

/** 主按钮：未开始 → 执行第一条；手动等待 → GO 执行当前 */
function primaryAction(): void {
  if (!started.value) {
    started.value = true
    fire(0)
    return
  }
  if (waitingManual.value) fire(currentIndex.value)
}

function reset(): void {
  clearTimers()
  stopTicker()
  started.value = false
  finished.value = false
  currentIndex.value = 0
  waitingManual.value = false
  firedAt.value = []
  startAt.value = null
  endedAt.value = null
  nowTick.value = Date.now()
}

/* ---------------- 展示派生 ---------------- */
const currentCue = computed<Cue | null>(() => cues.value[currentIndex.value] ?? null)
/** 自动衔接飞行中，下一条将在多少秒后执行 */
const autoRemainingMs = computed<number | null>(() => {
  if (!started.value || finished.value || waitingManual.value || autoTimer === null) return null
  if (currentIndex.value >= cues.value.length - 1) return null
  const fired = firedAt.value[currentIndex.value]
  if (fired === undefined) return null
  const next = cues.value[currentIndex.value + 1]
  const waitSec =
    next.followMode === 'follow'
      ? Math.max(0, next.followDelaySec)
      : next.followMode === 'hang'
        ? cueTotalSeconds(cues.value[currentIndex.value])
        : null
  if (waitSec === null) return null
  return Math.max(0, fired + waitSec * 1000 - nowTick.value)
})

/** 末条执行中，距全场结束的毫秒数 */
const endRemainingMs = computed<number | null>(() => {
  if (!started.value || finished.value || endedAt.value !== null) return null
  const lastIndex = cues.value.length - 1
  const fired = firedAt.value[lastIndex]
  if (fired === undefined) return null
  return Math.max(0, fired + cueTotalSeconds(cues.value[lastIndex]) * 1000 - nowTick.value)
})

const primaryText = computed(() => {
  if (!started.value) return '开始 · 执行第一条'
  if (finished.value) return '已走完'
  if (waitingManual.value && currentCue.value) return `GO · 执行 ${currentCue.value.cueNo}`
  return '自动衔接中…'
})

const statusText = computed(() => {
  if (!started.value) return currentCue.value ? `待开始，第一条 ${currentCue.value.cueNo} 已高亮` : ''
  if (finished.value) return '全场走完，末条已渐暗结束'
  if (waitingManual.value && currentCue.value) {
    return `手动等待：喊点后点 GO 执行 ${currentCue.value.cueNo}`
  }
  if (endRemainingMs.value !== null) return `末条 ${cues.value[cues.value.length - 1]?.cueNo} 执行中，等待渐暗结束`
  if (autoRemainingMs.value !== null && cues.value[currentIndex.value + 1]) {
    const next = cues.value[currentIndex.value + 1]
    const modeLabel = next.followMode === 'follow' ? '跟随到点' : '挂起，等上一条渐暗'
    return `${modeLabel}：${next.cueNo} 将于 ${(autoRemainingMs.value / 1000).toFixed(1)}s 后自动接上`
  }
  return ''
})

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 时间戳 → `HH:mm:ss`（跨天追加 `+Nd`） */
function clockOf(ts: number | undefined): string {
  if (ts === undefined) return ''
  const date = new Date(ts)
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const day = Math.floor((ts - dayStart) / 86400000)
  const base = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return day > 0 ? `${base}+${day}d` : base
}

/** 行状态：done / current / pending */
function rowState(index: number): 'done' | 'current' | 'pending' {
  if (firedAt.value[index] !== undefined) return 'done'
  if (!finished.value && index === currentIndex.value && (started.value || index === 0)) return 'current'
  return 'pending'
}

function followLabelOf(cue: Cue, index: number): string {
  if (index === 0) return '首场起点'
  if (cue.followMode === 'follow') return `${CUE_FOLLOW_LABELS.follow} ${formatSeconds(cue.followDelaySec)}`
  return CUE_FOLLOW_LABELS[cue.followMode]
}

/** 计划结束时间戳（按今天锚定，跨午夜则加一天） */
const plannedEndTs = computed<number | null>(() => {
  if (!session.value?.plannedStart || !session.value.plannedEnd) return null
  const [sh, sm] = session.value.plannedStart.split(':').map(Number)
  const [eh, em] = session.value.plannedEnd.split(':').map(Number)
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm, 0).getTime()
  let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em, 0).getTime()
  if (end < start) end += 86400000
  return end
})

/** 实走结束相对计划结束：正为超出秒数 */
const actualOverrunSec = computed(() => {
  if (endedAt.value === null || plannedEndTs.value === null) return null
  return Math.max(0, Math.round(((endedAt.value - plannedEndTs.value) / 1000) * 10) / 10)
})

function goBack(): void {
  void router.push(`/sessions/${sessionId.value}/cues`)
}
</script>

<template>
  <div class="page">
    <header class="page__header">
      <div>
        <h1 class="page__title">走场面板</h1>
        <p class="page__subtitle">
          {{ session ? `${session.order}. ${session.title}` : '场次不存在或已删除' }} ·
          计划 {{ session?.plannedStart || '—' }} ~ {{ session?.plannedEnd || '—' }}。跟随与挂起到点自动推进，手动等待喊点后点 GO。
        </p>
      </div>
      <div class="page__actions">
        <NButton @click="goBack">返回时间轴</NButton>
        <NButton :disabled="!started || finished" @click="reset">重新走场</NButton>
        <NButton
          type="primary"
          size="large"
          :disabled="!session || cues.length === 0 || (started && !waitingManual) || finished"
          @click="primaryAction"
        >
          {{ primaryText }}
        </NButton>
      </div>
    </header>

    <NAlert v-if="!session" type="warning" :bordered="false">
      该场次不存在，可能已被删除。请返回场次编排重新选择。
    </NAlert>
    <NAlert v-else-if="cues.length === 0" type="info" :bordered="false">
      本场还没有 Cue，先到 Cue 编排时间轴插入提示点。
    </NAlert>

    <template v-else>
      <section class="panel run-stage" :class="{ 'run-stage--manual': waitingManual, 'run-stage--done': finished }">
        <div class="run-stage__status">
          <NTag v-if="!started" size="small" :bordered="false" type="warning">待开始</NTag>
          <NTag v-else-if="finished" size="small" type="success" :bordered="false">已走完</NTag>
          <NTag v-else-if="waitingManual" size="small" type="error" :bordered="false">手动等待</NTag>
          <NTag v-else size="small" type="info" :bordered="false">自动衔接</NTag>
          <p class="run-stage__text">{{ statusText || '准备就绪' }}</p>
        </div>

        <div v-if="currentCue" class="run-stage__cue">
          <div class="run-stage__cue-head">
            <span class="run-stage__no mono">{{ currentCue.cueNo }}</span>
            <span class="run-stage__label">{{ currentCue.label || '（无提示语）' }}</span>
            <NTag size="small" :bordered="false">{{ currentCue.trigger }}</NTag>
            <NTag size="small" :bordered="false" type="warning">{{ followLabelOf(currentCue, currentIndex) }}</NTag>
          </div>
          <p v-if="currentCue.note" class="run-stage__note">{{ currentCue.note }}</p>
          <div class="run-stage__times">
            <div class="run-time">
              <span class="run-time__label">预计执行</span>
              <span class="run-time__value mono">{{ timingByCueId.get(currentCue.id)?.clock ?? '—' }}</span>
            </div>
            <div class="run-time">
              <span class="run-time__label">实走执行</span>
              <span class="run-time__value mono">{{ clockOf(firedAt[currentIndex]) || '——' }}</span>
            </div>
            <div class="run-time">
              <span class="run-time__label">本条过渡</span>
              <span class="run-time__value mono">{{ formatSeconds(cueTotalSeconds(currentCue)) }}</span>
            </div>
          </div>
          <FadeBar
            :fade-in-sec="currentCue.fadeInSec"
            :hold-sec="currentCue.holdSec"
            :fade-out-sec="currentCue.fadeOutSec"
            :height="12"
            compact
          />
        </div>

        <div v-if="finished" class="run-result">
          <p class="run-result__line">
            实走开始 <span class="mono">{{ clockOf(startAt ?? undefined) }}</span> ·
            实走结束 <span class="mono">{{ clockOf(endedAt ?? undefined) }}</span>
            <template v-if="timeline?.finishClock"> · 预计结束 <span class="mono">{{ timeline.finishClock }}</span></template>
          </p>
          <p v-if="actualOverrunSec !== null" class="run-result__overrun" :class="{ 'run-result__overrun--ok': actualOverrunSec === 0 }">
            {{ actualOverrunSec > 0 ? `晚于计划结束 ${formatSeconds(actualOverrunSec)}` : '不晚于计划结束' }}
          </p>
        </div>
      </section>

      <section class="panel">
        <h2 class="panel__title">
          Cue 走场顺序<span class="panel__title-tag">高亮为当前提示点，跟随 / 挂起自动往前</span>
        </h2>
        <div class="run-list">
          <article
            v-for="(cue, index) in cues"
            :key="cue.id"
            class="run-row"
            :class="{
              'run-row--current': rowState(index) === 'current',
              'run-row--done': rowState(index) === 'done'
            }"
          >
            <span class="run-row__index mono">{{ index + 1 }}</span>
            <span class="run-row__no mono">{{ cue.cueNo }}</span>
            <span class="run-row__label">{{ cue.label || '（无提示语）' }}</span>
            <NTag size="tiny" :bordered="false" type="warning">{{ followLabelOf(cue, index) }}</NTag>
            <span class="run-row__clock run-row__clock--plan mono" title="预计执行时刻">
              预 {{ timingByCueId.get(cue.id)?.clock ?? '—' }}
            </span>
            <span
              class="run-row__clock mono"
              :class="rowState(index) === 'done' ? 'run-row__clock--fired' : 'run-row__clock--idle'"
            >
              实 {{ clockOf(firedAt[index]) || '--:--:--' }}
            </span>
            <span class="run-row__state">
              <template v-if="rowState(index) === 'done'">✓ 已执行</template>
              <template v-else-if="rowState(index) === 'current'">
                {{ waitingManual ? '等待 GO' : started ? '执行中' : '待开始' }}
              </template>
              <template v-else>待执行</template>
            </span>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.run-stage {
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-color: rgba(127, 212, 193, 0.25);
}

.run-stage--manual {
  border-color: rgba(232, 84, 84, 0.5);
  box-shadow: 0 0 0 1px rgba(232, 84, 84, 0.18) inset;
}

.run-stage--done {
  border-color: rgba(63, 191, 159, 0.45);
}

.run-stage__status {
  display: flex;
  align-items: center;
  gap: 12px;
}

.run-stage__text {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.run-stage__cue {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border-radius: 12px;
  background: rgba(127, 212, 193, 0.05);
  border: 1px solid rgba(127, 212, 193, 0.16);
}

.run-stage__cue-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.run-stage__no {
  font-size: 22px;
  font-weight: 700;
  color: #7fd4c1;
}

.run-stage__label {
  font-size: 16px;
  font-weight: 600;
}

.run-stage__note {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}

.run-stage__times {
  display: flex;
  gap: 28px;
  flex-wrap: wrap;
}

.run-time {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.run-time__label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.run-time__value {
  font-size: 18px;
  font-weight: 600;
  color: #f2b544;
  font-variant-numeric: tabular-nums;
}

.run-result {
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(63, 191, 159, 0.08);
  border: 1px solid rgba(63, 191, 159, 0.24);
}

.run-result__line {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.78);
}

.run-result__overrun {
  margin: 6px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: #ff9a9a;
}

.run-result__overrun--ok {
  color: #7fd4c1;
}

.run-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.run-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: border-color 0.16s ease, background 0.16s ease;
}

.run-row--current {
  border-color: rgba(242, 181, 68, 0.7);
  background: rgba(242, 181, 68, 0.1);
  box-shadow: 0 0 0 1px rgba(242, 181, 68, 0.25) inset;
}

.run-row--done {
  opacity: 0.62;
}

.run-row__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  flex: none;
}

.run-row--current .run-row__index {
  background: rgba(242, 181, 68, 0.25);
  color: #f2b544;
}

.run-row__no {
  font-weight: 600;
  color: #f2b544;
  min-width: 60px;
}

.run-row__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.run-row__clock {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.run-row__clock--plan {
  color: rgba(127, 212, 193, 0.85);
}

.run-row__clock--fired {
  color: rgba(255, 255, 255, 0.85);
}

.run-row__clock--idle {
  color: rgba(255, 255, 255, 0.28);
}

.run-row__state {
  min-width: 72px;
  text-align: right;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.run-row--current .run-row__state {
  color: #f2b544;
  font-weight: 600;
}
</style>
