import 'server-only';
import { createHash } from 'node:crypto';
import OpenAI, { toFile } from 'openai';
import sharp from 'sharp';
import { coastAgreement } from './coast-check';
import { satelliteImage } from './mapbox';
import { ArtError } from './place-art';
import { cutPolyline, decodePolyline, expandBbox, MAP_SIZES, routeBbox, townPosition, type Coordinate } from './route-geometry';
import type { MapQuery } from './contract';
import type { RouteLeg } from './state';

const MODEL = 'gpt-image-2.6-flare';
const MIN_COAST_AGREEMENT = 0.85;
// Below this, a typed leg's frame is a neighborhood, not scenery.
const PUBLIC_MAP_MIN_M = 50_000;

export const posterKey = (placeId: string) => `poster:v1:${placeId}`;
export const mapKey = (polyline: string, size: MapQuery['size']) =>
  `map:v1:${size}:${createHash('sha256').update(polyline).digest('base64url')}`;

/** A painting is shared art only at regional scale (every bank route is longer). */
export function mapPaintable(leg: Pick<RouteLeg, 'distanceM' | 'straightLine'>): boolean {
  return !leg.straightLine && leg.distanceM >= PUBLIC_MAP_MIN_M;
}

const POSTER_STYLE = 'Flat screen print colours with soft paper grain, bold simple shapes, a limited palette of five colours: deep navy, teal, coral sunset, golden yellow and cream. Leave the top 28 percent of the frame as plain flat coral sky colour and the bottom 30 percent as plain flat dark navy colour for large type. No text, letters, numbers, logos, people, border or watermark.';
const MAP_PROMPT = [
  'Repaint this satellite image as a hand-painted map of exactly the same place, seen straight down from above. Keep every coastline, island, bay, mountain ridge and valley exactly where it is in the photo, at the same scale and position, so the painting lines up with the photo.',
  'Style: a bright, cheerful hand-painted animated film background in gouache and watercolour, clean simplified shapes. Vivid greens and warm golds on the hills, deep green in the canyons, gentle violet shadows on the ridges, light from the upper left. A rich blue sea that turns clear turquoise in the shallows, with a thin white surf line.',
  'A few small soft white clouds scattered over the hills across the whole picture, each with a soft shadow on the land below.',
  'Keep the coastline itself and the land right next to it clear of clouds. No roads, no towns or buildings drawn, no text, labels, numbers, compass, legend, border or frame, no route line, no watermark.',
].join(' ');

function client(signal: AbortSignal) {
  signal.throwIfAborted();
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, adminAPIKey: null, baseURL: 'https://api.openai.com/v1',
    organization: null, project: null, webhookSecret: null, maxRetries: 0, logLevel: 'off' });
}

function decoded(result: OpenAI.ImagesResponse): Buffer {
  const encoded = result.data?.length === 1 ? result.data[0]!.b64_json : null;
  if (!encoded || encoded.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new ArtError('generation_failed');
  return Buffer.from(encoded, 'base64');
}

async function providerCall<T>(call: () => Promise<T>): Promise<T> {
  try { return await call(); }
  catch (error) {
    if (error instanceof OpenAI.APIError && ['moderation_blocked', 'content_policy_violation'].includes(error.code ?? '')) throw new ArtError('refused');
    throw error;
  }
}

/** A travel poster of a public place, from its place name only. */
export async function makePoster(label: string, signal: AbortSignal): Promise<Buffer> {
  const prompt = `A mid century travel poster illustration of ${label}, showing the real scenery and best-known landmark of this place as they actually look. ${POSTER_STYLE}`;
  const result = await providerCall(() => client(signal).images.generate({ model: MODEL, prompt, n: 1, size: '1024x1536', quality: 'medium',
    output_format: 'jpeg', output_compression: 90 }, { signal, maxRetries: 0 }));
  return sharp(decoded(result), { limitInputPixels: 40_000_000 }).jpeg({ quality: 85 }).toBuffer();
}

/**
 * The route's frame painted in the chosen look (E1). The satellite photo is
 * taken of the frame grown to the edit canvas, painted, cut back to the frame,
 * and kept only if its coast still lines up with the photo.
 */
export async function makePaintedMap(polyline: string, size: MapQuery['size'], signal: AbortSignal): Promise<Buffer> {
  const { width, height } = MAP_SIZES[size];
  const canvas = size === 'card' ? { width: 1536, height: 1024, edit: '1536x1024' as const } : { width: 1024, height: 1024, edit: '1024x1024' as const };
  const bbox = routeBbox(decodePolyline(polyline), width, height);
  const photo = await satelliteImage(expandBbox(bbox, canvas.width / canvas.height), canvas.width, canvas.height, signal);
  const image = await toFile(photo, 'map.png', { type: 'image/png' });
  const result = await providerCall(() => client(signal).images.edit({ model: MODEL, image,
    prompt: MAP_PROMPT, n: 1, size: canvas.edit, quality: 'high', output_format: 'png' }, { signal, maxRetries: 0 }));
  const frame = Math.round(canvas.width * height / width);
  const crop = { left: 0, top: Math.round((canvas.height - frame) / 2), width: canvas.width, height: frame };
  // One resize per sharp pipeline: to the canvas and cut, then down to the map size.
  const cut = async (bytes: Buffer) => sharp(await sharp(bytes, { limitInputPixels: 40_000_000 })
    .resize(canvas.width, canvas.height, { fit: 'fill' }).extract(crop).png().toBuffer()).resize(width, height, { fit: 'fill' }).png().toBuffer();
  const [paintedFrame, photoFrame] = await Promise.all([cut(decoded(result)), cut(photo)]);
  if (await coastAgreement(photoFrame, paintedFrame, width / height) < MIN_COAST_AGREEMENT) throw new ArtError('drifted');
  return sharp(paintedFrame).jpeg({ quality: 88 }).toBuffer();
}

/** Today's line, walked and still to go, at the same projection the town labels use. */
export async function drawRouteOnPainting(painting: Buffer, polyline: string, progress: number, size: MapQuery['size']): Promise<Buffer> {
  const { width, height } = MAP_SIZES[size];
  const points = decodePolyline(polyline), bbox = routeBbox(points, width, height);
  const cut = cutPolyline(points, progress);
  const path = (line: Coordinate[]) => line.map((point, i) => {
    const { x, y } = townPosition(point, bbox);
    return `${i ? 'L' : 'M'}${(x * width).toFixed(1)} ${(y * height).toFixed(1)}`;
  }).join(' ');
  const stroke = (line: Coordinate[], color: string, lineWidth: number) => line.length > 1
    ? `<path d="${path(line)}" fill="none" stroke="${color}" stroke-width="${lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + stroke(cut.remaining, '#FFFFFF', 9) + stroke(cut.walked, '#FFFFFF', 9)
    + stroke(cut.remaining, '#CDBEA7', 6) + stroke(cut.walked, '#5A6E32', 6) + '</svg>';
  return sharp(painting).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 88 }).toBuffer();
}
