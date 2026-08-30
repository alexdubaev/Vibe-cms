import type { PropsWithChildren, ReactNode } from 'react'

import { Typography } from '@/components/typography'

export function PageContainer({ children }: PropsWithChildren) {
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5 p-4 sm:p-5 md:p-6 lg:p-8">
      {children}
    </div>
  )
}

export function PageHeader({
  actions,
  description,
  title,
}: {
  actions?: ReactNode
  description: ReactNode
  title: string
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid gap-1.5">
        <Typography as="h1" variant="h2">{title}</Typography>
        <Typography tone="muted">{description}</Typography>
      </div>
      {actions && <PageHeaderActions>{actions}</PageHeaderActions>}
    </div>
  )
}

function PageHeaderActions({ children }: PropsWithChildren) {
  return <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{children}</div>
}
