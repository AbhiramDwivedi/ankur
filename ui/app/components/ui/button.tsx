import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'
import { cn } from '../../lib/utils.ts'

// ankur buttons. `primary` is the one filled brand-green button per view. Focus is drawn
// by the global :focus-visible rule in styles/app.css, so no ring classes here.
// Press: :active takes the pressed background and a 1 px offset at once; only colour eases (motion.quick).
// A pending button is aria-disabled + data-pending (never `disabled`, which drops focus) and holds the offset.
const buttonVariants = cva(
  'relative inline-flex max-w-full min-w-0 shrink-0 items-center justify-center gap-2 rounded-ctl font-semibold whitespace-nowrap transition-colors duration-(--duration-quick) ease-out active:bg-pressed active:text-fg active:translate-y-px disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-fg disabled:shadow-none disabled:translate-y-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-[pending=true]:cursor-progress data-[pending=true]:opacity-100 data-[pending=true]:translate-y-px data-[pending=true]:bg-disabled-bg data-[pending=true]:text-muted data-[pending=true]:shadow-none aria-busy:cursor-progress [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // bg-primary reads --primary, which is `move` in :root (tokens.json "shadcn"); the button is brand green, so it takes brand here.
        primary: '[--primary:var(--brand)] [--primary-foreground:var(--on-brand)] bg-primary text-primary-foreground shadow-e1 hover:bg-brand-hover',
        secondary: 'border border-border bg-surface text-fg hover:bg-secondary',
        ghost: 'text-muted hover:bg-secondary hover:text-fg',
        danger: 'bg-fail text-surface',
        'danger-soft': 'border border-fail/40 bg-fail-soft text-fail-text',
        // The two buttons of the dark Your move card: `on-move` is the first (main) one, `move` the others.
        'on-move': 'bg-move-fg text-move shadow-e1 hover:bg-move-muted data-[pending=true]:bg-move-muted data-[pending=true]:text-move',
        move: 'border border-move-line bg-transparent text-move-fg hover:border-move-muted data-[pending=true]:border-move-muted data-[pending=true]:bg-move-muted data-[pending=true]:text-move disabled:border-move-line disabled:bg-transparent disabled:text-move-muted',
      },
      size: {
        sm: 'h-7 px-3 text-meta pointer-coarse:h-10 [&_svg]:size-3.5',
        md: 'h-9 px-4 text-meta [&_svg]:size-3.5',
        lg: 'h-10 px-4 text-ui [&_svg]:size-4',
        icon: 'size-9 text-meta [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft' | 'on-move' | 'move'

type BaseProps = Omit<React.ComponentProps<'button'>, 'aria-disabled'> & {
  variant?: Variant
  asChild?: boolean
  /** The action is under way: keeps the label, swaps the leading icon for a spinner and ignores clicks. */
  busy?: boolean
  /** A POST is under way: the pending style at once, aria-disabled and data-pending, focus kept, clicks and Enter ignored. Never `disabled`. */
  pending?: boolean
  /** Stays focusable but does nothing; describe why with a Hint through aria-describedby. */
  'aria-disabled'?: boolean | 'true' | 'false'
  /** A leading lucide icon. Pass one to a button that can go busy, so the spinner keeps its width. */
  icon?: React.ReactNode
  /** A trailing lucide icon, outside the truncating label. */
  iconEnd?: React.ReactNode
}

// An icon-only button has no visible name, so its type requires one.
export type ButtonProps =
  | (BaseProps & { size?: 'sm' | 'md' | 'lg' })
  | (BaseProps & { size: 'icon'; 'aria-label': string })

const inert = (v: BaseProps['aria-disabled']) => v === true || v === 'true'

// A plain function component with no hooks: the guards below are ordinary handlers.
export function Button(props: ButtonProps) {
  const {
    className,
    variant,
    size,
    asChild = false,
    busy = false,
    pending = false,
    icon,
    iconEnd,
    type,
    children,
    onClick,
    onKeyDown,
    onKeyUp,
    ...rest
  } = props
  const blocked = busy || pending || inert(props['aria-disabled'])
  const guard = <E extends React.SyntheticEvent>(fn?: (e: E) => void) =>
    (e: E) => {
      if (blocked) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      fn?.(e)
    }
  const guardKey = (fn?: (e: React.KeyboardEvent<HTMLButtonElement>) => void) =>
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (blocked && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      fn?.(e)
    }
  const classes = cn(buttonVariants({ variant, size }), className)
  const handlers = {
    onClick: guard(onClick),
    onKeyDown: guardKey(onKeyDown),
    onKeyUp: guardKey(onKeyUp),
    'aria-busy': busy || undefined,
    ...(pending ? { 'aria-disabled': true, 'data-pending': true } : {}),
  }
  if (asChild) {
    return (
      <Slot className={classes} {...rest} {...handlers}>
        {children}
      </Slot>
    )
  }
  const lead = busy ? <LoaderCircle aria-hidden="true" /> : icon
  return (
    <button type={type ?? 'button'} className={classes} {...rest} {...handlers}>
      {lead}
      {size === 'icon' ? (busy ? null : children) : children != null && <span className="min-w-0 truncate">{children}</span>}
      {iconEnd}
    </button>
  )
}

export { buttonVariants }
