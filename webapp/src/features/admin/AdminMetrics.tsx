import {
  UserAdd01Icon,
  UserGroupIcon,
  UserShield01Icon,
} from '@hugeicons/core-free-icons'

import { SectionCards } from '@/components/dashboard'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAdminDashboardQuery } from './queries'

export function AdminMetrics() {
  const query = useAdminDashboardQuery()

  if (query.isPending) {
    return (
      <div
        aria-label="Загружаем обзор"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        role="status"
      >
        <Skeleton className="h-40 rounded-4xl" />
        <Skeleton className="h-40 rounded-4xl" />
        <Skeleton className="h-40 rounded-4xl" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Обзор временно недоступен</AlertTitle>
        <AlertDescription>{query.error.message}</AlertDescription>
        <AlertAction>
          <Button onClick={() => void query.refetch()} size="sm" type="button" variant="outline">
            Повторить
          </Button>
        </AlertAction>
      </Alert>
    )
  }

  return (
    <SectionCards
      items={[
        {
          description: 'Все зарегистрированные участники рабочего пространства.',
          icon: UserGroupIcon,
          label: 'Всего участников',
          value: query.data.totalUsers.toLocaleString(),
        },
        {
          description: 'Участники с правом управлять доступом и публикациями.',
          icon: UserShield01Icon,
          label: 'Владельцы',
          value: query.data.totalAdmins.toLocaleString(),
        },
        {
          description: 'Участники, присоединившиеся за последнюю неделю.',
          icon: UserAdd01Icon,
          label: 'Новые за 7 дней',
          value: query.data.newUsersLast7Days.toLocaleString(),
        },
      ]}
    />
  )
}
