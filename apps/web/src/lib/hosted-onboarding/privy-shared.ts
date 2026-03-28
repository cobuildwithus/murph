import { normalizePhoneNumber } from "./phone";

export const HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE = "ethereum" as const;
export const HOSTED_PRIVY_WALLET_CHAIN_APPEARANCE = `${HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE}-only` as const;
export const HOSTED_PRIVY_EMBEDDED_WALLET_CONNECTOR_TYPE = "embedded" as const;
export const HOSTED_PRIVY_EMBEDDED_WALLET_CREATE_ON_LOGIN = "users-without-wallets" as const;
export const HOSTED_PRIVY_SHOW_WALLET_UIS = false as const;

export interface HostedPrivyPhoneAccount {
  number: string;
  verifiedAt: number;
}

export interface HostedPrivyEmailAccount {
  address: string;
  verifiedAt: number | null;
}

export interface HostedPrivyTelegramAccount {
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  telegramUserId: string;
  username: string | null;
}

export interface HostedPrivyWalletAccount {
  address: string;
  chainType: string | null;
  id: string | null;
  type: string;
}

export interface HostedPrivyTelegramAccountSelection {
  account: HostedPrivyTelegramAccount | null;
  ambiguous: boolean;
}

export interface HostedPrivyLinkedAccountContainer {
  linkedAccounts?: unknown;
  linked_accounts?: unknown;
  telegram?: unknown;
}

export interface HostedPrivyLinkedAccountState {
  linkedAccounts: PrivyLinkedAccountLike[];
  phone: HostedPrivyPhoneAccount | null;
  wallet: HostedPrivyWalletAccount | null;
}

export interface PrivyLinkedAccountLike extends Record<string, unknown> {
  type?: unknown;
}

export function resolveHostedPrivyLinkedAccounts(
  input: HostedPrivyLinkedAccountContainer | null | undefined,
): PrivyLinkedAccountLike[] {
  if (!input || typeof input !== "object") {
    return [];
  }

  return parseLinkedAccounts(input.linkedAccounts ?? input.linked_accounts);
}

export function resolveHostedPrivyLinkedAccountState(
  input: HostedPrivyLinkedAccountContainer | null | undefined,
  preferredChainType: string | null = HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE,
): HostedPrivyLinkedAccountState {
  const linkedAccounts = resolveHostedPrivyLinkedAccounts(input);

  return {
    linkedAccounts,
    phone: extractHostedPrivyPhoneAccount(linkedAccounts),
    wallet: extractHostedPrivyWalletAccount(linkedAccounts, preferredChainType),
  };
}

export function extractHostedPrivyPhoneAccount(
  linkedAccounts: readonly PrivyLinkedAccountLike[],
): HostedPrivyPhoneAccount | null {
  const candidates = linkedAccounts
    .filter((account): account is PrivyLinkedAccountLike => Boolean(account) && account.type === "phone")
    .map((account) => {
      const rawNumber = firstString(account, ["phone_number", "number", "phoneNumber", "address"]);
      const normalizedNumber = normalizePhoneNumber(rawNumber);
      const verifiedAt = firstTimestamp(account, [
        "latest_verified_at",
        "verified_at",
        "first_verified_at",
        "latestVerifiedAt",
        "verifiedAt",
        "firstVerifiedAt",
        "lv",
      ]);

      if (!normalizedNumber || verifiedAt === null) {
        return null;
      }

      return {
        number: normalizedNumber,
        verifiedAt,
      } satisfies HostedPrivyPhoneAccount;
    })
    .filter((account): account is HostedPrivyPhoneAccount => Boolean(account));

  return selectNewestTimestampedCandidate(candidates, (account) => account.number);
}

export function extractHostedPrivyEmailAccount(
  linkedAccounts: readonly PrivyLinkedAccountLike[],
): HostedPrivyEmailAccount | null {
  for (const account of linkedAccounts) {
    if (!account || account.type !== "email") {
      continue;
    }

    const address = firstString(account, ["address", "email_address", "emailAddress", "email"]);

    if (!address) {
      continue;
    }

    return {
      address,
      verifiedAt: firstTimestamp(account, [
        "latest_verified_at",
        "verified_at",
        "first_verified_at",
        "latestVerifiedAt",
        "verifiedAt",
        "firstVerifiedAt",
        "lv",
      ]),
    };
  }

  return null;
}

export function extractHostedPrivyPreferredEmailAccount(
  linkedAccounts: readonly PrivyLinkedAccountLike[],
): HostedPrivyEmailAccount | null {
  return extractHostedPrivyVerifiedEmailAccount(linkedAccounts) ?? extractHostedPrivyEmailAccount(linkedAccounts);
}

export function isHostedPrivyEmailAccountVerified(
  account: HostedPrivyEmailAccount | null | undefined,
): account is HostedPrivyEmailAccount & { verifiedAt: number } {
  return Boolean(account && typeof account.verifiedAt === "number" && Number.isFinite(account.verifiedAt));
}

export function extractHostedPrivyVerifiedEmailAccount(
  linkedAccounts: readonly PrivyLinkedAccountLike[],
): (HostedPrivyEmailAccount & { verifiedAt: number }) | null {
  const candidates = linkedAccounts
    .filter((account): account is PrivyLinkedAccountLike => Boolean(account) && account.type === "email")
    .map((account) => {
      const address = firstString(account, ["address", "email_address", "emailAddress", "email"]);
      const verifiedAt = firstTimestamp(account, [
        "latest_verified_at",
        "verified_at",
        "first_verified_at",
        "latestVerifiedAt",
        "verifiedAt",
        "firstVerifiedAt",
        "lv",
      ]);

      if (!address || verifiedAt === null) {
        return null;
      }

      return {
        address,
        verifiedAt,
      } satisfies HostedPrivyEmailAccount & { verifiedAt: number };
    })
    .filter((account): account is HostedPrivyEmailAccount & { verifiedAt: number } => Boolean(account));

  return selectNewestTimestampedCandidate(candidates, (account) => account.address.toLowerCase());
}

export function extractHostedPrivyTelegramAccount(
  input: HostedPrivyLinkedAccountContainer | null | undefined,
): HostedPrivyTelegramAccount | null {
  return resolveHostedPrivyTelegramAccountSelection(input).account;
}

export function resolveHostedPrivyTelegramAccountSelection(
  input: HostedPrivyLinkedAccountContainer | null | undefined,
): HostedPrivyTelegramAccountSelection {
  const candidates: HostedPrivyTelegramAccount[] = [];

  if (input?.telegram && typeof input.telegram === "object" && !Array.isArray(input.telegram)) {
    const directAccount = coerceHostedPrivyTelegramAccount(input.telegram as Record<string, unknown>);

    if (directAccount) {
      candidates.push(directAccount);
    }
  }

  for (const account of resolveHostedPrivyLinkedAccounts(input)) {
    if (!account || account.type !== "telegram") {
      continue;
    }

    const telegramAccount = coerceHostedPrivyTelegramAccount(account);

    if (telegramAccount) {
      candidates.push(telegramAccount);
    }
  }

  if (candidates.length === 0) {
    return {
      account: null,
      ambiguous: false,
    };
  }

  const mergedByTelegramUserId = new Map<string, HostedPrivyTelegramAccount>();

  for (const candidate of candidates) {
    const existing = mergedByTelegramUserId.get(candidate.telegramUserId);
    mergedByTelegramUserId.set(
      candidate.telegramUserId,
      mergeHostedPrivyTelegramAccounts(existing, candidate),
    );
  }

  if (mergedByTelegramUserId.size !== 1) {
    return {
      account: null,
      ambiguous: true,
    };
  }

  return {
    account: mergedByTelegramUserId.values().next().value ?? null,
    ambiguous: false,
  };
}

export function extractHostedPrivyWalletAccount(
  linkedAccounts: readonly PrivyLinkedAccountLike[],
  preferredChainType: string | null = HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE,
): HostedPrivyWalletAccount | null {
  const walletAccounts = linkedAccounts
    .filter((account): account is PrivyLinkedAccountLike => Boolean(account) && account.type === "wallet")
    .map((account) => {
      const address = firstString(account, ["address"]);
      const chainType = firstString(account, ["chain_type", "chainType"]);
      const connectorType = firstString(account, ["connector_type", "connectorType"]);
      const walletClient = firstString(account, ["wallet_client", "walletClient"]);
      const walletClientType = firstString(account, ["wallet_client_type", "walletClientType"]);
      const hasEmbeddedShape =
        connectorType === HOSTED_PRIVY_EMBEDDED_WALLET_CONNECTOR_TYPE &&
        (walletClient === "privy" ||
          walletClientType === "privy" ||
          hasAnyKey(account, ["wallet_index", "walletIndex", "recovery_method", "recoveryMethod", "imported", "delegated"]));

      if (!address || !hasEmbeddedShape) {
        return null;
      }

      return {
        address,
        chainType,
        id: firstString(account, ["id"]),
        type: "wallet",
        walletIndex: firstInteger(account, ["wallet_index", "walletIndex"]),
        normalizedAddress: address.toLowerCase(),
      };
    })
    .filter((account): account is HostedPrivyWalletAccount & {
      normalizedAddress: string;
      walletIndex: number | null;
    } => Boolean(account));

  if (walletAccounts.length === 0) {
    return null;
  }

  const preferredWalletAccounts = preferredChainType
    ? walletAccounts.filter((account) => account.chainType === preferredChainType)
    : walletAccounts;

  const selectedWallet = selectLowestRankCandidate(
    preferredWalletAccounts,
    (account) => account.normalizedAddress,
    (account) => account.walletIndex ?? Number.MAX_SAFE_INTEGER,
  );

  if (!selectedWallet) {
    return null;
  }

  return {
    address: selectedWallet.address,
    chainType: selectedWallet.chainType,
    id: selectedWallet.id,
    type: selectedWallet.type,
  };
}

function mergeHostedPrivyTelegramAccounts(
  current: HostedPrivyTelegramAccount | undefined,
  next: HostedPrivyTelegramAccount,
): HostedPrivyTelegramAccount {
  if (!current) {
    return next;
  }

  return {
    firstName: preferLongerString(current.firstName, next.firstName),
    lastName: preferLongerString(current.lastName, next.lastName),
    photoUrl: preferLongerString(current.photoUrl, next.photoUrl),
    telegramUserId: current.telegramUserId,
    username: preferLongerString(current.username, next.username),
  };
}

function selectNewestTimestampedCandidate<T extends { verifiedAt: number }>(
  candidates: readonly T[],
  identityKey: (candidate: T) => string,
): T | null {
  if (candidates.length === 0) {
    return null;
  }

  const deduped = new Map<string, T>();

  for (const candidate of candidates) {
    const key = identityKey(candidate);
    const existing = deduped.get(key);

    if (!existing || candidate.verifiedAt > existing.verifiedAt) {
      deduped.set(key, candidate);
    }
  }

  let best: T | null = null;
  let bestKey: string | null = null;

  for (const [key, candidate] of deduped.entries()) {
    if (!best || candidate.verifiedAt > best.verifiedAt) {
      best = candidate;
      bestKey = key;
      continue;
    }

    if (best && candidate.verifiedAt === best.verifiedAt && key !== bestKey) {
      return null;
    }
  }

  return best;
}

function selectLowestRankCandidate<T>(
  candidates: readonly T[],
  identityKey: (candidate: T) => string,
  rank: (candidate: T) => number,
): T | null {
  if (candidates.length === 0) {
    return null;
  }

  const deduped = new Map<string, T>();

  for (const candidate of candidates) {
    const key = identityKey(candidate);
    const existing = deduped.get(key);

    if (!existing || rank(candidate) < rank(existing)) {
      deduped.set(key, candidate);
    }
  }

  let best: T | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  let bestKey: string | null = null;

  for (const [key, candidate] of deduped.entries()) {
    const candidateRank = rank(candidate);

    if (candidateRank < bestRank) {
      best = candidate;
      bestRank = candidateRank;
      bestKey = key;
      continue;
    }

    if (candidateRank === bestRank && key !== bestKey) {
      return null;
    }
  }

  return best;
}

function coerceHostedPrivyTelegramAccount(
  record: Record<string, unknown>,
): HostedPrivyTelegramAccount | null {
  const telegramUserId = firstString(record, ["telegram_user_id", "telegramUserId", "id"])
    ?? firstNumberishString(record, ["telegram_user_id", "telegramUserId", "id"]);

  if (!telegramUserId) {
    return null;
  }

  return {
    firstName: firstString(record, ["first_name", "firstName"]),
    lastName: firstString(record, ["last_name", "lastName"]),
    photoUrl: firstString(record, ["photo_url", "photoUrl"]),
    telegramUserId,
    username: firstString(record, ["username"]),
  };
}

function parseLinkedAccounts(input: unknown): PrivyLinkedAccountLike[] {
  if (Array.isArray(input)) {
    return input.filter((value): value is PrivyLinkedAccountLike => Boolean(value) && typeof value === "object");
  }

  if (typeof input !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is PrivyLinkedAccountLike => Boolean(value) && typeof value === "object")
      : [];
  } catch {
    return [];
  }
}

function firstTimestamp(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return Math.trunc(value.getTime() / 1000);
    }
  }

  return null;
}

function firstInteger(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isInteger(value)) {
      return value;
    }

    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
      return Number.parseInt(value, 10);
    }
  }

  return null;
}

function preferLongerString(current: string | null, next: string | null): string | null {
  if (!current) {
    return next;
  }

  if (!next) {
    return current;
  }

  return next.length > current.length ? next : current;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function firstNumberishString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }

    if (typeof value === "bigint") {
      return String(value);
    }
  }

  return null;
}

function hasAnyKey(record: Record<string, unknown>, keys: readonly string[]): boolean {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return true;
    }
  }

  return false;
}
