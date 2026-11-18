# ankur

Ankur is a Claude Code plugin that sets up a software factory for a project, then runs it: it builds the agents, skills, architecture doc, ADRs and quality gates the project needs, then uses them to build goals in parallel crews, each in its own worktree, checked by tests and a QC engineer.

The name is Sanskrit: ankur (अंकुर) means "sprout".

## Install

There are two ways in. Option 1 is the plugin alone. Option 2 adds the ankur UI, which runs on top of the plugin. Run each command on its own line, in any shell on macOS, Linux or Windows.

### Option 1: the engine alone

The engine is the ankur plugin, which you drive from Claude Code. Add the claude-ops marketplace first. ankur depends on three claude-ops plugins, and `claude plugin install ankur@ankur` installs them with it. One of them is kit, which builds the project's team of agents, and `/ankur:init` runs kit's set-up for you.

```sh
claude plugin marketplace add AbhiramDwivedi/claude-ops
claude plugin marketplace add AbhiramDwivedi/ankur
claude plugin install ankur@ankur
```

Without the claude-ops marketplace, ankur fails to load. To fix it, add that marketplace, then reinstall ankur.

### Option 2: the ankur UI on top of the engine

The ankur UI is a local web page that runs on top of the engine. One Node process on your machine hosts a Claude Code session with the ankur plugin loaded, and the page shows the run live: your conversation with the project manager, the crews at work, and what needs you. It listens on `127.0.0.1` only and asks for no API key of its own.

It needs Node 24 or later, a git repo to run ankur in, and a logged-in Claude Code, because it drives your local Claude Code on your existing login. The UI is not part of the plugin install, so clone this repo, then install, build and start it from the repo root:

```sh
git clone -b main https://github.com/AbhiramDwivedi/ankur.git
cd ankur
npm --prefix ui ci
npm --prefix ui run build
npm --prefix ui start
```

The server prints one line, `ankur-ui listening on http://127.0.0.1:<port>/?token=<token>`. Open that whole URL in your browser. To point it at another repo, add `-- --repo <path>` to the start command. [ui/README.md](ui/README.md) has the flags and how to stop it.

## Read more

The manual is [plugins/ankur/README.md](plugins/ankur/README.md). The release history is in [CHANGELOG.md](CHANGELOG.md). The UI source is in `ui/`, and its setup is in [ui/README.md](ui/README.md).

ankur is released under the license in [LICENSE](LICENSE).
