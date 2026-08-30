import type { UserDto } from '@web-app-demo/contracts'
import { Link } from '@tanstack/react-router'

import { PageContainer, PageHeader } from '@/components/PageLayout'
import { Typography } from '@/components/typography'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppearancePanel } from '@/features/settings'
import { ProfilePanel } from '@/features/users'
import { NavigationEditor, PublicationPolicyPanel, SiteIdentityPanel } from '@/features/cms'
import { AdminMetrics } from './AdminMetrics'
import { UserDirectory } from './UserDirectory'

export function AdminDashboard() {
  return (
    <PageContainer>
      <PageHeader
        description="Продолжайте работу с сайтом и быстро находите то, что требует внимания."
        title="Обзор"
      />
      <Card className="border-primary/15 bg-[linear-gradient(135deg,var(--card),color-mix(in_oklch,var(--primary)_4%,var(--card)))] shadow-none">
        <CardHeader>
          <CardTitle>Работа с сайтом</CardTitle>
          <CardDescription>Основной путь редактора: обновить содержание, проверить результат и выпустить изменения.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <WorkflowLink description="Структура, секции и настройки страниц" label="Открыть редактор" to="/admin/pages" />
          <WorkflowLink description="Услуги, отзывы, проекты и FAQ" label="Работать с материалами" to="/admin/content/service" />
          <WorkflowLink description="Согласование и состояние сайта" label="Проверить выпуск" to="/admin/publications" />
        </CardContent>
      </Card>
      <div className="grid gap-2">
        <CardTitle>Команда</CardTitle>
        <CardDescription>Сводка доступа к рабочему пространству.</CardDescription>
      </div>
      <AdminMetrics />
    </PageContainer>
  )
}

function WorkflowLink({ description, label, to }: { description: string; label: string; to: '/admin/pages' | '/admin/content/service' | '/admin/publications' }) {
  return (
    <Button asChild className="h-auto min-h-20 justify-start whitespace-normal border bg-background px-4 py-3 text-left text-foreground shadow-none hover:border-primary/30 hover:bg-primary/5" variant="outline">
      <Link to={to}>
        <span className="grid gap-1">
          <Typography as="span" variant="bodySmMedium">{label}</Typography>
          <Typography as="span" tone="muted" variant="caption">{description}</Typography>
        </span>
      </Link>
    </Button>
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
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start [&_[data-slot=card]]:shadow-none">
        <SiteIdentityPanel />
        <ProfilePanel user={user} />
        <AppearancePanel />
        {user.role === 'owner' && <PublicationPolicyPanel />}
      </div>
      <NavigationEditor />
    </PageContainer>
  )
}
