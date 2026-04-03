import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { getProviderConfig, getProviderKey, resolveModelSelectionOrSingle } from '@/lib/api-config'
import { extractStorageKey, getSignedUrl, toFetchableUrl, uploadObject } from '@/lib/storage'

// 旧版 fal IndexTTS2 实现保留供对照：
// import { fal } from '@fal-ai/client'
// import { getAudioApiKey } from '@/lib/api-config'
// import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { synthesizeWithBailianTTS } from '@/lib/providers/bailian'
import {
  parseSpeakerVoiceMap,
  resolveVoiceBindingForProvider,
  type CharacterVoiceFields,
  type SpeakerVoiceMap,
} from '@/lib/voice/provider-voice-binding'

type CheckCancelled = () => Promise<void>
type CharacterVoiceProfile = CharacterVoiceFields & { name: string }

function normalizeBailianVoiceGenerationError(errorMessage: string | null | undefined) {
  const message = typeof errorMessage === 'string' ? errorMessage.trim() : ''
  if (!message) return 'BAILIAN_AUDIO_GENERATION_FAILED'

  const normalized = message.toLowerCase()
  if (
    normalized.includes('bailian_tts_failed(400): invalidparameter') ||
    normalized.includes('invalidparameter')
  ) {
    return '无效音色ID，QwenTTS 必须使用 AI 设计音色'
  }

  return message
}

function getWavDurationFromBuffer(buffer: Buffer): number {
  try {
    const riff = buffer.slice(0, 4).toString('ascii')
    if (riff !== 'RIFF') {
      return Math.round((buffer.length * 8) / 128)
    }

    const byteRate = buffer.readUInt32LE(28)
    let offset = 12
    let dataSize = 0

    while (offset < buffer.length - 8) {
      const chunkId = buffer.slice(offset, offset + 4).toString('ascii')
      const chunkSize = buffer.readUInt32LE(offset + 4)

      if (chunkId === 'data') {
        dataSize = chunkSize
        break
      }

      offset += 8 + chunkSize
    }

    if (dataSize > 0 && byteRate > 0) {
      return Math.round((dataSize / byteRate) * 1000)
    }

    return Math.round((buffer.length * 8) / 128)
  } catch {
    return Math.round((buffer.length * 8) / 128)
  }
}

/*
旧版 fal IndexTTS2 实现（已停用，改为本地 Gradio 服务）

async function generateVoiceWithIndexTTS2(params: {
  endpoint: string
  referenceAudioUrl: string
  text: string
  emotionPrompt?: string | null
  strength?: number
  falApiKey?: string
}) {
  const strength = typeof params.strength === 'number' ? params.strength : 0.4

  _ulogInfo(`IndexTTS2: Generating with reference audio, strength: ${strength}`)
  if (params.emotionPrompt) {
    _ulogInfo(`IndexTTS2: Using emotion prompt: ${params.emotionPrompt}`)
  }

  if (params.falApiKey) {
    fal.config({ credentials: params.falApiKey })
  }

  const audioDataUrl = params.referenceAudioUrl.startsWith('data:')
    ? params.referenceAudioUrl
    : await normalizeToBase64ForGeneration(params.referenceAudioUrl)

  const input: {
    audio_url: string
    prompt: string
    should_use_prompt_for_emotion: boolean
    strength: number
    emotion_prompt?: string
  } = {
    audio_url: audioDataUrl,
    prompt: params.text,
    should_use_prompt_for_emotion: true,
    strength,
  }

  if (params.emotionPrompt?.trim()) {
    input.emotion_prompt = params.emotionPrompt.trim()
  }

  const result = await fal.subscribe(params.endpoint, {
    input,
    logs: false,
  })

  const audioUrl = (result as { data?: { audio?: { url?: string } } })?.data?.audio?.url
  if (!audioUrl) {
    throw new Error('No audio URL in response')
  }

  const audioData = await downloadAudioData(audioUrl)

  return {
    audioData,
    audioDuration: getWavDurationFromBuffer(audioData),
  }
}
*/

const DEFAULT_INDEX_TTS2_BASE_URL = 'http://127.0.0.1:7860'

type GradioFileData = {
  path: string
  meta: {
    _type: 'gradio.FileData'
  }
}

function getIndexTTS2BaseUrl() {
  return (process.env.INDEXTTS2_BASE_URL || DEFAULT_INDEX_TTS2_BASE_URL).replace(/\/$/, '')
}

async function uploadIndexTTS2ReferenceAudio(baseUrl: string, referenceAudioUrl: string): Promise<GradioFileData> {
  const audioData = await downloadAudioData(referenceAudioUrl)
  const formData = new FormData()
  const blob = new Blob([audioData], { type: 'audio/wav' })
  formData.append('files', blob, 'reference.wav')

  const response = await fetch(`${baseUrl}/gradio_api/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`INDEXTTS2_UPLOAD_FAILED: ${response.status}`)
  }

  const result = await response.json().catch(() => null) as string[] | null
  const uploadedPath = Array.isArray(result) ? result[0] : null
  if (!uploadedPath) {
    throw new Error('INDEXTTS2_UPLOAD_FAILED: missing uploaded path')
  }

  return {
    path: uploadedPath,
    meta: {
      _type: 'gradio.FileData',
    },
  }
}

async function submitIndexTTS2Generation(params: {
  baseUrl: string
  promptFile: GradioFileData
  text: string
  emotionPrompt?: string | null
  strength?: number
}) {
  const strength = typeof params.strength === 'number' ? params.strength : 0.4
  const payload = {
    data: [
      '与音色参考音频相同',
      params.promptFile,
      params.text,
      params.promptFile,
      strength,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      params.emotionPrompt?.trim() ?? '',
      false,
      120,
      true,
      0.8,
      30,
      0.8,
      0,
      3,
      10,
      1500,
    ],
  }

  const response = await fetch(`${params.baseUrl}/gradio_api/call/gen_single`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`INDEXTTS2_SUBMIT_FAILED: ${response.status}`)
  }

  const result = await response.json().catch(() => null) as { event_id?: string } | null
  const eventId = typeof result?.event_id === 'string' ? result.event_id : ''
  if (!eventId) {
    throw new Error('INDEXTTS2_SUBMIT_FAILED: missing event_id')
  }

  return eventId
}

async function readIndexTTS2GenerationResult(baseUrl: string, eventId: string) {
  const response = await fetch(`${baseUrl}/gradio_api/call/gen_single/${eventId}`)
  if (!response.ok) {
    throw new Error(`INDEXTTS2_RESULT_FAILED: ${response.status}`)
  }

  const text = await response.text()
  const lines = text.split(/\r?\n/)
  const completeIndex = lines.findIndex((line) => line.trim() === 'event: complete')
  const dataLine = completeIndex >= 0
    ? lines.slice(completeIndex + 1).find((line) => line.startsWith('data: '))
    : lines.find((line) => line.startsWith('data: '))

  if (!dataLine) {
    throw new Error('INDEXTTS2_RESULT_FAILED: missing complete payload')
  }

  const raw = dataLine.slice(6)
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('INDEXTTS2_RESULT_FAILED: invalid payload shape')
  }

  const output = parsed
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const directPath = typeof item.path === 'string' ? item.path : ''
      const directUrl = typeof item.url === 'string' ? item.url : ''
      if (directPath || directUrl) {
        return { path: directPath, url: directUrl }
      }

      const nestedValue = 'value' in item && item.value && typeof item.value === 'object' && !Array.isArray(item.value)
        ? item.value
        : null
      if (!nestedValue) return null

      const nestedPath = typeof nestedValue.path === 'string' ? nestedValue.path : ''
      const nestedUrl = typeof nestedValue.url === 'string' ? nestedValue.url : ''
      if (!nestedPath && !nestedUrl) return null

      return { path: nestedPath, url: nestedUrl }
    })
    .find((item) => !!item)

  if (!output) {
    throw new Error('INDEXTTS2_RESULT_FAILED: missing output file')
  }

  const outputPath = output.path
  const outputUrl = output.url
  if (!outputPath && !outputUrl) {
    throw new Error('INDEXTTS2_RESULT_FAILED: empty output file')
  }

  return {
    path: outputPath,
    url: outputUrl || `${baseUrl}/gradio_api/file=${outputPath}`,
  }
}

async function generateVoiceWithIndexTTS2(params: {
  referenceAudioUrl: string
  text: string
  emotionPrompt?: string | null
  strength?: number
}) {
  const strength = typeof params.strength === 'number' ? params.strength : 0.4
  const baseUrl = getIndexTTS2BaseUrl()

  _ulogInfo(`IndexTTS2: Generating with reference audio, strength: ${strength}`)
  _ulogInfo(`IndexTTS2: Using Gradio endpoint ${baseUrl}`)
  if (params.emotionPrompt) {
    _ulogInfo(`IndexTTS2: Using emotion prompt: ${params.emotionPrompt}`)
  }

  const promptFile = await uploadIndexTTS2ReferenceAudio(baseUrl, params.referenceAudioUrl)
  const eventId = await submitIndexTTS2Generation({
    baseUrl,
    promptFile,
    text: params.text,
    emotionPrompt: params.emotionPrompt,
    strength,
  })
  const output = await readIndexTTS2GenerationResult(baseUrl, eventId)
  const audioData = await downloadAudioData(output.url)

  return {
    audioData,
    audioDuration: getWavDurationFromBuffer(audioData),
  }
}

function matchCharacterBySpeaker(
  speaker: string,
  characters: CharacterVoiceProfile[],
) {
  const exactMatch = characters.find((character) => character.name === speaker)
  if (exactMatch) return exactMatch
  return characters.find((character) => character.name.includes(speaker) || speaker.includes(character.name))
}

async function resolveReferenceAudioUrl(referenceAudioUrl: string): Promise<string> {
  if (referenceAudioUrl.startsWith('http') || referenceAudioUrl.startsWith('data:')) {
    return referenceAudioUrl
  }
  if (referenceAudioUrl.startsWith('/m/')) {
    const storageKey = await resolveStorageKeyFromMediaValue(referenceAudioUrl)
    if (!storageKey) {
      throw new Error(`无法解析参考音频路径: ${referenceAudioUrl}`)
    }
    return getSignedUrl(storageKey, 3600)
  }
  if (referenceAudioUrl.startsWith('/api/files/')) {
    const storageKey = extractStorageKey(referenceAudioUrl)
    return storageKey ? getSignedUrl(storageKey, 3600) : referenceAudioUrl
  }
  return getSignedUrl(referenceAudioUrl, 3600)
}

async function downloadAudioData(audioUrl: string): Promise<Buffer> {
  const response = await fetch(toFetchableUrl(audioUrl))
  if (!response.ok) {
    throw new Error(`Audio download failed: ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

export async function generateVoiceLine(params: {
  projectId: string
  episodeId?: string | null
  lineId: string
  userId: string
  audioModel?: string
  checkCancelled?: CheckCancelled
}) {
  const checkCancelled = params.checkCancelled

  const line = await prisma.novelPromotionVoiceLine.findUnique({
    where: { id: params.lineId },
    select: {
      id: true,
      episodeId: true,
      speaker: true,
      content: true,
      emotionPrompt: true,
      emotionStrength: true,
    },
  })
  if (!line) {
    throw new Error('Voice line not found')
  }

  const episodeId = params.episodeId || line.episodeId
  if (!episodeId) {
    throw new Error('episodeId is required')
  }

  const [projectData, episode] = await Promise.all([
    prisma.novelPromotionProject.findUnique({
      where: { projectId: params.projectId },
      include: { characters: true },
    }),
    prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      select: { speakerVoices: true },
    }),
  ])

  if (!projectData) {
    throw new Error('Novel promotion project not found')
  }

  const speakerVoices: SpeakerVoiceMap = parseSpeakerVoiceMap(episode?.speakerVoices)

  const character = matchCharacterBySpeaker(line.speaker, projectData.characters || [])
  const speakerVoice = speakerVoices[line.speaker]

  const text = (line.content || '').trim()
  if (!text) {
    throw new Error('Voice line text is empty')
  }

  const audioSelection = await resolveModelSelectionOrSingle(params.userId, params.audioModel, 'audio')
  const providerKey = getProviderKey(audioSelection.provider).toLowerCase()
  const voiceBinding = resolveVoiceBindingForProvider({
    providerKey,
    character,
    speakerVoice,
  })
  let generated: { audioData: Buffer; audioDuration: number }
  if (providerKey === 'fal') {
    if (!voiceBinding || voiceBinding.provider !== 'fal') {
      throw new Error('请先为该发言人设置参考音频')
    }

    const fullAudioUrl = await resolveReferenceAudioUrl(voiceBinding.referenceAudioUrl)
    // 旧版 fal 调用保留供对照：
    // const falApiKey = await getAudioApiKey(params.userId, audioSelection.modelKey)
    // generated = await generateVoiceWithIndexTTS2({
    //   endpoint: audioSelection.modelId,
    //   referenceAudioUrl: fullAudioUrl,
    //   text,
    //   emotionPrompt: line.emotionPrompt,
    //   strength: line.emotionStrength ?? 0.4,
    //   falApiKey,
    // })
    generated = await generateVoiceWithIndexTTS2({
      referenceAudioUrl: fullAudioUrl,
      text,
      emotionPrompt: line.emotionPrompt,
      strength: line.emotionStrength ?? 0.4,
    })
  } else if (providerKey === 'bailian') {
    if (!voiceBinding || voiceBinding.provider !== 'bailian') {
      const hasUploadedReference =
        !!character?.customVoiceUrl ||
        (speakerVoice?.provider === 'fal' && !!speakerVoice.audioUrl)
      if (hasUploadedReference) {
        throw new Error('无音色ID，QwenTTS 必须使用 AI 设计音色')
      }
      throw new Error('请先为该发言人绑定百炼音色')
    }
    const { apiKey } = await getProviderConfig(params.userId, audioSelection.provider)
    const result = await synthesizeWithBailianTTS({
      text,
      voiceId: voiceBinding.voiceId,
      modelId: audioSelection.modelId,
      languageType: 'Chinese',
    }, apiKey)
    if (!result.success || !result.audioData) {
      throw new Error(normalizeBailianVoiceGenerationError(result.error))
    }

    const audioData = result.audioData
    generated = {
      audioData,
      audioDuration: result.audioDuration ?? getWavDurationFromBuffer(audioData),
    }
  } else {
    throw new Error(`AUDIO_PROVIDER_UNSUPPORTED: ${audioSelection.provider}`)
  }

  const audioKey = `voice/${params.projectId}/${episodeId}/${line.id}.wav`
  const cosKey = await uploadObject(generated.audioData, audioKey)

  await checkCancelled?.()

  await prisma.novelPromotionVoiceLine.update({
    where: { id: line.id },
    data: {
      audioUrl: cosKey,
      audioDuration: generated.audioDuration || null,
    },
  })

  const signedUrl = getSignedUrl(cosKey, 7200)
  return {
    lineId: line.id,
    audioUrl: signedUrl,
    storageKey: cosKey,
    audioDuration: generated.audioDuration || null,
  }
}

export function estimateVoiceLineMaxSeconds(content: string | null | undefined) {
  const chars = typeof content === 'string' ? content.length : 0
  return Math.max(5, Math.ceil(chars / 2))
}
