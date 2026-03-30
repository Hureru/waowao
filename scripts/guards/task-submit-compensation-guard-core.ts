import fs from 'fs'
import path from 'path'

const CREATE_PATTERN = /\.\s*create\s*\(/
const SUBMIT_TASK_PATTERN = /\bsubmitTask\s*\(/
const ROLLBACK_PATTERN = /rollback|compensat/i

export function walkApiRoutes(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.next' || entry.name === 'node_modules') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkApiRoutes(fullPath, out)
      continue
    }
    if (entry.name === 'route.ts') out.push(fullPath)
  }
  return out
}

export function toRelPath(scanRoot: string, fullPath: string): string {
  return path.relative(scanRoot, fullPath).split(path.sep).join('/')
}

export function inspectTaskSubmitCompensation(relPath: string, content: string): string[] {
  if (!CREATE_PATTERN.test(content)) return []
  if (!SUBMIT_TASK_PATTERN.test(content)) return []
  if (ROLLBACK_PATTERN.test(content)) return []
  return [
    `${relPath} creates data before submitTask without explicit rollback/compensation marker`,
  ]
}

export function findTaskSubmitCompensationViolations(scanRoot: string): string[] {
  const routesRoot = path.join(scanRoot, 'src', 'app', 'api')
  return walkApiRoutes(routesRoot)
    .map((fullPath) => {
      const relPath = toRelPath(scanRoot, fullPath)
      const content = fs.readFileSync(fullPath, 'utf8')
      return inspectTaskSubmitCompensation(relPath, content)
    })
    .flat()
}
