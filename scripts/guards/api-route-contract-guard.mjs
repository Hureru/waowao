#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'
import { pathToFileURL } from 'url'

import {
  API_HANDLER_ALLOWLIST,
  PUBLIC_ROUTE_ALLOWLIST,
  findApiRouteContractViolations,
  walkApiRoutes,
} from './api-route-contract-guard-core.ts'

function fail(title, details = []) {
  process.stderr.write(`\n[api-route-contract-guard] ${title}\n`)
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

  const violations = findApiRouteContractViolations(root)
  if (violations.length > 0) {
    fail('Found API route contract violations', violations)
  }

  process.stdout.write(
    `[api-route-contract-guard] OK routes=${walkApiRoutes(apiDir).length} public=${PUBLIC_ROUTE_ALLOWLIST.size} apiHandlerExceptions=${API_HANDLER_ALLOWLIST.size}\n`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
