import type { IconSvgElement } from '@hugeicons/react'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { Typography } from '@/components/typography'
import type { WorkspaceRoutePath } from '@/features/navigation'
import { DashboardLink } from './DashboardLink'

export type DashboardNavigationItem = {
  icon: IconSvgElement
  isActive: boolean
  label: string
  to: WorkspaceRoutePath
}

export type DashboardNavigationGroup = {
  label: string
  items: ReadonlyArray<DashboardNavigationItem>
}

export function NavMain({
  groups,
}: {
  groups: ReadonlyArray<DashboardNavigationGroup>
}) {
  return (
    <nav aria-label="Основная навигация">
      {groups.map((group) => (
        <SidebarGroup className="py-2" key={group.label}>
          <Typography asChild tone="sidebar" variant="controlXs">
            <SidebarGroupLabel className="px-2 text-sidebar-foreground/45 uppercase">
              {group.label}
            </SidebarGroupLabel>
          </Typography>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    className="min-h-9 text-sidebar-foreground/78 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-[inset_3px_0_0_var(--sidebar-primary)]"
                    isActive={item.isActive}
                    tooltip={item.label}
                  >
                    <DashboardLink to={item.to}>
                      <HugeiconsIcon icon={item.icon} strokeWidth={1.8} />
                      <Typography asChild variant="control">
                        <span>{item.label}</span>
                      </Typography>
                    </DashboardLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </nav>
  )
}
