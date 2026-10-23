import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, ThemeKey } from 'claude-code'

import type { Reading, UsageWindow } from '../types'

// A band above the prompt with the session's plan usage: 5h and 7d windows
// (bar, pace marker, percent, reset countdown) and the context window. Reads
// only what the session reports; the last reading is kept per account so a new
// session starts with it.

const CELLS = 10
// Below this many columns the bars drop out; the full line is about 82 wide.
const NARROW = 88
const WINDOWS = [
  { kind: 'five_hour', label: '5h', ms: 5 * 3_600_000 },
  { kind: 'seven_day', label: '7d', ms: 7 * 86_400_000 },
] as const

const reading = atom({ plugin: 'usage-band', key: 'reading' } as const, null)

let config = { warnAt: 70, criticalAt: 90, showPace: true, showContext: true, toast: true }
let tick: { cancel: () => void } | undefined

export function filled(percent: number): number {
  return Math.min(CELLS, Math.max(0, Math.round(percent / (100 / CELLS))))
}

export function level(percent: number, warnAt = 70, criticalAt = 90): ThemeKey {
  return percent >= criticalAt ? 'error' : percent >= warnAt ? 'warning' : 'success'
}

// The cell an even pace through the window has reached, or undefined.
export function paceCell(resetsAt: string | undefined, windowMs: number, now: number): number | undefined {
  const end = resetsAt ? Date.parse(resetsAt) : NaN
  if (Number.isNaN(end)) return undefined
  const elapsed = Math.min(1, Math.max(0, 1 - (end - now) / windowMs))
  return Math.min(CELLS - 1, Math.floor(elapsed * CELLS))
}

// Time left as its two largest units: 45m, 2h13m, 3d4h.
export function countdown(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${String(mins).padStart(2, '0')}m`
  return `${mins}m`
}

// The bar as runs of filled, empty and pace cells.
export function runs(percent: number, pace?: number): { text: string; kind: 'fill' | 'empty' | 'pace' }[] {
  const full = filled(percent)
  const out: { text: string; kind: 'fill' | 'empty' | 'pace' }[] = []
  for (let i = 0; i < CELLS; i++) {
    const kind = i === pace ? 'pace' : i < full ? 'fill' : 'empty'
    const text = kind === 'pace' ? '│' : kind === 'fill' ? '▰' : '▱'
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += text
    else out.push({ text, kind })
  }
  return out
}

const toWindows = (limits: readonly SessionRateLimit[]): UsageWindow[] =>
  limits.flatMap(l =>
    l.kind === 'five_hour' || l.kind === 'seven_day'
      ? [{ kind: l.kind, percent: l.percentUsed, resetsAt: l.resetsAt }]
      : [],
  )

const isCurrent = (w: UsageWindow, now: number) => !w.resetsAt || Date.parse(w.resetsAt) > now

async function account($: EngineInterface): Promise<string> {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) ?? 'default'
}

async function remember($: EngineInterface, windows: UsageWindow[]): Promise<void> {
  if (windows.length) await $.store.set(`last:${await account($)}`, windows)
}

async function recall($: EngineInterface, now: number): Promise<UsageWindow[]> {
  const kept = (await $.store.get(`last:${await account($)}`)) as UsageWindow[] | undefined
  return (kept ?? []).filter(w => isCurrent(w, now))
}

// Toasts once per window when it crosses the red threshold.
async function warn($: EngineInterface, windows: UsageWindow[], now: number): Promise<void> {
  if (!config.toast) return
  for (const w of windows) {
    if (w.percent < config.criticalAt) continue
    const key = `toasted:${await account($)}:${w.kind}`
    if ((await $.store.get(key)) === (w.resetsAt ?? 'unknown')) continue
    await $.store.set(key, w.resetsAt ?? 'unknown')
    const label = w.kind === 'five_hour' ? '5-hour' : '7-day'
    const left = w.resetsAt ? `, resets in ${countdown(Date.parse(w.resetsAt) - now)}` : ''
    $.ui.toast(`${label} usage at ${Math.round(w.percent)}%${left}`)
  }
}

async function measured($: EngineInterface, limits: readonly SessionRateLimit[], context?: number): Promise<void> {
  const now = await $.clock.now()
  const windows = toWindows(limits)
  const prior = await read($, reading)
  await update($, reading, () =>
    windows.length
      ? { windows, context: context ?? prior?.context, isStale: false, now }
      : { windows: prior?.windows ?? [], context: context ?? prior?.context, isStale: prior?.isStale ?? true, now },
  )
  if (windows.length) {
    await remember($, windows)
    await warn($, windows, now)
  }
}

async function start($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const usage = await $.session.usage()
  const live = toWindows(usage.rateLimits)
  const windows = live.length ? live : await recall($, now)
  await update($, reading, () => ({
    windows,
    context: usage.context.percent,
    isStale: live.length === 0,
    now,
  }))
  if (live.length) {
    await remember($, live)
    await warn($, live, now)
  }
}

async function clock($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, reading, r => (r ? { ...r, now, windows: r.windows.filter(w => isCurrent(w, now)) } : r))
}

export const register: Register = (on, options) => {
  config = {
    warnAt: Number(options.warnAt ?? 70),
    criticalAt: Number(options.criticalAt ?? 90),
    showPace: options.showPace !== false,
    showContext: options.showContext !== false,
    toast: options.toast !== false,
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      await start($)
    } catch {
      // Nothing to show until the session reports usage.
    }
    tick?.cancel()
    // Countdowns and pace markers move with the clock.
    tick = $.clock.every(60_000, () => void clock($).catch(() => undefined))
    return started
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') || e.changed.includes('context')) {
      await measured($, e.rateLimits, e.context.percent).catch(() => undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, reading)
    const context = config.showContext ? r?.context : undefined
    if (e.props.hasSurvey || !r || (r.windows.length === 0 && context === undefined)) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const isNarrow = e.props.bodyColumns < NARROW

    const bar = (percent: number, pace?: number) =>
      isNarrow ? null : (
        <Text>
          {runs(percent, config.showPace ? pace : undefined).map(run =>
            run.kind === 'fill' ? (
              <Text color={level(percent, config.warnAt, config.criticalAt)}>{run.text}</Text>
            ) : run.kind === 'pace' ? (
              <Text bold>{run.text}</Text>
            ) : (
              <Text dimColor>{run.text}</Text>
            ),
          )}{' '}
        </Text>
      )

    const parts = WINDOWS.flatMap(spec => {
      const w = r.windows.find(x => x.kind === spec.kind)
      if (!w) return []
      const left = w.resetsAt ? Date.parse(w.resetsAt) - r.now : NaN
      return [
        <Text>
          {spec.label} {bar(w.percent, paceCell(w.resetsAt, spec.ms, r.now))}
          <Text dimColor={r.isStale}>{Math.round(w.percent)}%</Text>
          {Number.isNaN(left) ? '' : <Text dimColor> {countdown(left)}</Text>}
        </Text>,
      ]
    })
    if (context !== undefined) {
      parts.push(
        <Text>
          context {bar(context)}
          {Math.round(context)}%
        </Text>,
      )
    }

    return (
      <Box>
        <Text>
          <Text bold>Usage</Text>
          {'  '}
          {parts.flatMap((part, i) => (i ? [<Text dimColor> · </Text>, part] : [part]))}
        </Text>
      </Box>
    )
  })
}
