// the five-hour limit reset a wake is armed for, and whether that wake has gone out
export type LimitReset = { resetsAt: string; fired: boolean }

// what ankur keeps in the session's $.state, so it survives a hot reload of the hooks module
declare module 'claude-code' {
  interface PluginState {
    ankur: { limitReset: LimitReset }
  }
}
