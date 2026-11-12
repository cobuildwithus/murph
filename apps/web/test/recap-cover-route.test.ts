import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "@/app/recap/[gameId]/cover/[token]/route";
import { generateMetadata } from "@/app/recap/[gameId]/page";

const mocks = vi.hoisted(() => ({ readCover: vi.fn() }));
vi.mock("@/src/lib/game/recap-preview", () => ({ readRecapCoverPreview: mocks.readCover }));
afterEach(() => vi.clearAllMocks());
const gameId = "synthetic-game", token = "a".repeat(43);
const request = new Request(`https://web.example.test/recap/${gameId}/cover/${token}`);
const context = { params: Promise.resolve({ gameId, token }) };

it("serves a portrait cover as a no-store 1200x630 JPEG with matching social metadata", async () => {
  const portrait = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#62826c" } }).jpeg().toBuffer();
  mocks.readCover.mockResolvedValue({ bytes: portrait });
  const response = await GET(request, context);
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(response.status).toBe(200);
  expect(await sharp(bytes).metadata()).toMatchObject({ format: "jpeg", width: 1200, height: 630 });
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(response.headers.get("content-length")).toBe(String(bytes.length));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(mocks.readCover).toHaveBeenCalledWith(gameId, token);
  const metadata = await generateMetadata({ params: Promise.resolve({ gameId }), searchParams: Promise.resolve({ preview: token }) });
  const image = { url: `/recap/${gameId}/cover/${token}`, alt: "Murph recap", type: "image/jpeg", width: 1200, height: 630 };
  expect(metadata.openGraph?.images).toEqual([image]);
  expect(metadata.twitter?.images).toEqual([image]);
});

it("crops a portrait cover's preview from its upper part, where the faces are, never the feet", async () => {
  // A plain top with a busy bottom: the attention crop alone picks the bottom.
  const width = 1024, height = 1536, busyFrom = Math.round(height * 0.7);
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3, busy = y >= busyFrom && (x + y) % 2 === 0;
    pixels[i] = busy ? 255 : 98; pixels[i + 1] = busy ? 20 : 130; pixels[i + 2] = busy ? 200 : 108;
  }
  mocks.readCover.mockResolvedValue({ bytes: await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer() });
  const bytes = Buffer.from(await (await GET(request, context)).arrayBuffer());
  const { channels } = await sharp(bytes).stats();
  expect(Math.max(...channels.map((channel) => channel.stdev))).toBeLessThan(8);
});

it("keeps missing or revoked cover capabilities unavailable and uncached", async () => {
  mocks.readCover.mockResolvedValue(null);
  const response = await GET(request, context);
  expect(response.status).toBe(404);
  expect(await response.text()).toBe("");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it.each([
  [1024, 1536, 0, 45], [1024, 1536, 0.05, 45], [1024, 1536, 0.4, 102],
  [1024, 1536, 0.95, 210], [1024, 1536, 1, 210], [1800, 500, 1, 128],
])("centers and clamps the face band for %ix%i at faceY=%s", async (width, height, faceY, expectedCenter) => {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    pixels[i] = Math.round(255 * y / height); pixels[i + 1] = 40; pixels[i + 2] = 80;
  }
  const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  mocks.readCover.mockResolvedValue({ bytes, faceY });
  const output = Buffer.from(await (await GET(request, context)).arrayBuffer());
  const pixel = await sharp(output).extract({ left: 600, top: 315, width: 1, height: 1 }).raw().toBuffer();
  expect(Math.abs(pixel[0]! - expectedCenter)).toBeLessThanOrEqual(3);
});
