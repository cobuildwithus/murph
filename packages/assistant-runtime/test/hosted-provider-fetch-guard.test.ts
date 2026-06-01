import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describe, it } from "vitest";

const HOSTED_PROVIDER_FETCH_SOURCE_FILES = [
  "../src/hosted-provider-effects.ts",
  "../src/hosted-runtime/callbacks.ts",
  "../src/hosted-runtime/channel-activity.ts",
  "../src/hosted-runtime/events/conversation.ts",
  "../src/hosted-runtime/events/linq.ts",
  "../src/hosted-runtime/events/telegram.ts",
  "../src/hosted-runtime/message-cleanup.ts",
  "../src/hosted-runtime/provider-cleanup.ts",
  "../src/hosted-runtime/workspace-assistant-phase.ts",
] as const;

describe("hosted provider fetch guard", () => {
  it("does not silently convert missing providerFetch to ambient provider fetch fallback", async () => {
    for (const relativePath of HOSTED_PROVIDER_FETCH_SOURCE_FILES) {
      const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
      assert.equal(
        source.includes("providerFetch ?? undefined"),
        false,
        `${relativePath} must require hosted provider fetch instead of passing undefined`,
      );
      assert.equal(
        source.includes("fetchImplementation: dependencies.fetchImplementation"),
        false,
        `${relativePath} must not pass optional hosted provider fetch directly`,
      );
    }
  });

  it("keeps hosted cleanup paths from accepting omitted provider fetches", async () => {
    for (const relativePath of [
      "../src/hosted-runtime/message-cleanup.ts",
      "../src/hosted-runtime/provider-cleanup.ts",
    ] as const) {
      const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
      assert.equal(
        source.includes("fetchImplementation?:"),
        false,
        `${relativePath} must make missing provider fetch explicit`,
      );
      assert.equal(
        source.includes("fetchImplementation: LinqFetch | null"),
        false,
        `${relativePath} must not make Linq cleanup responsible for missing provider fetches`,
      );
      assert.equal(
        source.includes("fetchImplementation: TelegramFetchImplementation | null"),
        false,
        `${relativePath} must not make Telegram cleanup responsible for missing provider fetches`,
      );
    }
  });

  it("keeps hosted attachment drivers from accepting ambient fetch fallback", async () => {
    for (const relativePath of [
      "../src/hosted-runtime/events/linq.ts",
      "../src/hosted-runtime/events/telegram.ts",
    ] as const) {
      const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
      assert.equal(
        source.includes("allowAmbientFetchForLocalRuntime"),
        false,
        `${relativePath} must not expose an ambient fetch opt-in`,
      );
      assert.equal(
        source.includes("globalThis.fetch"),
        false,
        `${relativePath} must not use ambient global fetch as a provider fallback`,
      );
    }
  });

  it("keeps provider fetch normalization provider-agnostic", async () => {
    const source = await readFile(
      new URL("../src/hosted-provider-effects.ts", import.meta.url),
      "utf8",
    );
    assert.equal(
      source.includes("HostedProviderLinqEffectContext"),
      false,
      "hosted provider effects must not introduce Linq-specific fetch boundary state",
    );
    assert.equal(
      source.includes("adaptHostedProviderFetchForLinq"),
      false,
      "hosted provider effects must pass the normalized provider fetch without provider-specific adapters",
    );
  });
});
