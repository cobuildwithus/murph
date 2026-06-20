import { describe, expect, it } from "vitest";

import {
  findHostedAssistantCapability,
  getHostedAssistantCapabilityEnvBindings,
  getHostedAssistantCapabilityEnvNames,
  HOSTED_ASSISTANT_CAPABILITIES,
  HOSTED_ASSISTANT_CAPABILITY_IDS,
  HOSTED_ASSISTANT_DYNAMIC_TOOL_CAPABILITY_IDS,
  isHostedAssistantCapabilityId,
} from "../src/assistant-capabilities.ts";

describe("hosted assistant capabilities", () => {
  it("declares each env name once with one owner and explicit surfaces", () => {
    const ownersByEnv = new Map<string, string>();

    for (const capability of HOSTED_ASSISTANT_CAPABILITIES) {
      expect(capability.id).toBeTruthy();
      expect(capability.env.length).toBeGreaterThan(0);

      for (const binding of capability.env) {
        expect(binding.name).toMatch(/^[A-Z][A-Z0-9_]*$/u);
        expect(binding.owner).toMatch(/^(forwarded-config|platform|worker-secret)$/u);
        expect(binding.surfaces.length).toBeGreaterThan(0);
        for (const surface of binding.surfaces) {
          expect(surface).toMatch(/^(codex-process|codex-shell|delivery)$/u);
        }

        const existingOwner = ownersByEnv.get(binding.name);
        if (existingOwner !== undefined) {
          throw new Error(
            `${binding.name} is declared by more than one capability owner (${existingOwner}, ${binding.owner})`,
          );
        }
        ownersByEnv.set(binding.name, binding.owner);
      }
    }
  });

  it("projects provider env names by owner, surface, and capability id", () => {
    expect(getHostedAssistantCapabilityEnvNames({
      capabilityIds: [HOSTED_ASSISTANT_CAPABILITY_IDS.elevenLabsTts],
    })).toEqual([
      "ELEVENLABS_API_KEY",
      "MURPH_ELEVENLABS_MODEL_ID",
      "MURPH_ELEVENLABS_VOICE_ID",
    ]);

    expect(getHostedAssistantCapabilityEnvNames({
      owner: "worker-secret",
      surface: "codex-shell",
    })).toEqual([
      "ELEVENLABS_API_KEY",
      "EXA_API_KEY",
      "MAPBOX_ACCESS_TOKEN",
    ]);

    expect(getHostedAssistantCapabilityEnvBindings({
      capabilityIds: [HOSTED_ASSISTANT_CAPABILITY_IDS.telegramDelivery],
      owner: "forwarded-config",
      surface: "delivery",
    }).map((binding) => binding.name)).toEqual([
      "TELEGRAM_API_BASE_URL",
      "TELEGRAM_BOT_USERNAME",
      "TELEGRAM_FILE_BASE_URL",
    ]);
  });

  it("resolves every dynamic-tool capability id", () => {
    for (const [toolName, capabilityIds] of Object.entries(
      HOSTED_ASSISTANT_DYNAMIC_TOOL_CAPABILITY_IDS,
    )) {
      expect(toolName).toMatch(/^murph\.[a-z_]+$/u);
      for (const capabilityId of capabilityIds) {
        expect(isHostedAssistantCapabilityId(capabilityId)).toBe(true);
        expect(findHostedAssistantCapability(capabilityId)).not.toBeNull();
      }
    }

    expect(isHostedAssistantCapabilityId("missing.provider")).toBe(false);
    expect(findHostedAssistantCapability("missing.provider")).toBeNull();
  });
});
