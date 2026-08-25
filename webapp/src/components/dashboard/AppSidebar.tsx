import type { UserDto } from '@web-app-demo/contracts'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { CmsBrandMark } from '@/components/CmsBrand'
import { Typography } from '@/components/typography'
import type { WorkspaceRoutePath } from '@/features/navigation'
import { DashboardLink } from './DashboardLink'
import { NavMain, type DashboardNavigationItem } from './NavMain'
import { NavUser } from './NavUser'

export function AppSidebar({
  accountPath,
  homePath,
  items,
  onLogout,
  settingsPath,
  user,
  workspaceLabel,
}: {
  accountPath?: WorkspaceRoutePath
  homePath: WorkspaceRoutePath
  items: ReadonlyArray<DashboardNavigationItem>
  onLogout: () => Promise<void>
  settingsPath: WorkspaceRoutePath
  user: UserDto
  workspaceLabel: string
}) {
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="Vibe CMS">
              <DashboardLink to={homePath}>
                <CmsBrandMark className="size-8" />
                <span className="grid min-w-0 gap-0.5 group-data-[collapsible=icon]:hidden">
                  <Typography variant="control" truncate>
                    Vibe CMS
                  </Typography>
                  <Typography variant="caption" tone="muted" truncate>
                    {workspaceLabel}
                  </Typography>
                </span>
              </DashboardLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          accountPath={accountPath}
          onLogout={onLogout}
          settingsPath={settingsPath}
          user={user}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
