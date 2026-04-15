/**
 * Cloudflare workers expose string env vars alongside non-string service bindings.
 * Config readers should consume a string-only view instead of depending on casts.
 */
export type StringEnvSource = Readonly<Record<string, string | undefined>>;

export function toStringEnvSource(source: Readonly<Record<string, unknown>>): StringEnvSource {
  const values: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(source)) {
    values[key] = typeof value === "string" ? value : undefined;
  }

  return values;
}
