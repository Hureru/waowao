#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'
import { pathToFileURL } from 'url'

import {
  NORMALIZATION_HELPER_ALLOWLIST,
  findImageReferenceNormalizationViolations,
  walkHandlerFiles,
} from './image-reference-normalization-guard-core.ts'

function fail(title, details = []) {
  process.stderr.write(`\n[image-reference-normalization-guard] ${title}\n`)
  for (const detail of details) {
    process.stderr.write(`  - ${detail}\n`)
  }
  process.exit(1)
}

export function main() {
  const root = process.cwd()
  const handlersDir = path.join(root, 'src', 'lib', 'workers', 'handlers')
  if (!fs.existsSync(handlersDir)) {
    fail('Missing src/lib/workers/handlers directory')
  }

  const handlerFiles = walkHandlerFiles(handlersDir)
  const violations = findImageReferenceNormalizationViolations(root)
  if (violations.length > 0) {
    fail('Found image reference normalization violations', violations)
  }

  process.stdout.write(
    `[image-reference-normalization-guard] OK handlers=${handlerFiles.length} allowlist=${NORMALIZATION_HELPER_ALLOWLIST.size}\n`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
