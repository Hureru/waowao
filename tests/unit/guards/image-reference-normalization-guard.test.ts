import { describe, expect, it } from 'vitest'

type ImageReferenceNormalizationGuardModule = {
  NORMALIZATION_HELPER_ALLOWLIST: Set<string>
  inspectImageReferenceNormalization: (relPath: string, content: string) => string[]
}

async function loadGuardModule() {
  const moduleHref = new URL('../../../scripts/guards/image-reference-normalization-guard.mjs', import.meta.url).href
  return (await import(/* @vite-ignore */ moduleHref)) as ImageReferenceNormalizationGuardModule
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
