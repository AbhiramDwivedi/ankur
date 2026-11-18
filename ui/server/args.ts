// ankur-allow-truss: --truss-dir is the old name of --ankur-dir, kept as a deprecated alias for one release.
// The UI's command line: flags and their values, two argv entries each.
export const USAGE = 'usage: node ui/server/main.ts [--repo <path>] [--plugin <path>] [--ankur-dir <path>] [--claude-dir <path>] [--port <n>]';

export interface Args { repo?: string; plugin?: string; ankurDir?: string; claudeDir?: string; port: number }

const FLAGS = ['--repo', '--plugin', '--ankur-dir', '--truss-dir', '--claude-dir', '--port']; // ankur-allow-truss

// `fail` ends the process with a message; `warn` prints one line to the user.
export function parseArgs(argv: string[], fail: (code: number, msg: string) => never, warn: (line: string) => void): Args {
  const o: Args = { port: 0 };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!;
    if (!FLAGS.includes(flag)) fail(2, `unknown argument ${flag}; ${USAGE}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail(2, `${flag} needs a value; ${USAGE}`);
    if (flag === '--repo') o.repo = value;
    else if (flag === '--plugin') o.plugin = value;
    else if (flag === '--ankur-dir') o.ankurDir = value;
    else if (flag === '--truss-dir') { // ankur-allow-truss
      warn('ankur-ui: --truss-dir is deprecated; use --ankur-dir instead'); // ankur-allow-truss
      if (o.ankurDir === undefined) o.ankurDir = value;
    } else if (flag === '--claude-dir') o.claudeDir = value;
    else {
      if (!/^\d+$/.test(value) || Number(value) > 65535) fail(2, `--port must be an integer 0 to 65535; ${USAGE}`);
      o.port = Number(value);
    }
  }
  return o;
}
