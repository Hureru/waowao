import { describe, expect, it } from 'vitest'

const importModule = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<Record<string, unknown>>

async function loadGuardModule() {
  return await importModule(new URL('../../../scripts/guards/api-route-contract-guard.mjs', import.meta.url).href)
}

describe('api route contract guard', () => {
  it('allows explicit public and framework-managed exceptions', async () => {
    const {
      API_HANDLER_ALLOWLIST,
      PUBLIC_ROUTE_ALLOWLIST,
      inspectRouteContract,
    } = await loadGuardModule()

    expect(API_HANDLER_ALLOWLIST.has('src/app/api/auth/[...nextauth]/route.ts')).toBe(true)
    expect(PUBLIC_ROUTE_ALLOWLIST.has('src/app/api/system/boot-id/route.ts')).toBe(true)
    expect(
      inspectRouteContract(
        'src/app/api/system/boot-id/route.ts',
        'export async function GET() { return Response.json({ bootId: "x" }) }',
      ),
    ).toEqual([])
  })

  it('passes protected routes that use apiHandler and explicit auth', async () => {
    const { inspectRouteContract } = await loadGuardModule()
    const content = `
      import { requireUserAuth } from '@/lib/api-auth'
      import { apiHandler } from '@/lib/api-errors'
      export const GET = apiHandler(async () => {
        await requireUserAuth()
        return Response.json({ ok: true })
      })
    `

    expect(inspectRouteContract('src/app/api/user/secure/route.ts', content)).toEqual([])
  })

  it('flags protected routes that skip apiHandler or auth', async () => {
    const { inspectRouteContract } = await loadGuardModule()
    const missingApiHandler = `
      import { requireUserAuth } from '@/lib/api-auth'
      export async function GET() {
        await requireUserAuth()
        return Response.json({ ok: true })
      }
    `
    const missingAuth = `
      import { apiHandler } from '@/lib/api-errors'
      export const GET = apiHandler(async () => Response.json({ ok: true }))
    `

    expect(inspectRouteContract('src/app/api/user/secure/route.ts', missingApiHandler)).toEqual([
      'src/app/api/user/secure/route.ts missing apiHandler wrapper',
    ])
    expect(inspectRouteContract('src/app/api/user/secure/route.ts', missingAuth)).toEqual([
      'src/app/api/user/secure/route.ts missing requireUserAuth/requireProjectAuth/requireProjectAuthLight',
    ])
  })
})
