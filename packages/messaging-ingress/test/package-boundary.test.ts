import { access, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const builtDistTest = process.env.MURPH_MESSAGING_INGRESS_TEST_BUILT_DIST === "1" ? it : it.skip;

describe("@murphai/messaging-ingress package boundary", () => {
  it("publishes only the focused provider subpaths and keeps the root barrel removed", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      exports?: Record<string, unknown>;
      main?: string;
      scripts?: Record<string, string | undefined>;
      types?: string;
    };

    expect(packageJson.scripts?.test).toMatch(/^pnpm build && MURPH_MESSAGING_INGRESS_TEST_BUILT_DIST=1 /u);
    expect(packageJson.scripts?.["test:coverage"]).toMatch(
      /^pnpm build && MURPH_MESSAGING_INGRESS_TEST_BUILT_DIST=1 /u,
    );
    expect(packageJson.exports).toEqual({
      "./linq-webhook": {
        default: "./dist/linq-webhook.js",
        types: "./dist/linq-webhook.d.ts",
      },
      "./telegram-webhook": {
        default: "./dist/telegram-webhook.js",
        types: "./dist/telegram-webhook.d.ts",
      },
      "./telegram-webhook-payload": {
        default: "./dist/telegram-webhook-payload.js",
        types: "./dist/telegram-webhook-payload.d.ts",
      },
      "./whatsapp-webhook": {
        default: "./dist/whatsapp-webhook.js",
        types: "./dist/whatsapp-webhook.d.ts",
      },
    });
    expect(packageJson).not.toHaveProperty("main");
    expect(packageJson).not.toHaveProperty("types");
    await expect(access(new URL("../src/index.ts", import.meta.url))).rejects.toThrow();
  });

  it("rejects the package root while keeping the focused subpaths importable", async () => {
    const importBySpecifier = async (specifier: string) => import(specifier);

    await expect(importBySpecifier("@murphai/messaging-ingress")).rejects.toThrow();
    await expect(importBySpecifier("@murphai/messaging-ingress/linq-webhook")).resolves.toMatchObject({
      verifyAndParseLinqWebhookRequest: expect.any(Function),
    });
    await expect(importBySpecifier("@murphai/messaging-ingress/telegram-webhook")).resolves.toMatchObject({
      buildTelegramThreadId: expect.any(Function),
      summarizeTelegramUpdate: expect.any(Function),
    });
    await expect(importBySpecifier("@murphai/messaging-ingress/telegram-webhook-payload")).resolves.toMatchObject({
      minimizeTelegramUpdate: expect.any(Function),
      parseTelegramWebhookUpdate: expect.any(Function),
      verifyAndParseTelegramWebhookRequest: expect.any(Function),
    });
    await expect(importBySpecifier("@murphai/messaging-ingress/whatsapp-webhook")).resolves.toMatchObject({
      buildWhatsAppWebhookEventId: expect.any(Function),
      parseWhatsAppInboundTexts: expect.any(Function),
      verifyAndParseWhatsAppWebhookRequest: expect.any(Function),
    });
  });

  builtDistTest("keeps built export targets importable after the package test prebuild", async () => {
    const importBuiltModule = async (relativePath: string) =>
      import(new URL(relativePath, import.meta.url).href);

    await expect(importBuiltModule("../dist/linq-webhook.js")).resolves.toMatchObject({
      verifyAndParseLinqWebhookRequest: expect.any(Function),
    });
    await expect(importBuiltModule("../dist/telegram-webhook.js")).resolves.toMatchObject({
      buildTelegramThreadId: expect.any(Function),
      summarizeTelegramUpdate: expect.any(Function),
    });
    await expect(importBuiltModule("../dist/telegram-webhook-payload.js")).resolves.toMatchObject({
      minimizeTelegramUpdate: expect.any(Function),
      parseTelegramWebhookUpdate: expect.any(Function),
      verifyAndParseTelegramWebhookRequest: expect.any(Function),
    });
    await expect(importBuiltModule("../dist/whatsapp-webhook.js")).resolves.toMatchObject({
      buildWhatsAppWebhookEventId: expect.any(Function),
      parseWhatsAppInboundTexts: expect.any(Function),
      verifyAndParseWhatsAppWebhookRequest: expect.any(Function),
    });
  });
});
