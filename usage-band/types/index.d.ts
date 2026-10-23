// One rate-limit window as the session reported it.
export type UsageWindow = {
  kind: 'five_hour' | 'seven_day'
  percent: number
  resetsAt?: string
}

// What the band draws. `isStale`: the windows are the last reading kept from an
// earlier session, until this session's first response reports its own.
export type Reading = {
  windows: UsageWindow[]
  context?: number
  isStale: boolean
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { reading: Reading | null }
  }
}
