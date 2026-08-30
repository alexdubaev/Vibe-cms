import { expect, test } from 'bun:test'

import {
  homePathForRole,
  navigationGroupsForRole,
  navigationItemsForRole,
  resolveRoleDestination,
  safeReturnPath,
} from '../src/features/navigation/model'

test('role navigation exposes only the current workspace', () => {
  // Asserted as a boundary, not as a list: a new menu entry is a product decision, while an admin
  // path reachable from the user menu is a bug.
  expect(navigationItemsForRole('user').every((item) => item.to.startsWith('/app'))).toBe(true)
  expect(navigationItemsForRole('editor').every((item) => item.to.startsWith('/admin'))).toBe(true)
  expect(navigationItemsForRole('owner').every((item) => item.to.startsWith('/admin'))).toBe(true)
  expect(homePathForRole('user')).toBe('/app')
  expect(homePathForRole('editor')).toBe('/admin')
  expect(homePathForRole('owner')).toBe('/admin')
})

test('admin navigation is grouped by the work editors are doing', () => {
  expect(navigationGroupsForRole('editor').map((group) => group.label)).toEqual([
    'Рабочее пространство',
    'Сайт',
    'Выпуск',
    'Управление',
  ])
  expect(navigationGroupsForRole('editor')[1]?.items.map((item) => item.label)).toEqual([
    'Страницы',
    'Контент',
    'Медиатека',
  ])
  expect(navigationGroupsForRole('editor').flatMap((group) => group.items).map((item) => item.to)).not.toContain('/admin/users')
  expect(navigationGroupsForRole('owner').flatMap((group) => group.items).map((item) => item.to)).toContain('/admin/users')
})

test('CMS navigation uses human Russian labels instead of internal workspace terms', () => {
  expect(navigationItemsForRole('editor').map((item) => item.label)).toEqual([
    'Обзор',
    'Страницы',
    'Контент',
    'Медиатека',
    'Публикации',
    'Настройки сайта',
  ])
  expect(navigationItemsForRole('owner').map((item) => item.label)).toContain('Доступ и команда')
})

test('cross-role destinations resolve to the current role home', () => {
  expect(resolveRoleDestination('user', '/app/profile')).toBe('/app/profile')
  expect(resolveRoleDestination('user', '/admin/users')).toBe('/app')
  expect(resolveRoleDestination('editor', '/admin/settings')).toBe('/admin/settings')
  expect(resolveRoleDestination('owner', '/admin/users')).toBe('/admin/users')
  expect(resolveRoleDestination('editor', '/admin/users')).toBe('/admin')
  expect(resolveRoleDestination('owner', '/app')).toBe('/admin')
})

test('return paths accept only known internal destinations for the current role', () => {
  expect(safeReturnPath('user', '/app/profile')).toBe('/app/profile')
  expect(safeReturnPath('owner', '/admin/users?page=2')).toBe('/admin/users?page=2')
  expect(safeReturnPath('editor', '/admin/users?page=2')).toBeNull()
  expect(safeReturnPath('user', '/admin')).toBeNull()
  expect(safeReturnPath('owner', 'https://attacker.example/admin')).toBeNull()
  expect(safeReturnPath('owner', '//attacker.example/admin')).toBeNull()
  expect(safeReturnPath('user', '/app/unknown')).toBeNull()
})
