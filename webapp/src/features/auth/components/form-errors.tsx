import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function FormAlert({
  message,
  title = 'Не удалось выполнить действие',
}: {
  message: string | null
  title?: string
}) {
  if (!message) return null

  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
