import type {
  HealthCommonsCatalogEntity,
  StoredMedia,
} from "@murphai/contracts";

const FINNISH_SAUNA_ROUTE_ID = "finnish-sauna";
const NORWEGIAN_4X4_ROUTE_ID = "norwegian-4x4";
const RED_LIGHT_GLASSES_ROUTE_ID = "red-light-glasses-before-bed";
const BRYAN_JOHNSON_SAUNA_ROUTE_ID = "bryan-johnson-blueprint";
const FINNISH_SAUNA_IMAGE = "/design-assets/hero-finnish-sauna.jpeg";
const NORWEGIAN_4X4_IMAGE = "/design-assets/hero-norwegian-4x4.jpeg";
const RED_LIGHT_GLASSES_IMAGE = "/design-assets/hero-red-light-glasses-before-bed.jpeg";
const BRYAN_JOHNSON_SAUNA_IMAGE = "/design-assets/hero-bryan-johnson-sauna.jpg";
const GENERIC_SAUNA_IMAGE = "/design-assets/hero-sauna.png";
const SLEEP_EXPERIMENT_IMAGE = "/design-assets/hero-02.png";
const EXERCISE_EXPERIMENT_IMAGE = "/design-assets/hero-03.png";
const EXPERIMENT_IMAGE_BY_ROUTE_ID: Readonly<Partial<Record<string, string>>> = {
  [FINNISH_SAUNA_ROUTE_ID]: FINNISH_SAUNA_IMAGE,
  [NORWEGIAN_4X4_ROUTE_ID]: NORWEGIAN_4X4_IMAGE,
  [RED_LIGHT_GLASSES_ROUTE_ID]: RED_LIGHT_GLASSES_IMAGE,
  [BRYAN_JOHNSON_SAUNA_ROUTE_ID]: BRYAN_JOHNSON_SAUNA_IMAGE,
};

export function resolveProtocolImage(
  protocol: HealthCommonsCatalogEntity,
  routeId: string,
): string {
  const pageOwnedImage = resolveProtocolPageImage(protocol);

  if (pageOwnedImage) {
    return pageOwnedImage;
  }

  const mappedImage = EXPERIMENT_IMAGE_BY_ROUTE_ID[routeId];

  if (mappedImage) {
    return mappedImage;
  }

  return inferFallbackProtocolImage(protocol);
}

export function resolveProtocolPageImage(protocol: HealthCommonsCatalogEntity): string | null {
  const pageMedia = readProtocolMedia(protocol);
  const imageEntry = pageMedia.find(isProtocolImageMedia);

  if (!imageEntry) {
    return null;
  }

  return imageEntry.relativePath.startsWith("/")
    ? imageEntry.relativePath
    : `/${imageEntry.relativePath}`;
}

export function readProtocolMedia(protocol: HealthCommonsCatalogEntity): StoredMedia[] {
  const protocolRecord = protocol as Record<string, unknown>;
  const media = protocolRecord["media"];

  if (!Array.isArray(media)) {
    return [];
  }

  return media.filter(isStoredMediaEntry);
}

export function isStoredMediaEntry(value: unknown): value is StoredMedia {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const kind = record["kind"];
  const relativePath = record["relativePath"];
  const mediaType = record["mediaType"];
  const caption = record["caption"];

  if (
    kind !== "photo"
    && kind !== "video"
    && kind !== "gif"
    && kind !== "image"
    && kind !== "other"
  ) {
    return false;
  }

  if (typeof relativePath !== "string" || relativePath.length === 0) {
    return false;
  }

  if (mediaType !== undefined && typeof mediaType !== "string") {
    return false;
  }

  if (caption !== undefined && typeof caption !== "string") {
    return false;
  }

  return true;
}

export function isProtocolImageMedia(entry: StoredMedia): boolean {
  return entry.kind === "image"
    || entry.kind === "photo"
    || entry.mediaType?.startsWith("image/") === true;
}

export function inferFallbackProtocolImage(protocol: HealthCommonsCatalogEntity): string {
  const lookupText = [
    protocol.key,
    protocol.slug,
    protocol.title,
    ...(protocol.categories ?? []),
  ].join(" ");

  if (/red-light|sleep|circadian|evening-light/iu.test(lookupText)) {
    return SLEEP_EXPERIMENT_IMAGE;
  }

  if (/4x4|exercise|cardio|vo2max|hiit/iu.test(lookupText)) {
    return EXERCISE_EXPERIMENT_IMAGE;
  }

  return GENERIC_SAUNA_IMAGE;
}
