import { encodeBase64 } from "./base64.js";

export async function listHostedStorageObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  mapKey: (candidateRootKey: Uint8Array) => Promise<string> | string,
): Promise<string[]> {
  const keys = await Promise.all(
    listHostedStorageRootKeys(rootKey, keysById).map((candidateRootKey) => mapKey(candidateRootKey)),
  );

  return [...new Set(keys)];
}

function listHostedStorageRootKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
): Uint8Array[] {
  const seen = new Set<string>();
  const unique: Uint8Array[] = [];

  for (const key of [rootKey, ...Object.values(keysById ?? {})]) {
    const signature = encodeBase64(key);

    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    unique.push(key);
  }

  return unique;
}
