import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Typography } from '@/components/ui/typography'

export function SiteHeader({ title }: { title: string }) {
  return (
    <header className="flex h-16 shrink-0 items-center border-b bg-background/95 backdrop-blur transition-[width,height] motion-reduce:transition-none">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          className="mx-2 data-[orientation=vertical]:h-4"
          orientation="vertical"
        />
        <Typography as="h1" variant="h6">
          {title}
        </Typography>
      </div>
    </header>
  )
}
