import type { UserDto } from '@web-app-demo/contracts'

import { PageContainer, PageHeader } from '@/components/PageLayout'
import { AvatarPanel } from '@/features/avatar'
import { AppearancePanel } from '@/features/settings'
import { AccountSummary } from './AccountSummary'
import { ProfilePanel } from './ProfilePanel'
import { SessionPanel } from './SessionPanel'

export function UserHome({ user }: { user: UserDto }) {
  return (
    <PageContainer>
      <PageHeader
        description="Проверьте состояние учётной записи и продолжайте работу в своём пространстве."
        title={`Здравствуйте, ${user.displayName ?? user.email}`}
      />
      <AccountSummary user={user} />
    </PageContainer>
  )
}

export function UserProfile({ user }: { user: UserDto }) {
  return (
    <PageContainer>
      <div className="grid w-full max-w-2xl gap-6">
        <PageHeader
          description="Обновите имя, которое отображается в рабочем пространстве."
          title="Профиль"
        />
        <AvatarPanel user={user} />
        <ProfilePanel user={user} />
      </div>
    </PageContainer>
  )
}

export function UserSettings({ onLogout }: { onLogout: () => Promise<void> }) {
  return (
    <PageContainer>
      <PageHeader
        description="Выберите оформление рабочего пространства и управляйте текущим сеансом."
        title="Настройки"
      />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <AppearancePanel />
        <SessionPanel onLogout={onLogout} />
      </div>
    </PageContainer>
  )
}
