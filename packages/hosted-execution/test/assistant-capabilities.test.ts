import { describe, expect, it } from "vitest";

import {
  HOSTED_ASSISTANT_CODEX_SHELL_ENV_NAMES,
  HOSTED_ASSISTANT_FORWARDED_CONFIG_ENV_NAMES,
  HOSTED_ASSISTANT_WORKER_SECRET_ENV_NAMES,
  HOSTED_ELEVENLABS_ENV_NAMES,
  HOSTED_EXA_SEARCH_CODEX_SHELL_ENV_NAMES,
  HOSTED_LINQ_DELIVERY_ENV_NAMES,
  HOSTED_MAPBOX_ROUTES_CODEX_SHELL_ENV_NAMES,
  HOSTED_TELEGRAM_DELIVERY_FORWARDED_ENV_NAMES,
  HOSTED_WHATSAPP_DELIVERY_FORWARDED_ENV_NAMES,
} from "../src/assistant-capabilities.ts";

function expectEnvNames(names: readonly string[]): void {
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) {
    expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/u);
  }
}

describe("hosted assistant capability env lists", () => {
  it("keeps each boundary list explicit and deduplicated", () => {
    const boundaryLists = [
      HOSTED_ASSISTANT_WORKER_SECRET_ENV_NAMES,
      HOSTED_ASSISTANT_FORWARDED_CONFIG_ENV_NAMES,
      HOSTED_ASSISTANT_CODEX_SHELL_ENV_NAMES,
      HOSTED_ELEVENLABS_ENV_NAMES,
      HOSTED_EXA_SEARCH_CODEX_SHELL_ENV_NAMES,
      HOSTED_MAPBOX_ROUTES_CODEX_SHELL_ENV_NAMES,
      HOSTED_LINQ_DELIVERY_ENV_NAMES,
      HOSTED_TELEGRAM_DELIVERY_FORWARDED_ENV_NAMES,
      HOSTED_WHATSAPP_DELIVERY_FORWARDED_ENV_NAMES,
    ];

    for (const names of boundaryLists) {
      expectEnvNames(names);
    }

    const workerSecrets = new Set<string>(HOSTED_ASSISTANT_WORKER_SECRET_ENV_NAMES);
    for (const forwardedName of HOSTED_ASSISTANT_FORWARDED_CONFIG_ENV_NAMES) {
      expect(workerSecrets.has(forwardedName)).toBe(false);
    }
  });

  it("exports named provider env projections for runtime boundaries", () => {
    expect(HOSTED_ASSISTANT_WORKER_SECRET_ENV_NAMES).toEqual([
      "ELEVENLABS_API_KEY",
      "EXA_API_KEY",
      "MAPBOX_ACCESS_TOKEN",
      "LINQ_API_TOKEN",
      "TELEGRAM_BOT_TOKEN",
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_PHONE_NUMBER_ID",
    ]);

    expect(HOSTED_ASSISTANT_FORWARDED_CONFIG_ENV_NAMES).toEqual([
      "MURPH_ELEVENLABS_MODEL_ID",
      "MURPH_ELEVENLABS_VOICE_ID",
      "LINQ_ATTACHMENT_CDN_BASE_URL",
      "LINQ_API_BASE_URL",
      "TELEGRAM_API_BASE_URL",
      "TELEGRAM_BOT_USERNAME",
      "TELEGRAM_FILE_BASE_URL",
      "WHATSAPP_API_BASE_URL",
      "WHATSAPP_GRAPH_VERSION",
    ]);

    expect(HOSTED_ELEVENLABS_ENV_NAMES).toEqual([
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

    expect(HOSTED_LINQ_DELIVERY_ENV_NAMES).toEqual([
      "LINQ_ATTACHMENT_CDN_BASE_URL",
      "LINQ_API_BASE_URL",
      "LINQ_API_TOKEN",
    ]);

    expect(HOSTED_TELEGRAM_DELIVERY_FORWARDED_ENV_NAMES).toEqual([
      "TELEGRAM_API_BASE_URL",
      "TELEGRAM_BOT_USERNAME",
      "TELEGRAM_FILE_BASE_URL",
    ]);

    expect(HOSTED_WHATSAPP_DELIVERY_FORWARDED_ENV_NAMES).toEqual([
      "WHATSAPP_API_BASE_URL",
      "WHATSAPP_GRAPH_VERSION",
    ]);
  });
});
