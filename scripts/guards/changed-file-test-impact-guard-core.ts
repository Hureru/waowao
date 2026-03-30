import { execSync } from 'node:child_process'

export type ChangedFileRule = {
  name: string
  source: RegExp
  tests: RegExp[]
  message: string
}

export const RULES: ChangedFileRule[] = [
  {
    name: 'api',
    source: /^src\/app\/api\//,
    tests: [/^tests\/integration\/api\/contract\//, /^tests\/system\//, /^tests\/regression\//],
    message: 'changing src/app/api/** requires a matching contract, system, or regression test change',
  },
  {
    name: 'worker',
    source: /^src\/lib\/workers\//,
    tests: [/^tests\/unit\/worker\//, /^tests\/system\//, /^tests\/regression\//],
    message: 'changing src/lib/workers/** requires a matching worker, system, or regression test change',
  },
  {
    name: 'task',
    source: /^src\/lib\/task\//,
    tests: [/^tests\/unit\/task\//, /^tests\/system\//, /^tests\/regression\//],
    message: 'changing src/lib/task/** requires a matching task, system, or regression test change',
  },
  {
    name: 'media',
    source: /^src\/lib\/media\//,
    tests: [/^tests\/unit\//, /^tests\/system\//, /^tests\/regression\//],
    message: 'changing src/lib/media/** requires a matching unit, system, or regression test change',
  },
  {
    name: 'provider',
    source: /^src\/lib\/(generator-api|generators|model-gateway|lipsync|providers)\//,
    tests: [/^tests\/unit\/(providers|model-gateway|llm)\//, /^tests\/integration\/provider\//, /^tests\/system\//, /^tests\/regression\//],
    message: 'changing provider/gateway code requires provider contract, system, or regression test change',
  },
]

export function normalizeChangedFiles(rawFiles: string[]): string[] {
  return rawFiles
    .flatMap((item) => item.split(/[\n,]/))
    .map((item) => item.trim())
    .filter(Boolean)
}

export function readGitChangedFiles(cwd: string = process.cwd()): string[] {
  try {
    const output = execSync('git diff --name-only --cached', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return normalizeChangedFiles([output])
  } catch {
    return []
  }
}

export function inspectChangedFiles(changedFiles: string[]): string[] {
  const changed = normalizeChangedFiles(changedFiles)
  const changedTests = changed.filter((file) => file.startsWith('tests/'))
  const violations: string[] = []

  for (const rule of RULES) {
    const impactedSources = changed.filter((file) => rule.source.test(file))
    if (impactedSources.length === 0) continue
    const hasMatchingTestChange = changedTests.some((file) => rule.tests.some((pattern) => pattern.test(file)))
    if (!hasMatchingTestChange) {
      violations.push(`${rule.name}: ${rule.message}; sources=${impactedSources.join(',')}`)
    }
  }

  return violations
}
