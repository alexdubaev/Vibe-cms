import {
  Alert02Icon,
  FileNotFoundIcon,
  ShieldUserIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
} from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/typography'

type HomeDestination = '/login' | '/app' | '/admin'

export function SessionLoadingSection() {
  return (
    <RouteStateCard
      description="Проверяем текущий сеанс…"
      icon={ShieldUserIcon}
      title="Загружаем рабочее пространство"
    >
      <Spinner />
    </RouteStateCard>
  )
}

export function SessionErrorSection({ retry }: { retry: () => Promise<void> }) {
  const [retryPending, setRetryPending] = useState(false)

  async function retrySession() {
    setRetryPending(true)
    try {
      await retry()
    } catch {
      // The existing session error remains visible and retryable.
    } finally {
      setRetryPending(false)
    }
  }

  return (
    <RouteStateCard
      alert
      description="Не удалось проверить сеанс. Проверьте подключение и повторите попытку."
      icon={Alert02Icon}
      title="Проверка сеанса временно недоступна"
    >
      <Button
        disabled={retryPending}
        onClick={() => void retrySession()}
        type="button"
      >
        {retryPending ? 'Повторяем…' : 'Повторить'}
      </Button>
    </RouteStateCard>
  )
}

export function NotFoundSection({ destination }: { destination: HomeDestination }) {
  const authenticated = destination !== '/login'

  return (
    <RouteStateCard
      description="Запрошенная страница не существует или была перемещена."
      icon={FileNotFoundIcon}
      title="Страница не найдена"
    >
      <Button asChild>
        {authenticated ? (
          <Link to={destination}>Вернуться в рабочее пространство</Link>
        ) : (
          <Link search={{ returnTo: undefined }} to="/login">Вернуться ко входу</Link>
        )}
      </Button>
    </RouteStateCard>
  )
}

function RouteStateCard({
  alert = false,
  children,
  description,
  icon,
  title,
}: {
  alert?: boolean
  children: ReactNode
  description: string
  icon: IconSvgElement
  title: string
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-5">
      <Card className="w-full max-w-lg shadow-sm">
        <CardContent>
          <Empty
            aria-live={alert ? 'assertive' : undefined}
            className="border-0 p-4 sm:p-8"
            role={alert ? 'alert' : undefined}
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon aria-hidden icon={icon} strokeWidth={2} />
              </EmptyMedia>
              <Typography as="h1" variant="h4" balance>
                {title}
              </Typography>
              <Typography variant="bodySm" tone="muted" align="center" pretty>
                {description}
              </Typography>
            </EmptyHeader>
            <EmptyContent>{children}</EmptyContent>
          </Empty>
        </CardContent>
      </Card>
    </main>
  )
}
