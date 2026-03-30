import { describe, expect, it } from 'vitest'

type TaskSubmitCompensationGuardModule = {
  inspectTaskSubmitCompensation: (relPath: string, content: string) => string[]
}

async function loadGuardModule() {
  const moduleHref = new URL('../../../scripts/guards/task-submit-compensation-guard.mjs', import.meta.url).href
  return (await import(/* @vite-ignore */ moduleHref)) as TaskSubmitCompensationGuardModule
}

describe('task submit compensation guard', () => {
  it('passes routes that create data before submitTask and define rollback handling', async () => {
    const { inspectTaskSubmitCompensation } = await loadGuardModule()
    const content = `
      async function rollbackCreatedRecord() {}
      export const POST = apiHandler(async () => {
        await prisma.panel.create({ data: {} })
        try {
          return await submitTask({})
        } catch (error) {
          await rollbackCreatedRecord()
          throw error
        }
      })
    `

    expect(
      inspectTaskSubmitCompensation('src/app/api/novel-promotion/[projectId]/panel-variant/route.ts', content),
    ).toEqual([])
  })

  it('ignores routes that do not combine create and submitTask', async () => {
    const { inspectTaskSubmitCompensation } = await loadGuardModule()
    expect(inspectTaskSubmitCompensation('src/app/api/user/api-config/route.ts', 'await submitTask({})')).toEqual([])
    expect(inspectTaskSubmitCompensation('src/app/api/projects/route.ts', 'await prisma.project.create({ data: {} })')).toEqual([])
  })

  it('flags routes that create data before submitTask without compensation marker', async () => {
    const { inspectTaskSubmitCompensation } = await loadGuardModule()
    const content = `
      export const POST = apiHandler(async () => {
        await prisma.panel.create({ data: {} })
        return await submitTask({})
      })
    `

    expect(
      inspectTaskSubmitCompensation('src/app/api/example/route.ts', content),
    ).toEqual([
      'src/app/api/example/route.ts creates data before submitTask without explicit rollback/compensation marker',
    ])
  })
})
