import { expect, it } from 'vitest';
import { isAllowedElevenLabsRequest, parseHostedElevenLabsRequestBody } from '../src/runner-egress-elevenlabs';

const request = { model_id: 'music_v2', with_timestamps: true, composition_plan: { chunks: [{
  text: 'Leo goes\nAva stays', duration_ms: 20_000, positive_styles: ['Playful piano'], negative_styles: [],
}] } };
const parse = (value: unknown, pathnameSuffix = '/v1/music/detailed') => parseHostedElevenLabsRequestBody({
  body: new TextEncoder().encode(JSON.stringify(value)).buffer, contentType: 'application/json', pathnameSuffix,
});

it('admits only the bounded detailed song endpoint and derives usage duration from its one chunk', () => {
  const url = new URL('https://api.elevenlabs.io/v1/music/detailed?output_format=mp3_48000_192');
  expect(isAllowedElevenLabsRequest(new Request(url, { method: 'POST' }), url, url.pathname)).toBe(true);
  expect(parse(request)).toEqual({ kind: 'music', modelId: 'music_v2', durationMs: 20_000, upstreamBody: JSON.stringify(request) });
  for (const suffix of ['/v1/music/detailed/stream', '/v1/music/detailed/']) expect(isAllowedElevenLabsRequest(new Request(url, { method: 'POST' }), url, suffix)).toBe(false);
  url.searchParams.set('output_format', 'mp3_44100_128');
  expect(isAllowedElevenLabsRequest(new Request(url, { method: 'POST' }), url, url.pathname)).toBe(false);
  expect(parse({ prompt: 'Playful piano', music_length_ms: 20_000, force_instrumental: false, model_id: 'music_v2' }, '/v1/music')).toMatchObject({ durationMs: 20_000 });
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
