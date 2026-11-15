import { expect, it } from 'vitest';
import { isAllowedElevenLabsRequest, parseHostedElevenLabsRequestBody } from '../src/runner-egress-elevenlabs';

const request = { model_id: 'music_v2_5', with_timestamps: true, composition_plan: { chunks: [{
  text: 'Leo goes\nAva stays', duration_ms: 20_000, positive_styles: ['Playful piano'], negative_styles: [],
}] } };
const parse = (value: unknown, pathnameSuffix = '/v1/music/detailed') => parseHostedElevenLabsRequestBody({
  body: new TextEncoder().encode(JSON.stringify(value)).buffer, contentType: 'application/json', pathnameSuffix,
});

const instrumental = { text: '[Intro]', duration_ms: 5000, positive_styles: ['Piano', '96 BPM', '4/4', 'instrumental'], negative_styles: ['vocals', 'lyrics', 'singing', 'spoken word'], context_adherence: 'high' };
const sung = { text: '[Chorus]\nHello friend', duration_ms: 20_000, positive_styles: ['Piano', 'Warm voice'], negative_styles: ['instrumental intro'], context_adherence: 'high' };
it.each([1, 4, 9])('accepts %s instrumental chunks plus the sung chunk and records their total duration', count => {
  const body = { ...request, composition_plan: { chunks: [...Array.from({ length: count }, () => instrumental), sung] } };
  const result = parse(body);
  expect(result).toMatchObject({ kind: "music", durationMs: count * 5000 + 20_000 });
  expect(JSON.parse(result!.upstreamBody)).toEqual(body);
});
it('refuses malformed scores without loosening the legacy shape', () => {
  const withChunks = (chunks: unknown[]) => ({ ...request, composition_plan: { chunks } });
  for (const chunks of [[], Array(11).fill(instrumental), [sung, instrumental], [instrumental, instrumental],
    [{ ...instrumental, duration_ms: 5001 }, sung], [{ ...instrumental, context_adherence: 'low' }, sung],
    [{ ...instrumental, extra: true }, sung], [{ ...instrumental, positive_styles: Array(13).fill('a') }, sung],
    [instrumental, { ...sung, text: 'x'.repeat(201) }], [instrumental, { ...sung, negative_styles: [''] }],
  ]) expect(parse(withChunks(chunks))).toBeNull();
});

it('admits only the bounded detailed song endpoint and derives usage duration from its one chunk', () => {
  const url = new URL('https://api.elevenlabs.io/v1/music/detailed?output_format=mp3_48000_192');
  expect(isAllowedElevenLabsRequest(new Request(url, { method: 'POST' }), url, url.pathname)).toBe(true);
  expect(parse(request)).toEqual({ kind: 'music', modelId: 'music_v2_5', durationMs: 20_000, upstreamBody: JSON.stringify(request) });
  for (const suffix of ['/v1/music/detailed/stream', '/v1/music/detailed/']) expect(isAllowedElevenLabsRequest(new Request(url, { method: 'POST' }), url, suffix)).toBe(false);
  url.searchParams.set('output_format', 'mp3_44100_128');
  expect(isAllowedElevenLabsRequest(new Request(url, { method: 'POST' }), url, url.pathname)).toBe(false);
  expect(parse({ prompt: 'Playful piano', music_length_ms: 20_000, force_instrumental: false, model_id: 'music_v2' }, '/v1/music')).toMatchObject({ durationMs: 20_000 });
});

it.each(['music_v2', 'music_v2_5'])('preserves %s upstream on both music request shapes', modelId => {
  for (const [pathname, body] of [
    ['/v1/music', { force_instrumental: false, model_id: modelId, music_length_ms: 20_000, prompt: 'Playful piano' }],
    ['/v1/music/detailed', { ...request, model_id: modelId }],
  ] as const) {
    const result = parse(body, pathname);
    expect(result).toMatchObject({ kind: 'music', modelId, durationMs: 20_000 });
    expect(JSON.parse(result!.upstreamBody)).toEqual(body);
    for (const unsupported of ['music_v1', 'unknown-model']) {
      expect(parse({ ...body, model_id: unsupported }, pathname)).toBeNull();
    }
  }
});

it('rejects unbounded plans, extra generation features and mismatched model formats', () => {
  const chunk = request.composition_plan.chunks[0]!;
  const withChunk = (value: unknown) => ({ ...request, composition_plan: { chunks: [value] } });
  for (const value of [
    { ...request, model_id: 'music_v1' }, { ...request, with_timestamps: false }, { ...request, prompt: 'extra' },
    { ...request, composition_plan: { sections: [] } }, { ...request, composition_plan: { chunks: [chunk, chunk] } },
    withChunk({ ...chunk, duration_ms: 120_001 }), withChunk({ ...chunk, duration_ms: 2999 }),
    withChunk({ ...chunk, duration_ms: 20_000.5 }), withChunk({ ...chunk, text: 'x'.repeat(201) }),
    withChunk({ ...chunk, text: Array(21).fill('Leo').join('\n') }), withChunk({ ...chunk, text: 'Leo\n\nAva' }),
    withChunk({ ...chunk, positive_styles: ['x'.repeat(4101)] }), withChunk({ ...chunk, conditioning_ref: {} }),
  ]) expect(parse(value)).toBeNull();
});
