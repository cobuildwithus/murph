import { describe, expect, it } from "vitest";

import {
  HOSTED_ASSISTANT_CODEX_SHELL_ENV_NAMES,
  HOSTED_ASSISTANT_FORWARDED_CONFIG_ENV_NAMES,
  HOSTED_ASSISTANT_WORKER_SECRET_ENV_NAMES,
  HOSTED_ELEVENLABS_ENV_NAMES,
  HOSTED_EXA_SEARCH_CODEX_SHELL_ENV_NAMES,
  HOSTED_LINQ_DELIVERY_ENV_NAMES,
  HOSTED_MAPBOX_ROUTES_CODEX_SHELL_ENV_NAMES,
  HOSTED_MURPH_DATA_API_CODEX_SHELL_ENV_NAMES,
  HOSTED_TELEGRAM_DELIVERY_FORWARDED_ENV_NAMES,
  HOSTED_XAI_SEARCH_ENV_NAMES,
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
      HOSTED_MURPH_DATA_API_CODEX_SHELL_ENV_NAMES,
      HOSTED_LINQ_DELIVERY_ENV_NAMES,
      HOSTED_TELEGRAM_DELIVERY_FORWARDED_ENV_NAMES,
      HOSTED_XAI_SEARCH_ENV_NAMES,
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
      "GEMINI_API_KEY",
      "ELEVENLABS_API_KEY",
      "XAI_API_KEY",
      "EXA_API_KEY",
      "MAPBOX_ACCESS_TOKEN",
      "MURPH_DATA_API_KEY",
      "LINQ_API_TOKEN",
      "TELEGRAM_BOT_TOKEN",
    ]);

    expect(HOSTED_ASSISTANT_FORWARDED_CONFIG_ENV_NAMES).toEqual([
      "MURPH_ELEVENLABS_MODEL_ID",
      "MURPH_ELEVENLABS_VOICE_ID",
      "XAI_X_SEARCH_MODEL",
      "LINQ_ATTACHMENT_CDN_BASE_URL",
      "LINQ_API_BASE_URL",
      "TELEGRAM_API_BASE_URL",
      "TELEGRAM_BOT_USERNAME",
      "TELEGRAM_FILE_BASE_URL",
    ]);

    expect(HOSTED_XAI_SEARCH_ENV_NAMES).toEqual([
      "XAI_API_KEY",
      "XAI_X_SEARCH_MODEL",
    ]);

    expect(HOSTED_ELEVENLABS_ENV_NAMES).toEqual([
      "ELEVENLABS_API_KEY",
      "MURPH_ELEVENLABS_MODEL_ID",
      "MURPH_ELEVENLABS_VOICE_ID",
    ]);

    expect(HOSTED_ASSISTANT_CODEX_SHELL_ENV_NAMES).toEqual([
      "EXA_API_KEY",
      "MAPBOX_ACCESS_TOKEN",
      "MURPH_DATA_API_KEY",
    ]);
    expect(HOSTED_ASSISTANT_CODEX_SHELL_ENV_NAMES).not.toContain("ELEVENLABS_API_KEY");
    expect(HOSTED_ASSISTANT_CODEX_SHELL_ENV_NAMES).not.toContain("XAI_API_KEY");
    expect(HOSTED_ASSISTANT_CODEX_SHELL_ENV_NAMES).not.toContain("GEMINI_API_KEY");
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

    expect(HOSTED_ASSISTANT_FORWARDED_CONFIG_ENV_NAMES)
      .not.toContain("XAI_API_BASE_URL");
    expect(HOSTED_XAI_SEARCH_ENV_NAMES).not.toContain("XAI_API_BASE_URL");
  });
});
