import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
const mocks = vi.hoisted(() => ({ edit: vi.fn(), constructor: vi.fn(), file: vi.fn() }));
vi.mock('openai', async importOriginal => {
  const actual = await importOriginal<typeof import('openai')>();
  return { ...actual, toFile: mocks.file, default: class {
    static APIError = actual.default.APIError;
    images = { edit: mocks.edit };
    constructor(options: object) { mocks.constructor(options); }
  } };
});
import { makeShareImage, prepareShareJpeg, SHARE_DEADLINE_MS } from '../src/lib/game/progress/share-image';
import OpenAI from 'openai';
let synthetic: Buffer;
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv('OPENAI_API_KEY', undefined);
  synthetic = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#b8c4d0' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  mocks.file.mockResolvedValue('synthetic-file');
  mocks.edit.mockResolvedValue({ data: [{ b64_json: synthetic.toString('base64') }] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe('one private OpenAI edit boundary', () => {
  it('fixes one model, reference, output and operation-owned deadline with retries and logging off', async () => {
    const reference = new Uint8Array(synthetic), expires = Date.now() + SHARE_DEADLINE_MS;
    const output = await makeShareImage(reference, 'synthetic prompt', expires);
    expect(mocks.constructor).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, logLevel: 'off', baseURL: 'https://api.openai.com/v1', timeout: expect.any(Number) }));
    expect(mocks.file).toHaveBeenCalledExactlyOnceWith(reference, 'reference.jpg', { type: 'image/jpeg' });
    expect(mocks.edit).toHaveBeenCalledExactlyOnceWith({ model: 'gpt-image-2.6-flare', image: 'synthetic-file', prompt: 'synthetic prompt',
      n: 1, quality: 'medium', size: '1024x1536', output_format: 'jpeg', output_compression: 90 }, expect.objectContaining({ signal: expect.any(AbortSignal), maxRetries: 0 }));
    const options = mocks.edit.mock.calls[0][1]; expect(options.timeout).toBeGreaterThan(0); expect(options.timeout).toBeLessThanOrEqual(240000);
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 20, height: 40 });
    expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined(); expect(metadata.orientation).toBeUndefined();
  });
  it.each([{}, { data: [] }, { data: [{ url: 'https://example.test/private-provider' }] }, { data: [{ b64_json: 'bad bytes' }] },
    { data: [{ b64_json: 'aGVsbG8=' }, { b64_json: 'aGVsbG8=' }] }])('rejects malformed external output once', async result => {
    mocks.edit.mockResolvedValue(result);
    await expect(makeShareImage(synthetic, 'synthetic', Date.now() + 1000)).rejects.toMatchObject({ code: 'generation_failed' });
    expect(mocks.edit).toHaveBeenCalledTimes(1);
  });
  it.each([['moderation_blocked', 'refused'], ['content_policy_violation', 'refused'], ['rate_limit_exceeded', 'generation_failed']])('sanitizes provider %s without recording payloads', async (code, expected) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.edit.mockRejectedValue(new OpenAI.APIError(400, { code, message: 'PRIVATE_PROVIDER_SENTINEL' }, 'PRIVATE_PROVIDER_SENTINEL', new Headers()));
    const error = await makeShareImage(synthetic, 'synthetic', Date.now() + 1000).catch(value => value);
    expect(error).toMatchObject({ code: expected, message: 'Progress picture could not be made.' });
    expect(JSON.stringify(error)).not.toContain('PRIVATE_PROVIDER_SENTINEL'); expect(error.cause).toBeUndefined();
    expect(mocks.edit).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
  it('never calls an expired operation and rejects late completion', async () => {
    await expect(makeShareImage(synthetic, 'synthetic', Date.now() - 1)).rejects.toMatchObject({ code: 'timeout' });
    expect(mocks.edit).not.toHaveBeenCalled();
    vi.useFakeTimers({ toFake: ['Date'] });
    const expiry = Date.now() + 1000;
    mocks.edit.mockImplementation(async () => { vi.setSystemTime(expiry); return { data: [{ b64_json: synthetic.toString('base64') }] }; });
    await expect(makeShareImage(synthetic, 'synthetic', expiry)).rejects.toMatchObject({ code: 'timeout' });
  });
  it('fails a fixed oversized encode without another quality pass', async () => {
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1, 1);
    const buffer = vi.spyOn(sharp.prototype, 'toBuffer').mockResolvedValueOnce(oversized);
    await expect(prepareShareJpeg(synthetic)).rejects.toMatchObject({ code: 'generation_failed' });
    expect(buffer).toHaveBeenCalledTimes(1); expect(oversized.every(byte => byte === 0)).toBe(true); buffer.mockRestore();
  });
});
