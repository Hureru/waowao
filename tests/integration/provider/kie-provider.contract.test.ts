import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pollAsyncTask } from '@/lib/async-poll'
import { generateKieImage, queryKieTaskStatus } from '@/lib/providers/kie'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'

const getProviderConfigMock = vi.hoisted(() => vi.fn())
const getUserModelsMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: getProviderConfigMock,
  getUserModels: getUserModelsMock,
}))

describe('provider contract - kie market', () => {
  let server: Awaited<ReturnType<typeof startScenarioServer>> | null = null

  beforeEach(async () => {
    server = await startScenarioServer()
    vi.clearAllMocks()
    getProviderConfigMock.mockResolvedValue({
      id: 'kie:provider-local',
      apiKey: 'kie-local',
      baseUrl: server.baseUrl,
    })
    getUserModelsMock.mockResolvedValue([
      {
        provider: 'kie:provider-local',
      },
    ])
  })

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('submits image task to createTask and returns KIE externalId', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/api/v1/jobs/createTask',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: {
          data: {
            taskId: 'task_img_1',
          },
        },
      },
    })

    const result = await generateKieImage({
      userId: 'user-1',
      prompt: 'draw a product shot',
      referenceImages: ['https://example.com/ref.png'],
      options: {
        provider: 'kie:provider-local',
        modelId: 'google/imagen4',
        modelKey: 'kie:provider-local::google/imagen4',
        aspectRatio: '1:1',
      },
    })

    expect(result).toMatchObject({
      success: true,
      async: true,
      requestId: 'task_img_1',
      externalId: 'KIE:IMAGE:task_img_1',
    })

    const requests = server!.getRequests('POST', '/api/v1/jobs/createTask')
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      model: 'google/imagen4',
      input: {
        provider: 'kie:provider-local',
        modelId: 'google/imagen4',
        modelKey: 'kie:provider-local::google/imagen4',
        aspectRatio: '1:1',
        prompt: 'draw a product shot',
        aspect_ratio: '1:1',
        image_urls: ['https://example.com/ref.png'],
      },
    })
  })

  it('polls recordInfo and resolves downloadable url', async () => {
    server!.defineScenario({
      method: 'GET',
      path: '/api/v1/jobs/recordInfo',
      mode: 'queued_then_success',
      pollSequence: [
        {
          status: 200,
          body: {
            data: {
              state: 'generating',
            },
          },
        },
        {
          status: 200,
          body: {
            data: {
              state: 'success',
              resultJson: JSON.stringify({
                resultUrls: ['https://tempfile.aiquickdraw.com/path/to/video.mp4'],
              }),
            },
          },
        },
      ],
    })
    server!.defineScenario({
      method: 'POST',
      path: '/api/v1/common/download-url',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: {
          data: 'https://download.local/video.mp4',
        },
      },
    })

    const first = await pollAsyncTask('KIE:VIDEO:task_vid_1', 'user-1')
    const second = await pollAsyncTask('KIE:VIDEO:task_vid_1', 'user-1')

    expect(first).toEqual({
      status: 'pending',
      resultUrl: undefined,
      videoUrl: undefined,
      error: undefined,
    })
    expect(second).toEqual({
      status: 'completed',
      resultUrl: 'https://download.local/video.mp4',
      videoUrl: 'https://download.local/video.mp4',
      error: undefined,
    })
  })

  it('reports failMsg when kie task fails', async () => {
    server!.defineScenario({
      method: 'GET',
      path: '/api/v1/jobs/recordInfo',
      mode: 'fatal_error',
      submitResponse: {
        status: 200,
        body: {
          data: {
            state: 'fail',
            failMsg: 'credits exhausted',
          },
        },
      },
    })

    const result = await queryKieTaskStatus('task_fail_1', 'kie-local', server!.baseUrl)
    expect(result).toEqual({
      status: 'failed',
      error: 'credits exhausted',
    })
  })
})
