import {
  coreBlockContractDefinitions,
  type CmsBlockContractDefinition,
  type CmsSitePackageDescriptor,
  type RegisteredContentBlock,
} from '@web-app-demo/contracts'
import { expect, mock, test } from 'bun:test'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { z } from 'zod'

import { PageEditor, SitePackageBlockAddMenu } from '@/features/cms/components/PageEditor'
import { DescriptorBlockEditor } from '@/features/cms/site-package/DescriptorBlockEditor'
import { createAdminBlockRegistry } from '@/features/cms/site-package/registry'

const descriptor: CmsSitePackageDescriptor = {
  id: 'reference-calculator',
  version: '1.0.0',
  schemaVersion: 1,
}

const calculatorDefinition = {
  type: 'estimateCalculator',
  label: 'Калькулятор стоимости',
  description: 'Расчёт по площади и цене',
  dataSchema: z.object({
    title: z.string().trim().min(1),
    unitPrice: z.number().min(1).max(1_000_000),
  }).strict(),
  defaultData: { title: 'Рассчитайте стоимость', unitPrice: 1_500 },
  editor: {
    kind: 'descriptor',
    fields: [
      { key: 'title', kind: 'text', label: 'Заголовок', required: true },
      {
        key: 'unitPrice',
        kind: 'number',
        label: 'Цена за м²',
        required: true,
        min: 1,
        max: 1_000_000,
      },
    ],
  },
} satisfies CmsBlockContractDefinition

const heroDefinition = coreBlockContractDefinitions.find((definition) => definition.type === 'hero')!

test('selected package registrations drive the add-section menu and schema-validated defaults', () => {
  const registry = createAdminBlockRegistry({
    descriptor,
    blockDefinitions: [heroDefinition, calculatorDefinition],
    admin: { descriptor, customEditors: {} },
  })
  const onAdd = mock(() => undefined)

  const html = renderToStaticMarkup(
    <SitePackageBlockAddMenu onAdd={onAdd} registrations={registry.registrations} />,
  )

  expect(html).toContain('aria-label="Калькулятор стоимости"')
  expect(html).not.toContain('Контакты')
  expect(registry.create('estimateCalculator', 'calculator-1')).toEqual({
    id: 'calculator-1',
    type: 'estimateCalculator',
    data: { title: 'Рассчитайте стоимость', unitPrice: 1_500 },
  })
})

test('descriptor fields expose Russian labels, bounds, hints, errors, and numeric changes', () => {
  const onChange = mock(() => undefined)
  const block: RegisteredContentBlock = {
    id: 'calculator-1',
    type: 'estimateCalculator',
    data: { title: 'Рассчитайте стоимость', unitPrice: 1_500 },
  }

  const editor = DescriptorBlockEditor({
    block,
    definition: calculatorDefinition,
    entries: [],
    mediaAssets: [],
    onChange,
  })
  const unitPriceInput = findElement(editor, (element) => element.props.id === 'cms-block-calculator-1-unitPrice')

  expect(unitPriceInput).toBeDefined()
  expect(unitPriceInput?.props).toMatchObject({ min: 1, max: 1_000_000, required: true, type: 'number' })
  unitPriceInput?.props.onChange({ target: { value: '2500' } })
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ unitPrice: 2_500 }))

  const invalidHtml = renderToStaticMarkup(
    <DescriptorBlockEditor
      block={{ ...block, data: { title: '', unitPrice: 0 } }}
      definition={calculatorDefinition}
      entries={[]}
      mediaAssets={[]}
      onChange={() => undefined}
    />,
  )
  expect(invalidHtml).toContain('Цена за м²')
  expect(invalidHtml).toContain('От 1 до 1000000')
  expect(invalidHtml).toContain('Значение должно быть не меньше 1')
  expect(invalidHtml).toContain('Обязательное поле')
})

test('custom editor registrations require the exact selected admin component', () => {
  const CustomEditor = () => <div>Специальный редактор</div>
  const customDefinition = {
    ...calculatorDefinition,
    editor: { kind: 'custom' as const },
  }

  const registry = createAdminBlockRegistry({
    descriptor,
    blockDefinitions: [customDefinition],
    admin: { descriptor, customEditors: { estimateCalculator: CustomEditor } },
  })

  expect(registry.get('estimateCalculator')?.Editor).toBe(CustomEditor)
  expect(() => createAdminBlockRegistry({
    descriptor,
    blockDefinitions: [customDefinition],
    admin: { descriptor, customEditors: {} },
  })).toThrow('Missing custom CMS editor for estimateCalculator')
  expect(() => createAdminBlockRegistry({
    descriptor,
    blockDefinitions: [calculatorDefinition],
    admin: {
      descriptor: { ...descriptor, version: '2.0.0' },
      customEditors: {},
    },
  })).toThrow('Selected Site Package admin descriptor does not match its contract')
})

test('an unknown stored block renders a blocking Russian error', () => {
  const html = renderToStaticMarkup(
    <PageEditor
      page={{
        id: '018f8c8d-5f34-7db2-8b98-2c7bf3d80a10',
        title: 'Главная',
        path: '/',
        draftRevision: 3,
        archived: false,
        draftPayload: {
          title: 'Главная',
          path: '/',
          blocks: [{ id: 'unknown-1', type: 'unknown', data: {} }],
        },
      }}
    />,
  )

  expect(html).toContain('Черновик нельзя открыть')
  expect(html).toContain('неподдерживаемые')
  expect(html).toContain('role="alert"')
})

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (!isValidElement<Record<string, unknown>>(node)) return undefined
  if (predicate(node)) return node
  for (const child of Children.toArray(node.props.children as ReactNode)) {
    const match = findElement(child, predicate)
    if (match) return match
  }
  return undefined
}
