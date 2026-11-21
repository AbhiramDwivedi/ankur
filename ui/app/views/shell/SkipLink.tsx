// The first Tab stop: hidden until focused, it jumps past the header. App passes the target
// that exists at the current width and a label that says where it goes.
export interface SkipLinkProps {
  href?: string
  label?: string
}

export function SkipLink({ href = '#your-move', label = 'Skip to Your move' }: SkipLinkProps) {
  return (
    <a
      href={href}
      className="sr-only rounded-ctl bg-surface text-ui font-semibold text-fg shadow-e1 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2"
    >
      {label}
    </a>
  )
}
