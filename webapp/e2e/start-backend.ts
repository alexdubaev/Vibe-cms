import prepareE2eDatabase from './global-setup'

await prepareE2eDatabase()
await import('../../backend/src/index')
