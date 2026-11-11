import { expect, test } from 'vitest'
import { inspectRecapProviderRequest, recapReservationMicrodollars, reserveRecapOperation, RECAP_DEADLINE_MS, RECAP_FINALIZATION_MS, RECAP_IMAGE_INPUT_TOKEN_CEILING, RECAP_MEDIA_CAP_MICRODOLLARS, type RecapAdmissionState, type RecapProviderRequest } from '../src/recap-admission.js'

const image: RecapProviderRequest = { kind: 'image', model: 'gpt-image-2.6-flare', requestHash: 'a'.repeat(64), promptBytes: 400,
  size: '1024x1024', quality: 'medium', outputFormat: 'jpeg', referenceHashes: [] }
const now = new Date('2026-11-11T00:00:00Z')
const initial = (): RecapAdmissionState => ({ v: 1, deadline: new Date(now.getTime() + RECAP_DEADLINE_MS).toISOString(), runs: ['run'], operations: [] })
const reserve = (state: RecapAdmissionState, id: string, reserved = 500_000, request: RecapProviderRequest = image) => reserveRecapOperation(state, { id, runId: 'run', request, reserved, now })

test('prospective reservations enforce total cost, count, concurrency, retries and deadline', () => {
  let state = reserve(initial(), 'one')
  expect(() => reserve(state, 'one')).toThrow('already attempted')
  state = reserve(state, 'two')
  expect(() => reserve(state, 'three')).toThrow('in progress')
  state.operations.forEach(operation => { operation.active = false })
  for (const id of ['three', 'four', 'five']) { state = reserve(state, id); state.operations.at(-1)!.active = false }
  expect(() => reserve(state, 'six', 500_001)).toThrow('budget')
  state = reserve(state, 'six', 500_000)
  expect(() => reserve(state, 'seven', 0)).toThrow('attempt limit')
  expect(() => reserveRecapOperation(initial(), { id: 'late', runId: 'run', request: image, reserved: 1,
    now: new Date(now.getTime() + RECAP_DEADLINE_MS - RECAP_FINALIZATION_MS) })).toThrow('deadline')
  const song: RecapProviderRequest = { kind: 'song', model: 'music_v2', durationMs: 20_000, promptBytes: 200, requestHash: 'b'.repeat(64) }
  expect(() => reserve(reserve(initial(), 'song', 50_000, song), 'again', 50_000, song)).toThrow('attempt limit')
})

test('bounded photo edits work without an env override and high portrait output fits the prospective cap', () => {
  expect(recapReservationMicrodollars(image, null)).toBeGreaterThan(40_000)
  expect(RECAP_IMAGE_INPUT_TOKEN_CEILING).toBe(36_847)
  const portrait = { ...image, size: '1024x1536' as const, quality: 'high' as const, referenceHashes: ['b'.repeat(64)] }
  expect(recapReservationMicrodollars(portrait)).toBe(335_936)
  expect(recapReservationMicrodollars(portrait, null)).toBe(335_936)
  expect(recapReservationMicrodollars(portrait, 40_000)).toBe(361_160)
  expect(recapReservationMicrodollars(portrait, 1)).toBeNull()
  expect(recapReservationMicrodollars(portrait)! * 6 + 50_000).toBeLessThan(RECAP_MEDIA_CAP_MICRODOLLARS)
  expect(recapReservationMicrodollars({ ...portrait, referenceHashes: [] })).toBe(43_160)
  expect(recapReservationMicrodollars({ ...image, referenceHashes: ['b'.repeat(64)] }, 20_000)).toBeGreaterThan(200_000)
})

test('request admission hashes final prompts, settings and ordered reference bytes, and rejects extra billable options', async () => {
  const body = { model: image.model, prompt: 'A synthetic paper stage.', size: image.size, quality: image.quality, output_format: 'jpeg' }
  const request = (value: unknown) => new Request('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  const first = await inspectRecapProviderRequest(request(body))
  expect(first).toMatchObject({ kind: 'image', referenceHashes: [] })
  expect((await inspectRecapProviderRequest(request({ ...body, prompt: 'Changed' }))).requestHash).not.toBe(first.requestHash)
  await expect(inspectRecapProviderRequest(request({ ...body, n: 4 }))).rejects.toThrow('settings')
  await expect(inspectRecapProviderRequest(request({ ...body, quality: 'high' }))).resolves.toMatchObject({ quality: 'high' })
  await expect(inspectRecapProviderRequest(request({ ...body, quality: 'max' }))).rejects.toThrow()
  const form = new FormData()
  Object.entries(body).forEach(([key, value]) => form.append(key, value))
  form.append('image[]', new Blob(['synthetic reference'], { type: 'image/jpeg' }), 'photo.jpg')
  expect(await inspectRecapProviderRequest(new Request('https://api.openai.com/v1/images/edits', { method: 'POST', body: form }))).toMatchObject({ kind: 'image', referenceHashes: [expect.stringMatching(/^[a-f0-9]{64}$/u)] })
})


test('classifies DOM aborts and bounded causes without copying arbitrary names, messages or getters', async () => {
  const { readMediaTransportError, mediaElapsedBucket } = await import('../src/recap-admission.js');
  expect(readMediaTransportError(new DOMException('Private synthetic reason', 'AbortError'))).toMatchObject({ mediaTransportName: 'AbortError' });
  expect(readMediaTransportError(new TypeError('private', { cause: Object.assign(new Error('private'), { code: 'ECONNRESET' }) }))).toMatchObject({ mediaTransportCode: 'ECONNRESET' });
  expect(readMediaTransportError({ name: 'private name', code: 'private code', message: 'private message' })).toEqual({ mediaTransportName: 'unknown', mediaTransportCode: 'unknown' });
  expect(readMediaTransportError({ get name() { throw new Error('Must not run'); } })).toEqual({ mediaTransportName: 'unknown', mediaTransportCode: 'unknown' });
  expect([500, 1500, 40_000, 100_000, 300_000].map(mediaElapsedBucket)).toEqual(['lt_1s', '1_30s', '30_90s', '90_300s', 'ge_300s']);
});
