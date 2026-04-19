import { createHmac } from "node:crypto";

const hostedBlindIndexPrefix = "hbidx";
const hostedPhonePurpose = "blind-index:phone";
const hostedPrivacyVersionPattern = /^v[0-9]+$/u;
const hostedWebSmokeDefaultEncryptionKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
const hostedWebSmokeDefaultEncryptionKeyVersion = "v1";

export function createHostedPhoneLookupKey(value: string | null | undefined): string | null {
  const normalized = normalizePhoneNumber(value);

  if (!normalized) {
    return null;
  }

  const keyring = readHostedContactPrivacyKeyring();
  const digest = createHmac(
    "sha256",
    deriveHostedPrivacyKey(keyring.currentVersion, keyring.currentKey, hostedPhonePurpose),
  )
    .update(normalized)
    .digest("hex");

  return `${hostedBlindIndexPrefix}:phone:${keyring.currentVersion}:${digest}`;
}

function readHostedContactPrivacyKeyring(): {
  currentKey: Buffer;
  currentVersion: string;
} {
  const keyringValue =
    process.env.HOSTED_CONTACT_PRIVACY_KEYS
    ?? `${hostedWebSmokeDefaultEncryptionKeyVersion}:${hostedWebSmokeDefaultEncryptionKey}`;
  const entries = keyringValue
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    throw new TypeError("HOSTED_CONTACT_PRIVACY_KEYS must include at least one version:key entry.");
  }

  const keysByVersion = new Map<string, Buffer>();
  for (const entry of entries) {
    const separatorIndex = entry.indexOf(":");

    if (separatorIndex < 1 || separatorIndex === entry.length - 1) {
      throw new TypeError("HOSTED_CONTACT_PRIVACY_KEYS entries must use the format vN:base64key.");
    }

    const version = entry.slice(0, separatorIndex).trim();
    const encodedKey = entry.slice(separatorIndex + 1).trim();

    if (!hostedPrivacyVersionPattern.test(version)) {
      throw new TypeError(
        `Hosted contact privacy key version ${JSON.stringify(version)} must match /^v[0-9]+$/.`,
      );
    }

    if (keysByVersion.has(version)) {
      throw new TypeError(`HOSTED_CONTACT_PRIVACY_KEYS must not repeat ${version}.`);
    }

    keysByVersion.set(version, decodeHostedEncryptionKey(encodedKey));
  }

  const configuredCurrentVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION?.trim();
  const currentVersion = configuredCurrentVersion
    || (keysByVersion.size === 1 ? keysByVersion.keys().next().value ?? null : null);

  if (!currentVersion) {
    throw new TypeError(
      "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION is required when HOSTED_CONTACT_PRIVACY_KEYS defines multiple versions.",
    );
  }

  const currentKey = keysByVersion.get(currentVersion);
  if (!currentKey) {
    throw new TypeError(
      `HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION ${JSON.stringify(currentVersion)} is not present in HOSTED_CONTACT_PRIVACY_KEYS.`,
    );
  }

  return {
    currentKey,
    currentVersion,
  };
}

function deriveHostedPrivacyKey(version: string, rootKey: Buffer, purpose: string): Buffer {
  return createHmac("sha256", rootKey)
    .update(`hosted-contact-privacy:${version}:${purpose}`)
    .digest();
}

function decodeHostedEncryptionKey(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");

  if (decoded.byteLength !== 32) {
    throw new TypeError("Hosted contact privacy keys must decode to exactly 32 bytes.");
  }

  return decoded;
}

function normalizePhoneNumber(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const compact = trimmed.replace(/[\s().-]+/gu, "");
  const prefixed = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;

  if (/^\+[1-9]\d{6,14}$/u.test(prefixed)) {
    return prefixed;
  }

  if (/^[1-9]\d{6,14}$/u.test(prefixed)) {
    return `+${prefixed}`;
  }

  return null;
}
