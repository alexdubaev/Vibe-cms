import { GalleryVerticalEndIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Typography } from '@/components/typography'

export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <section className="flex flex-col gap-4 bg-background p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link className="flex items-center gap-2" search={{ returnTo: undefined }} to="/login">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <HugeiconsIcon aria-hidden icon={GalleryVerticalEndIcon} size={16} strokeWidth={2} />
            </span>
            <Typography as="span" variant="control">
              Vibe CMS
            </Typography>
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-xs">{children}</div>
        </div>
      </section>
      <section aria-hidden className="relative hidden overflow-hidden bg-sidebar lg:block">
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-80 mix-blend-screen"
          src="/auth-cover.svg"
        />
        <div className="relative z-10 grid h-full content-end gap-3 p-12 text-sidebar-foreground">
          <Typography as="p" variant="caption">Vibe CMS</Typography>
          <Typography as="p" variant="h2">Сайт, который легко поддерживать в актуальном состоянии.</Typography>
          <Typography as="p" tone="muted">Редактируйте, проверяйте и публикуйте изменения в одном спокойном рабочем пространстве.</Typography>
        </div>
      </section>
    </main>
  )
}
