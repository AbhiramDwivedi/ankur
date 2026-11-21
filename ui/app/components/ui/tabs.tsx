import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '../../lib/utils.ts'

// Radix Tabs with automatic activation (arrow keys select). An underline bar: 40 px triggers, a brand underline on
// the selected one. The list scrolls inside itself at 360 px. Focus draws inside the trigger (app.css [role=tab]).
export function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn('flex min-w-0 flex-col gap-3', className)} {...props} />
}

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('flex max-w-full items-center gap-1 overflow-x-auto border-b border-border no-scrollbar', className)}
      {...props}
    />
  )
}

// Shared with RadioGroupItem's and the Composer's segment look (not the tab trigger, which is the underline above).
export const triggerLook =
  'inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-chip px-2.5 text-meta font-medium whitespace-nowrap text-muted tabular-nums transition-colors duration-(--duration-quick) ease-out hover:text-fg pointer-coarse:h-9 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0'

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex h-10 shrink-0 items-center justify-center gap-2 border-b-2 border-transparent px-3 text-meta font-medium whitespace-nowrap text-muted tabular-nums transition-colors duration-(--duration-quick) ease-out hover:text-fg active:translate-y-px disabled:cursor-not-allowed disabled:text-disabled-fg [&_svg]:size-3.5 [&_svg]:shrink-0',
        'data-[state=active]:border-brand data-[state=active]:text-fg',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('min-w-0', className)} {...props} />
}
