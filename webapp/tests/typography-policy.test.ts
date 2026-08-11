import { expect, test } from 'bun:test'
import { ESLint } from 'eslint'
import { resolve } from 'node:path'

const webRoot = resolve(import.meta.dir, '..')

async function lintPolicyFixture(source: string) {
  const eslint = new ESLint({
    cwd: webRoot,
    overrideConfigFile: resolve(webRoot, 'eslint.config.js'),
  })
  const [result] = await eslint.lintText(source, {
    filePath: resolve(webRoot, 'src/typography-policy.fixture.tsx'),
  })

  return result?.messages
    .filter((message) => message.ruleId === 'typographyPolicy/use-typography-component')
    .map((message) => message.message)
}

test('typography policy allows project Typography and layout children', async () => {
  const messages = await lintPolicyFixture(`
    import { Typography } from '@/components/typography'

    export function Fixture({ children }: { children: React.ReactNode }) {
      return (
        <div>
          {children}
          <Typography as="h1" variant="h2">Allowed text</Typography>
        </div>
      )
    }
  `)

  expect(messages).toEqual([])
})

test('typography policy rejects raw semantic elements and DOM text', async () => {
  const messages = await lintPolicyFixture(`
    export function Fixture() {
      return (
        <>
          <h1>Raw heading</h1>
          <button>Raw button label</button>
        </>
      )
    }
  `)

  expect(messages).toEqual(expect.arrayContaining([
    'Use <Typography> for semantic text elements instead of raw <h1>.',
    'Wrap text content in <button> with <Typography> instead of raw JSX text.',
  ]))
})

test('typography policy rejects typography utilities outside variants', async () => {
  const messages = await lintPolicyFixture(`
    export function Fixture() {
      return <div className="text-sm font-bold leading-tight tracking-wide" />
    }
  `)

  expect(messages).toEqual(expect.arrayContaining([
    'Move typography utility "text-sm" into the Typography component variants.',
    'Move typography utility "font-bold" into the Typography component variants.',
    'Move typography utility "leading-tight" into the Typography component variants.',
    'Move typography utility "tracking-wide" into the Typography component variants.',
  ]))
})
