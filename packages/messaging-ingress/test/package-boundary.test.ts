import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

    expect(packageJson.scripts?.test ?? "").not.toContain("pnpm build");
    expect(packageJson.scripts?.["test:coverage"] ?? "").not.toContain("pnpm build");
    expect(packageJson.scripts?.["verify:package-boundary"] ?? "").toMatch(
      /MURPH_MESSAGING_INGRESS_TEST_BUILT_DIST=1/u,
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
  });

  builtDistTest("keeps built export targets importable through package resolution", async () => {
    const result = await execFileAsync(process.execPath, [
      "--input-type=module",
      "-e",
      [
        "await import('@murphai/messaging-ingress/linq-webhook');",
        "await import('@murphai/messaging-ingress/telegram-webhook');",
        "await import('@murphai/messaging-ingress/telegram-webhook-payload');",
      ].join("\n"),
    ], {
      cwd: packageDir,
    });

    expect(result.stdout.trim()).toBe("");
    expect(result.stderr.trim()).toBe("");
  });
});
