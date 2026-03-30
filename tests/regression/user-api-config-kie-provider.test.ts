import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../helpers/auth'

type UserPreferenceSnapshot = {
  customProviders: string | null
  customModels: string | null
}

type SavedProvider = {
  id: string
  name: string
  baseUrl?: string
  apiKey?: string
  apiMode?: 'gemini-sdk' | 'openai-official'
  gatewayRoute?: 'official' | 'openai-compat'
}

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn<(...args: unknown[]) => Promise<UserPreferenceSnapshot | null>>(),
    upsert: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  },
}))

const encryptApiKeyMock = vi.hoisted(() => vi.fn((value: string) => `enc:${value}`))
const decryptApiKeyMock = vi.hoisted(() => vi.fn((value: string) => value.replace(/^enc:/, '')))
const getBillingModeMock = vi.hoisted(() => vi.fn(async () => 'OFF'))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/crypto-utils', () => ({
  encryptApiKey: encryptApiKeyMock,
  decryptApiKey: decryptApiKeyMock,
}))

vi.mock('@/lib/billing/mode', () => ({
  getBillingMode: getBillingModeMock,
}))

const routeContext = { params: Promise.resolve({}) }

function readSavedProvidersFromUpsert(): SavedProvider[] {
  const firstCall = prismaMock.userPreference.upsert.mock.calls[0]
  if (!firstCall) throw new Error('expected prisma.userPreference.upsert to be called at least once')

  const payload = firstCall[0] as { update?: { customProviders?: unknown } }
  const rawProviders = payload.update?.customProviders
  if (typeof rawProviders !== 'string') {
    throw new Error('expected update.customProviders to be a JSON string')
  }

  const parsed = JSON.parse(rawProviders) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('expected update.customProviders to parse as an array')
  }

  return parsed as SavedProvider[]
}

describe('regression - user api-config kie provider', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()

    prismaMock.userPreference.findUnique.mockResolvedValue({
      customProviders: null,
      customModels: null,
    })
    prismaMock.userPreference.upsert.mockResolvedValue({ id: 'pref-1' })
    getBillingModeMock.mockResolvedValue('OFF')
  })

  it('pins kie provider to the official baseUrl and route on PUT', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    const route = await import('@/app/api/user/api-config/route')

    const req = buildMockRequest({
      path: '/api/user/api-config',
      method: 'PUT',
      body: {
        providers: [
          {
            id: 'kie:node-1',
            name: 'Kie Node',
            apiKey: 'kie-key',
          },
        ],
      },
    })

    const res = await route.PUT(req, routeContext)
    expect(res.status).toBe(200)
    expect(prismaMock.userPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          customProviders: expect.any(String),
        }),
      }),
    )

    const savedProviders = readSavedProvidersFromUpsert()
    expect(savedProviders).toHaveLength(1)
    expect(savedProviders[0]).toMatchObject({
      id: 'kie:node-1',
      name: 'Kie Node',
      baseUrl: 'https://api.kie.ai',
      gatewayRoute: 'official',
    })
    expect(savedProviders[0]?.apiMode).toBeUndefined()
  })

  it('rejects custom baseUrl for kie provider on PUT', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    const route = await import('@/app/api/user/api-config/route')

    const req = buildMockRequest({
      path: '/api/user/api-config',
      method: 'PUT',
      body: {
        providers: [
          {
            id: 'kie:node-1',
            name: 'Kie Node',
            baseUrl: 'https://proxy.example/kie',
            apiKey: 'kie-key',
          },
        ],
      },
    })

    const res = await route.PUT(req, routeContext)
    expect(res.status).toBe(400)
    expect(prismaMock.userPreference.upsert).not.toHaveBeenCalled()
  })

  it('rejects apiMode for kie provider on PUT', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    const route = await import('@/app/api/user/api-config/route')

    const req = buildMockRequest({
      path: '/api/user/api-config',
      method: 'PUT',
      body: {
        providers: [
          {
            id: 'kie:node-1',
            name: 'Kie Node',
            apiKey: 'kie-key',
            apiMode: 'gemini-sdk',
          },
        ],
      },
    })

    const res = await route.PUT(req, routeContext)
    expect(res.status).toBe(400)
    expect(prismaMock.userPreference.upsert).not.toHaveBeenCalled()
  })
})
