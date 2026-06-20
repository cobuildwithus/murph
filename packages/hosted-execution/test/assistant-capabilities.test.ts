import { describe, expect, it } from "vitest";

import {
  HOSTED_ASSISTANT_CODEX_SHELL_ENV_NAMES,
  HOSTED_ASSISTANT_CAPABILITIES,
  HOSTED_ASSISTANT_DYNAMIC_TOOL_CAPABILITY_IDS,
  HOSTED_ELEVENLABS_TTS_ENV_NAMES,
  HOSTED_TELEGRAM_DELIVERY_FORWARDED_ENV_NAMES,
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

  it("exports named provider env projections for runtime boundaries", () => {
    expect(HOSTED_ELEVENLABS_TTS_ENV_NAMES).toEqual([
      "ELEVENLABS_API_KEY",
      "MURPH_ELEVENLABS_MODEL_ID",
      "MURPH_ELEVENLABS_VOICE_ID",
    ]);

    expect(HOSTED_ASSISTANT_CODEX_SHELL_ENV_NAMES).toEqual([
      "EXA_API_KEY",
      "MAPBOX_ACCESS_TOKEN",
    ]);
    expect(HOSTED_ASSISTANT_CODEX_SHELL_ENV_NAMES).not.toContain("ELEVENLABS_API_KEY");
    expect(HOSTED_ASSISTANT_CODEX_SHELL_ENV_NAMES).not.toContain("MURPH_ELEVENLABS_MODEL_ID");
    expect(HOSTED_ASSISTANT_CODEX_SHELL_ENV_NAMES).not.toContain("MURPH_ELEVENLABS_VOICE_ID");

    expect(HOSTED_TELEGRAM_DELIVERY_FORWARDED_ENV_NAMES).toEqual([
      "TELEGRAM_API_BASE_URL",
      "TELEGRAM_BOT_USERNAME",
      "TELEGRAM_FILE_BASE_URL",
    ]);
  });

  it("resolves every dynamic-tool capability id", () => {
    const knownCapabilityIds = new Set<string>(
      HOSTED_ASSISTANT_CAPABILITIES.map((capability) => capability.id),
    );

    for (const [toolName, capabilityIds] of Object.entries(
      HOSTED_ASSISTANT_DYNAMIC_TOOL_CAPABILITY_IDS,
    )) {
      expect(toolName).toMatch(/^murph\.[a-z_]+$/u);
      for (const capabilityId of capabilityIds) {
        expect(knownCapabilityIds.has(capabilityId)).toBe(true);
      }
    }

    expect(knownCapabilityIds.has("missing.provider")).toBe(false);
  });
});
