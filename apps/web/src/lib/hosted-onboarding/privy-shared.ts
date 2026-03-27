import { normalizePhoneNumber } from "./phone";

export interface HostedPrivyPhoneAccount {
  number: string;
  verifiedAt: number;
}

export interface HostedPrivyWalletAccount {
  address: string;
  chainType: string | null;
  id: string | null;
  type: string;
}

export interface HostedPrivyIdentityPayload {
  custom_metadata?: unknown;
  linked_accounts?: string | unknown[];
  sub?: unknown;
}

export interface HostedPrivyIdentityTokenData {
  linkedAccounts: PrivyLinkedAccountLike[];
  payload: HostedPrivyIdentityPayload;
  subject: string | null;
}

export interface PrivyLinkedAccountLike extends Record<string, unknown> {
  type?: unknown;
}

export function parseHostedPrivyIdentityToken(identityToken: string): HostedPrivyIdentityTokenData {
  const trimmed = identityToken.trim();
  const parts = trimmed.split(".");

  if (parts.length !== 3) {
    throw new TypeError("Privy identity token must be a JWT.");
  }

  const payload = decodeJwtPayload(parts[1]);
  const linkedAccounts = parseLinkedAccounts(payload.linked_accounts);
  const subject = typeof payload.sub === "string" && payload.sub.trim() ? payload.sub.trim() : null;

  return {
    linkedAccounts,
    payload,
    subject,
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
    const verifiedAt = firstNumber(account, ["latest_verified_at", "verified_at", "first_verified_at"]);

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

export function extractHostedPrivyWalletAccount(
  linkedAccounts: readonly PrivyLinkedAccountLike[],
  preferredChainType: string | null = "ethereum",
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
        connectorType === "embedded" &&
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
  }

  return walletAccounts[0] ?? null;
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

function decodeJwtPayload(segment: string): HostedPrivyIdentityPayload {
  const decoded = decodeBase64UrlUtf8(segment);
  const parsed = JSON.parse(decoded);

  if (!parsed || typeof parsed !== "object") {
    throw new TypeError("Privy identity token payload must be a JSON object.");
  }

  return parsed as HostedPrivyIdentityPayload;
}

function decodeBase64UrlUtf8(value: string): string {
  const normalizedValue = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const paddedValue = normalizedValue.padEnd(Math.ceil(normalizedValue.length / 4) * 4, "=");

  if (typeof window !== "undefined" && typeof window.atob === "function") {
    const binary = window.atob(paddedValue);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  return Buffer.from(paddedValue, "base64").toString("utf8");
}

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
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

function hasAnyKey(record: Record<string, unknown>, keys: readonly string[]): boolean {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return true;
    }
  }

  return false;
}
