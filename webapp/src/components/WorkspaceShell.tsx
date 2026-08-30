import {
  DashboardSquare01Icon,
  Album01Icon,
  File01Icon,
  Home01Icon,
  Rocket01Icon,
  Settings01Icon,
  UserGroupIcon,
  UserIcon,
} from '@hugeicons/core-free-icons'
import { useLocation } from '@tanstack/react-router'
import type { UserDto } from '@web-app-demo/contracts'
import type { PropsWithChildren } from 'react'

import {
  AppSidebar,
  type DashboardNavigationGroup,
  type DashboardNavigationItem,
  SiteHeader,
} from '@/components/dashboard'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import {
  homePathForRole,
  navigationGroupsForRole,
  navigationItemsForRole,
  type NavigationItem,
} from '@/features/navigation'
import { useCmsSiteSettingsQuery } from '@/features/cms'

const iconsByPath = {
  '/app': Home01Icon,
  '/app/profile': UserIcon,
  '/app/settings': Settings01Icon,
  '/admin': DashboardSquare01Icon,
  '/admin/users': UserGroupIcon,
  '/admin/pages': File01Icon,
  '/admin/content/service': File01Icon,
  '/admin/media': Album01Icon,
  '/admin/publications': Rocket01Icon,
  '/admin/settings': Settings01Icon,
} as const

function getSidebarDefaultOpen() {
  const persistedState = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('sidebar_state='))
    ?.slice('sidebar_state='.length)

  return persistedState !== 'false'
}

export function WorkspaceShell({
  children,
  onLogout,
  user,
}: PropsWithChildren<{
  onLogout: () => Promise<void>
  user: UserDto
}>) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const navigationItems = navigationItemsForRole(user.role)
  const navigationGroups = navigationGroupsForRole(user.role)
  const siteSettings = useCmsSiteSettingsQuery(user.role !== 'user')
  const activeItem = navigationItems.find((item) => item.to === pathname)
  const homePath = homePathForRole(user.role)
  const settingsPath = user.role === 'user' ? '/app/settings' : '/admin/settings'
  const toDashboardItem = (item: NavigationItem): DashboardNavigationItem => ({
    ...item,
    icon: iconsByPath[item.to],
    isActive: item.to === pathname,
  })
  const groups: ReadonlyArray<DashboardNavigationGroup> = navigationGroups.map((group) => ({
    label: group.label,
    items: group.items.map(toDashboardItem),
  }))

  return (
    <SidebarProvider defaultOpen={getSidebarDefaultOpen()}>
      <AppSidebar
        accountPath={user.role === 'user' ? '/app/profile' : undefined}
        homePath={homePath}
        groups={groups}
        onLogout={onLogout}
        settingsPath={settingsPath}
        user={user}
        workspaceLabel={user.role === 'user' ? 'Личный кабинет' : siteSettings.data?.companyName ?? 'Рабочее пространство'}
      />
      <SidebarInset>
        <SiteHeader
          title={activeItem?.label ?? (user.role === 'user' ? 'Главная' : 'Обзор')}
        />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
