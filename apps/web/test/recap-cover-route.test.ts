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
  mocks.readCover.mockResolvedValue(portrait);
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

it("keeps missing or revoked cover capabilities unavailable and uncached", async () => {
  mocks.readCover.mockResolvedValue(null);
  const response = await GET(request, context);
  expect(response.status).toBe(404);
  expect(await response.text()).toBe("");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
