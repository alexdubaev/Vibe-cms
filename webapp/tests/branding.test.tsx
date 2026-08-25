import { expect, test } from 'bun:test'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AuthPageShell } from '@/features/auth/components/AuthPageShell'

test('the authentication shell presents the Vibe CMS brand artwork', async () => {
  const rootRoute = createRootRoute()
  const loginRoute = createRoute({
    component: () => <AuthPageShell>Форма входа</AuthPageShell>,
    getParentRoute: () => rootRoute,
    path: '/login',
  })
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/login'] }),
    routeTree: rootRoute.addChildren([loginRoute]),
  })

  await router.load()

  const html = renderToStaticMarkup(<RouterProvider router={router} />)

  expect(html).toContain('src="/brand/vibe-cms-logo.png"')
  expect(html).toContain('Vibe CMS')
})
