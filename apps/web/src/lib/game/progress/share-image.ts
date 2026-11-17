import 'server-only';
import OpenAI, { toFile } from 'openai';
import sharp from 'sharp';

export const SHARE_DEADLINE_MS = 240_000;
export type ShareFailureCode = 'generation_failed' | 'timeout' | 'refused';
export class ShareImageError extends Error {
  constructor(readonly code: ShareFailureCode) { super('Progress picture could not be made.'); }
}

/** Orient once and strip metadata; a fixed encode never retries quality. */
export async function prepareShareJpeg(bytes: Uint8Array): Promise<Buffer> {
  const result = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().jpeg({ quality: 90 }).toBuffer();
  if (result.length > 2 * 1024 * 1024) { result.fill(0); throw new ShareImageError('generation_failed'); }
  return result;
}

/** One multipart edit. There is no provider URL, durable Files upload or client cancellation signal. */
export async function makeShareImage(reference: Uint8Array, prompt: string, expiresAt: number): Promise<Buffer> {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) throw new ShareImageError('timeout');
  const signal = AbortSignal.timeout(remaining);
  let decoded: Buffer | undefined;
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, adminAPIKey: null, baseURL: 'https://api.openai.com/v1',
      organization: null, project: null, webhookSecret: null, maxRetries: 0, logLevel: 'off', timeout: remaining });
    const result = await client.images.edit({ model: 'gpt-image-2.6-flare', image: await toFile(reference, 'reference.jpg', { type: 'image/jpeg' }),
      prompt, n: 1, quality: 'medium', size: '1024x1536', output_format: 'jpeg', output_compression: 90 },
    { signal, timeout: remaining, maxRetries: 0 });
    const encoded = result.data?.length === 1 ? result.data[0].b64_json : null;
    if (!encoded || encoded.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new ShareImageError('generation_failed');
    decoded = Buffer.from(encoded, 'base64');
    result.data = [];
    const output = await prepareShareJpeg(decoded);
    if (Date.now() >= expiresAt) { output.fill(0); throw new ShareImageError('timeout'); }
    return output;
  } catch (error) {
    if (signal.aborted || Date.now() >= expiresAt) throw new ShareImageError('timeout');
    if (error instanceof OpenAI.APIError && ['moderation_blocked', 'content_policy_violation'].includes(error.code ?? '')) throw new ShareImageError('refused');
    throw new ShareImageError('generation_failed');
  } finally { decoded?.fill(0); }
}
