import {
  assertHostedAuthorityVerifyPublicKeyPem,
  buildHostedDomainRootWrapContext,
  generateHostedDomainRootKey,
  type HostedCryptoEcdhRecipientKind,
  unwrapHostedDomainRootKeyWithP256Ecdh,
  wrapHostedDomainRootKeyWithP256Ecdh,
} from "./hosted-domain-crypto.ts";
import {
  parseHostedUserRecipientPrivateKeyJwk,
  parseHostedUserRecipientPublicKeyJwk,
  type HostedUserRecipientPrivateKeyJwk,
  type HostedUserRecipientPublicKeyJwk,
} from "./hosted-ecdh-jwk.ts";

export type HostedAuthorityVerifyKeyStatus =
  | "active"
  | "verify_only"
  | "disabled";
export type HostedRecipientPublicKeyStatus = "active" | "disabled";
export type HostedRecipientPrivateKeyStatus =
  | "active"
  | "decrypt_only"
  | "disabled";

export interface HostedAuthorityVerifyKeyringEntry {
  keyVersionName: string;
  publicKeyPem: string;
  status: HostedAuthorityVerifyKeyStatus;
}

export interface HostedRecipientPublicKeyringEntry {
  publicJwk: HostedUserRecipientPublicKeyJwk;
  recipient: HostedCryptoEcdhRecipientKind;
  recipientKeyId: string;
  status: HostedRecipientPublicKeyStatus;
  teePolicyId?: string;
}

export interface HostedRecipientPrivateKeyringEntry {
  privateJwk: HostedUserRecipientPrivateKeyJwk;
  recipient: HostedCryptoEcdhRecipientKind;
  recipientKeyId: string;
  status: HostedRecipientPrivateKeyStatus;
  teePolicyId?: string;
}

export type HostedAuthorityVerifyKeyring = Readonly<
  Record<string, HostedAuthorityVerifyKeyringEntry>
>;
export type HostedRecipientPublicKeyring = Readonly<
  Record<string, HostedRecipientPublicKeyringEntry>
>;
export type HostedRecipientPrivateKeyring = Readonly<
  Record<string, HostedRecipientPrivateKeyringEntry>
>;

export const HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR =
  "HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON must be a valid non-active hosted authority standby keyring.";
export const HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR =
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON must be a valid non-active Cloudflare automation public standby keyring.";
export const HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR =
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON must be a valid non-active Cloudflare automation private standby keyring.";
export const HOSTED_CRYPTO_COMPLETE_STANDBY_PRELOAD_ERROR =
  "Hosted crypto complete standby preload requires authority, Cloudflare public, and Cloudflare private keyrings.";
export const HOSTED_CRYPTO_COMPLETE_STANDBY_IDENTIFIERS_ERROR =
  "Hosted crypto complete standby preload requires active and proposed authority and Cloudflare key identifiers.";
export const HOSTED_CLOUDFLARE_STANDBY_KEYPAIR_MISMATCH_ERROR =
  "Hosted crypto Cloudflare public and private standby keyrings must contain matching P-256 keypairs.";

/**
 * Shared deploy-time acceptance contract for optional hosted crypto keyrings.
 * It intentionally validates only non-active compatibility entries; required
 * active values remain owned by each runtime's existing single-key variables.
 * All thrown messages are field-only and safe to surface from provider gates.
 */
export function assertHostedCryptoStandbyKeyringJsons(input: {
  activeAuthorityKeyVersionName?: string | null;
  activeCloudflareRecipientKeyId?: string | null;
  authorityVerifyKeyringJson?: string | null;
  cloudflarePrivateKeyringJson?: string | null;
  cloudflarePublicKeyringJson?: string | null;
  proposedAuthorityKeyVersionName?: string | null;
  proposedCloudflareRecipientKeyId?: string | null;
  requireCompletePreload?: boolean;
}): void {
  const authorityEntries = readHostedAuthorityStandbyEntries(
    input.authorityVerifyKeyringJson,
  );
  const publicEntries = readHostedCloudflarePublicStandbyEntries(
    input.cloudflarePublicKeyringJson,
  );
  const privateEntries = readHostedCloudflarePrivateStandbyEntries(
    input.cloudflarePrivateKeyringJson,
  );
  const activeAuthorityKeyVersionName = normalizeOptionalString(
    input.activeAuthorityKeyVersionName,
  );
  const activeCloudflareRecipientKeyId = normalizeOptionalString(
    input.activeCloudflareRecipientKeyId,
  );

  if (
    activeAuthorityKeyVersionName
    && authorityEntries.some(
      (entry) => entry.keyVersionName === activeAuthorityKeyVersionName,
    )
  ) {
    throw new TypeError(HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR);
  }
  if (
    activeCloudflareRecipientKeyId
    && publicEntries.some(
      (entry) => entry.recipientKeyId === activeCloudflareRecipientKeyId,
    )
  ) {
    throw new TypeError(HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR);
  }
  if (
    activeCloudflareRecipientKeyId
    && privateEntries.some(
      (entry) => entry.recipientKeyId === activeCloudflareRecipientKeyId,
    )
  ) {
    throw new TypeError(HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR);
  }

  if (!input.requireCompletePreload) {
    return;
  }
  if (
    authorityEntries.length === 0
    || publicEntries.length === 0
    || privateEntries.length === 0
  ) {
    throw new TypeError(HOSTED_CRYPTO_COMPLETE_STANDBY_PRELOAD_ERROR);
  }

  const proposedAuthorityKeyVersionName = normalizeOptionalString(
    input.proposedAuthorityKeyVersionName,
  );
  const proposedCloudflareRecipientKeyId = normalizeOptionalString(
    input.proposedCloudflareRecipientKeyId,
  );
  if (
    !activeAuthorityKeyVersionName
    || !activeCloudflareRecipientKeyId
    || !proposedAuthorityKeyVersionName
    || !proposedCloudflareRecipientKeyId
  ) {
    throw new TypeError(HOSTED_CRYPTO_COMPLETE_STANDBY_IDENTIFIERS_ERROR);
  }

  const authorityEntriesById = new Map(
    authorityEntries.map((entry) => [entry.keyVersionName, entry] as const),
  );
  const publicEntriesById = new Map(
    publicEntries.map((entry) => [entry.recipientKeyId, entry] as const),
  );
  const privateEntriesById = new Map(
    privateEntries.map((entry) => [entry.recipientKeyId, entry] as const),
  );
  const proposedAuthorityEntry = authorityEntriesById.get(
    proposedAuthorityKeyVersionName,
  );
  if (proposedAuthorityEntry?.status !== "verify_only") {
    throw new TypeError(HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR);
  }
  const proposedPublicEntry = publicEntriesById.get(
    proposedCloudflareRecipientKeyId,
  );
  if (proposedPublicEntry?.status !== "disabled") {
    throw new TypeError(HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR);
  }
  const proposedPrivateEntry = privateEntriesById.get(
    proposedCloudflareRecipientKeyId,
  );
  if (proposedPrivateEntry?.status !== "decrypt_only") {
    throw new TypeError(HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR);
  }

  if (
    publicEntries.length !== privateEntries.length
    || publicEntries.some((publicEntry) => {
      const privateEntry = privateEntriesById.get(publicEntry.recipientKeyId);
      return !privateEntry
        || privateEntry.privateJwk.crv !== publicEntry.publicJwk.crv
        || privateEntry.privateJwk.kty !== publicEntry.publicJwk.kty
        || privateEntry.privateJwk.x !== publicEntry.publicJwk.x
        || privateEntry.privateJwk.y !== publicEntry.publicJwk.y;
    })
  ) {
    throw new TypeError(HOSTED_CLOUDFLARE_STANDBY_KEYPAIR_MISMATCH_ERROR);
  }
}

export async function assertHostedCryptoCompleteStandbyKeyringJsons(input: {
  activeAuthorityKeyVersionName?: string | null;
  activeCloudflareRecipientKeyId?: string | null;
  authorityVerifyKeyringJson?: string | null;
  cloudflarePrivateKeyringJson?: string | null;
  cloudflarePublicKeyringJson?: string | null;
  proposedAuthorityKeyVersionName?: string | null;
  proposedCloudflareRecipientKeyId?: string | null;
}): Promise<void> {
  assertHostedCryptoStandbyKeyringJsons({
    ...input,
    requireCompletePreload: true,
  });

  const proposedAuthorityKeyVersionName = normalizeOptionalString(
    input.proposedAuthorityKeyVersionName,
  );
  const proposedCloudflareRecipientKeyId = normalizeOptionalString(
    input.proposedCloudflareRecipientKeyId,
  );
  if (!proposedAuthorityKeyVersionName || !proposedCloudflareRecipientKeyId) {
    throw new TypeError(HOSTED_CRYPTO_COMPLETE_STANDBY_IDENTIFIERS_ERROR);
  }
  const authorityEntry = readHostedAuthorityStandbyEntries(
    input.authorityVerifyKeyringJson,
  ).find(
    (entry) => entry.keyVersionName === proposedAuthorityKeyVersionName,
  );
  if (!authorityEntry) {
    throw new TypeError(HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR);
  }
  const publicEntry = readHostedCloudflarePublicStandbyEntries(
    input.cloudflarePublicKeyringJson,
  ).find((entry) => entry.recipientKeyId === proposedCloudflareRecipientKeyId);
  const privateEntry = readHostedCloudflarePrivateStandbyEntries(
    input.cloudflarePrivateKeyringJson,
  ).find((entry) => entry.recipientKeyId === proposedCloudflareRecipientKeyId);
  if (!publicEntry || !privateEntry) {
    throw new TypeError(HOSTED_CLOUDFLARE_STANDBY_KEYPAIR_MISMATCH_ERROR);
  }

  try {
    await assertHostedAuthorityVerifyPublicKeyPem(authorityEntry.publicKeyPem);
  } catch {
    throw new TypeError(HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR);
  }

  const challenge = generateHostedDomainRootKey();
  let unwrapped: Uint8Array | null = null;
  try {
    const wrap = await wrapHostedDomainRootKeyWithP256Ecdh({
      encryptionContext: buildHostedDomainRootWrapContext({
        domain: "runtime",
        env: "standby-preload",
        recipient: publicEntry.recipient,
        rootKeyId: "udrk:runtime:standby-preload",
        userId: "standby-preload",
      }),
      recipient: publicEntry.recipient,
      recipientKeyId: publicEntry.recipientKeyId,
      recipientPublicJwk: publicEntry.publicJwk,
      rootKey: challenge,
      teePolicyId: publicEntry.teePolicyId,
    });
    unwrapped = await unwrapHostedDomainRootKeyWithP256Ecdh({
      privateJwk: privateEntry.privateJwk,
      wrap,
    });
    if (
      unwrapped.length !== challenge.length
      || unwrapped.some((byte, index) => byte !== challenge[index])
    ) {
      throw new TypeError(HOSTED_CLOUDFLARE_STANDBY_KEYPAIR_MISMATCH_ERROR);
    }
  } catch {
    throw new TypeError(HOSTED_CLOUDFLARE_STANDBY_KEYPAIR_MISMATCH_ERROR);
  } finally {
    challenge.fill(0);
    unwrapped?.fill(0);
  }
}

export function createHostedAuthorityVerifyKeyring(input: {
  activeKeyVersionName: string;
  activePublicKeyPem: string;
  keyringJson?: string | null;
}): HostedAuthorityVerifyKeyring {
  const keyring = new Map<string, HostedAuthorityVerifyKeyringEntry>();

  for (const entry of parseHostedAuthorityVerifyKeyringJson(input.keyringJson)) {
    keyring.set(entry.keyVersionName, entry);
  }

  const activeKeyVersionName = requireNonEmptyString(
    input.activeKeyVersionName,
    "Hosted authority active key version name",
  );
  keyring.set(activeKeyVersionName, {
    keyVersionName: activeKeyVersionName,
    publicKeyPem: normalizePem(
      input.activePublicKeyPem,
      "Hosted authority active public key PEM",
    ),
    status: "active",
  });

  assertOneActiveAuthorityVerifyKey(keyring);
  return Object.freeze(Object.fromEntries(keyring.entries()));
}

export function selectHostedAuthorityVerifyPublicKeyPem(input: {
  keyVersionName: string;
  keyring: HostedAuthorityVerifyKeyring;
}): string {
  const keyVersionName = requireNonEmptyString(
    input.keyVersionName,
    "Hosted authority verify key version name",
  );
  const entry = input.keyring[keyVersionName];

  if (!entry || entry.status === "disabled") {
    throw new Error(
      `Hosted authority signing key ${keyVersionName} is not trusted for verification.`,
    );
  }

  return entry.publicKeyPem;
}

export function createHostedRecipientPublicKeyring(input: {
  activePublicJwk: JsonWebKey;
  activeRecipient: HostedCryptoEcdhRecipientKind;
  activeRecipientKeyId: string;
  keyringJson?: string | null;
  teePolicyId?: string | null;
}): HostedRecipientPublicKeyring {
  const keyring = new Map<string, HostedRecipientPublicKeyringEntry>();

  for (const entry of parseHostedRecipientPublicKeyringJson(input.keyringJson)) {
    keyring.set(entry.recipientKeyId, entry);
  }

  const activeRecipientKeyId = requireNonEmptyString(
    input.activeRecipientKeyId,
    "Hosted recipient active key id",
  );
  const teePolicyId = normalizeOptionalString(input.teePolicyId);
  keyring.set(activeRecipientKeyId, {
    publicJwk: parseHostedUserRecipientPublicKeyJwk(
      input.activePublicJwk,
      "Hosted recipient active public JWK",
    ),
    recipient: input.activeRecipient,
    recipientKeyId: activeRecipientKeyId,
    status: "active",
    ...(teePolicyId ? { teePolicyId } : {}),
  });

  assertAtMostOneActiveRecipientPublicKeyPerRecipient(keyring);
  return Object.freeze(Object.fromEntries(keyring.entries()));
}

export function createHostedRecipientPrivateKeyring(input: {
  activePrivateJwk: JsonWebKey;
  activeRecipient: HostedCryptoEcdhRecipientKind;
  activeRecipientKeyId: string;
  keyringJson?: string | null;
  teePolicyId?: string | null;
}): HostedRecipientPrivateKeyring {
  const keyring = new Map<string, HostedRecipientPrivateKeyringEntry>();

  for (const entry of parseHostedRecipientPrivateKeyringJson(input.keyringJson)) {
    keyring.set(entry.recipientKeyId, entry);
  }

  const activeRecipientKeyId = requireNonEmptyString(
    input.activeRecipientKeyId,
    "Hosted recipient active private key id",
  );
  const teePolicyId = normalizeOptionalString(input.teePolicyId);
  keyring.set(activeRecipientKeyId, {
    privateJwk: parseHostedUserRecipientPrivateKeyJwk(
      input.activePrivateJwk,
      "Hosted recipient active private JWK",
    ),
    recipient: input.activeRecipient,
    recipientKeyId: activeRecipientKeyId,
    status: "active",
    ...(teePolicyId ? { teePolicyId } : {}),
  });

  assertAtMostOneActiveRecipientPrivateKeyPerRecipient(keyring);
  return Object.freeze(Object.fromEntries(keyring.entries()));
}

export function selectActiveHostedRecipientPublicKey(input: {
  keyring: HostedRecipientPublicKeyring;
  recipient: HostedCryptoEcdhRecipientKind;
}): HostedRecipientPublicKeyringEntry {
  const activeEntries = Object.values(input.keyring).filter(
    (entry) => entry.recipient === input.recipient && entry.status === "active",
  );

  if (activeEntries.length !== 1) {
    throw new Error(
      `Hosted recipient ${input.recipient} must have exactly one active public key.`,
    );
  }

  return activeEntries[0]!;
}

export function selectHostedRecipientPrivateKeyForDecrypt(input: {
  keyring: HostedRecipientPrivateKeyring;
  recipient: HostedCryptoEcdhRecipientKind;
  recipientKeyId: string;
}): HostedRecipientPrivateKeyringEntry {
  const recipientKeyId = requireNonEmptyString(
    input.recipientKeyId,
    "Hosted recipient decrypt key id",
  );
  const entry = input.keyring[recipientKeyId];

  if (
    !entry
    || entry.recipient !== input.recipient
    || entry.status === "disabled"
  ) {
    throw new Error(
      `Hosted recipient ${input.recipient} key ${recipientKeyId} is not available for decrypt.`,
    );
  }

  return entry;
}

function readHostedAuthorityStandbyEntries(
  value: string | null | undefined,
): HostedAuthorityVerifyKeyringEntry[] {
  try {
    const entries = parseHostedAuthorityVerifyKeyringJson(value);
    if (
      hasDuplicateStrings(entries.map((entry) => entry.keyVersionName))
      || entries.some((entry) => entry.status === "active")
    ) {
      throw new TypeError(HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR);
    }
    return entries;
  } catch {
    throw new TypeError(HOSTED_AUTHORITY_STANDBY_KEYRING_ERROR);
  }
}

function readHostedCloudflarePublicStandbyEntries(
  value: string | null | undefined,
): HostedRecipientPublicKeyringEntry[] {
  try {
    const entries = parseHostedRecipientPublicKeyringJson(value);
    const rawKeyring = parseOptionalJsonRecord(
      value,
      "Hosted recipient public keyring JSON",
    );
    const containsUnsafeRawMaterial = rawKeyring
      ? Object.entries(rawKeyring).some(([rawRecipientKeyId, rawEntry]) => {
          const entry = requireRecord(
            rawEntry,
            "Hosted recipient public standby entry",
          );
          const publicJwk = requireRecord(
            entry.publicJwk,
            "Hosted recipient public standby JWK",
          );
          const normalizedRecipientKeyId = requireNonEmptyString(
            rawRecipientKeyId,
            "Hosted recipient public standby key id",
          );
          const declaredRecipientKeyId = normalizeOptionalString(
            entry.recipientKeyId,
          );
          return !hasOnlyKeys(entry, [
            "publicJwk",
            "recipient",
            "recipientKeyId",
            "status",
            "teePolicyId",
          ])
            || !hasOnlyKeys(publicJwk, [
              "crv",
              "ext",
              "key_ops",
              "kty",
              "x",
              "y",
            ])
            || (
              entry.recipientKeyId !== undefined
              && declaredRecipientKeyId !== normalizedRecipientKeyId
            );
        })
      : false;
    if (
      containsUnsafeRawMaterial
      || hasDuplicateStrings(entries.map((entry) => entry.recipientKeyId))
      || entries.some(
        (entry) =>
          entry.recipient !== "cloudflare-automation-secret"
          || entry.status === "active",
      )
    ) {
      throw new TypeError(HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR);
    }
    return entries;
  } catch {
    throw new TypeError(HOSTED_CLOUDFLARE_PUBLIC_STANDBY_KEYRING_ERROR);
  }
}

function readHostedCloudflarePrivateStandbyEntries(
  value: string | null | undefined,
): HostedRecipientPrivateKeyringEntry[] {
  try {
    const entries = parseHostedRecipientPrivateKeyringJson(value);
    if (
      hasDuplicateStrings(entries.map((entry) => entry.recipientKeyId))
      || entries.some(
        (entry) =>
          entry.recipient !== "cloudflare-automation-secret"
          || entry.status === "active",
      )
    ) {
      throw new TypeError(HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR);
    }
    return entries;
  } catch {
    throw new TypeError(HOSTED_CLOUDFLARE_PRIVATE_STANDBY_KEYRING_ERROR);
  }
}

function hasDuplicateStrings(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseHostedAuthorityVerifyKeyringJson(
  value: string | null | undefined,
): HostedAuthorityVerifyKeyringEntry[] {
  const parsed = parseOptionalJsonRecord(
    value,
    "HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON",
  );
  if (!parsed) {
    return [];
  }

  return Object.entries(parsed).map(([keyVersionName, rawEntry]) => {
    const record = requireRecord(
      rawEntry,
      `Hosted authority verify keyring ${keyVersionName}`,
    );
    return {
      keyVersionName: requireNonEmptyString(
        keyVersionName,
        "Hosted authority verify keyring key version",
      ),
      publicKeyPem: normalizePem(
        record.publicKeyPem,
        `Hosted authority verify keyring ${keyVersionName}.publicKeyPem`,
      ),
      status: requireAuthorityVerifyKeyStatus(
        record.status,
        `Hosted authority verify keyring ${keyVersionName}.status`,
      ),
    };
  });
}

function parseHostedRecipientPublicKeyringJson(
  value: string | null | undefined,
): HostedRecipientPublicKeyringEntry[] {
  const parsed = parseOptionalJsonRecord(
    value,
    "Hosted recipient public keyring JSON",
  );
  if (!parsed) {
    return [];
  }

  return Object.entries(parsed).map(([recipientKeyId, rawEntry]) => {
    const record = requireRecord(
      rawEntry,
      `Hosted recipient public keyring ${recipientKeyId}`,
    );
    const teePolicyId = normalizeOptionalString(record.teePolicyId);
    return {
      publicJwk: parseHostedUserRecipientPublicKeyJwk(
        record.publicJwk,
        `Hosted recipient public keyring ${recipientKeyId}.publicJwk`,
      ),
      recipient: requireHostedCryptoEcdhRecipientKind(
        record.recipient,
        `Hosted recipient public keyring ${recipientKeyId}.recipient`,
      ),
      recipientKeyId: requireNonEmptyString(
        recipientKeyId,
        "Hosted recipient public key id",
      ),
      status: requireRecipientPublicKeyStatus(
        record.status,
        `Hosted recipient public keyring ${recipientKeyId}.status`,
      ),
      ...(teePolicyId ? { teePolicyId } : {}),
    };
  });
}

function parseHostedRecipientPrivateKeyringJson(
  value: string | null | undefined,
): HostedRecipientPrivateKeyringEntry[] {
  const parsed = parseOptionalJsonRecord(
    value,
    "Hosted recipient private keyring JSON",
  );
  if (!parsed) {
    return [];
  }

  return Object.entries(parsed).map(([recipientKeyId, rawEntry]) => {
    const record = requireRecord(
      rawEntry,
      `Hosted recipient private keyring ${recipientKeyId}`,
    );
    const teePolicyId = normalizeOptionalString(record.teePolicyId);
    return {
      privateJwk: parseHostedUserRecipientPrivateKeyJwk(
        record.privateJwk,
        `Hosted recipient private keyring ${recipientKeyId}.privateJwk`,
      ),
      recipient: requireHostedCryptoEcdhRecipientKind(
        record.recipient,
        `Hosted recipient private keyring ${recipientKeyId}.recipient`,
      ),
      recipientKeyId: requireNonEmptyString(
        recipientKeyId,
        "Hosted recipient private key id",
      ),
      status: requireRecipientPrivateKeyStatus(
        record.status,
        `Hosted recipient private keyring ${recipientKeyId}.status`,
      ),
      ...(teePolicyId ? { teePolicyId } : {}),
    };
  });
}

function parseOptionalJsonRecord(
  value: string | null | undefined,
  label: string,
): Record<string, unknown> | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }
  assertNoDuplicateJsonObjectMembers(normalized);

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    throw new TypeError(
      `${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return requireRecord(parsed, label);
}

function assertNoDuplicateJsonObjectMembers(value: string): void {
  const cursor = { index: 0 };
  readJsonValue(value, cursor);
  skipJsonWhitespace(value, cursor);
  if (cursor.index !== value.length) {
    throw new TypeError("Hosted crypto keyring JSON must be unambiguous.");
  }
}

function readJsonValue(value: string, cursor: { index: number }): void {
  skipJsonWhitespace(value, cursor);
  const token = value[cursor.index];
  if (token === "{") {
    readJsonObject(value, cursor);
    return;
  }
  if (token === "[") {
    readJsonArray(value, cursor);
    return;
  }
  if (token === '"') {
    readJsonString(value, cursor);
    return;
  }
  if (token === "t" && value.startsWith("true", cursor.index)) {
    cursor.index += 4;
    return;
  }
  if (token === "f" && value.startsWith("false", cursor.index)) {
    cursor.index += 5;
    return;
  }
  if (token === "n" && value.startsWith("null", cursor.index)) {
    cursor.index += 4;
    return;
  }
  const number = value.slice(cursor.index).match(
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u,
  );
  if (number) {
    cursor.index += number[0].length;
    return;
  }
  throw new TypeError("Hosted crypto keyring JSON must be unambiguous.");
}

function readJsonObject(value: string, cursor: { index: number }): void {
  cursor.index += 1;
  const memberNames = new Set<string>();
  skipJsonWhitespace(value, cursor);
  if (value[cursor.index] === "}") {
    cursor.index += 1;
    return;
  }

  while (cursor.index < value.length) {
    skipJsonWhitespace(value, cursor);
    const memberName = readJsonString(value, cursor);
    if (memberNames.has(memberName)) {
      throw new TypeError("Hosted crypto keyring JSON must be unambiguous.");
    }
    memberNames.add(memberName);
    skipJsonWhitespace(value, cursor);
    requireJsonToken(value, cursor, ":");
    readJsonValue(value, cursor);
    skipJsonWhitespace(value, cursor);
    if (value[cursor.index] === "}") {
      cursor.index += 1;
      return;
    }
    requireJsonToken(value, cursor, ",");
  }
  throw new TypeError("Hosted crypto keyring JSON must be unambiguous.");
}

function readJsonArray(value: string, cursor: { index: number }): void {
  cursor.index += 1;
  skipJsonWhitespace(value, cursor);
  if (value[cursor.index] === "]") {
    cursor.index += 1;
    return;
  }

  while (cursor.index < value.length) {
    readJsonValue(value, cursor);
    skipJsonWhitespace(value, cursor);
    if (value[cursor.index] === "]") {
      cursor.index += 1;
      return;
    }
    requireJsonToken(value, cursor, ",");
  }
  throw new TypeError("Hosted crypto keyring JSON must be unambiguous.");
}

function readJsonString(value: string, cursor: { index: number }): string {
  const start = cursor.index;
  requireJsonToken(value, cursor, '"');
  while (cursor.index < value.length) {
    const token = value[cursor.index];
    if (token === '"') {
      cursor.index += 1;
      const parsed: unknown = JSON.parse(value.slice(start, cursor.index));
      if (typeof parsed !== "string") {
        break;
      }
      return parsed;
    }
    cursor.index += token === "\\" ? 2 : 1;
  }
  throw new TypeError("Hosted crypto keyring JSON must be unambiguous.");
}

function requireJsonToken(
  value: string,
  cursor: { index: number },
  expected: string,
): void {
  if (value[cursor.index] !== expected) {
    throw new TypeError("Hosted crypto keyring JSON must be unambiguous.");
  }
  cursor.index += 1;
}

function skipJsonWhitespace(value: string, cursor: { index: number }): void {
  while (
    value[cursor.index] === " "
    || value[cursor.index] === "\n"
    || value[cursor.index] === "\r"
    || value[cursor.index] === "\t"
  ) {
    cursor.index += 1;
  }
}

function assertOneActiveAuthorityVerifyKey(
  keyring: ReadonlyMap<string, HostedAuthorityVerifyKeyringEntry>,
): void {
  const active = [...keyring.values()].filter((entry) => entry.status === "active");
  if (active.length !== 1) {
    throw new TypeError(
      "Hosted authority verify keyring must contain exactly one active key.",
    );
  }
}

function assertAtMostOneActiveRecipientPublicKeyPerRecipient(
  keyring: ReadonlyMap<string, HostedRecipientPublicKeyringEntry>,
): void {
  assertAtMostOneActiveRecipientKey(
    [...keyring.values()].map(({ recipient, status }) => ({ recipient, status })),
  );
}

function assertAtMostOneActiveRecipientPrivateKeyPerRecipient(
  keyring: ReadonlyMap<string, HostedRecipientPrivateKeyringEntry>,
): void {
  assertAtMostOneActiveRecipientKey(
    [...keyring.values()].map(({ recipient, status }) => ({ recipient, status })),
  );
}

function assertAtMostOneActiveRecipientKey(
  entries: Array<{ recipient: HostedCryptoEcdhRecipientKind; status: string }>,
): void {
  const activeByRecipient = new Map<HostedCryptoEcdhRecipientKind, number>();

  for (const entry of entries) {
    if (entry.status !== "active") {
      continue;
    }
    activeByRecipient.set(
      entry.recipient,
      (activeByRecipient.get(entry.recipient) ?? 0) + 1,
    );
  }

  for (const [recipient, count] of activeByRecipient.entries()) {
    if (count > 1) {
      throw new TypeError(
        `Hosted recipient ${recipient} keyring contains multiple active keys.`,
      );
    }
  }
}

function requireAuthorityVerifyKeyStatus(
  value: unknown,
  label: string,
): HostedAuthorityVerifyKeyStatus {
  if (value === "active" || value === "verify_only" || value === "disabled") {
    return value;
  }
  throw new TypeError(`${label} must be active, verify_only, or disabled.`);
}

function requireRecipientPublicKeyStatus(
  value: unknown,
  label: string,
): HostedRecipientPublicKeyStatus {
  if (value === "active" || value === "disabled") {
    return value;
  }
  throw new TypeError(`${label} must be active or disabled.`);
}

function requireRecipientPrivateKeyStatus(
  value: unknown,
  label: string,
): HostedRecipientPrivateKeyStatus {
  if (value === "active" || value === "decrypt_only" || value === "disabled") {
    return value;
  }
  throw new TypeError(`${label} must be active, decrypt_only, or disabled.`);
}

function requireHostedCryptoEcdhRecipientKind(
  value: unknown,
  label: string,
): HostedCryptoEcdhRecipientKind {
  if (
    value === "cloudflare-automation-secret"
    || value === "tee-runtime-attested"
    || value === "recovery-offline"
  ) {
    return value;
  }
  throw new TypeError(`${label} must be a hosted ECDH recipient kind.`);
}

function normalizePem(value: unknown, label: string): string {
  return requireNonEmptyString(value, label).replace(/\\n/g, "\n");
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
