// Entry point: wires ui-state and ui-session for one repo and serves them on 127.0.0.1.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { USAGE, parseArgs } from './args.ts';

const uiDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function oneLine(e: unknown): string {
  return String((e as Error)?.message ?? e).split('\n')[0]!;
}

function fail(code: number, msg: string): never {
  process.stderr.write(msg.replace(/\s*\n\s*/g, ' ') + '\n');
  process.exit(code);
}

// Warn, never exit: the UI is tested on the engines range but still runs on older Node.
const { nodeVersionWarning, readEnginesRange } = await import('./node-version.ts');
const nodeWarning = nodeVersionWarning(process.versions.node, readEnginesRange(uiDir) ?? '');
if (nodeWarning) process.stderr.write(nodeWarning + '\n');

const args = parseArgs(process.argv.slice(2), fail, (line) => process.stderr.write(line + '\n'));
const repo = resolve(args.repo ?? process.env.INIT_CWD ?? process.cwd());
const pluginPath = resolve(args.plugin ?? join(uiDir, '..', 'plugins', 'ankur'));
if (!existsSync(join(pluginPath, '.claude-plugin', 'plugin.json'))) {
  fail(2, `plugin root ${pluginPath} has no .claude-plugin/plugin.json; ${USAGE}`);
}
const ankurDirFlag = args.ankurDir === undefined ? undefined : resolve(args.ankurDir);

// Loaded after the flag checks so a bad command line exits 2 before these modules are touched.
const { createStore, ankurDirFor } = await import('./state/index.ts');
const { createSession } = await import('./session/index.ts');
const { createServer } = await import('./http/index.ts');

const claudeDir = resolve(args.claudeDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'));
const store = createStore(ankurDirFlag === undefined ? { repo, pluginPath, claudeDir } : { repo, pluginPath, claudeDir, ankurDir: ankurDirFlag });
// The run as the store holds it: a typed goal starts /ankur:run only when no plan is live.
const liveRun = () => (store.snapshot().state as { run?: { version: number | null; crews: { slug: string }[] } | null }).run ?? null;
const session = createSession({
  repo,
  pluginPath,
  claudeDir,
  hasPlan: () => { const r = liveRun(); return r !== null && r.version !== null; },
  crewSlugs: () => liveRun()?.crews.map((c) => c.slug) ?? [],
});
let lastSessionId: string | null = null;
session.subscribe((view) => {
  store.setSession(view);
  const id = view.session.sessionId;
  if (ankurDirFlag === undefined && id && id !== lastSessionId) {
    lastSessionId = id;
    ankurDirFor(repo, id).then(
      (dir) => { if (lastSessionId === id) store.setAnkurDir(dir); },
      (e) => process.stderr.write(`ankur dir lookup failed: ${oneLine(e)}\n`),
    );
  }
});

const webDir = join(uiDir, 'web');
// No client build: start anyway (GET / answers the 503 page) and say once, on stderr, how to build it.
const webIndex = join(webDir, 'index.html');
if (!existsSync(webIndex)) {
  const { BUILD_CMD } = await import('./http/static.ts');
  process.stderr.write(`ankur-ui: no client build at ${webIndex}; run: ${BUILD_CMD}\n`);
}
const server = createServer({ state: store, session, webDir });
const { onShutdownSignals, watchParent, lockPath, writeLock, readLiveLock, removeLock, addrInUseMessage } = await import('./lifecycle.ts');
let url: string;
let port: number;
try {
  ({ url, port } = await server.listen(args.port));
} catch (e) {
  session.close().catch(() => {});
  store.close();
  if ((e as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
    process.stderr.write(addrInUseMessage('127.0.0.1', args.port, readLiveLock(lockPath(args.port))));
    process.exit(1);
  }
  fail(1, `listen failed: ${oneLine(e)}`);
}
const lock = lockPath(port);
if (!writeLock(lock, { pid: process.pid, host: '127.0.0.1', port, startedAt: new Date().toISOString() })) {
  process.stderr.write(`ankur-ui: could not write lockfile ${lock}; carrying on without it\n`);
}
process.on('exit', () => removeLock(lock));
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  // A stuck session close must not leave the port held: force the exit after 5 s.
  setTimeout(() => { removeLock(lock); process.exit(0); }, 5000).unref();
  try { await session.close(); } catch (e) { process.stderr.write(`session close failed: ${oneLine(e)}\n`); }
  try { await server.close(); } catch (e) { process.stderr.write(`server close failed: ${oneLine(e)}\n`); }
  store.close();
  removeLock(lock);
  process.exit(0);
}
// SIGINT, SIGTERM, SIGHUP and SIGBREAK, and the parent or any ancestor (npm, cmd.exe, a shell) going away, all end the server.
onShutdownSignals(process, shutdown);
watchParent(shutdown);
// Printed last, so whoever waits on this line can already stop the server with any of the signals above.
process.stdout.write(`ankur-ui listening on ${url}\n`);
