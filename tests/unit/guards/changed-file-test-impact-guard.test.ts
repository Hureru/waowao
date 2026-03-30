import { describe, expect, it } from 'vitest'

type ChangedFileTestImpactGuardModule = {
  inspectChangedFiles: (changedFiles: string[]) => string[]
}

async function loadGuardModule() {
  const moduleHref = new URL('../../../scripts/guards/changed-file-test-impact-guard.mjs', import.meta.url).href
  return (await import(/* @vite-ignore */ moduleHref)) as ChangedFileTestImpactGuardModule
}

describe('changed-file-test-impact-guard', () => {
  it('requires api changes to be paired with contract, system, or regression tests', async () => {
    const { inspectChangedFiles } = await loadGuardModule()
    const violations = inspectChangedFiles([
      'src/app/api/novel-promotion/[projectId]/generate-image/route.ts',
    ])
    expect(violations).toEqual([
      'api: changing src/app/api/** requires a matching contract, system, or regression test change; sources=src/app/api/novel-promotion/[projectId]/generate-image/route.ts',
    ])
  })

  it('accepts worker changes when system tests are updated together', async () => {
    const { inspectChangedFiles } = await loadGuardModule()
    const violations = inspectChangedFiles([
      'src/lib/workers/image.worker.ts',
      'tests/system/generate-image.system.test.ts',
    ])
    expect(violations).toEqual([])
  })

  it('accepts provider changes when provider contract coverage is updated', async () => {
    const { inspectChangedFiles } = await loadGuardModule()
    const violations = inspectChangedFiles([
      'src/lib/model-gateway/openai-compat/image.ts',
      'tests/unit/model-gateway/openai-compat-template-image-output-urls.test.ts',
    ])
    expect(violations).toEqual([])
  })
})
