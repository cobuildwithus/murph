const HOSTED_PRIVY_CONNECTIONS_STORAGE_KEY = "privy:connections";
const HOSTED_PRIVY_STORAGE_KEYS = {
  caid: "privy:caid",
  idToken: "privy:id_token",
  pat: "privy:pat",
  refreshToken: "privy:refresh_token",
  token: "privy:token",
} as const;

interface HostedPrivyDebugStorageLike {
  getItem(key: string): string | null;
}

export interface HostedPrivySessionStorageSnapshot {
  connectionCount: number | null;
  hasAnyAuthState: boolean;
  hasCaid: boolean | null;
  hasIdToken: boolean | null;
  hasPat: boolean | null;
  hasRefreshToken: boolean | null;
  hasToken: boolean | null;
}

export function hostedPrivySessionDebugEnabled(nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv === "development";
}

export function logHostedPrivySessionDebug(
  event: string,
  details: Record<string, unknown> = {},
): void {
  if (!hostedPrivySessionDebugEnabled()) {
    return;
  }

  console.info("[murph][hosted-privy]", {
    event,
    route: readHostedPrivyDebugRoute(),
    storage: readHostedPrivySessionStorageSnapshot(),
    ...details,
  });
}

export function readHostedPrivySessionStorageSnapshot(
  storage: HostedPrivyDebugStorageLike | null = resolveHostedPrivyDebugStorage(),
): HostedPrivySessionStorageSnapshot {
  if (!storage) {
    return {
      connectionCount: null,
      hasAnyAuthState: false,
      hasCaid: null,
      hasIdToken: null,
      hasPat: null,
      hasRefreshToken: null,
      hasToken: null,
    };
  }

  const hasCaid = hasStoredValue(storage, HOSTED_PRIVY_STORAGE_KEYS.caid);
  const hasToken = hasStoredValue(storage, HOSTED_PRIVY_STORAGE_KEYS.token);
  const hasIdToken = hasStoredValue(storage, HOSTED_PRIVY_STORAGE_KEYS.idToken);
  const hasRefreshToken = hasStoredValue(storage, HOSTED_PRIVY_STORAGE_KEYS.refreshToken);
  const hasPat = hasStoredValue(storage, HOSTED_PRIVY_STORAGE_KEYS.pat);

  return {
    connectionCount: readStoredConnectionCount(storage),
    hasAnyAuthState: hasToken || hasIdToken || hasRefreshToken || hasPat,
    hasCaid,
    hasIdToken,
    hasPat,
    hasRefreshToken,
    hasToken,
  };
}

export function sanitizeHostedPrivyDebugError(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== "object") {
    if (typeof error === "string" && error) {
      return { message: error };
    }

    return null;
  }

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
    status?: unknown;
  };
  const sanitized: Record<string, unknown> = {};

  if (typeof candidate.name === "string" && candidate.name) {
    sanitized.name = candidate.name;
  }

  if (typeof candidate.message === "string" && candidate.message) {
    sanitized.message = candidate.message;
  }

  if (typeof candidate.code === "string" && candidate.code) {
    sanitized.code = candidate.code;
  }

  if (typeof candidate.status === "number") {
    sanitized.status = candidate.status;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

export function sanitizeHostedPrivyDebugPath(path: string): string {
  return path
    .replace(/\/join\/[^/?#]+/g, "/join/[inviteCode]")
    .replace(/\/invites\/[^/?#]+/g, "/invites/[inviteCode]");
}

export function summarizeHostedPrivyLinkedAccounts(user: { linkedAccounts?: unknown; linked_accounts?: unknown } | null): {
  hasUser: boolean;
  linkedAccountCount: number | null;
  linkedAccountTypes: string[];
} {
  const linkedAccounts = readHostedPrivyLinkedAccounts(user);

  return {
    hasUser: Boolean(user),
    linkedAccountCount: linkedAccounts?.length ?? null,
    linkedAccountTypes: linkedAccounts
      ?.map((account) => (typeof account.type === "string" ? account.type : null))
      .filter((value): value is string => Boolean(value))
      ?? [],
  };
}

function hasStoredValue(storage: HostedPrivyDebugStorageLike, key: string): boolean {
  try {
    return Boolean(storage.getItem(key));
  } catch {
    return false;
  }
}

function readHostedPrivyDebugRoute(): string | null {
  if (typeof window === "undefined" || typeof window.location?.pathname !== "string") {
    return null;
  }

  return sanitizeHostedPrivyDebugPath(window.location.pathname);
}

function readStoredConnectionCount(storage: HostedPrivyDebugStorageLike): number | null {
  try {
    const value = storage.getItem(HOSTED_PRIVY_CONNECTIONS_STORAGE_KEY);

    if (!value) {
      return 0;
    }

    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

function resolveHostedPrivyDebugStorage(): HostedPrivyDebugStorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readHostedPrivyLinkedAccounts(
  user: { linkedAccounts?: unknown; linked_accounts?: unknown } | null,
): Array<{ type?: unknown }> | null {
  if (!user || typeof user !== "object") {
    return null;
  }

  if (Array.isArray(user.linkedAccounts)) {
    return user.linkedAccounts as Array<{ type?: unknown }>;
  }

  if (Array.isArray(user.linked_accounts)) {
    return user.linked_accounts as Array<{ type?: unknown }>;
  }

  return null;
}
