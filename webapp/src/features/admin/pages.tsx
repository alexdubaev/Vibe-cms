import type { UserDto } from '@web-app-demo/contracts'

import { PageContainer, PageHeader } from '@/components/PageLayout'
import { AppearancePanel } from '@/features/settings'
import { ProfilePanel } from '@/features/users'
import { NavigationEditor, PublicationPolicyPanel, SiteIdentityPanel } from '@/features/cms'
import { AdminMetrics } from './AdminMetrics'
import { UserDirectory } from './UserDirectory'

export function AdminDashboard() {
  return (
    <PageContainer>
      <PageHeader
        description="Ключевые показатели рабочего пространства и доступ команды."
        title="Обзор"
      />
      <AdminMetrics />
    </PageContainer>
  )
}

export function AdminUsers({ currentUser }: { currentUser: UserDto }) {
  return (
    <PageContainer>
      <PageHeader
        description="Управляйте доступом команды, не раскрывая учётные данные."
        title="Доступ и команда"
      />
      <UserDirectory currentUser={currentUser} />
    </PageContainer>
  )
}

export function AdminSettings({ user }: { user: UserDto }) {
  return (
    <PageContainer>
      <PageHeader
        description="Настройте название сайта, профиль владельца и внешний вид рабочего пространства."
        title="Настройки сайта"
      />
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <SiteIdentityPanel />
        <ProfilePanel user={user} />
        <AppearancePanel />
        {user.role === 'owner' && <PublicationPolicyPanel />}
      </div>
      <NavigationEditor />
    </PageContainer>
  )
}
