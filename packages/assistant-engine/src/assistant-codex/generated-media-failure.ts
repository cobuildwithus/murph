import { types } from 'node:util'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { toolFailureDiagnostic, type ToolFailureDiagnostic } from './tool-failure-diagnostics.js'

const validationRules = ['image_byte_limit', 'image_format', 'image_dimensions', 'image_decode',
  'audio_byte_limit', 'audio_duration', 'audio_decode', 'invalid_response', 'credentials', 'reservation', 'receipt'] as const
export type MediaValidationRule = typeof validationRules[number]
export interface MediaFailureDetails {
  mediaFailureReason: MediaValidationRule | 'provider_http' | 'provider_timeout' | 'provider_transport' | 'unknown'
  mediaHttpStatusClass?: '4xx' | '5xx' | 'other'
  mediaTypeClass?: 'jpeg' | 'png' | 'webp' | 'mp3' | 'unknown'
  mediaSizeClass?: 'empty' | 'le_1mib' | 'le_2mib' | 'le_10mib' | 'gt_10mib'
}

export function mediaValidationError(rule: MediaValidationRule, bytes?: Uint8Array): VaultCliError {
  return new VaultCliError('RECAP_MEDIA_VALIDATION_FAILED', `Recap media validation failed: ${rule}.`, {
    mediaFailureReason: rule,
    ...(bytes ? { mediaTypeClass: classifyMediaType(bytes), mediaSizeClass: classifyMediaSize(bytes.length) } : {}),
  })
}

/** Closed source-owned fields only: never copy messages, IDs, bodies or causes. */
export function generatedMediaFailureDiagnostic(error: unknown): ToolFailureDiagnostic & MediaFailureDetails {
  const base = toolFailureDiagnostic('handler_exception')
  const context = !types.isProxy(error) && error instanceof VaultCliError ? readOwn(error, 'context') : undefined
  const code = readOwn(error, 'code')
  const rule = readOwn(context, 'mediaFailureReason')
  if (code === 'RECAP_MEDIA_VALIDATION_FAILED' && validationRules.some(known => known === rule)) {
    const details: MediaFailureDetails = { mediaFailureReason: rule as MediaValidationRule }
    const mediaType = readEnum(readOwn(context, 'mediaTypeClass'), ['jpeg', 'png', 'webp', 'mp3', 'unknown'] as const)
    if (mediaType) details.mediaTypeClass = mediaType
    const size = readEnum(readOwn(context, 'mediaSizeClass'), ['empty', 'le_1mib', 'le_2mib', 'le_10mib', 'gt_10mib'] as const)
    if (size) details.mediaSizeClass = size
    return { ...base, failureStage: 'validation', ...details }
  }
  const status = readOwn(context, 'status')
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) return {
    ...base, mediaFailureReason: 'provider_http', mediaHttpStatusClass: status >= 500 ? '5xx' : status >= 400 ? '4xx' : 'other',
  }
  if (readOwn(context, 'timedOut') === true) return { ...base, mediaFailureReason: 'provider_timeout' }
  if (readOwn(context, 'failureStage') === 'transport') return { ...base, mediaFailureReason: 'provider_transport' }
  if (code === 'ELEVENLABS_INVALID_AUDIO') return { ...base, failureStage: 'validation', mediaFailureReason: 'audio_decode' }
  if (code === 'ASSISTANT_IMAGE_GENERATION_INVALID_RESPONSE') return { ...base, failureStage: 'validation', mediaFailureReason: 'invalid_response' }
  return { ...base, mediaFailureReason: 'unknown' }
}

export function generatedMediaFailureResult(error: unknown) {
  const failureDiagnostic = generatedMediaFailureDiagnostic(error)
  return { rpcSuccess: false, failureDiagnostic,
    rpcText: `Media failed (${failureDiagnostic.mediaFailureReason}). Do not retry this failure class. Omit its receipt and finish a readable photo/text show. Before write_recap, omit an unavailable song. After submission starts, retry only the identical frozen draft without regenerating media.` }
}

function readOwn(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}
function classifyMediaSize(size: number): NonNullable<MediaFailureDetails['mediaSizeClass']> {
  return size === 0 ? 'empty' : size <= 1024 * 1024 ? 'le_1mib' : size <= 2 * 1024 * 1024 ? 'le_2mib' : size <= 10 * 1024 * 1024 ? 'le_10mib' : 'gt_10mib'
}
function classifyMediaType(bytes: Uint8Array): NonNullable<MediaFailureDetails['mediaTypeClass']> {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png'
  if (Buffer.from(bytes.subarray(8, 12)).toString() === 'WEBP') return 'webp'
  if (Buffer.from(bytes.subarray(0, 3)).toString() === 'ID3' || bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return 'mp3'
  return 'unknown'
}

function readEnum<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return values.find(known => known === value)
}
