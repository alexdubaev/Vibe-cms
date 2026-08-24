import type { AdminUserSummary, UserRole } from '@web-app-demo/contracts'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export function RoleChangeDialog({
  error,
  isPending,
  onCancel,
  onConfirm,
  pendingChange,
}: {
  error: Error | null
  isPending: boolean
  onCancel: () => void
  onConfirm: () => void
  pendingChange: {
    role: UserRole
    user: AdminUserSummary
  } | null
}) {
  return (
    <AlertDialog
      open={pendingChange !== null}
      onOpenChange={(open) => {
        if (!open && !isPending) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Изменить роль участника?</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingChange
              ? `${pendingChange.user.email} получит роль «${roleLabel(pendingChange.role)}». Его активные сеансы будут завершены.`
              : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Не удалось изменить роль</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Отмена</AlertDialogCancel>
          <Button disabled={isPending} onClick={onConfirm}>
            {isPending ? 'Изменяем…' : 'Изменить роль'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function roleLabel(role: UserRole) {
  return role === 'owner' ? 'владелец' : role === 'editor' ? 'редактор' : 'участник'
}
