import 'server-only';
import sharp from 'sharp';
import { RequestInputError } from '@murphai/hosted-execution/request-input';
import { readRawBodyBuffer } from '../../http';

/** The upload boundary fully decodes a bounded JPEG before any storage effect. */
export async function readProgressJpeg(request: Request): Promise<Uint8Array> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'image/jpeg') {
    throw new RequestInputError('Content-Type must be image/jpeg.');
  }
  const bytes = await readRawBodyBuffer(request, { limitBytes: 2 * 1024 * 1024 });
  try {
    const image = sharp(bytes, { limitInputPixels: 2048 * 2048, failOn: 'warning' });
    const info = await image.metadata();
    if (info.format !== 'jpeg' || !info.width || !info.height || info.width > 2048 || info.height > 2048) {
      throw new RequestInputError('The picture must be a JPEG no larger than 2048 pixels.');
    }
    await image.raw().toBuffer();
  } catch {
    throw new RequestInputError('The picture must be a complete JPEG no larger than 2048 pixels.');
  }
  return bytes;
}
