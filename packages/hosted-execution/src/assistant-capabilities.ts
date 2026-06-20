export type HostedAssistantCapabilityEnvOwner =
  | "forwarded-config"
  | "platform"
  | "worker-secret";

export type HostedAssistantCapabilitySurface =
  | "codex-process"
  | "codex-shell"
  | "delivery";

export interface HostedAssistantCapabilityEnvBinding {
  name: string;
  owner: HostedAssistantCapabilityEnvOwner;
  surfaces: readonly HostedAssistantCapabilitySurface[];
}

export interface HostedAssistantCapability {
  env: readonly HostedAssistantCapabilityEnvBinding[];
  id: string;
}

export const HOSTED_ASSISTANT_CAPABILITY_IDS = {
  elevenLabsTts: "elevenlabs.tts",
  exaSearch: "exa.search",
  linqDelivery: "linq.delivery",
  mapboxRoutes: "mapbox.routes",
  telegramDelivery: "telegram.delivery",
  whatsappDelivery: "whatsapp.delivery",
} as const;

export type HostedAssistantCapabilityId =
  (typeof HOSTED_ASSISTANT_CAPABILITY_IDS)[keyof typeof HOSTED_ASSISTANT_CAPABILITY_IDS];

export const HOSTED_ASSISTANT_CAPABILITIES = [
  {
    id: HOSTED_ASSISTANT_CAPABILITY_IDS.elevenLabsTts,
    env: [
      {
        name: "ELEVENLABS_API_KEY",
        owner: "worker-secret",
        surfaces: ["delivery"],
      },
      {
        name: "MURPH_ELEVENLABS_MODEL_ID",
        owner: "forwarded-config",
        surfaces: ["delivery"],
      },
      {
        name: "MURPH_ELEVENLABS_VOICE_ID",
        owner: "forwarded-config",
        surfaces: ["delivery"],
      },
    ],
  },
  {
    id: HOSTED_ASSISTANT_CAPABILITY_IDS.exaSearch,
    env: [
      {
        name: "EXA_API_KEY",
        owner: "worker-secret",
        surfaces: ["codex-shell"],
      },
    ],
  },
  {
    id: HOSTED_ASSISTANT_CAPABILITY_IDS.mapboxRoutes,
    env: [
      {
        name: "MAPBOX_ACCESS_TOKEN",
        owner: "worker-secret",
        surfaces: ["codex-shell"],
      },
    ],
  },
  {
    id: HOSTED_ASSISTANT_CAPABILITY_IDS.linqDelivery,
    env: [
      {
        name: "LINQ_ATTACHMENT_CDN_BASE_URL",
        owner: "forwarded-config",
        surfaces: ["delivery"],
      },
      {
        name: "LINQ_API_BASE_URL",
        owner: "forwarded-config",
        surfaces: ["delivery"],
      },
      {
        name: "LINQ_API_TOKEN",
        owner: "worker-secret",
        surfaces: ["delivery"],
      },
    ],
  },
  {
    id: HOSTED_ASSISTANT_CAPABILITY_IDS.telegramDelivery,
    env: [
      {
        name: "TELEGRAM_API_BASE_URL",
        owner: "forwarded-config",
        surfaces: ["delivery"],
      },
      {
        name: "TELEGRAM_BOT_TOKEN",
        owner: "worker-secret",
        surfaces: ["delivery"],
      },
      {
        name: "TELEGRAM_BOT_USERNAME",
        owner: "forwarded-config",
        surfaces: ["delivery"],
      },
      {
        name: "TELEGRAM_FILE_BASE_URL",
        owner: "forwarded-config",
        surfaces: ["delivery"],
      },
    ],
  },
  {
    id: HOSTED_ASSISTANT_CAPABILITY_IDS.whatsappDelivery,
    env: [
      {
        name: "WHATSAPP_ACCESS_TOKEN",
        owner: "worker-secret",
        surfaces: ["delivery"],
      },
      {
        name: "WHATSAPP_API_BASE_URL",
        owner: "forwarded-config",
        surfaces: ["delivery"],
      },
      {
        name: "WHATSAPP_GRAPH_VERSION",
        owner: "forwarded-config",
        surfaces: ["delivery"],
      },
      {
        name: "WHATSAPP_PHONE_NUMBER_ID",
        owner: "worker-secret",
        surfaces: ["delivery"],
      },
    ],
  },
] as const satisfies readonly HostedAssistantCapability[];

export const HOSTED_ASSISTANT_DYNAMIC_TOOL_CAPABILITY_IDS = {
  "murph.generate_voice_memo": [
    HOSTED_ASSISTANT_CAPABILITY_IDS.elevenLabsTts,
  ],
} as const satisfies Record<string, readonly HostedAssistantCapabilityId[]>;

interface HostedAssistantCapabilityEnvProjection {
  capabilityIds?: readonly HostedAssistantCapabilityId[];
  owner?: HostedAssistantCapabilityEnvOwner;
  surface?: HostedAssistantCapabilitySurface;
}

function collectHostedAssistantCapabilityEnvNames(
  input: HostedAssistantCapabilityEnvProjection = {},
): readonly string[] {
  const capabilityIdSet = input.capabilityIds
    ? new Set<string>(input.capabilityIds)
    : null;
  const names: string[] = [];
  const seen = new Set<string>();

  for (const capability of HOSTED_ASSISTANT_CAPABILITIES) {
    if (capabilityIdSet && !capabilityIdSet.has(capability.id)) {
      continue;
    }

    for (const binding of capability.env) {
      if (input.owner && binding.owner !== input.owner) {
        continue;
      }
      const surfaces: readonly HostedAssistantCapabilitySurface[] = binding.surfaces;
      if (input.surface && !surfaces.includes(input.surface)) {
        continue;
      }
      if (seen.has(binding.name)) {
        continue;
      }
      seen.add(binding.name);
      names.push(binding.name);
    }
  }

  return Object.freeze(names);
}

export const HOSTED_ASSISTANT_WORKER_SECRET_ENV_NAMES =
  collectHostedAssistantCapabilityEnvNames({ owner: "worker-secret" });

export const HOSTED_ASSISTANT_FORWARDED_CONFIG_ENV_NAMES =
  collectHostedAssistantCapabilityEnvNames({ owner: "forwarded-config" });

export const HOSTED_ASSISTANT_CODEX_SHELL_ENV_NAMES =
  collectHostedAssistantCapabilityEnvNames({ surface: "codex-shell" });

export const HOSTED_ELEVENLABS_TTS_ENV_NAMES =
  collectHostedAssistantCapabilityEnvNames({
    capabilityIds: [HOSTED_ASSISTANT_CAPABILITY_IDS.elevenLabsTts],
    surface: "delivery",
  });

export const HOSTED_EXA_SEARCH_CODEX_SHELL_ENV_NAMES =
  collectHostedAssistantCapabilityEnvNames({
    capabilityIds: [HOSTED_ASSISTANT_CAPABILITY_IDS.exaSearch],
    surface: "codex-shell",
  });

export const HOSTED_MAPBOX_ROUTES_CODEX_SHELL_ENV_NAMES =
  collectHostedAssistantCapabilityEnvNames({
    capabilityIds: [HOSTED_ASSISTANT_CAPABILITY_IDS.mapboxRoutes],
    surface: "codex-shell",
  });

export const HOSTED_LINQ_DELIVERY_ENV_NAMES =
  collectHostedAssistantCapabilityEnvNames({
    capabilityIds: [HOSTED_ASSISTANT_CAPABILITY_IDS.linqDelivery],
    surface: "delivery",
  });

export const HOSTED_TELEGRAM_DELIVERY_FORWARDED_ENV_NAMES =
  collectHostedAssistantCapabilityEnvNames({
    capabilityIds: [HOSTED_ASSISTANT_CAPABILITY_IDS.telegramDelivery],
    owner: "forwarded-config",
    surface: "delivery",
  });

export const HOSTED_WHATSAPP_DELIVERY_FORWARDED_ENV_NAMES =
  collectHostedAssistantCapabilityEnvNames({
    capabilityIds: [HOSTED_ASSISTANT_CAPABILITY_IDS.whatsappDelivery],
    owner: "forwarded-config",
    surface: "delivery",
  });
