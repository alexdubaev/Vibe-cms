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
import { NavMain, type DashboardNavigationGroup } from './NavMain'
import { NavUser } from './NavUser'

export function AppSidebar({
  accountPath,
  homePath,
  groups,
  onLogout,
  settingsPath,
  user,
  workspaceLabel,
}: {
  accountPath?: WorkspaceRoutePath
  homePath: WorkspaceRoutePath
  groups: ReadonlyArray<DashboardNavigationGroup>
  onLogout: () => Promise<void>
  settingsPath: WorkspaceRoutePath
  user: UserDto
  workspaceLabel: string
}) {
  return (
    <Sidebar
      className="border-r border-sidebar-border/70 shadow-[8px_0_24px_-20px_oklch(0.08_0.02_264)]"
      collapsible="icon"
      variant="inset"
    >
      <SidebarHeader className="border-b border-sidebar-border/55 px-2 py-3">
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
        <NavMain groups={groups} />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/55 p-2">
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
