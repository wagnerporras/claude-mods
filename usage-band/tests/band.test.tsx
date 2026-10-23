import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'
import { countdown, filled, level, paceCell, runs } from '../hooks/register'

const NOW = Date.parse('2026-10-23T12:00:00Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()
const H = 3_600_000

// 5h: 16% used, resets in 2h13m; 7d: 48%, resets in 3d4h.
const LIMITS: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 16, resetsAt: at(2 * H + 13 * 60_000) },
  { kind: 'seven_day', percentUsed: 48, resetsAt: at(76 * H) },
]

// Stands for the engine beneath the mod: the clock, the store, the session's
// usage and toasts.
function world(on: On, usage: { rateLimits: SessionRateLimit[]; percent?: number }, stored = {}) {
  const toasts: string[] = []
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, stored)
  mock.env(on, {})
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: usage.percent }, rateLimits: usage.rateLimits },
  }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return { clock, toasts }
}

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

const band$ = (columns: number) =>
  ({
    plugin: 'usage-band',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  }) as const

// The band as drawn: its words, each coloured run as `text:colour`, the dimmed runs.
async function band($: Engine, surface: 'terminal' | 'desktop' = 'terminal', columns = 120) {
  const ui = await $.ui.mount({ ...band$(columns), surface })
  const all = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return {
    text: all[0]?.text ?? '',
    colours: all.filter(t => t.props.color).map(t => `${t.text}:${String(t.props.color)}`),
    dimmed: all.filter(t => t.props.dimColor).map(t => t.text),
  }
}

const measure = (rateLimits: SessionRateLimit[], percent?: number) => ({
  context: { window: 200_000, percent },
  rateLimits,
  changed: ['rateLimits', 'context'] as ('rateLimits' | 'context')[],
})

test('the session reports usage: bars with pace markers, countdowns, context', async ($, on) => {
  world(on, { rateLimits: LIMITS, percent: 22 })
  await $.session.start(START)

  for (const surface of ['terminal', 'desktop'] as const) {
    const b = await band($, surface)
    expect(b.text).toBe(
      'Usage  5h ▰▰▱▱▱│▱▱▱▱ 16% 2h13m · 7d ▰▰▰▰▰│▱▱▱▱ 48% 3d4h · context ▰▰▱▱▱▱▱▱▱▱ 22%',
    )
    expect(b.colours).toEqual(['▰▰:success', '▰▰▰▰▰:success', '▰▰:success'])
    expect(b.dimmed).not.toContain('16%')
  }
})

test('a new session shows the last reading, dimmed, until its first response', async ($, on) => {
  const kept = [
    { kind: 'five_hour', percent: 30, resetsAt: at(H) },
    // Reset an hour ago: dropped.
    { kind: 'seven_day', percent: 61, resetsAt: at(-H) },
  ]
  world(on, { rateLimits: [] }, { 'last:default': kept })
  await $.session.start(START)

  let b = await band($)
  expect(b.text).toBe('Usage  5h ▰▰▰▱▱▱▱▱│▱ 30% 1h00m')
  expect(b.dimmed).toContain('30%')

  await $.session.measure(measure(LIMITS, 5))
  b = await band($)
  expect(b.text).toMatch(/^Usage {2}5h ▰▰▱▱▱│▱▱▱▱ 16% 2h13m · 7d /)
  expect(b.dimmed).not.toContain('16%')
})

test('near the limits: amber, red, and one toast per window', async ($, on) => {
  const w = world(on, { rateLimits: LIMITS })
  await $.session.start(START)

  const hot: SessionRateLimit[] = [
    { kind: 'five_hour', percentUsed: 92.4, resetsAt: at(45 * 60_000) },
    { kind: 'seven_day', percentUsed: 74, resetsAt: at(76 * H) },
  ]
  await $.session.measure(measure(hot))
  await $.session.measure(measure(hot))
  const b = await band($)
  // A pace marker inside the filled cells takes that cell.
  expect(b.text).toMatch(/5h ▰▰▰▰▰▰▰▰│▱ 92% 45m · 7d ▰▰▰▰▰│▰▱▱▱ 74%/)
  expect(b.colours).toEqual(['▰▰▰▰▰▰▰▰:error', '▰▰▰▰▰:warning', '▰:warning'])
  expect(w.toasts).toEqual(['5-hour usage at 92%, resets in 45m'])
})

test('a session that starts past the red threshold toasts at once, and only once', async ($, on) => {
  const hot: SessionRateLimit[] = [{ kind: 'seven_day', percentUsed: 95, resetsAt: at(30 * H) }]
  const w = world(on, { rateLimits: hot })
  await $.session.start(START)
  await $.session.measure(measure(hot))
  expect(w.toasts).toEqual(['7-day usage at 95%, resets in 1d6h'])
})

test('narrow terminal: no bars', async ($, on) => {
  world(on, { rateLimits: LIMITS, percent: 22 })
  await $.session.start(START)
  expect((await band($, 'terminal', 60)).text).toBe('Usage  5h 16% 2h13m · 7d 48% 3d4h · context 22%')
})

test(
  'options: thresholds, no pace marker, no context bar, no toast',
  { options: { warnAt: 10, criticalAt: 40, showPace: false, showContext: false, toast: false } },
  async ($, on) => {
    const w = world(on, { rateLimits: LIMITS, percent: 22 })
    await $.session.start(START)
    await $.session.measure(measure(LIMITS, 22))
    const b = await band($)
    expect(b.text).toBe('Usage  5h ▰▰▱▱▱▱▱▱▱▱ 16% 2h13m · 7d ▰▰▰▰▰▱▱▱▱▱ 48% 3d4h')
    expect(b.colours).toEqual(['▰▰:warning', '▰▰▰▰▰:error'])
    expect(w.toasts).toEqual([])
  },
)

test('countdowns move with the clock; a window that resets leaves the band', async ($, on) => {
  const w = world(on, { rateLimits: LIMITS })
  await $.session.start(START)
  await w.clock.advance(60 * 60_000)
  expect((await band($)).text).toMatch(/5h ▰▰▱▱▱▱▱│▱▱ 16% 1h13m · 7d .* 48% 3d3h/)
  await w.clock.advance(75 * 60_000)
  expect((await band($)).text).toMatch(/^Usage {2}7d /)
})

test('no plan usage and no context (an API key session): the band is left to others', async ($, on) => {
  world(on, { rateLimits: [] })
  await $.session.start(START)
  expect((await band($)).text).toBe('engine')
})

test('pieces: cells, colours, pace, countdowns', async () => {
  expect([0, 4, 5, 46, 96, 100, 180, -10].map(filled)).toEqual([0, 0, 1, 5, 10, 10, 10, 0])
  expect([0, 69.9, 70, 89.9, 90].map(p => level(p))).toEqual(['success', 'success', 'warning', 'warning', 'error'])
  expect(paceCell(at(5 * H), 5 * H, NOW)).toBe(0)
  expect(paceCell(at(0), 5 * H, NOW)).toBe(9)
  expect(paceCell(undefined, 5 * H, NOW)).toBeUndefined()
  expect(runs(30, 1).map(r => r.text).join('')).toBe('▰│▰▱▱▱▱▱▱▱')
  expect([0, 45 * 60_000, 2 * H + 5 * 60_000, 76 * H].map(countdown)).toEqual(['0m', '45m', '2h05m', '3d4h'])
})
