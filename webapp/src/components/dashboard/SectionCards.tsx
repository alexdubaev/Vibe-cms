import type { IconSvgElement } from '@hugeicons/react'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@/components/ui/card'
import { Typography } from '@/components/typography'

export type SectionMetric = {
  description?: string
  icon?: IconSvgElement
  label: string
  value: number | string
}

export function SectionCards({
  items,
}: {
  items: ReadonlyArray<SectionMetric>
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {items.map((item) => (
        <Card className="@container/card gap-3 py-4 shadow-none" key={item.label}>
          <CardHeader>
            <CardDescription>{item.label}</CardDescription>
            {item.icon && (
              <CardAction>
                <span
                  aria-hidden="true"
                  className="flex size-8 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground"
                >
                  <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                </span>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <Typography as="div" className="tabular-nums" variant="h4">
              {item.value}
            </Typography>
          </CardContent>
          {item.description && (
            <CardFooter>
              <Typography variant="caption" tone="muted">
                {item.description}
              </Typography>
            </CardFooter>
          )}
        </Card>
      ))}
    </div>
  )
}
