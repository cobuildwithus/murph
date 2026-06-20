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

export interface HostedAssistantCapabilityEnvProjectionInput {
  capabilityIds?: readonly HostedAssistantCapabilityId[];
  owner?: HostedAssistantCapabilityEnvOwner;
  surface?: HostedAssistantCapabilitySurface;
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
        surfaces: ["codex-shell", "delivery"],
      },
      {
        name: "MURPH_ELEVENLABS_MODEL_ID",
        owner: "forwarded-config",
        surfaces: ["codex-shell", "delivery"],
      },
      {
        name: "MURPH_ELEVENLABS_VOICE_ID",
        owner: "forwarded-config",
        surfaces: ["codex-shell", "delivery"],
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

export function findHostedAssistantCapability(
  id: string,
): HostedAssistantCapability | null {
  for (const capability of HOSTED_ASSISTANT_CAPABILITIES) {
    if (capability.id === id) {
      return capability;
    }
  }
  return null;
}

export function getHostedAssistantCapabilityEnvBindings(
  input: HostedAssistantCapabilityEnvProjectionInput = {},
): HostedAssistantCapabilityEnvBinding[] {
  const capabilityIdSet = input.capabilityIds
    ? new Set<string>(input.capabilityIds)
    : null;
  const bindings: HostedAssistantCapabilityEnvBinding[] = [];
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
      bindings.push({
        name: binding.name,
        owner: binding.owner,
        surfaces: [...binding.surfaces],
      });
    }
  }

  return bindings;
}

export function getHostedAssistantCapabilityEnvNames(
  input: HostedAssistantCapabilityEnvProjectionInput = {},
): string[] {
  return getHostedAssistantCapabilityEnvBindings(input).map((binding) => binding.name);
}

export function isHostedAssistantCapabilityId(
  value: string,
): value is HostedAssistantCapabilityId {
  return findHostedAssistantCapability(value) !== null;
}
