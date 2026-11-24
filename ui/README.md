# Ankur local web UI

`ui/` runs Ankur from a browser tab. One Node process hosts a Claude Code session with the Ankur plugin loaded, and serves a page that shows the run live in three columns, without scrolling the page. The left rail lists your workspaces. The centre holds the workspace header, a summary strip (the stage timeline and the usage so far) and tabs: Conversation, ADRs, Deliverables, Decisions and Design. The right side holds Your move (what needs you) on top, then one line per crew.

The UI is not part of the plugin install: `claude plugin install ankur@ankur` installs only `plugins/ankur/`. To get the UI, clone the repo:

```
git clone -b main https://github.com/AbhiramDwivedi/ankur.git
```

The commands below run from the repo root, the directory that holds `ui/` and `plugins/`.

## Check the requirements

- Node 24 or later. `ui/package.json` sets `"engines": { "node": ">=24" }`, and `node` runs the server's `.ts` files as they are. On an older Node the server prints a one-line warning to stderr at startup and carries on.
- Claude Code, logged in. The UI drives your local Claude Code through `@anthropic-ai/claude-agent-sdk` on your existing login. It asks for no API key of its own.
- One or more git repos to run Ankur in. You open them from the page, one workspace each.

## Install the dependencies

```
npm --prefix ui ci
```

This installs the exact versions in `ui/package-lock.json` into `ui/node_modules`.

## Build the page

```
npm --prefix ui run build
```

The page's source is in `ui/app/`: React 19, TypeScript, Tailwind v4 and shadcn primitives restyled to `ui/contract/redesign/tokens.json`, with Geist self-hosted. The build typechecks it, then Vite writes it to `ui/web/`, which the server serves. `ui/web/` is build output only and git ignores it, so build again after every pull or change under `ui/app/`.

The whole start path, from the repo root:

```
npm --prefix ui ci
npm --prefix ui run build
npm --prefix ui start
```

## Start the UI

1. Start the server. It starts with no repo open: you open one from the page in step 4. Run this from the repo root:

   ```
   node ui/server/main.ts
   ```

   Or start it through npm:

   ```
   npm --prefix ui start
   ```

   On Windows, stopping an `npm start` task (for example closing the terminal or stopping a background task) can leave npm and the server running, because the server's parent is npm's cmd shell. Start with `node` directly to avoid it. If a later start reports the port is in use and a running ankur UI is recorded for that port, the message names its pid. Stop it with `taskkill /PID <pid> /F` on Windows, or `kill <pid>` elsewhere.

   Start `node ui/server/main.ts` from your own terminal where you can. The server stops when any process that started it exits, so detached launches such as PowerShell Start-Process or WMI end with their launching shell or host. Started from a Claude Code background shell, it stays up, but that shell's reaper can kill it under memory pressure, which ends the Ankur session.

2. Wait for the one line the server prints:

   ```
   ankur-ui listening on http://127.0.0.1:36581/?token=<token>
   ```

   The port and token differ on every start.

3. Open that whole URL, token included, in your browser. The server sets a cookie for the token and redirects to the same page without it, so the token doesn't stay in the address bar.

4. Open a directory. The page asks for a path in the "Repo path" field. Type the full path of a git repo (`~` at the start means your home directory; other relative paths are refused) and open it. Any folder inside a repo opens that repo's workspace, and opening it again returns the workspace that is already open. A path that isn't a git repo or doesn't exist is refused with the reason.

   "Browse…" beside the field opens a folder browser instead of typing. It starts in your home folder, lists only folders, marks the ones that are git repos and has an "Up" row. On Windows the drives are listed at the top. Folders whose names start with a dot are hidden until you tick "Show hidden folders". "Use this folder" puts the path in the field and "Open this folder" opens it at once. The server does the listing, because a browser's own folder picker never gives a page the folder's full path.

   "Or clone a repository" takes a URL (`https://…`, `ssh://…` or `git@host:owner/repo`, from any git host) and an optional "Clone into" folder, which you can also pick with "Browse…". When that folder is left empty, the clone goes into `~/code`, or into your home folder when `~/code` doesn't exist. The server runs `git clone` into `<folder>/<repo name>` with your own git and its credentials, then opens the clone as a workspace. A target that already exists and isn't empty is refused, and so are local paths and `ext::` or `file::` URLs. Git gets 5 minutes. Git never prompts for a password in this mode, so a private repo needs a credential helper or an SSH key that is already set up. A sign-in failure, a repo that doesn't exist, a network failure and the timeout are each refused with what to do next.

   You can open several repos: each is a workspace, listed with its status and its open-request count, and you switch between them in the page.

5. Type your goal in the message box of a workspace and send it. That workspace's Claude Code session starts with its first message, not when the server starts or when you open the directory. Each workspace has its own conversation, crews and decisions, and its own session with the Ankur plugin loaded.

### Workspaces

- Each workspace has its own store and its own Claude Code session. Stopping a workspace ends only its session and the Claude Code process tree under it (its agents, workflows and heavy jobs), on Windows too. A later message to a stopped workspace starts a fresh session.
- **Resume an earlier session.** A workspace with no session going shows "Resume an earlier session" at the top of the Conversation tab. It lists the repository's earlier Claude Code sessions, newest first: the first prompt line (or the run's goal), the last activity, a short id. "Resume" makes the workspace's next session start with the SDK's `resume: <id>`. The session keeps its id (checked against SDK 0.3.314: no `forkSession`), so its transcript under `~/.claude/projects/` and its run folder under `<repo>/.git/ankur/<id>/` stay the same, and the Conversation tab shows the earlier conversation (the last 500 user and assistant messages of the transcript) until you send a message. This is how a restarted UI reconnects to the session it had before. The list is read from the transcripts (`CLAUDE_CONFIG_DIR` or `--claude-dir` decides where) and the run folders, in memory only.
- **Resume session (the row).** Where "Stop session" was, a workspace with no session going shows "Resume session" when its repository has an earlier session (the newest one, with a conversation on disk): one click resumes it through the same `POST /api/workspaces/<id>/resume`. It reads "Resuming…" and is disabled while the server answers, and a refusal shows under it. When another process holds that session the button reads "Resume anyway" under the same warning and sends `force`. The copy-resume button stays on the Resume list.
- **Two writers diverge.** The server finds a session another Claude Code process holds (a terminal `claude --resume`, another UI) from Claude Code's own `sessions/<pid>.json` files and a live pid. The row says so and its button reads "Resume anyway"; the server refuses a resume of it without that confirmation. A process this check cannot see is not caught: close the terminal copy first, because two live copies of one session do not see each other's messages.
- **Copy resume command.** The header (once the session has an id) and each row of the list have a "Copy resume command" button. It copies `cd <repo> && claude --resume <id>`, with the path single-quoted when it needs it, or on Windows PowerShell's `Set-Location '<repo>'; claude --resume <id>`. The shell is read off the repository path. It uses the Clipboard API, says "Copied" for two seconds, and when the browser has no clipboard (or refuses it) shows the command selected in a field you can copy by keyboard. Routes: `GET /api/workspaces/<id>/sessions` and `POST /api/workspaces/<id>/resume` (`{sessionId, force?}`; 400 `session`, 409 `transcript`, `busy` or `live`).
- Open workspaces live in the server's memory only. Restarting the server closes them all, and the UI stores nothing.
- The routes are `GET` and `POST /api/workspaces`, `POST /api/workspaces/clone` (`{url, parent}`: clone, then open), `GET /api/fs/dirs?path=<dir>&hidden=1` (the folder browser's listing), `POST /api/workspaces/<id>/stop`, and `/events`, `/message`, `/requests/<id>/answer` and `/image` under `/api/workspaces/<id>/`. The token, `Host` and `Origin` checks apply to every one. When the server was started with a first workspace (see Flags), the un-scoped `/api/events`, `/api/message`, `/api/requests/<id>/answer` and `/api/image` act on that first workspace.

### Flags

| Flag | Default | What it does |
|---|---|---|
| `--repo <path>` | none: no workspace is open | Optional. Opens this directory as the first workspace, as given, with no git check. Without it nothing is open at start, whatever directory you started from (the server no longer reads `INIT_CWD`). |
| `--plugin <path>` | `plugins/ankur` beside `ui/` | The Ankur plugin root. It must contain `.claude-plugin/plugin.json`, or the server exits with code 2. |
| `--ankur-dir <path>` | Found from the session id | Read this Ankur dir instead, for the `--repo` workspace. Meant for tests on a copy of real Ankur files. It does nothing without `--repo`. |
| `--port <n>` | `0` | The port to listen on, 0 to 65535. `0` lets the OS pick a free port. |

Every flag takes a value. An unknown flag or a missing value exits with code 2 and a usage line on stderr. A failed listen exits with code 1.

### What the UI does and doesn't do

- It listens on `127.0.0.1` only, so other machines can't reach it. Every request needs the token, from the URL or the cookie, and a `Host` of `127.0.0.1:<port>` or `localhost:<port>`.
- It stores nothing. The UI's own code writes no file: no database, log or cache. It reads Ankur's files and git, and shows them. The one exception you start yourself is "Clone a repository": git then contacts the host in the URL you gave and writes the clone into the folder you chose, as `git clone` in a terminal would. The Ankur plugin's hooks in the session still write the Ankur dir, as they do in a terminal.
- It sets no model and no spending limit. The session runs on Claude Code's default model, and the header shows the run's cost and usage with no ceiling.

## Stop the UI

Press Ctrl+C in the terminal that runs the server. On `SIGINT` or `SIGTERM` the server stops every workspace's Claude Code session and its process tree, closes the HTTP server, then exits with code 0.

## Run the checks

Run these from the repo root.

### Unit and contract tests

```
npm --prefix ui test
```

This runs `node --test` on `ui/contract/*.check.ts` (state, session, http) and `ui/test/*/*.test.ts`.

### Browser tests

1. Install the Playwright browsers once. The tests use Chromium only (`ui/e2e/browsers.spec.ts`):

   ```
   npx --prefix ui playwright install chromium
   ```

2. Run the tests:

   ```
   npm --prefix ui run e2e
   ```

   This runs `playwright test` in `ui/`, with `ui/playwright.config.ts`: the contract spec in `ui/contract/e2e/` and the UI specs in `ui/e2e/`. Each spec starts its own server on port 0. Arguments after `--` go to Playwright, for example `npm --prefix ui run e2e -- --list` to list the tests.

   Use the `npm` script, not `npx --prefix ui playwright test` from the repo root. `npx` runs in the current directory, so Playwright doesn't find `ui/playwright.config.ts`.

### Live check on your login

```
npm --prefix ui run check:live
```

This starts the real `ui/server/main.ts` on a temp git repo with the real Agent SDK and your real Claude Code login, so its model turns count against your account. It passes no model, answers a question card and a permission card over HTTP, and checks that each answer reaches the session within 1 s. It is in no acceptance test, because it needs your login.
