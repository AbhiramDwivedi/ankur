// The plugin's one hooks module, loaded only by the Claude Code engine: the gate hooks, then the factory floor.
// Node code (the factory CLI, the tests) imports register.ts, which never reaches a .tsx file.
import type { Register } from 'claude-code'

import { registerGates } from './register.ts'
import { setupFloor } from './floor/register.tsx'

export const register: Register = on => {
  registerGates(on)
  // a throw inside the floor's setup draws nothing and leaves the gate hooks in place
  try {
    setupFloor(on)
  } catch {
    // nothing to draw
  }
}
