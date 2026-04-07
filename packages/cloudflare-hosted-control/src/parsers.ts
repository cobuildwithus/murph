import type {
  CloudflareHostedManagedUserCryptoStatus,
  CloudflareHostedUserEnvStatus,
  CloudflareHostedUserEnvUpdate,
} from "./contracts.ts";

export function parseCloudflareHostedManagedUserCryptoStatus(
  value: unknown,
): CloudflareHostedManagedUserCryptoStatus {
  const record = requireObject(value, "Managed user crypto status response");
  const recipientKinds = requireArray(
    record.recipientKinds,
    "Managed user crypto status response recipientKinds",
  ).map((entry, index) =>
    requireString(
      entry,
      `Managed user crypto status response recipientKinds[${index}]`,
    )
  );

  return {
    recipientKinds,
    rootKeyId: requireString(record.rootKeyId, "Managed user crypto status response rootKeyId"),
    userId: requireString(record.userId, "Managed user crypto status response userId"),
  };
}

export function parseCloudflareHostedUserEnvStatus(value: unknown): CloudflareHostedUserEnvStatus {
  const record = requireObject(value, "Hosted execution user env status");

  return {
    configuredUserEnvKeys: requireArray(
      record.configuredUserEnvKeys,
      "Hosted execution user env status configuredUserEnvKeys",
    ).map((entry, index) =>
      requireString(
        entry,
        `Hosted execution user env status configuredUserEnvKeys[${index}]`,
      )
    ),
    userId: requireString(record.userId, "Hosted execution user env status userId"),
  };
}

export function parseCloudflareHostedUserEnvUpdate(value: unknown): CloudflareHostedUserEnvUpdate {
  const record = requireObject(value, "Hosted execution user env update");
  const mode = requireString(record.mode, "Hosted execution user env update mode");

  if (mode !== "merge" && mode !== "replace") {
    throw new TypeError("Hosted execution user env update mode is invalid.");
  }

  const env = requireObject(record.env, "Hosted execution user env update env");

  return {
    env: Object.fromEntries(Object.entries(env).map(([key, entry]) => {
      if (entry !== null && typeof entry !== "string") {
        throw new TypeError(`Hosted execution user env update env.${key} must be a string or null.`);
      }

      return [key, entry];
    })),
    mode,
  };
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}
