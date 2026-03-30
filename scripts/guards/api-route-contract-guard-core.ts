import fs from 'fs'
import path from 'path'

export const API_HANDLER_ALLOWLIST = new Set([
  'src/app/api/auth/[...nextauth]/route.ts',
  'src/app/api/files/[...path]/route.ts',
  'src/app/api/system/boot-id/route.ts',
])

export const PUBLIC_ROUTE_ALLOWLIST = new Set([
  'src/app/api/auth/[...nextauth]/route.ts',
  'src/app/api/auth/register/route.ts',
  'src/app/api/cos/image/route.ts',
  'src/app/api/files/[...path]/route.ts',
  'src/app/api/storage/sign/route.ts',
  'src/app/api/system/boot-id/route.ts',
])

const AUTH_CALL_PATTERNS = [
  /\brequireUserAuth\s*\(/,
  /\brequireProjectAuth\s*\(/,
  /\brequireProjectAuthLight\s*\(/,
]

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

export function hasApiHandlerWrapper(content: string): boolean {
  return /\bapiHandler\s*\(/.test(content)
}

export function hasRequiredAuth(content: string): boolean {
  return AUTH_CALL_PATTERNS.some((pattern) => pattern.test(content))
}

export function inspectRouteContract(relPath: string, content: string): string[] {
  const violations: string[] = []

  if (!API_HANDLER_ALLOWLIST.has(relPath) && !hasApiHandlerWrapper(content)) {
    violations.push(`${relPath} missing apiHandler wrapper`)
  }

  if (!PUBLIC_ROUTE_ALLOWLIST.has(relPath) && !hasRequiredAuth(content)) {
    violations.push(`${relPath} missing requireUserAuth/requireProjectAuth/requireProjectAuthLight`)
  }

  return violations
}

export function findApiRouteContractViolations(scanRoot: string): string[] {
  const routesRoot = path.join(scanRoot, 'src', 'app', 'api')
  return walkApiRoutes(routesRoot)
    .map((fullPath) => {
      const relPath = toRelPath(scanRoot, fullPath)
      const content = fs.readFileSync(fullPath, 'utf8')
      return inspectRouteContract(relPath, content)
    })
    .flat()
}
