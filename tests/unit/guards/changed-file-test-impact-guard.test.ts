import { describe, expect, it } from 'vitest'
import { inspectChangedFiles } from '../../../scripts/guards/changed-file-test-impact-guard-core'

describe('changed-file-test-impact-guard', () => {
  it('requires api changes to be paired with contract, system, or regression tests', async () => {
    const violations = inspectChangedFiles([
      'src/app/api/novel-promotion/[projectId]/generate-image/route.ts',
    ])
    expect(violations).toEqual([
      'api: changing src/app/api/** requires a matching contract, system, or regression test change; sources=src/app/api/novel-promotion/[projectId]/generate-image/route.ts',
    ])
  })

  it('accepts worker changes when system tests are updated together', async () => {
    const violations = inspectChangedFiles([
      'src/lib/workers/image.worker.ts',
      'tests/system/generate-image.system.test.ts',
    ])
    expect(violations).toEqual([])
  })

  it('accepts provider changes when provider contract coverage is updated', async () => {
    const violations = inspectChangedFiles([
      'src/lib/model-gateway/openai-compat/image.ts',
      'tests/unit/model-gateway/openai-compat-template-image-output-urls.test.ts',
    ])
    expect(violations).toEqual([])
  })
})
