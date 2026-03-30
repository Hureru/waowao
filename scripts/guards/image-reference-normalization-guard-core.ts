import fs from 'fs'
import path from 'path'

export const NORMALIZATION_HELPER_ALLOWLIST = new Set([
  'src/lib/workers/handlers/image-task-handler-shared.ts',
])

const ACCEPTED_NORMALIZATION_MARKERS = [
  /\bnormalizeReferenceImagesForGeneration\s*\(/,
  /\bnormalizeToBase64ForGeneration\s*\(/,
  /\bgenerateLabeledImageToCos\s*\(/,
]

export function walkHandlerFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.next' || entry.name === 'node_modules') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkHandlerFiles(fullPath, out)
      continue
    }
    if (entry.name.endsWith('.ts')) out.push(fullPath)
  }
  return out
}

export function toRelPath(scanRoot: string, fullPath: string): string {
  return path.relative(scanRoot, fullPath).split(path.sep).join('/')
}

export function usesGenerationReferenceImages(content: string): boolean {
  return /\bresolveImageSourceFromGeneration\s*\(/.test(content) && /\breferenceImages\s*:/.test(content)
}

export function hasNormalizationMarker(content: string): boolean {
  return ACCEPTED_NORMALIZATION_MARKERS.some((pattern) => pattern.test(content))
}

export function inspectImageReferenceNormalization(relPath: string, content: string): string[] {
  if (NORMALIZATION_HELPER_ALLOWLIST.has(relPath)) return []
  if (!usesGenerationReferenceImages(content)) return []
  if (hasNormalizationMarker(content)) return []
  return [
    `${relPath} uses resolveImageSourceFromGeneration with referenceImages but does not reference normalizeReferenceImagesForGeneration/normalizeToBase64ForGeneration/generateLabeledImageToCos`,
  ]
}

export function findImageReferenceNormalizationViolations(scanRoot: string): string[] {
  const scanDir = path.join(scanRoot, 'src', 'lib', 'workers', 'handlers')
  return walkHandlerFiles(scanDir)
    .map((fullPath) => {
      const relPath = toRelPath(scanRoot, fullPath)
      const content = fs.readFileSync(fullPath, 'utf8')
      return inspectImageReferenceNormalization(relPath, content)
    })
    .flat()
}
