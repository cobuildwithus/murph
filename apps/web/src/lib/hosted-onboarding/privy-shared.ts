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
  for (const account of linkedAccounts) {
    if (!account || account.type !== "phone") {
      continue;
    }

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
      continue;
    }

    return {
      number: normalizedNumber,
      verifiedAt,
    };
  }

  return null;
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
  let bestMatch: (HostedPrivyEmailAccount & { verifiedAt: number }) | null = null;

  for (const account of linkedAccounts) {
    if (!account || account.type !== "email") {
      continue;
    }

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
      continue;
    }

    if (!bestMatch || verifiedAt > bestMatch.verifiedAt) {
      bestMatch = {
        address,
        verifiedAt,
      };
    }
  }

  return bestMatch;
}

export function extractHostedPrivyTelegramAccount(
  input: HostedPrivyLinkedAccountContainer | null | undefined,
): HostedPrivyTelegramAccount | null {
  if (input?.telegram && typeof input.telegram === "object" && !Array.isArray(input.telegram)) {
    const directAccount = coerceHostedPrivyTelegramAccount(input.telegram as Record<string, unknown>);

    if (directAccount) {
      return directAccount;
    }
  }

  const linkedAccounts = resolveHostedPrivyLinkedAccounts(input);

  for (const account of linkedAccounts) {
    if (!account || account.type !== "telegram") {
      continue;
    }

    const telegramAccount = coerceHostedPrivyTelegramAccount(account);

    if (telegramAccount) {
      return telegramAccount;
    }
  }

  return null;
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
      } satisfies HostedPrivyWalletAccount;
    })
    .filter((account): account is HostedPrivyWalletAccount => Boolean(account));

  if (walletAccounts.length === 0) {
    return null;
  }

  if (preferredChainType) {
    const preferred = walletAccounts.find((account) => account.chainType === preferredChainType);

    if (preferred) {
      return preferred;
    }

    return null;
  }

  return walletAccounts[0] ?? null;
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
