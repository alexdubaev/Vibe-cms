import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'

export function DataTableFrame({
  children,
  description,
  nextDisabled,
  onNext,
  onPrevious,
  previousDisabled,
  summary,
  title,
  toolbar,
}: {
  children: ReactNode
  description?: string
  nextDisabled: boolean
  onNext: () => void
  onPrevious: () => void
  previousDisabled: boolean
  summary: string
  title: string
  toolbar?: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <Typography as="h2" variant="h6">
          {title}
        </Typography>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="grid gap-5">
          {toolbar && (
            <Typography as="div" variant="bodySm">
              {toolbar}
            </Typography>
          )}
          <div className="overflow-x-auto">{children}</div>
        </div>
      </CardContent>
      <CardFooter className="justify-between gap-3 border-t">
        <Typography variant="bodySm" tone="muted">
          {summary}
        </Typography>
        <div className="flex gap-2">
          <Button
            disabled={previousDisabled}
            onClick={onPrevious}
            type="button"
            variant="outline"
          >
            Previous
          </Button>
          <Button
            disabled={nextDisabled}
            onClick={onNext}
            type="button"
            variant="outline"
          >
            Next
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
