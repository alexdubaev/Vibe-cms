import { Link } from '@tanstack/react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Typography } from '@/components/typography'

import type { CmsCollectionEntry } from '../api'
import { collectionEntryTypeLabel } from '../model'

export function CollectionList({
  entries,
  isPending,
  selectedId,
  type,
  onSelect,
}: {
  entries: readonly CmsCollectionEntry[] | undefined
  isPending: boolean
  selectedId: string | null
  type: CmsCollectionEntry['type']
  onSelect: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{collectionEntryTypeLabel(type)}</CardTitle>
        <CardDescription>Выберите запись для редактирования. Служебные идентификаторы скрыты.</CardDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          {(['service', 'review', 'teamMember', 'faq', 'case'] as const).map((itemType) => (
            <Button asChild key={itemType} size="sm" variant={itemType === type ? 'secondary' : 'outline'}>
              {itemType === 'service' ? (
                <Link to="/admin/content/service">{collectionEntryTypeLabel(itemType)}</Link>
              ) : (
                <Link params={{ type: itemType }} to="/admin/content/$type">
                  {collectionEntryTypeLabel(itemType)}
                </Link>
              )}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isPending && <Skeleton className="h-44 w-full" />}
        {!isPending && entries?.length === 0 && (
          <Typography tone="muted">Записей пока нет. Создайте первую запись.</Typography>
        )}
        {!isPending && entries && entries.length > 0 && (
          <div className="grid gap-2">
            {entries.map((entry) => (
              <button
                className={`grid min-h-16 w-full gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${selectedId === entry.id ? 'border-primary bg-muted/40' : ''}`}
                key={entry.id}
                onClick={() => onSelect(entry.id)}
                type="button"
              >
                <span className="flex items-center justify-between gap-3">
                  <Typography as="span" variant="bodySmMedium">{entry.name}</Typography>
                  <Badge variant={entry.archived ? 'outline' : 'secondary'}>{entry.archived ? 'Архив' : 'Черновик'}</Badge>
                </span>
                <Typography as="span" tone="muted" variant="caption" wrap="break">
                  {entry.summary || 'Без краткого описания'}
                </Typography>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
