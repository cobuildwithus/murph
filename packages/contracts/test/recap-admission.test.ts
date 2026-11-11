import { expect, test } from 'vitest'
import { inspectRecapProviderRequest, recapReservationMicrodollars, reserveRecapOperation, type RecapAdmissionState, type RecapProviderRequest } from '../src/recap-admission.js'

const image: RecapProviderRequest = { kind: 'image', model: 'gpt-image-2.6-flare', requestHash: 'a'.repeat(64), promptBytes: 400,
  size: '1024x1024', quality: 'medium', outputFormat: 'jpeg', referenceHashes: [] }
const now = new Date('2026-11-11T00:00:00Z')
const initial = (): RecapAdmissionState => ({ v: 1, deadline: '2026-11-11T00:10:00Z', runs: ['run'], operations: [] })
const reserve = (state: RecapAdmissionState, id: string, reserved = 300_000, request = image) => reserveRecapOperation(state, { id, runId: 'run', request, reserved, now })

test('prospective reservations enforce total cost, count, concurrency, retries and deadline', () => {
  let state = reserve(initial(), 'one')
  expect(() => reserve(state, 'one')).toThrow('already attempted')
  state = reserve(state, 'two')
  expect(() => reserve(state, 'three')).toThrow('in progress')
  state.operations.forEach(operation => { operation.active = false })
  state = reserve(state, 'three'); state.operations[2]!.active = false
  expect(() => reserve(state, 'four', 350_001)).toThrow('budget')
  state = reserve(state, 'four', 350_000)
  expect(() => reserve(state, 'five', 0)).toThrow('attempt limit')
  expect(() => reserveRecapOperation(initial(), { id: 'late', runId: 'run', request: image, reserved: 1, now: new Date('2026-11-11T00:09:30Z') })).toThrow('deadline')
  const song: RecapProviderRequest = { kind: 'song', model: 'music_v2', durationMs: 20_000, promptBytes: 200, requestHash: 'b'.repeat(64) }
  expect(() => reserve(reserve(initial(), 'song', 50_000, song), 'again', 50_000, song)).toThrow('attempt limit')
})

test('photo edits require a verified ceiling; text-only reservations include prompt and explicit output', () => {
  expect(recapReservationMicrodollars(image, null)).toBeGreaterThan(40_000)
  expect(recapReservationMicrodollars({ ...image, referenceHashes: ['b'.repeat(64)] }, null)).toBeNull()
  expect(recapReservationMicrodollars({ ...image, referenceHashes: ['b'.repeat(64)] }, 20_000)).toBeGreaterThan(200_000)
})

test('request admission hashes final prompts, settings and ordered reference bytes, and rejects extra billable options', async () => {
  const body = { model: image.model, prompt: 'A synthetic paper stage.', size: image.size, quality: image.quality, output_format: 'jpeg' }
  const request = (value: unknown) => new Request('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  const first = await inspectRecapProviderRequest(request(body))
  expect(first).toMatchObject({ kind: 'image', referenceHashes: [] })
  expect((await inspectRecapProviderRequest(request({ ...body, prompt: 'Changed' }))).requestHash).not.toBe(first.requestHash)
  await expect(inspectRecapProviderRequest(request({ ...body, n: 4 }))).rejects.toThrow('settings')
  await expect(inspectRecapProviderRequest(request({ ...body, quality: 'high' }))).rejects.toThrow()
  const form = new FormData()
  Object.entries(body).forEach(([key, value]) => form.append(key, value))
  form.append('image[]', new Blob(['synthetic reference'], { type: 'image/jpeg' }), 'photo.jpg')
  expect(await inspectRecapProviderRequest(new Request('https://api.openai.com/v1/images/edits', { method: 'POST', body: form }))).toMatchObject({ kind: 'image', referenceHashes: [expect.stringMatching(/^[a-f0-9]{64}$/u)] })
})
