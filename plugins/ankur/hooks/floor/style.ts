// Every glyph, theme colour key and width constant the floor draws with. Views hold no literal of these.
export const GLYPH = {
  merged: '✓',
  dropped: '✗',
  running: '●',
  planned: '○',
  stuck: '▲',
  need: '◆',
  ellipsis: '…',
  range: '–',
} as const

// Engine ThemeKeys only.
export const TONE = {
  done: 'success',
  attention: 'warning',
  quiet: 'inactive',
  fail: 'error',
  border: 'subtle',
} as const

export const WIDTH = {
  BAND_MIN_GOAL: 12,
  BAND_SLACK: 2,
  BAND_MARK: 5,
  BAND_GAP: 2, // cells between the band's parts
  BAND_FALLBACK_COLUMNS: 120, // a terminal's width when the engine gives no bodyColumns; the mark comes off it
  KEY_PREFIX: 3, // a plain Button with a hotkey draws "f: " before its label
  SLUG_COL: 44,
  STATUS_COL: 9,
  AGENTS_COL: 6,
  TIME_COL: 12,
  ADR_STATUS_COL: 11,
  ADR_STATUS_PAD: 10,
  WIDE: 100,
  NARROW: 60,
  DECISIONS_MAX: 60,
  SLUG_SHARE: 0.35,
  SLUG_MIN: 12,
  GLYPH_COL: 2, // a crew row's glyph column
  GOAL_CLIP: 400,
} as const

// How far an expanded crew's lines are indented, in cells.
export const INDENT = 4

// The key of the open action preview's Box, which register.tsx scrolls into view.
export const PREVIEW_KEY = 'preview'

// One table of hotkeys, by site. A test asserts no two Buttons drawn at once share a key.
export const HOTKEY = {
  tabs: { crews: 'c', move: 'y', decisions: 'd', adrs: 'a', design: 'g' },
  crews: { done: 'f' },
  actions: { restart: 'r', successor: 's', replan: 'p', ask: 'k' },
  inbox: { approve: 'p', reject: 'r', own: 'w' },
  preview: { confirm: 'o', cancel: 'x' },
  design: { prev: 'b', next: 'n', left: 'h', right: 'l' },
  band: { floor: 'f' },
} as const

// One sideways scroll step of a diagram: half the body.
export const scrollStep = (bodyColumns: number): number => Math.max(1, Math.floor(bodyColumns / 2))
