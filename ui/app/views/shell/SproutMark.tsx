import { cn } from '../../lib/utils.ts'

// The ankur mark: a soil tile with a sprout leaf, on a 24 grid (ui/contract/redesign/icon.svg).
// Colours are the icon tokens (--icon-tile, --icon-glyph), so no hex lives here. Decorative: aria-hidden,
// the brand row shows the visible "ankur" text beside it.
export function SproutMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={cn('size-6 shrink-0', className)}>
      <rect width="24" height="24" rx="6" className="fill-icon-tile" />
      <path
        d="M12 20.5C11.8 17.2 12.1 14.6 13 12.4C13.5 11.2 13.9 10.3 14 9.6"
        className="fill-none stroke-icon-glyph [stroke-linecap:round] [stroke-width:1.9]"
      />
      <path d="M14 9.7C11.7 7.9 12.4 4.7 15.9 3.3C17.2 6.3 16.6 8.7 14 9.7Z" className="fill-icon-glyph" />
      <path d="M12.6 14.4C10.9 11.8 8.1 11.1 4.9 12.3C6.9 14.8 9.8 15.6 12.6 14.4Z" className="fill-icon-glyph" />
    </svg>
  )
}
