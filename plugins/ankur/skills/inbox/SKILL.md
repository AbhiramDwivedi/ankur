---
name: inbox
description: Lists the open ankur inbox items, or resolves one as the client with /ankur:inbox <approve|reject|answer|done|dismiss> <item> <code> [raise <usd>] [note]. Only the human can start it; resolve --by client accepts only a decision the human typed in this session.
disable-model-invocation: true
---

# ankur inbox

The human typed this command, so you act for the client here, and only for the decision they typed. Never pick a decision, an id or a code yourself, and never resolve an item their typed words don't answer: the command line, or a plain reply to a list you showed.

Arguments: `$ARGUMENTS`

`<plugin>` is two levels above this skill's base directory (`<plugin>/skills/inbox`). `<ankur dir>` comes from the `[ankur] dir: <path>` note the plugin adds at session start, or from the `Ankur dir:` line `/ankur` prints; don't derive it yourself. If neither is there, tell the human the ankur plugin isn't loaded and stop. `<repo>` is the repo root of this session.

## List the open items

With no arguments, run:

```
node <plugin>/bin/factory.ts inbox --open --repo <repo> --dir <ankur dir>
```

It prints one JSON line, `{items, open}`. Show each item on its own line: its `id`, `kind`, `title`, the `crews` it holds with their `session`, and whether it is `blocking`. `open` is the total of open items whatever the filters. When `open` is 0, say the inbox is empty.

An item's `id` is its name, a few hyphenated words from its title (`several-sessions-per-ui`); an older item keeps an id like `E-20261120-a1b2c3`. Its code is three hyphenated words (`amber-otter-river`), or six capital letters on an older item. The human types it exactly as shown, hyphens included.

The list carries no codes: the inbox stores only a hash of each one. Tell the human that an item's code is in the escalation message, the program manager's message or the notify row, and that they use the code of the item's first escalation: a deduped escalation prints `code: null` and makes no new code. They resolve an item by typing `/ankur:inbox <approve|reject|answer|done|dismiss> <item> <code> [raise <usd>] [note]`. Don't run a command to find a code, with one exception: when the client asks about an item whose code was lost (the escalation died before its code reached anyone), run `node <plugin>/bin/factory.ts inbox --recover-codes --repo <repo>`. It prints `{codes: [{id, code, session}]}` for open items only. Give the client the code of the item they asked about, and no other. Never resolve an item with a recovered code the client has not typed themselves.

The human can also answer in plain words, with no code. When you list the items, show each one in plain words with its name (the `id`, exactly as printed): what it asks, and what happens on yes and on no. Then say they can reply in their own words, one reply for several items. See "Resolve from a plain reply" below.

An item the list shows with `reopened` was resolved once, but the typed line that backed that resolve can no longer be found (its transcript is gone, or the row never had one). Tell the human the `reopened.reason`, and who, when and what the old row said (`by`, `ts`, `decision`): the item blocks again until they type the decision. A resolved item's `note` is the text the human typed after the code, read from their typed line, never the note stored in the row. `noteUnbound` marks an item whose stored note differed from that typed text: tell the human the stored note was not theirs and was not used. For `blocked` and `stall-unrecovered` (anyone may resolve them) a `by: client` row with no typed line to back it still counts, but a stored note on it is flagged `noteUnbound`: it is not the human's words. A `by: pm` note there stays the pm's.

## Resolve an item

With arguments, read them as `<decision> <item> <code> [raise <usd>] [note…]`. The decision is one of `approve`, `reject`, `answer`, `done` or `dismiss` (`done` is for push-pr and prod-deploy items). If the decision isn't one of those, or the id or the code is missing, show the usage line above and stop. `raise <usd>` is for approving a budget item: the human types the amount, and only that amount goes to `--raise-usd`.

1. If there is a note, write it with the Write tool to `<ankur dir>/inbox-note-<item>.txt`. The note is the human's text, exactly what they typed after `<code>` (and after `raise <usd>`): it goes through that file and never onto the command line, and `resolve` refuses a note that differs from the typed line.
2. Run:

   ```
   node <plugin>/bin/factory.ts resolve <item> --decision <decision> --by client --code <code> --note-file <ankur dir>/inbox-note-<item>.txt --raise-usd <usd> --repo <repo> --dir <ankur dir>
   ```

   Leave out `--note-file` and its path when there is no note, and `--raise-usd <usd>` when the human typed no `raise <usd>`. `resolve` refuses an amount that differs from the typed one.
3. Read the one JSON line it prints.
   - Exit 0 prints `{id, state: "resolved", decision, quote}`. Tell the human the item is resolved, with the decision and the quote it stored.
   - Approving a plan's approval item (a `client-trigger` item with ref `run`, opened for this ankur dir) also approves the plan. The output then carries `approved: {approvedAt}`: tell the human the plan is approved. When it carries `approveRefused` instead (an open long-term cost, or a plan already approved), the resolve stands but the plan is not approved: show its `error` as it is. Never run `approve --by client` yourself.
   - Exit 1 whose `error` says no prompt typed by the client was found means the check found no line the human typed that holds the id, the decision word and the code. Ask the human to type the line again as a plain prompt, not a slash command: `<decision> <item> <code> [raise <usd>] [note]`. When they have, run the same command once more.
   - Any other refusal (a wrong code, an item already resolved): show its `error` to the human as it is, and stop. Don't retry with other values.

## Resolve from a plain reply

When the human's next message after your list answers items you showed ("ok", "go ahead", "yes to the persona, dismiss the other"), map it to one decision per item it answers. "ok" on its own approves every item the list showed, a production deploy or a budget raise included. For each of those items run:

```
node <plugin>/bin/factory.ts resolve <item> --reply --decision <decision> --by client --repo <repo> --dir <ankur dir>
```

Put the item before `--reply`. Add `--note-file <ankur dir>/inbox-note-<item>.txt` only to keep the part of the reply that answers this item, written with the Write tool exactly as typed. With no note, the whole reply is the note.

- The factory checks that the human's newest typed message answers your turn that names the item: everything you wrote since their previous message counts as that turn. It stores the whole reply as the quote. It refuses when no text of that turn names the item, or when the reply came from an agent, a task notification or anything else the human did not type. Then show the item again and wait for their reply.
- Resolve only the items you named in the turn the human is answering. An item from an earlier turn is refused; show it again first.
- A budget item: write the amount you propose on the line that names it (`raise the run budget by $20`). An approve takes that amount, and the output's `raiseUsd` shows it. When the line names several amounts, pass `--raise-usd <usd>` with the one the human chose; the factory refuses an amount your message did not propose.
- When you can't tell what the reply decides for an item, ask. Never pick a decision the reply does not say, and never resolve an item it does not answer.
- After resolving, tell the human in plain words what you took their reply to mean for each item ("I took "ok" to approve the export page and the persona"), so they can correct it.
- When their next reply corrects one ("no, reject the persona"), resolve that item again with `--reply` and the corrected decision; the output's `corrects` is the decision it replaced. A correction works only for an item resolved from a reply, only from a newer reply to a message that names the item, and only until the approved action ran: an applied item, an approved plan, an installed persona. Then show the refusal's `error` as it is.
- The output and the refusals read as in step 3 above. From another session or from the page, the human types the line with the code.

## How the check works

`resolve --by client` reads this session's transcript for the human's own line, newer than the item, holding the id, the decision word and the code, and stores that line as the quote. With `--reply` it reads the human's newest typed message instead, as above. There is no flag that sets the quote, so only the human's typing can approve. A line the human typed while the agent was busy (recorded as queued) counts when the row's origin is human; a line the human typed into an Agent SDK host such as the ankur UI counts. A queued row with no human origin doesn't count. While a client item is open, the hook refuses an agent that starts a claude session or an Agent SDK script, so the agent can't send one in the human's name. If the check refuses, ask the human to type it again once the agent is idle.
