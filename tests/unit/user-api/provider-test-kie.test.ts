import { beforeEach, describe, expect, it, vi } from 'vitest'
import { testProviderConnection } from '@/lib/user-api/provider-test'

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>())

describe('provider test connection kie', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('passes when credits endpoint responds successfully', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: 88,
    }), { status: 200 }))

    const result = await testProviderConnection({
      apiType: 'kie',
      apiKey: 'kie-key',
    })

    expect(result).toEqual({
      success: true,
      steps: [{
        name: 'credits',
        status: 'pass',
        message: 'Kie.ai credits endpoint reachable',
      }],
    })
  })

  it('fails with auth classification when credits endpoint rejects the key', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))

    const result = await testProviderConnection({
      apiType: 'kie',
      apiKey: 'kie-key',
    })

    expect(result.success).toBe(false)
    expect(result.steps[0]).toMatchObject({
      name: 'credits',
      status: 'fail',
      message: 'Authentication failed (401)',
    })
  })
})
