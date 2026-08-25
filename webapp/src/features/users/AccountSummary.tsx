import { Calendar03Icon, UserCircle02Icon } from '@hugeicons/core-free-icons'
import type { UserDto } from '@web-app-demo/contracts'

import { SectionCards } from '@/components/dashboard'

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
})

export function AccountSummary({ user }: { user: UserDto }) {
  return (
    <SectionCards
      items={[
        {
          description: user.email,
          icon: UserCircle02Icon,
          label: 'Учётная запись',
          value: user.displayName ?? 'Имя не указано',
        },
        {
          description: `Роль в рабочем пространстве: ${formatRole(user.role)}`,
          icon: Calendar03Icon,
          label: 'Участник с',
          value: dateFormatter.format(new Date(user.createdAt)),
        },
      ]}
    />
  )
}

function formatRole(role: UserDto['role']) {
  return role === 'owner' ? 'владелец' : role === 'editor' ? 'редактор' : 'участник'
}
