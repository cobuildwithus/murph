export const HOSTED_GROUP_START_PATH = "/groups/start";

const HOSTED_GROUP_START_HANDOFF_STORAGE_KEY =
  "murph:group-start-handoff:v1";
const HOSTED_GROUP_START_HANDOFF_TTL_MS = 30 * 60 * 1_000;

type HostedGroupStartHandoffStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

export function armHostedGroupStartHandoff(input: {
  now?: Date;
  storage?: HostedGroupStartHandoffStorage | null;
} = {}): void {
  const storage = input.storage ?? readHostedGroupStartSessionStorage();
  const now = input.now ?? new Date();
  if (!storage || Number.isNaN(now.getTime())) {
    return;
  }

  try {
    storage.setItem(
      HOSTED_GROUP_START_HANDOFF_STORAGE_KEY,
      JSON.stringify({
        expiresAt: new Date(
          now.getTime() + HOSTED_GROUP_START_HANDOFF_TTL_MS,
        ).toISOString(),
        version: 1,
      }),
    );
  } catch {
    // The handoff is a convenience. Browser storage policy must never block
    // authentication or onboarding.
  }
}

export function consumeHostedGroupStartHandoff(input: {
  now?: Date;
  storage?: HostedGroupStartHandoffStorage | null;
} = {}): boolean {
  const storage = input.storage ?? readHostedGroupStartSessionStorage();
  const now = input.now ?? new Date();
  if (!storage || Number.isNaN(now.getTime())) {
    return false;
  }

  let raw: string | null = null;
  try {
    raw = storage.getItem(HOSTED_GROUP_START_HANDOFF_STORAGE_KEY);
    storage.removeItem(HOSTED_GROUP_START_HANDOFF_STORAGE_KEY);
  } catch {
    return false;
  }
  if (!raw) {
    return false;
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || typeof record.expiresAt !== "string") {
      return false;
    }
    const expiresAt = new Date(record.expiresAt);
    return !Number.isNaN(expiresAt.getTime()) && expiresAt > now;
  } catch {
    return false;
  }
}

export function clearHostedGroupStartHandoff(input: {
  storage?: HostedGroupStartHandoffStorage | null;
} = {}): void {
  const storage = input.storage ?? readHostedGroupStartSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(HOSTED_GROUP_START_HANDOFF_STORAGE_KEY);
  } catch {
    // Best effort for browsers that block storage.
  }
}

function readHostedGroupStartSessionStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
