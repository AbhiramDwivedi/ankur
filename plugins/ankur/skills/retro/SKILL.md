---
name: retro
description: Counts what an ankur session recorded (escalations, checking engineer recommendations and overrules, stalls, spawns by model and effort, QC engineer rejections, decision timing, the plan) and proposes changes to .claude/ankur.json and the prompt-override files from them. Use when the person runs /ankur:retro, or asks how an ankur run went, what to change in ankur's setup, or why crews stalled or got rejected.
---

# ankur retro

You report what an ankur session dir recorded and propose setup changes from it. A script does the counting; you check its output. You read only the structured run files and git, never a transcript; only `recur` may read the `catalogHits` of `retro/extract.json`, when that file exists. You never print message, prompt or report text, except the QC engineer files' `VERDICT:` and finding lines that section 3 quotes as evidence. Section 6 holds the judges, the triage and the fix goal; at run end the PM decides whether to start the judges and the triage, and the fix goal waits for `/ankur:retro` or the client.

The person who ran `/ankur:retro` is the client.

## 1. Find the dir and run the script

The session's ankur dir is `<repo>/.git/ankur/<session id>/`. Use the current session's, or the one the client names. Resolve `<repo>` with `git rev-parse --git-common-dir`, which also works from a worktree.

Find the CLI: `${CLAUDE_PLUGIN_ROOT}/retro/cli.ts` when that variable is set, else `retro/cli.ts` two directories above this skill's own folder. Then run:

```
node <plugin root>/retro/cli.ts counts <ankur dir>
```

Exit 2 with `retro: NO_ANKUR_DIR:` means the dir is wrong: say so, show the path, ask the client for the right one, and stop. Any other failure: show the error and stop.

For the counts, read only the JSON it prints. Section 3 adds a few bounded reads of its own.

## 2. Report the counts

Per run (`runs`), then the dir-wide keys. Be brief; a table or short list per run.

- **Escalations** (`escalations`): QUESTION, BLOCKED, PROPOSAL. A project manager crew's come from its tagged messages to the program manager (PM); a Workflow crew's from the stops `factory.ts finish --result` records from the stage result, one per crew and run. A Workflow run that never went through `finish --result` records none.
- **Checking engineer** (`recommendations`): answer, defer, pass. With `decisions.overruled`, say how often the PM overruled.
- **Stalls** (`stalls`): agent and idle-project-manager.
- **Spawns** (`spawns`): total, and `byModelEffort`. `unset` means the call named no model or effort.
- **Client interruptions**: `escalations.QUESTION` and `escalations.BLOCKED` are what project managers sent the PM that could reach the client; the PM took only some to the client, so call these an upper bound. `messages` counts messages between project managers; report it separately as crew collisions.
- **QC rejections**: `qcs.fail` per run, and `qcFiles` for the whole dir (its files can't be split by run).
- **Spent allowances** (`allowancesSpent`, per run): how many distinct crews spent their rework allowance. `"not recorded"` means the log can't back a number, as on an old log or a run that spent none; say so and never write 0. `retro` stays 1.
- **Optional learning** (`knowledge`, per run): `crews` (the Workflow crews that recorded it), `items` (the learned items their members reported) and `ran` against `skipped`, from the `knowledge` lines `factory.ts finish --result` writes. A step runs when a member reported an item, a product call was made, or the diff added, renamed or deleted source files. Many crews with no items and no step run means members aren't reporting what they learn. `"not recorded"` means the run is not placed in the event log or no crew recorded the line; say so and never write 0.
- **Fetches** (`fetches`, per run): `total` and `perAgent`, the web fetches and searches the agents logged. `"not recorded"` means the run is not placed in the event log, or the whole log has no fetch line; say so and never write 0. A log with fetch lines but none in this run gives `total` 0.
- **Refusals** (`refusals`, per run): the tool calls refused before or as they ran, from the hooks' refusal lines. `total`; `bySource`: `ankur` (ankur's own hooks), `worktree-guard` (Claude Code's built-in confinement of a worktree-isolated agent; not a plugin and not ankur), `classifier` (the auto-mode classifier), `permission` (a permission rule, or the client said no), `other` (another plugin's hook); `byTool`; `byCategory`, keyed `<source>: <the refusal's own reason>`; `byProgram`, the refused Bash calls by their first word; `byShape`, the kinds of part those commands held (`heredoc`, `compound`, `cd`, `subst`, `var`, `pipe`, `loop`). The lines never hold a command's or a message's text. `"not recorded"` means the run is not placed in the event log, or the whole log has no refusal line; say so and never write 0.
- **Extend passes** (`extendPasses`, per run): commits in the run's window whose subject starts `docs(arch): extend ` or is `docs(arch): adopt learned items` or `docs(arch): reconcile learned items`. 0 means git was read and none matched. `"not recorded"` means the dir isn't `<repo>/.git/ankur/<session>`, git couldn't run, or the run has no parsed start.
- **Default decisions** (`defaultDecisions`): how many ADRs in the `adr` dir of `.claude/ankur.json` still hold the line `Decided by: default`. It is the repo's state now. `"not recorded"` means no repo root, no readable config, no `adr` key, or no such dir.
- **Open client actions** (`openClientActions`): how many `- [ ] ` lines sit under a `Client actions` heading in the file named by the `architecture` key, also the repo's state now. `"not recorded"` means no repo root, config, key or file. Report these as counts and propose no rule deletion from them.
- **Opus-high share**: the share of the run's spawns on Opus at `high` or `xhigh`: the sum of the `byModelEffort` counts whose model contains `opus` (case-folded) and whose effort is `high` or `xhigh`, over `spawns.total`. The target is 0, unless a line in `decisions.md` records the client's call for `high` or `xhigh`. Report any other non-zero share as over target. You compute it; the script prints no key for it.
- **Decision timing** (`decisions`): `clock`, `dateOnly`, `notRecorded`. Also `freeform` lines the script couldn't read as decisions.
- **Leftovers** (`leftovers`): this session's agents whose `worktree-agent-<id>` branch or `.claude/worktrees/agent-<id>` folder is still present. Report `count` and the names. `"not recorded"` means the dir isn't `<git common dir>/ankur/<session>`, there's no event log, or git couldn't run; say so and never write 0.
- **Leftover details** (`leftoverDetails`): per entry, report its `id`, `head`, `dirty`, `inMain` and `skip`; write a `null` value as none.
- **Plan** (`plan`): crews, stages, the `estAgents` total, and `status` counts, for the last run only. `agentCap` is retired; mention it only if an old plan.json still carries it as a number.
- **Goals** (`goals`, only when present): one row per goal with its crews, `estAgents`, status counts and decisions. A goal with crews but 0 decisions is not an anomaly and gets no `CAUSE:` line.

Read these three yourself from `<git common dir>/ankur/shared/`, which every session of the repo shares; each read counts as one bounded read.

- **Cost per merged crew**: read `<git common dir>/ankur/shared/ledger.jsonl` and keep the rows whose `session` is this session's id. Each row is one merge, with `crew`, `workType`, `process` and `costUsd`. When `costUsd` is null, write "not recorded" with the row's `costWhy`, never 0. Give the total of the priced rows and say how many crews it leaves out.
- **Long-term cost approve rate**: run `node <plugin>/bin/factory.ts inbox --kind long-term-cost --repo <repo>`, which lists the items of every session. Report the ltc approve rate as the items resolved `approve` over all resolved items. When the approve rate is above 90% over 10 or more resolved items, propose to tighten the long-term cost paragraph. The paragraph is in the plugin's agent files and Workflow prompts, so the proposal goes to the client as a plugin finding (section 3).
- **Quote audit**: from `node <plugin>/bin/factory.ts inbox --repo <repo>`, take each item with `by` `client`. Check each resolve's quote against the human-typed prompts of all the project's sessions: the main transcripts `<project>/<session id>.jsonl` under the transcript root (`$ANKUR_TRANSCRIPTS_ROOT`, else `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`), on user lines that pass the same test as `typedText` in `bin/inbox.ts`: not `isMeta`, `isSidechain`, `isCompactSummary` or `isVisibleInTranscriptOnly`, no `origin` whose kind is not `human`, no `wakeupSource`, `scheduledTaskId` or `scheduledFireId`, no `promptSource` other than `typed`, and no `tool_result`; a text with a bash or local-command output tag (`OUTPUT_TAG` in `bin/inbox.ts`) never counts. Report how many quotes match a typed prompt and list the item ids that don't. Never print a quote or a prompt. Report each quote with no typed prompt behind it to the client as a possible forged approval.

Wherever the JSON says `"not recorded"`, write "not recorded". Never turn it into zero, and never guess a number. If `split` is `"not recorded"`, say the dir couldn't be split into runs: the counts are for the whole dir, and the event-derived ones (spawns, stalls, escalations, QC engineers) weren't recorded. If `eventsSkipped` is above 0, say how many event lines were skipped; `eventsOutsideRuns` events fell before the first run heading.

## 3. Find the causes

Give each anomaly one line, exactly `CAUSE: <anomaly> | <evidence> | <fix location>`. There are six kinds. `<anomaly>` starts with the kind's name, then names the item, for example `leftover a0123456789abcdef` or `QC engineer fail auth-qc-2`.

- `leftover`: each `leftoverDetails` entry.
- `QC engineer fail`: each QC engineer file (`reports/<crew>/<name>-qc.md` or `<name>-qc-<n>.md` in the ankur dir) whose first line starts `VERDICT: FAIL`.
- `stall`: per run, a non-zero `stalls.agent` or `stalls.idleProjectManager`.
- `overrule`: per run, a non-zero `decisions.overruled`.
- `spent allowance`: per run, a non-zero `allowancesSpent`.
- `refusal`: per run, each `refusals.byCategory` entry of 3 or more, named by its key, for example `refusal worktree-guard: is too complex to verify that it stays inside the worktree`.

For a `refusal`, the evidence is the entry's count with the run's `byTool`, `byProgram` and `byShape` counts; the fix location follows the source:

- `ankur`: `plugin: hooks/register.ts`, naming the rule, when the counts show the rule refusing calls it should let through (a false positive); a refusal that is the rule doing its job gets `none`.
- `worktree-guard`: the guard is Claude Code's, so no ankur hook and no allow rule loosens it. Steer the members instead: `plugin: workflows/stage.js` (the member brief) when the commands are ones ankur's own prompts ask for, else `.claude/ankur/prompts/<role>.md` with a line such as "write files with Write or Edit, never a shell heredoc; one plain command per Bash call, with no `&&`, `;`, `cd` or `$VAR`".
- `permission`, and `classifier: no verdict` on a command the project runs every time (its tests, its build, read-only git): `.claude/settings.json` `permissions.allow`, one narrow rule (section 4).
- `classifier` with a named category (`Self-Modification`, `Code from External` and the like): `none`. The classifier did its job; never propose a rule to get past it.
- `other`: the plugin it names, as a plugin finding for the client; ankur writes nothing for it.

Spawns over estAgents are not an anomaly; give them no CAUSE line.

`<evidence>` is a fact from an allowed source, such as the entry's `skip` string or a QC engineer finding line (a line under the QC engineer file's `## Findings` heading that starts `- `). `<fix location>` is a file and a key, line or section. When the allowed sources don't show a cause, write `CAUSE: <anomaly> | not found | none`. Don't guess.

Its only sources are git, the disk, decisions.md, the QC engineer files' VERDICT: and finding lines, and the plugin's own files. It reads only the structured run files and git, never a transcript; only `recur` may read the `catalogHits` of `<ankur dir>/retro/extract.json`, when that file exists. The QC engineer files' `VERDICT:` and finding lines are the only report text it reads. Use at most 3 reads per anomaly; a git command, a file read and a grep each count as one.

A leftover whose `skip` is `passes every check retro can see` may still be kept by a check retro can't see: the session's own checkout, an agent that hasn't stopped, a crew member still running, or the checkout the last merge ran in. Say so in the evidence; don't pick one.

When the fix belongs in a file of the ankur plugin, not of the project, start `<fix location>` with `plugin: `. Plugin-level causes go to the client as plugin findings and are never written. Only project files (`.claude/ankur.json`, prompt-override files, and permission rules for `.claude/settings.json`) can become section 4 proposals.

## 4. Propose changes

Propose a change only when a count or a section 3 `CAUSE:` line supports it, and say which. Each proposal names a file and a key or path, the current value (read the file; it is the client's config, not a log), the new value, and why.

- `.claude/ankur.json`: `roles` (a job's agent type, for example a job whose QC engineer rejections or stalls cluster on one model), `deploy`, `writingSkill`, `promptOverrides`. Keep to keys the schema declares (`ankur-config.schema.json`).
- `.claude/ankur/prompts/<role>.md` for the roles `project-manager`, `qc-engineer`, `checking-engineer`, `writer`, `commissioning-engineer`, `design-engineer`: a line a role keeps missing, and the `promptOverrides` entry that points to the file. A prompt file adds to the role's prompt; it never replaces it.
- A persona `## Standards` item (`.claude/agents/<persona>.md`) or a rule-file item (`.claude/rules/<file>.md`): through the existing pass, when a QC note repeats across crews, propose the item that would make it a written rule the QC engineer can quote. The retro reads the `## Notes` of each crew's QC report files under `<ankur dir>/reports/<crew>/` (the newest `*-qc*.md` per crew) through its existing pass, and proposes a persona Standard or rule-file item for a note that repeats across crews.
- `.claude/settings.json` `permissions.allow`: an allow rule for a `refusal` line whose source is `permission`, or `classifier: no verdict`, on a command the project runs every time. Each rule is narrow: a program and its subcommand, such as `Bash(npm --prefix ui test:*)`, `Bash(node --test:*)` or `Bash(git log:*)`. Never propose a wildcard over anything that runs code it is handed: no `Bash(*)`, `Bash(node:*)`, `Bash(python3:*)`, `Bash(bash:*)`, `Bash(sh:*)`, `Bash(npx:*)`, `Bash(env:*)`, `Bash(xargs:*)`, `Bash(git:*)` or the like. Never a rule for a `worktree-guard` refusal (no rule reaches the guard) or for a named classifier category. The rules go in `.claude/settings.json`, the project's committed file: `.claude/settings.local.json` is not checked in, so it never reaches the agents' worktrees. A fix goal may edit `.claude/settings.json`. Ankur writes the approved rules into `.claude/settings.json`; when Claude Code's classifier refuses that write, ankur shows the refusal and the client writes the rules, and the refusal is never worked around.

Retro may propose removing a rule, and each proposed rule names the rule it replaces, or says `none`. A removal needs a count or `CAUSE:` line like any other proposal.

If the counts support nothing, say so and stop. Don't invent changes.

## 5. Write only what the client approves

Show the proposals as a list. Write only the ones the client approves, keep every key and value already in the file, and don't edit anything else. Then show what changed. Permission rules are the exception: when the classifier refuses ankur's write, show the approved rules as the `permissions.allow` lines to add to `.claude/settings.json`, for the client to write.

Repeated work the counts point to, such as the same command sequence or the same brief written again, is `kit:revise`'s job. When `kit:revise` is in the skills list, hand it the finding through the Skill tool. Otherwise say `kit:revise` isn't installed.

## 6. The full retro

At run end the PM always runs `extract`, `recur` and the section 2 counts. These scripted steps start no agent. Then `retro/cli.ts due <repo>` says whether the full retro is due, and the run skill's section 10 says what the PM does with its answer: with `runEndRetro` unset the judges and the triage start only on `due: true`, and with `pm` the PM decides from the section 10 trigger list. Either way the PM logs the call and its evidence with `factory.ts decide`. When the judges do not start, the PM marks `judges`, `triage`, `fixGoal` and `applied` as `skipped` with a one-line reason. The fix goal never starts at run end: at run end the PM marks `fixGoal` and `applied` as `skipped`, lists the fix-now findings in its report, and the fix goal waits for `/ankur:retro` or the client's yes.

When `.claude/ankur.json` sets `runEndRetro` to `off`, the PM runs only the scripted steps at run end and marks `judges`, `triage`, `fixGoal` and `applied` as `skipped`. Use the detail `runEndRetro off` as the reason. Unset, the key means the `due` rule below; `pm` and `off` keep the meaning they had before the rule. `/ankur:retro` always runs the full retro, whatever the key says and whatever `due` prints.

The full retro reads every run since the last full retro, not just the current one. The last full retro is the run whose `retro/state.json` has `judges` done with the latest `at`. A run counts once every crew in its `plan.json` is `merged` or `dropped` and the latest `## Run <ISO>` heading of its `decisions.md` is after that `at`; with no full retro yet, every finished run counts. A run with a `planned` or `running` crew never counts. `due` scans the run dirs under both `.git/truss/` and `.git/ankur/`, and prints `due: true` with `why` `count` when `fullRetroEvery` runs (5 when unset) have finished, or with `why` `recurred` when fewer have but one holds a `RECURRED:` line; otherwise `due: false` with `why` `not due`. Its `runs` list names the counted run dirs, oldest start first. Once a run's `judges` step is done, the count starts again from 0. <!-- ankur-allow-truss -->

Run `node <plugin>/retro/cli.ts state <ankur dir> <step> <status> [detail]` before and after each step: `running` before it, then `done`, `failed` or `skipped` with a one-line detail and no transcript text. The state file has five steps, `extract`, `judges`, `triage`, `fixGoal` and `applied`; `recur` has no step of its own. On `/ankur:retro`, run the steps in this order and stop at the first that fails, showing the client why.

`/ankur:retro` runs `due` only to get its `runs` list, never to decide whether to go on. Copy and run this block for the `extract` step, with `<plugin>` and `<repo>` filled in:

```bash
node <plugin>/retro/cli.ts due <repo>
node <plugin>/retro/cli.ts problems <each dir in its runs list>
```

1. **`extract`.** The `extract` step runs `node <plugin>/retro/cli.ts problems` over every dir in `due`'s `runs` list, the last line of the block above. It counts the problems from the structured run files, never a transcript, writes `retro/problems.json` under each dir it is given, and prints one JSON line per dir in the order given. `problems` needs at least one dir, so when `runs` is empty, give it `<ankur dir>` alone.
2. **`recur`.** Run `node <plugin>/retro/cli.ts recur <ankur dir>`. Each `RECURRED:` line is a finding for triage: a problem a merged fix was meant to end has come back.
3. **Judges and `findings`.** Start one judge per crew that has counted measures, plus one combining judge for the main session and anything across crews; that is at most 1 + the number of crews. Each is a `ankur:retro-judge` agent on Opus at effort `medium`, started with `model` and `effort` set; when `ankur:retro-judge` is not in the session's agent list, start a `general-purpose` agent (same model and effort) whose prompt is the agent file `agents/retro-judge.md`. Give it the paths of the `retro/problems.json` files step 1 wrote, the catalog's path and the plan's path, never the PM's account of the run. It reads the structured files and never a transcript, and it reports problems outside the checklist too. Save each judge's report with `node <plugin>/retro/cli.ts findings <ankur dir> <judge label> <report file>`. A finding is dropped when its evidence names a counted measure that is missing or gives a different value; show the client each `DROPPED:` line. `findings` checks a finding's evidence against `<ankur dir>/retro/problems.json` and against the `retro/problems.json` of every counted run beside it, so a finding may cite a value any one of those runs counted.
4. **`triage`.** Start a fresh checking engineer whose brief opens with the line `Retro triage.` and gives the findings file, the catalog and `retro/problems.json`. It answers with `TRIAGE: <finding id> | <fix now|defer|drop> | <reason>` lines. Save its report to a file and run `node <plugin>/retro/cli.ts triage <ankur dir> <report file>`, which parses the lines and writes `retro/triage.json` with `fixGoal` (the fix-now plugin and project-config findings), `proposedGoals` and `dropped`. `proposedGoals` holds the fix-now product-code findings, which you show the client as risks, with their evidence. Log each line as a decision and follow it. Triage drops a finding the catalog already holds, naming the catalog id.
5. **`fixGoal`.** A finding's `target` must be a file ankur uses: on the ankur repo, a file of the plugin (`.claude-plugin/plugin.json` exists and its `name` is `ankur`); on any project, its `CLAUDE.md` or a file under its `.claude/`. A finding whose target is product code a run delivered (on the ankur repo, anything outside the plugin, such as ui/**) is out of scope for a fix and stays out of the fix goal, while a plugin file stays in scope even when a crew of this run changed it. Triage never drops a finding for its category. Fixes touch only files ankur uses, never code a run delivered. On a project other than the ankur repo, a fix whose target is a plugin file is not built: write it as a draft to `<ankur dir>/retro/upstream/<finding id>.md` and report it to the client. The fix-now findings become one fix goal, added through amend with the finding ids in its goal text, so the amend route and its checking engineer run as they do for any goal. A fix goal is `"auto"` unless a run-skill section-4 client trigger applies, and a `.claude/settings.json` edit counts as one; then it is `"client"`. When triage keeps no fix-now finding, set `fixGoal` and `applied` to `skipped`.
6. **`applied`.** The goal's crews run as every crew does: tests, a QC engineer, then a merge. A fix that fails QC is not merged; report it to the client with its finding id. Run `node <plugin>/retro/cli.ts scrub` on every file the fix changed, before each merge. A hit blocks the merge until the file is clean. A settings.json write follows section 4: when the classifier refuses it, show the client the refusal and the rules and never work around it. Each merged fix adds a catalog entry, or updates one, with `patterns` from the finding's `signature` and `fixedBy` set to `{"finding": "<session id>/<finding id>", "date": "<merge date>"}`. Set `applied` to `done` when every crew merged, `failed` when one did not.
