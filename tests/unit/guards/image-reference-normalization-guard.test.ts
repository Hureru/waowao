import { describe, expect, it } from 'vitest'

const importModule = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<Record<string, unknown>>

async function loadGuardModule() {
  return await importModule(new URL('../../../scripts/guards/image-reference-normalization-guard.mjs', import.meta.url).href)
}

describe('image reference normalization guard', () => {
  it('allows shared helper exceptions explicitly', async () => {
    const {
      NORMALIZATION_HELPER_ALLOWLIST,
      inspectImageReferenceNormalization,
    } = await loadGuardModule()

    expect(NORMALIZATION_HELPER_ALLOWLIST.has('src/lib/workers/handlers/image-task-handler-shared.ts')).toBe(true)
    expect(
      inspectImageReferenceNormalization(
        'src/lib/workers/handlers/image-task-handler-shared.ts',
        'resolveImageSourceFromGeneration(job, { options: params.options })\nreferenceImages?: string[]',
      ),
    ).toEqual([])
  })

  it('passes handlers that normalize reference images before generation', async () => {
    const { inspectImageReferenceNormalization } = await loadGuardModule()
    const content = `
      import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
      async function run() {
        const normalizedRefs = await normalizeReferenceImagesForGeneration(refs)
        return await resolveImageSourceFromGeneration(job, {
          options: {
            referenceImages: normalizedRefs,
          },
        })
      }
    `

    expect(
      inspectImageReferenceNormalization('src/lib/workers/handlers/panel-image-task-handler.ts', content),
    ).toEqual([])
  })

  it('flags handlers that send referenceImages without normalization markers', async () => {
    const { inspectImageReferenceNormalization } = await loadGuardModule()
    const content = `
      async function run() {
        return await resolveImageSourceFromGeneration(job, {
          options: {
            referenceImages: refs,
          },
        })
      }
    `

    expect(
      inspectImageReferenceNormalization('src/lib/workers/handlers/bad-handler.ts', content),
    ).toEqual([
      'src/lib/workers/handlers/bad-handler.ts uses resolveImageSourceFromGeneration with referenceImages but does not reference normalizeReferenceImagesForGeneration/normalizeToBase64ForGeneration/generateLabeledImageToCos',
    ])
  })
})
