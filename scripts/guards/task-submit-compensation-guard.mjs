#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'
import { pathToFileURL } from 'url'

import {
  findTaskSubmitCompensationViolations,
  walkApiRoutes,
} from './task-submit-compensation-guard-core.ts'

function fail(title, details = []) {
  process.stderr.write(`\n[task-submit-compensation-guard] ${title}\n`)
  for (const detail of details) {
    process.stderr.write(`  - ${detail}\n`)
  }
  process.exit(1)
}

export function main() {
  const root = process.cwd()
  const apiDir = path.join(root, 'src', 'app', 'api')
  if (!fs.existsSync(apiDir)) {
    fail('Missing src/app/api directory')
  }

  const routeFiles = walkApiRoutes(apiDir)
  const violations = findTaskSubmitCompensationViolations(root)
  if (violations.length > 0) {
    fail('Found create+submitTask routes without compensation marker', violations)
  }

  process.stdout.write(`[task-submit-compensation-guard] OK routes=${routeFiles.length}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
