const PRODUCT_LABEL_ID_MAX_LENGTH = 256;
const MAX_ENCODED_ID_LENGTH = PRODUCT_LABEL_ID_MAX_LENGTH * 4;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

export type PublicProductKind = "supplement" | "food";

export type DecodedPublicProductRef = {
  kind: PublicProductKind;
  id: string;
};

/** Opaque URL identifier only. It does not grant access or authorization. */
export function encodePublicProductRef(
  kind: PublicProductKind,
  id: string,
): string {
  if (!isProductLabelLookupId(id) || !hasCanonicalUtf8Encoding(id)) {
    throw new TypeError("Public product references require a valid product label ID.");
  }

  const encodedId = Buffer.from(id, "utf8").toString("base64url");
  return `${kind}_${encodedId}`;
}

export function decodePublicProductRef(
  value: string,
): DecodedPublicProductRef | null {
  const parsed = splitPublicProductRef(value);
  if (!parsed || !BASE64URL_PATTERN.test(parsed.encodedId)) {
    return null;
  }

  if (
    parsed.encodedId.length > MAX_ENCODED_ID_LENGTH ||
    parsed.encodedId.length % 4 === 1
  ) {
    return null;
  }

  const bytes = Buffer.from(parsed.encodedId, "base64url");
  if (bytes.toString("base64url") !== parsed.encodedId) {
    return null;
  }

  let id: string;
  try {
    id = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }

  if (
    Buffer.from(id, "utf8").toString("base64url") !== parsed.encodedId ||
    !isProductLabelLookupId(id)
  ) {
    return null;
  }

  return {
    kind: parsed.kind,
    id,
  };
}

function splitPublicProductRef(value: string): {
  kind: PublicProductKind;
  encodedId: string;
} | null {
  if (value.startsWith("supplement_")) {
    return {
      kind: "supplement",
      encodedId: value.slice("supplement_".length),
    };
  }

  if (value.startsWith("food_")) {
    return {
      kind: "food",
      encodedId: value.slice("food_".length),
    };
  }

  return null;
}

function hasCanonicalUtf8Encoding(value: string): boolean {
  const bytes = Buffer.from(value, "utf8");

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes) === value;
  } catch {
    return false;
  }
}

function isProductLabelLookupId(id: string): boolean {
  if (
    id.length === 0 ||
    id.length > PRODUCT_LABEL_ID_MAX_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(id)
  ) {
    return false;
  }

  return /^\d+$/u.test(id) || /^[a-z][a-z0-9_-]*:\S+$/u.test(id);
}
