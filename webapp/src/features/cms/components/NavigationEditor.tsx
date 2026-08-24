import { Add01Icon, Delete02Icon, SaveIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Typography } from '@/components/typography'

import type { CmsMenu } from '../api'
import { useCmsMenusQuery, useSaveCmsMenuMutation } from '../queries'

const locationLabels = { header: 'Верхнее меню', footer: 'Нижнее меню' } as const

export function NavigationEditor() {
  const menus = useCmsMenusQuery()

  if (menus.isLoading) return <Card className="min-h-64 animate-pulse bg-muted/35" aria-label="Загружаем меню сайта" />
  if (menus.isError) return <NavigationError />
  if (!menus.data?.length) return <NavigationEmpty />

  return (
    <section className="grid gap-6" aria-labelledby="site-navigation-heading">
      <div className="grid gap-1">
        <Typography as="h2" id="site-navigation-heading" variant="h6">Навигация сайта</Typography>
        <Typography tone="muted" variant="bodySm">Настройте названия и адреса ссылок, которые увидят посетители.</Typography>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {menus.data.map((menu) => <MenuCard key={`${menu.id}:${menu.revision}`} menu={menu} />)}
      </div>
    </section>
  )
}

function MenuCard({ menu }: { menu: CmsMenu }) {
  const save = useSaveCmsMenuMutation()
  const [items, setItems] = useState(menu.items)
  const dirty = JSON.stringify(items) !== JSON.stringify(menu.items)
  const valid = items.length <= 100 && items.every((item) => item.label.trim() && item.href.trim())

  function changeItem(index: number, field: 'label' | 'href', value: string) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  }

  return (
    <Card>
      <CardHeader>
        <Typography as="h3" variant="h6">{locationLabels[menu.location]}</Typography>
        <CardDescription>Ссылки отображаются в порядке сверху вниз.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {items.map((item, index) => (
          <div className="grid gap-2 rounded-lg border bg-muted/20 p-3" key={`${index}:${item.label}`}>
            <div className="flex items-center justify-between gap-2">
              <Typography as="span" tone="muted" variant="caption">Ссылка {index + 1}</Typography>
              <Button aria-label={`Удалить ссылку ${index + 1}`} disabled={save.isPending} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} size="icon-xs" type="button" variant="ghost">
                <HugeiconsIcon aria-hidden icon={Delete02Icon} strokeWidth={2} />
              </Button>
            </div>
            <Input aria-label={`Название ссылки ${index + 1}`} maxLength={120} onChange={(event) => changeItem(index, 'label', event.target.value)} placeholder="Название ссылки" value={item.label} />
            <Input aria-label={`Адрес ссылки ${index + 1}`} maxLength={500} onChange={(event) => changeItem(index, 'href', event.target.value)} placeholder="/services" value={item.href} />
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button disabled={items.length >= 100 || save.isPending} onClick={() => setItems((current) => [...current, { label: 'Новая ссылка', href: '/' }])} size="sm" type="button" variant="outline">
            <HugeiconsIcon aria-hidden icon={Add01Icon} strokeWidth={2} /> Добавить ссылку
          </Button>
          <Button disabled={!dirty || !valid || save.isPending} onClick={() => save.mutate({ menuId: menu.id, items: items.map((item) => ({ label: item.label.trim(), href: item.href.trim() })), expectedRevision: menu.revision })} size="sm" type="button">
            <HugeiconsIcon aria-hidden icon={SaveIcon} strokeWidth={2} /> {save.isPending ? 'Сохраняем…' : 'Сохранить меню'}
          </Button>
        </div>
        {save.isError && <Typography role="alert" tone="destructive" variant="bodyXs">Не удалось сохранить меню. Обновите страницу и повторите попытку.</Typography>}
      </CardContent>
    </Card>
  )
}

function NavigationError() {
  return <Card><CardHeader><Typography as="h2" variant="h6">Навигация сайта</Typography><CardDescription>Не удалось загрузить меню. Обновите страницу и попробуйте ещё раз.</CardDescription></CardHeader></Card>
}

function NavigationEmpty() {
  return <Card><CardHeader><Typography as="h2" variant="h6">Навигация сайта</Typography><CardDescription>Меню ещё не настроены. Они появятся здесь после инициализации сайта.</CardDescription></CardHeader></Card>
}
