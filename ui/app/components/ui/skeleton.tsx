import * as React from 'react'
import { cn } from '../../lib/utils.ts'

// A loading block. No default height: the caller gives the final one, so it never collapses by accident.
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('rounded-chip bg-secondary', className)}
      {...props}
    />
  )
}
