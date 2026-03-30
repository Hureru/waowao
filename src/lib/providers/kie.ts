import { getProviderConfig } from '@/lib/api-config'
import type { GenerateResult, ImageGenerateParams, VideoGenerateParams } from '@/lib/generators/base'

export const KIE_OFFICIAL_BASE_URL = 'https://api.kie.ai'

type KieCreateTaskResponse = {
  data?: {
    taskId?: string
  }
}

type KieTaskRecord = {
  state?: string
  resultJson?: string | Record<string, unknown> | null
  failCode?: string
  failMsg?: string
}

type KieTaskStatusResponse = {
  data?: KieTaskRecord
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeBaseUrl(baseUrl?: string): string {
  const value = readString(baseUrl)
  return (value || KIE_OFFICIAL_BASE_URL).replace(/\/+$/, '')
}

function createHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

function readTaskId(payload: KieCreateTaskResponse): string {
  const taskId = readString(payload.data?.taskId)
  if (!taskId) {
    throw new Error('KIE_TASK_ID_NOT_FOUND')
  }
  return taskId
}

function parseResultJson(value: KieTaskRecord['resultJson']): Record<string, unknown> | null {
  if (isRecord(value)) return value
  const raw = readString(value)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function findFirstUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) {
    return value.trim()
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstUrl(item)
      if (found) return found
    }
    return undefined
  }
  if (!isRecord(value)) return undefined

  for (const [key, nested] of Object.entries(value)) {
    if (key.toLowerCase().includes('url')) {
      const found = findFirstUrl(nested)
      if (found) return found
    }
  }
  for (const nested of Object.values(value)) {
    const found = findFirstUrl(nested)
    if (found) return found
  }
  return undefined
}

function readResultUrl(record: KieTaskRecord): string | undefined {
  const parsed = parseResultJson(record.resultJson)
  if (!parsed) return undefined
  const resultUrls = parsed.resultUrls
  if (Array.isArray(resultUrls)) {
    const first = resultUrls.find((item) => typeof item === 'string' && item.trim())
    if (typeof first === 'string') return first.trim()
  }
  return findFirstUrl(parsed)
}

export async function resolveKieDownloadUrl(apiKey: string, sourceUrl: string, baseUrl?: string): Promise<string> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const response = await fetch(`${normalizedBaseUrl}/api/v1/common/download-url`, {
    method: 'POST',
    headers: createHeaders(apiKey),
    body: JSON.stringify({ url: sourceUrl }),
  })
  if (!response.ok) return sourceUrl

  const payload = await response.json().catch(() => null) as { data?: unknown } | null
  const directUrl = readString(payload?.data)
  return directUrl || sourceUrl
}

export async function queryKieTaskStatus(taskId: string, apiKey: string, baseUrl?: string): Promise<{
  status: 'pending' | 'completed' | 'failed'
  resultUrl?: string
  error?: string
}> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const response = await fetch(`${normalizedBaseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })
  if (!response.ok) {
    return {
      status: 'failed',
      error: `KIE_STATUS_REQUEST_FAILED: ${response.status}`,
    }
  }

  const payload = await response.json().catch(() => null) as KieTaskStatusResponse | null
  const data = payload?.data || {}
  const state = readString(data.state).toLowerCase()
  if (state === 'waiting' || state === 'queuing' || state === 'generating') {
    return { status: 'pending' }
  }
  if (state === 'fail') {
    return {
      status: 'failed',
      error: readString(data.failMsg) || readString(data.failCode) || 'KIE task failed',
    }
  }
  if (state !== 'success') {
    return { status: 'pending' }
  }

  const resultUrl = readResultUrl(data)
  if (!resultUrl) {
    return {
      status: 'failed',
      error: 'KIE_RESULT_URL_MISSING',
    }
  }

  return {
    status: 'completed',
    resultUrl: await resolveKieDownloadUrl(apiKey, resultUrl, normalizedBaseUrl).catch(() => resultUrl),
  }
}

async function submitKieTask(input: {
  apiKey: string
  baseUrl?: string
  modelId: string
  requestInput: Record<string, unknown>
}): Promise<string> {
  const normalizedBaseUrl = normalizeBaseUrl(input.baseUrl)
  const response = await fetch(`${normalizedBaseUrl}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: createHeaders(input.apiKey),
    body: JSON.stringify({
      model: input.modelId,
      input: input.requestInput,
    }),
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`KIE_CREATE_TASK_FAILED (${response.status}): ${errorText.slice(0, 300)}`)
  }

  return readTaskId(await response.json() as KieCreateTaskResponse)
}

function buildImageRequestInput(params: ImageGenerateParams): Record<string, unknown> {
  const requestInput: Record<string, unknown> = {
    ...params.options,
    prompt: params.prompt,
  }
  const aspectRatio = readString(params.options?.aspectRatio)
  if (aspectRatio) requestInput.aspect_ratio = aspectRatio
  const negativePrompt = readString(params.options?.negativePrompt)
  if (negativePrompt) requestInput.negative_prompt = negativePrompt
  if (Array.isArray(params.referenceImages) && params.referenceImages.length > 0) {
    requestInput.image_urls = params.referenceImages
  }
  return requestInput
}

function buildVideoRequestInput(params: VideoGenerateParams): Record<string, unknown> {
  const requestInput: Record<string, unknown> = {
    ...params.options,
    image_urls: [params.imageUrl],
  }
  const prompt = readString(params.prompt)
  if (prompt) requestInput.prompt = prompt
  const aspectRatio = readString(params.options?.aspectRatio)
  if (aspectRatio) {
    requestInput.aspect_ratio = aspectRatio === '16:9'
      ? 'landscape'
      : aspectRatio === '9:16'
        ? 'portrait'
        : aspectRatio
  }
  const duration = params.options?.duration
  if (typeof duration === 'number' && Number.isFinite(duration)) requestInput.duration = duration
  const nFrames = params.options?.nFrames
  if (typeof nFrames === 'string' || typeof nFrames === 'number') requestInput.n_frames = String(nFrames)
  if (typeof params.options?.generateAudio === 'boolean') requestInput.generate_audio = params.options.generateAudio
  if (typeof params.options?.removeWatermark === 'boolean') requestInput.remove_watermark = params.options.removeWatermark
  return requestInput
}

export async function generateKieImage(params: ImageGenerateParams): Promise<GenerateResult> {
  const providerId = typeof params.options?.provider === 'string' ? params.options.provider : 'kie'
  const modelId = readString(params.options?.modelId)
  if (!modelId) throw new Error('KIE_MODEL_ID_REQUIRED')

  const config = await getProviderConfig(params.userId, providerId)
  const taskId = await submitKieTask({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    modelId,
    requestInput: buildImageRequestInput(params),
  })

  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: `KIE:IMAGE:${taskId}`,
  }
}

export async function generateKieVideo(params: VideoGenerateParams): Promise<GenerateResult> {
  const providerId = typeof params.options?.provider === 'string' ? params.options.provider : 'kie'
  const modelId = readString(params.options?.modelId)
  if (!modelId) throw new Error('KIE_MODEL_ID_REQUIRED')

  const config = await getProviderConfig(params.userId, providerId)
  const taskId = await submitKieTask({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    modelId,
    requestInput: buildVideoRequestInput(params),
  })

  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: `KIE:VIDEO:${taskId}`,
  }
}
