import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { CmsWorkflowState } from '../model'

const toneClasses: Record<CmsWorkflowState['tone'], string> = {
  neutral: 'border-border bg-muted/55 text-muted-foreground',
  primary: 'border-primary/20 bg-primary/8 text-primary',
  warning: 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  destructive: 'border-destructive/25 bg-destructive/10 text-destructive',
}

export function WorkflowStatus({ state, className }: { state: CmsWorkflowState; className?: string }) {
  return (
    <Badge
      className={cn('gap-1.5 border px-2.5 py-1', toneClasses[state.tone], className)}
      role="status"
      variant="outline"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {state.label}
    </Badge>
  )
}
