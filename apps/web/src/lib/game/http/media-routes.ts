import { withRetryableServerFailures } from "../../hosted-onboarding/errors";
import type { GameHistoryView, GameHomeView, GameView } from "../contract";
import {
  GAME_MEDIA_MAX_BYTES,
  gameMediaDelivery,
  isGameMediaKey,
  isGameMediaStorageAvailable,
  matchesGameMediaContentType,
  parseGameMediaContentType,
  putGameMedia,
  readGameMedia,
  servesSignedGameMedia,
} from "../media";
import { authorizeLockedPreviewReads, authorizeMediaRead, authorizeMediaReads, mediaKeyPrefixFor } from "../service";
import { gameMediaKeyOf } from "../views";
import { readRawBodyBuffer } from "../../http";
import { gameHttpError, gameMediaUnavailable, invalidGameRequest } from "./errors";

/**
 * Stores a photo under the member's prefix, keyed by its bytes: a retry
 * returns the same key. Entry photos and invite label photos share it.
 */
export async function uploadGameMedia(input: { memberId: string; request: Request }): Promise<string> {
  const { request } = input;
  const contentType = parseGameMediaContentType(request.headers.get("content-type"));
  if (!contentType) throw invalidGameRequest("Content-Type must be image/jpeg or image/heic.");
  requireStorage();
  const bytes = await readRawBodyBuffer(request, { limitBytes: GAME_MEDIA_MAX_BYTES });
  if (bytes.byteLength === 0 || !matchesGameMediaContentType(bytes, contentType)) {
    throw invalidGameRequest("The upload doesn't match its Content-Type.");
  }
  return withRetryableServerFailures(() => putGameMedia({ bytes, contentType, prefix: mediaKeyPrefixFor(input.memberId) }));
}

/**
 * Bytes only after the service says this viewer may see them (their own
 * upload, or another player's entry once the game view would show it).
 * Locked and missing media look the same.
 */
export async function serveGameMedia(input: { key: string; memberId: string; delivery?: boolean; variant?: "face" | "thumb" | "avatar" | "photo"; multiplayer?: boolean }): Promise<Response> {
  if (!(await isViewable(input.memberId, input.key, input.multiplayer))) throw mediaNotFound();
  requireStorage();
  if (input.delivery && servesSignedGameMedia()) {
    // Missing from the hosted store is final: no second look through the byte proxy.
    const delivery = await gameMediaDelivery(input.key, input.variant ?? "photo");
    if (!delivery) throw mediaNotFound();
    return new Response(JSON.stringify(delivery), { headers: {
      "Cache-Control": "private, no-store", "Content-Type": "application/json", "Referrer-Policy": "no-referrer",
    } });
  }
  const media = await readGameMedia(input.key);
  if (!media) throw mediaNotFound();
  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(media.bytes.byteLength),
      "Content-Type": media.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * A post's answer with the other players' pictures it just unlocked signed
 * in, so the app downloads them at once instead of asking for each. Each is
 * authorized exactly as `serveGameMedia` would; one that can't be signed is
 * left for the app to ask for as usual.
 */
export async function withUnlockedPhotoDeliveries(game: GameView, input: { entryId: string; memberId: string }): Promise<GameView> {
  if (!servesSignedGameMedia()) return game;
  const day = game.days.find((candidate) => candidate.mine?.entryId === input.entryId);
  if (!day) return game;
  const others = await Promise.all(day.others.map(async (other) => {
    const key = other.entry?.mediaUrls[0] ? gameMediaKeyOf(other.entry.mediaUrls[0]) : null;
    if (!other.entry || !key) return other;
    const delivery = await isViewable(input.memberId, key, game.maxPlayers !== undefined)
      .then((viewable) => (viewable ? gameMediaDelivery(key, "photo") : null))
      .catch(() => null);
    return delivery ? { ...other, entry: { ...other.entry, delivery } } : other;
  }));
  return { ...game, days: game.days.map((candidate) => (candidate === day ? { ...candidate, others } : candidate)) };
}

/**
 * Home with today's locked pictures signed in (`preview.delivery`), so the app
 * keeps each one ready, hidden, and develops it the moment its own post is in.
 * Authorized by `authorizeLockedPreviewReads`; one that can't be signed keeps
 * its preview without a delivery, and the app waits for the post's answer as
 * before. Bounded: a preview is only on each live game's today, signed six at
 * a time.
 */
export async function withLockedPreviewDeliveries(home: GameHomeView, memberId: string): Promise<GameHomeView> {
  if (!servesSignedGameMedia()) return home;
  const keyOf = (preview: { mediaUrl: string } | undefined) => {
    const key = preview ? gameMediaKeyOf(preview.mediaUrl) : null;
    return key && isGameMediaKey(key) ? key : null;
  };
  const keys = [...new Set(home.games.flatMap((game) => game.days.flatMap((day) =>
    day.others.flatMap((other) => keyOf(other.preview) ?? []))))];
  if (keys.length === 0) return home;
  const allowed = await authorizeLockedPreviewReads(memberId, keys, home.canStartGroups !== undefined).catch(() => new Set<string>());
  const deliveries = new Map<string, { url: string; expiresAt: string }>();
  const signable = keys.filter((key) => allowed.has(key));
  for (let offset = 0; offset < signable.length; offset += 6) {
    await Promise.all(signable.slice(offset, offset + 6).map(async (key) => {
      const delivery = await gameMediaDelivery(key, "photo").catch(() => null);
      if (delivery) deliveries.set(key, delivery);
    }));
  }
  if (deliveries.size === 0) return home;
  return { ...home, games: home.games.map((game) => ({ ...game, days: game.days.map((day) => ({ ...day,
    others: day.others.map((other) => {
      const delivery = deliveries.get(keyOf(other.preview) ?? "");
      return delivery && other.preview ? { ...other, preview: { ...other.preview, delivery } } : other;
    }),
  })) })) };
}

/** Sign the latest game per person or group, after the normal history filters.
 * At most (50 people + 20 groups) × 6 previews; deduplicate keys and authorize/sign six at
 * a time. Missing or unavailable delivery leaves the stable media URL intact.
 */
export async function withHistoryPhotoDeliveries(history: GameHistoryView, memberId: string): Promise<GameHistoryView> {
  if (!servesSignedGameMedia()) return history;
  const previews = [...history.people.flatMap(person => person.games[0]?.previews ?? []), ...(history.groups ?? []).flatMap(group => group.games[0]?.previews ?? [])];
  const keys = [...new Set(previews.flatMap((preview) => {
    const key = preview.mediaUrls[0] ? gameMediaKeyOf(preview.mediaUrls[0]) : null;
    return key ? [key] : [];
  }))];
  const deliveries = new Map<string, { url: string; expiresAt: string }>();
  for (let offset = 0; offset < keys.length; offset += 6) {
    const batch = keys.slice(offset, offset + 6).filter(isGameMediaKey);
    const allowed = await authorizeMediaReads(memberId, batch, history.groups !== undefined)
      .catch(() => new Set(batch.filter((key) => key.startsWith(mediaKeyPrefixFor(memberId)))));
    await Promise.all(batch.map(async (key) => {
      const delivery = allowed.has(key) ? await gameMediaDelivery(key, "thumb").catch(() => null) : null;
      if (delivery) deliveries.set(key, delivery);
    }));
  }
  const signedGroups = history.groups?.map(group => ({ ...group, games: group.games.map((game, index) => index === 0 ? { ...game,
    previews: game.previews.map(preview => {
      const key = preview.mediaUrls[0] ? gameMediaKeyOf(preview.mediaUrls[0]) : null;
      const delivery = key ? deliveries.get(key) : null;
      return delivery ? { ...preview, delivery } : preview;
    }),
  } : game) }));
  return { ...history, ...(signedGroups ? { groups: signedGroups } : {}), people: history.people.map((person) => ({ ...person,
    games: person.games.map((game, index) => index === 0 ? { ...game,
      previews: game.previews.map((preview) => {
        const key = preview.mediaUrls[0] ? gameMediaKeyOf(preview.mediaUrls[0]) : null;
        const delivery = key ? deliveries.get(key) : null;
        return delivery ? { ...preview, delivery } : preview;
      }),
    } : game),
  })) };
}

async function isViewable(memberId: string, key: string, multiplayer = false): Promise<boolean> {
  return isGameMediaKey(key) && authorizeMediaRead(memberId, key, multiplayer);
}

function requireStorage(): void {
  if (!isGameMediaStorageAvailable()) {
    throw gameMediaUnavailable();
  }
}

function mediaNotFound() {
  return gameHttpError("MEDIA_MISSING", 404, "That media isn't available.");
}
