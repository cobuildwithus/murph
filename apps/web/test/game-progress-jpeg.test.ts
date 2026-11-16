import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { RequestBodyTooLargeError } from '@murphai/hosted-execution/request-input';
vi.mock('server-only', () => ({}));
import { readProgressJpeg } from '../src/lib/game/progress/jpeg';

const upload = (bytes: Uint8Array, type: string) => new Request('https://example.test/api/game/v1/progress/pics', {
  method: 'POST', headers: { 'content-type': type }, body: new Uint8Array(bytes),
});
const image = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#F5F0E8' } });

describe('Progress JPEG request boundary', () => {
  it('accepts the camera JPEG without changing its bytes', async () => {
    const bytes = await image(2048, 1024).jpeg().toBuffer();
    expect(await readProgressJpeg(upload(bytes, 'image/jpeg'))).toEqual(bytes);
  });
  it.each([
    ['wrong content type', () => image(4, 4).jpeg().toBuffer(), 'image/png'],
    ['wrong format', () => image(4, 4).png().toBuffer(), 'image/jpeg'],
    ['too wide', () => image(2049, 1).jpeg().toBuffer(), 'image/jpeg'],
    ['too tall', () => image(1, 2049).jpeg().toBuffer(), 'image/jpeg'],
    ['empty', async () => Buffer.alloc(0), 'image/jpeg'],
    ['incomplete', async () => (await image(100, 100).jpeg().toBuffer()).subarray(0, 40), 'image/jpeg'],
  ] as const)('rejects %s', async (_name, bytes, type) => {
    await expect(readProgressJpeg(upload(await bytes(), type))).rejects.toMatchObject({ name: 'RequestInputError' });
  });
  it('bounds the byte stream before decoding', async () => {
    await expect(readProgressJpeg(upload(new Uint8Array(2 * 1024 * 1024 + 1), 'image/jpeg')))
      .rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });
});
