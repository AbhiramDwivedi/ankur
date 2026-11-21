// The open items of the current workspace's run (its shared inbox): what the rail counts as "need you" besides the
// question and permission blocks of Your move. Read-only: the plugin resolves them. Folded into the Your move card:
// YourMove renders OpenItemBlocks, one block per item (kind line and title), and counts them with its asks.
import type { RunState } from '../../store/types.ts'
import { inboxOf, kindWord } from './format.ts'
import type { InboxItem } from './format.ts'

/** The items to show: none until the snapshot carries an inbox. */
export const openItemsOf = (state: RunState | null): InboxItem[] => inboxOf(state)?.items ?? []

/** One block per open item, for the Your move card. */
export function OpenItemBlocks({ items }: { items: InboxItem[] }) {
  return items.map((it) => (
    <article
      key={it.id}
      aria-label={kindWord(it.kind)}
      data-item={it.id}
      className="flex min-w-0 flex-col gap-1 border-t border-move-line pt-4 first:border-t-0 first:pt-0"
    >
      <p className="text-meta font-semibold text-move-fg">{kindWord(it.kind)}</p>
      <p className="min-w-0 text-body text-move-fg [overflow-wrap:anywhere]">{it.title}</p>
      <p className="min-w-0 text-meta text-move-muted [overflow-wrap:anywhere]">
        Answer it in Claude Code: /ankur:inbox approve|reject {it.id} &lt;code&gt;. The code is in the project manager's message.
      </p>
    </article>
  ))
}

/** The page still mounts this beside Your move; the items now live inside that card, so it draws nothing. */
export function OpenItems(_props: { state: RunState | null }) {
  return null
}
