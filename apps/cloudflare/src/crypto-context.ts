const CONTEXT_SALT = new TextEncoder().encode("murph.cloudflare.hosted.storage.v2");
const utf8Encoder = new TextEncoder();

export type HostedStorageScope =
  | "artifact"
  | "assistant-usage"
  | "assistant-usage-dirty"
  | "bundle"
  | "dispatch-payload"
  | "device-sync-runtime"
  | "email-raw"
  | "email-route"
  | "execution-journal"
  | "gateway-store"
  | "member-private-state"
  | "root-key-envelope"
  | "root-key-recipient"
  | "share-pack"
  | "side-effect-journal"
  | "user-env";

export async function deriveHostedStorageKey(
  rootKey: Uint8Array,
  scope: HostedStorageScope | `id:${string}` | "",
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rootKey),
    "HKDF",
    false,
    ["deriveBits"],
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      info: utf8Encoder.encode(scope),
      salt: CONTEXT_SALT,
    },
    baseKey,
    256,
  );

  return new Uint8Array(derived);
}

export async function deriveHostedStorageOpaqueId(input: {
  length?: number;
  rootKey: Uint8Array;
  scope: string;
  value: string;
}): Promise<string> {
  const idKey = await deriveHostedStorageKey(input.rootKey, `id:${input.scope}`);
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(idKey),
    {
      hash: "SHA-256",
      name: "HMAC",
    },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", hmacKey, utf8Encoder.encode(input.value)),
  );
  const hex = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return hex.slice(0, input.length ?? 48);
}

export function buildHostedStorageAad(
  fields: Readonly<Record<string, string | number | boolean | null | undefined>>,
): Uint8Array {
  const canonical = Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value ?? null]),
  );

  return utf8Encoder.encode(JSON.stringify(canonical));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
