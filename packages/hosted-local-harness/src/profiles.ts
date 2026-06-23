export type HostedLocalProfileName =
  | "dev"
  | "worker-only"
  | "e2e:stub"
  | "e2e:live";

export type HostedLocalProfileMode = "dev" | "test" | "debug";

export interface HostedLocalProfile {
  description: string;
  envDefaults: NodeJS.ProcessEnv;
  mode: HostedLocalProfileMode;
  name: HostedLocalProfileName;
}

export const hostedLocalProfiles: Record<HostedLocalProfileName, HostedLocalProfile> = {
  dev: {
    description:
      "Interactive hosted local stack using the production-shaped runner-container Codex app-server path.",
    envDefaults: {},
    mode: "dev",
    name: "dev",
  },
  "worker-only": {
    description:
      "Cloudflare worker/container lane only. Useful when apps/web is already running or intentionally disabled.",
    envDefaults: {
      MURPH_DEV_SKIP_WEB: "1",
    },
    mode: "debug",
    name: "worker-only",
  },
  "e2e:stub": {
    description:
      "Hosted-local E2E with deterministic local stubs and no live assistant provider, Stripe listener, or Vercel pull.",
    envDefaults: {
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "250",
      MURPH_DEV_TEMPORAL: "managed",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "0",
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
      MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
      MURPH_DEV_SKIP_VERCEL_PULL: "1",
      MURPH_E2E_ASSISTANT_PROVIDER_MODE: "stub",
      NODE_ENV: "test",
      TEMPORAL_DEV_HEADLESS: "1",
      VITEST: "1",
    },
    mode: "test",
    name: "e2e:stub",
  },
  "e2e:live": {
    description:
      "Hosted-local E2E using explicit live/test provider credentials supplied by the caller.",
    envDefaults: {
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "250",
      MURPH_DEV_TEMPORAL: "managed",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "0",
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
      MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
      MURPH_DEV_SKIP_VERCEL_PULL: "1",
      MURPH_E2E_ASSISTANT_PROVIDER_MODE: "live",
      NODE_ENV: "test",
      TEMPORAL_DEV_HEADLESS: "1",
      VITEST: "1",
    },
    mode: "test",
    name: "e2e:live",
  },
};

export function listHostedLocalProfiles(): HostedLocalProfile[] {
  return Object.values(hostedLocalProfiles);
}

export function resolveHostedLocalProfile(
  rawName: string | null | undefined,
): HostedLocalProfile {
  const name = (rawName?.trim() || "dev") as HostedLocalProfileName;
  const profile = hostedLocalProfiles[name];
  if (!profile) {
    throw new Error(
      [
        `Unsupported hosted-local profile: ${JSON.stringify(rawName)}`,
        `Supported profiles: ${listHostedLocalProfiles()
          .map((entry) => entry.name)
          .join(", ")}`,
      ].join("\n"),
    );
  }
  return profile;
}

export function applyHostedLocalProfile(input: {
  env: NodeJS.ProcessEnv;
  profileName?: string | null;
}): { env: NodeJS.ProcessEnv; profile: HostedLocalProfile } {
  const profile = resolveHostedLocalProfile(input.profileName);
  const env: NodeJS.ProcessEnv = {
    ...profile.envDefaults,
    ...input.env,
    MURPH_HOSTED_LOCAL_PROFILE: profile.name,
  };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete env[key];
    }
  }

  return { env, profile };
}
