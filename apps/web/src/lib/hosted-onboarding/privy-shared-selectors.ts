import { normalizePhoneNumber } from "./phone";

import {
  firstNumberishString,
  firstString,
  firstTimestamp,
  parseLinkedAccounts,
  preferLongerString,
  selectNewestTimestampedCandidate,
} from "./privy-shared-helpers";
import {
  type HostedPrivyEmailAccount,
  type HostedPrivyLinkedAccountContainer,
  type HostedPrivyLinkedAccountState,
  type HostedPrivyPhoneAccount,
  type HostedPrivyTelegramAccount,
  type HostedPrivyTelegramAccountSelection,
  type PrivyLinkedAccountLike,
} from "./privy-shared-types";

const PRIVY_VERIFIED_AT_KEYS = [
  "latest_verified_at",
  "verified_at",
  "first_verified_at",
  "latestVerifiedAt",
  "verifiedAt",
  "firstVerifiedAt",
  "lv",
] as const;

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
): HostedPrivyLinkedAccountState {
  const linkedAccounts = resolveHostedPrivyLinkedAccounts(input);

  return {
    linkedAccounts,
    phone: extractHostedPrivyPhoneAccount(linkedAccounts),
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
      const verifiedAt = firstTimestamp(account, PRIVY_VERIFIED_AT_KEYS);

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
      verifiedAt: firstTimestamp(account, PRIVY_VERIFIED_AT_KEYS),
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
      const verifiedAt = firstTimestamp(account, PRIVY_VERIFIED_AT_KEYS);

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
