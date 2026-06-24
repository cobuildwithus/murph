export const HOSTED_LOCAL_CODEX_SUBSCRIPTION_HOST_AUTH_MODE = "chatgpt";
export const HOSTED_LOCAL_CODEX_SUBSCRIPTION_SEED_AUTH_MODE = "chatgptAuthTokens";

export interface HostedLocalCodexSubscriptionHostAuth {
  OPENAI_API_KEY?: null;
  auth_mode: typeof HOSTED_LOCAL_CODEX_SUBSCRIPTION_HOST_AUTH_MODE;
  last_refresh: string;
  tokens: {
    access_token: string;
    account_id: string;
    id_token: string;
    refresh_token: string;
  };
}

export interface HostedLocalCodexSubscriptionSeedAuth {
  OPENAI_API_KEY: null;
  auth_mode: typeof HOSTED_LOCAL_CODEX_SUBSCRIPTION_SEED_AUTH_MODE;
  last_refresh: string;
  tokens: {
    access_token: string;
    account_id: string;
    id_token: string;
    refresh_token: "";
  };
}

export function parseHostedLocalCodexSubscriptionHostAuth(
  value: unknown,
): HostedLocalCodexSubscriptionHostAuth {
  const root = readObject(value, "auth");
  if (root.OPENAI_API_KEY !== undefined && root.OPENAI_API_KEY !== null) {
    throw new Error("auth.OPENAI_API_KEY must be absent or null for ChatGPT subscription auth.");
  }

  const authMode = readRequiredString(root, "auth.auth_mode", "auth_mode");
  if (authMode !== HOSTED_LOCAL_CODEX_SUBSCRIPTION_HOST_AUTH_MODE) {
    throw new Error(
      `auth.auth_mode must be ${HOSTED_LOCAL_CODEX_SUBSCRIPTION_HOST_AUTH_MODE}.`,
    );
  }

  const lastRefresh = readRequiredTimestamp(root, "auth.last_refresh", "last_refresh");
  const tokens = readObject(root.tokens, "auth.tokens");
  const refreshToken = readRequiredString(
    tokens,
    "auth.tokens.refresh_token",
    "refresh_token",
  );
  if (refreshToken.length === 0) {
    throw new Error("auth.tokens.refresh_token must be non-empty for host auth.");
  }

  return {
    ...(root.OPENAI_API_KEY === null ? { OPENAI_API_KEY: null } : {}),
    auth_mode: HOSTED_LOCAL_CODEX_SUBSCRIPTION_HOST_AUTH_MODE,
    last_refresh: lastRefresh,
    tokens: {
      access_token: readRequiredString(
        tokens,
        "auth.tokens.access_token",
        "access_token",
      ),
      account_id: readRequiredString(tokens, "auth.tokens.account_id", "account_id"),
      id_token: readRequiredJsonJwtString(tokens, "auth.tokens.id_token", "id_token"),
      refresh_token: refreshToken,
    },
  };
}

export function buildHostedLocalCodexSubscriptionSeedAuth(
  hostAuth: unknown,
): HostedLocalCodexSubscriptionSeedAuth {
  const parsed = parseHostedLocalCodexSubscriptionHostAuth(hostAuth);

  return {
    OPENAI_API_KEY: null,
    auth_mode: HOSTED_LOCAL_CODEX_SUBSCRIPTION_SEED_AUTH_MODE,
    last_refresh: parsed.last_refresh,
    tokens: {
      access_token: parsed.tokens.access_token,
      account_id: parsed.tokens.account_id,
      id_token: parsed.tokens.id_token,
      refresh_token: "",
    },
  };
}

export function parseHostedLocalCodexSubscriptionSeedAuth(
  value: unknown,
): HostedLocalCodexSubscriptionSeedAuth {
  const root = readObject(value, "seed auth");
  if (root.OPENAI_API_KEY !== null) {
    throw new Error("seed auth.OPENAI_API_KEY must be null.");
  }

  const authMode = readRequiredString(root, "seed auth.auth_mode", "auth_mode");
  if (authMode !== HOSTED_LOCAL_CODEX_SUBSCRIPTION_SEED_AUTH_MODE) {
    throw new Error(
      `seed auth.auth_mode must be ${HOSTED_LOCAL_CODEX_SUBSCRIPTION_SEED_AUTH_MODE}.`,
    );
  }

  const lastRefresh = readRequiredTimestamp(
    root,
    "seed auth.last_refresh",
    "last_refresh",
  );
  const tokens = readObject(root.tokens, "seed auth.tokens");
  const refreshToken = tokens.refresh_token;
  if (typeof refreshToken !== "string") {
    throw new Error("seed auth.tokens.refresh_token must be a string.");
  }
  if (refreshToken !== "") {
    throw new Error("seed auth.tokens.refresh_token must be empty.");
  }

  return {
    OPENAI_API_KEY: null,
    auth_mode: HOSTED_LOCAL_CODEX_SUBSCRIPTION_SEED_AUTH_MODE,
    last_refresh: lastRefresh,
    tokens: {
      access_token: readRequiredString(
        tokens,
        "seed auth.tokens.access_token",
        "access_token",
      ),
      account_id: readRequiredString(
        tokens,
        "seed auth.tokens.account_id",
        "account_id",
      ),
      id_token: readRequiredJsonJwtString(
        tokens,
        "seed auth.tokens.id_token",
        "id_token",
      ),
      refresh_token: "",
    },
  };
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readRequiredString(
  record: Record<string, unknown>,
  label: string,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function readRequiredTimestamp(
  record: Record<string, unknown>,
  label: string,
  key: string,
): string {
  const value = readRequiredString(record, label, key);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${label} must be an RFC3339 UTC timestamp.`);
  }

  return value;
}

function readRequiredJsonJwtString(
  record: Record<string, unknown>,
  label: string,
  key: string,
): string {
  const value = readRequiredString(record, label, key);
  const segments = value.split(".");
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
    throw new Error(`${label} must be a JWT with a JSON object payload.`);
  }

  try {
    const payload: unknown = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    );
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new Error("payload must be an object");
    }
  } catch {
    throw new Error(`${label} must be a JWT with a JSON object payload.`);
  }

  return value;
}
