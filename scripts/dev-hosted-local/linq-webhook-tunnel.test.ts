import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostedLocalDevConfig } from "./types.ts";

type LinqWebhookSubscriptionResult = {
  createdAt: string | null;
  id: string;
  isActive: boolean;
  phoneNumbers: readonly string[];
  signingSecret: string | null;
  subscribedEvents: readonly string[];
  targetUrl: string;
  updatedAt: string | null;
};

const createLinqWebhookSubscription = vi.fn<
  (
    input: {
      phoneNumbers: readonly string[] | null;
      subscribedEvents: readonly string[];
      targetUrl: string;
    },
    options: { env: NodeJS.ProcessEnv },
  ) => Promise<LinqWebhookSubscriptionResult>
>(async () => ({
  createdAt: "2026-05-02T00:00:00.000Z",
  id: "subscription-1",
  isActive: true,
  phoneNumbers: ["+15550000001"],
  signingSecret: "linq-webhook-secret",
  subscribedEvents: ["message.received"],
  targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
  updatedAt: "2026-05-02T00:00:00.000Z",
}));

vi.mock("@murphai/operator-config/linq-runtime", () => ({
  createLinqWebhookSubscription,
}));

class CapturingWritable extends Writable {
  readonly writeMock = vi.fn();

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.writeMock(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    callback();
  }
}

afterEach(() => {
  createLinqWebhookSubscription.mockClear();
});

const config: HostedLocalDevConfig = {
  databaseUrlOverride: null,
  forceResetLocalDatabase: false,
  linqWebhookPublicUrl: null,
  linqWebhookTunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
  linqWebhookTunnelMode: "auto",
  linqWebhookTunnelName: "dev",
  localCodexBridge: true,
  localCodexBridgeHost: "127.0.0.1",
  localCodexBridgePort: 0,
  localCodexCommand: "codex",
  skipHealthCommonsWatch: false,
  skipLinqWebhookRegister: false,
  skipPrismaMigrate: false,
  skipRunnerSmoke: false,
  skipStripeListen: false,
  skipWeb: false,
  skipVercelPull: false,
  useVercelDatabaseUrl: false,
  webHost: "localhost",
  webPort: 3000,
  workerHost: "127.0.0.1",
  workerPersistDir: ".wrangler/state/dev-root",
  workerPort: 8787,
  workerProtocol: "http",
};

describe("normalizeLinqWebhookPublicUrl", () => {
  it("accepts an HTTPS origin and appends the hosted Linq webhook path", async () => {
    const { normalizeLinqWebhookPublicUrl } = await import("./linq-webhook-tunnel.ts");

    expect(normalizeLinqWebhookPublicUrl("https://tunnel.example.test")).toEqual({
      publicBaseUrl: "https://tunnel.example.test",
      targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
    });
  });

  it("accepts the exact hosted Linq webhook URL", async () => {
    const { normalizeLinqWebhookPublicUrl } = await import("./linq-webhook-tunnel.ts");

    expect(
      normalizeLinqWebhookPublicUrl(
        "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
      ),
    ).toEqual({
      publicBaseUrl: "https://tunnel.example.test",
      targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
    });
  });

  it("rejects non-HTTPS public targets", async () => {
    const { normalizeLinqWebhookPublicUrl } = await import("./linq-webhook-tunnel.ts");

    expect(() =>
      normalizeLinqWebhookPublicUrl("http://tunnel.example.test")
    ).toThrow("must use HTTPS");
  });

  it("rejects query and hash values before appending the webhook path", async () => {
    const { normalizeLinqWebhookPublicUrl } = await import("./linq-webhook-tunnel.ts");

    expect(() =>
      normalizeLinqWebhookPublicUrl("https://tunnel.example.test?debug=1")
    ).toThrow("must not include query or hash");
    expect(() =>
      normalizeLinqWebhookPublicUrl("https://tunnel.example.test/#fragment")
    ).toThrow("must not include query or hash");
  });
});

describe("parseCloudflaredTunnelHostname", () => {
  it("reads the first ingress hostname from a cloudflared config", async () => {
    const { parseCloudflaredTunnelHostname } = await import("./linq-webhook-tunnel.ts");

    expect(parseCloudflaredTunnelHostname([
      "tunnel: dev",
      "ingress:",
      "  - hostname: \"tunnel.example.test\"",
      "    service: http://localhost:3000",
    ].join("\n"))).toBe("tunnel.example.test");
  });

  it("selects the hostname whose ingress service routes to hosted web", async () => {
    const { parseCloudflaredTunnelHostname } = await import("./linq-webhook-tunnel.ts");

    expect(parseCloudflaredTunnelHostname([
      "ingress:",
      "  - hostname: other.example.test",
      "    service: http://localhost:9999",
      "  - hostname: tunnel.example.test",
      "    service: http://127.0.0.1:3000",
      "  - service: http_status:404",
    ].join("\n"), "cloudflared.yml", {
      webHost: "localhost",
      webPort: 3000,
    })).toBe("tunnel.example.test");
  });

  it("fails when no hostname rule routes to hosted web", async () => {
    const { parseCloudflaredTunnelHostname } = await import("./linq-webhook-tunnel.ts");

    expect(() =>
      parseCloudflaredTunnelHostname([
        "ingress:",
        "  - hostname: tunnel.example.test",
        "    service: http://localhost:9999",
        "  - service: http_status:404",
      ].join("\n"), "cloudflared.yml", {
        webHost: "localhost",
        webPort: 3000,
      })
    ).toThrow("must include an ingress hostname whose service routes to local hosted web port 3000");
  });

  it("fails closed when the cloudflared config has no hostname", async () => {
    const { parseCloudflaredTunnelHostname } = await import("./linq-webhook-tunnel.ts");

    expect(() =>
      parseCloudflaredTunnelHostname("ingress:\n  - service: http://localhost:3000")
    ).toThrow("must include an ingress hostname");
  });
});

describe("resolveHostedLocalLinqWebhookSetup", () => {
  it("derives the tunnel target from the local cloudflared config when Linq env is present", async () => {
    const { resolveHostedLocalLinqWebhookSetup } = await import("./linq-webhook-tunnel.ts");

    await expect(resolveHostedLocalLinqWebhookSetup({
      config,
      env: {
        HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS:
          " +15550000001, +15550000002 ",
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
      fileExists: async () => true,
      readTextFile: async () => "ingress:\n  - hostname: tunnel.example.test\n    service: http://localhost:3000",
    })).resolves.toEqual({
      phoneNumbers: ["+15550000001", "+15550000002"],
      publicBaseUrl: "https://tunnel.example.test",
      shouldRegister: true,
      shouldStartTunnel: true,
      targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
      tunnelConfigPath: expect.stringMatching(/\.tmp\/cloudflared-linq-webhook\.yml$/u),
      tunnelName: "dev",
    });
  });

  it("stays off for ordinary dev when the config is missing", async () => {
    const { resolveHostedLocalLinqWebhookSetup } = await import("./linq-webhook-tunnel.ts");

    await expect(resolveHostedLocalLinqWebhookSetup({
      config,
      env: {
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
      fileExists: async () => false,
    })).resolves.toBeNull();
  });

  it("uses an explicit public URL without requiring a managed tunnel config", async () => {
    const { resolveHostedLocalLinqWebhookSetup } = await import("./linq-webhook-tunnel.ts");

    await expect(resolveHostedLocalLinqWebhookSetup({
      config: {
        ...config,
        linqWebhookPublicUrl: "https://manual.example.test",
      },
      env: {
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
      fileExists: async () => false,
    })).resolves.toMatchObject({
      publicBaseUrl: "https://manual.example.test",
      shouldRegister: true,
      shouldStartTunnel: false,
      targetUrl: "https://manual.example.test/api/hosted-onboarding/linq/webhook",
      tunnelConfigPath: null,
      tunnelName: null,
    });
  });

  it("fails when the tunnel is required but the config is absent", async () => {
    const { resolveHostedLocalLinqWebhookSetup } = await import("./linq-webhook-tunnel.ts");

    await expect(resolveHostedLocalLinqWebhookSetup({
      config: {
        ...config,
        linqWebhookTunnelMode: "required",
      },
      env: {
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
      fileExists: async () => false,
    })).rejects.toThrow("Configured Linq webhook tunnel config was not found");
  });
});

describe("registerHostedLocalLinqWebhookSubscription", () => {
  it("registers message.received against the resolved target", async () => {
    const { registerHostedLocalLinqWebhookSubscription } = await import(
      "./linq-webhook-tunnel.ts"
    );
    const stderrTarget = new CapturingWritable();

    await registerHostedLocalLinqWebhookSubscription({
      env: {
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
      setup: {
        phoneNumbers: ["+15550000001"],
        publicBaseUrl: "https://tunnel.example.test",
        shouldRegister: true,
        shouldStartTunnel: true,
        targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
        tunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
        tunnelName: "dev",
      },
      registrationCachePath: null,
      stderrTarget,
    });

    const call = createLinqWebhookSubscription.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error("Expected Linq webhook subscription call.");
    }
    expect(call[0]).toEqual({
      phoneNumbers: ["+15550000001"],
      subscribedEvents: ["message.received"],
      targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
    });
    expect(call[1].env).toEqual({
      LINQ_API_TOKEN: "linq-token",
    });
    expect(stderrTarget.writeMock).toHaveBeenCalledWith(expect.stringContaining(
      "Registered local webhook target https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
    ));
  });

  it("uses the local registration cache to avoid duplicate create calls", async () => {
    const { registerHostedLocalLinqWebhookSubscription } = await import(
      "./linq-webhook-tunnel.ts"
    );
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-linq-registration-cache-"));
    const registrationCachePath = path.join(tempDir, "cache.json");
    const stderrTarget = new CapturingWritable();
    const setup = {
      phoneNumbers: ["+15550000001"],
      publicBaseUrl: "https://tunnel.example.test",
      shouldRegister: true,
      shouldStartTunnel: true,
      targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
      tunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
      tunnelName: "dev",
    };

    try {
      await registerHostedLocalLinqWebhookSubscription({
        env: {
          LINQ_API_BASE_URL: "https://linq.example.test/api/partner/v3",
          LINQ_API_TOKEN: "linq-token",
          LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
          PRIVY_APP_SECRET: "unrelated-secret",
        },
        registrationCachePath,
        setup,
        stderrTarget,
      });
      await registerHostedLocalLinqWebhookSubscription({
        env: {
          LINQ_API_BASE_URL: "https://linq.example.test/api/partner/v3",
          LINQ_API_TOKEN: "linq-token",
          LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
          PRIVY_APP_SECRET: "unrelated-secret",
        },
        registrationCachePath,
        setup,
        stderrTarget,
      });

      expect(createLinqWebhookSubscription).toHaveBeenCalledTimes(1);
      const call = createLinqWebhookSubscription.mock.calls[0];
      expect(call).toBeDefined();
      if (!call) {
        throw new Error("Expected Linq webhook subscription call.");
      }
      expect(call[1].env).toEqual({
        LINQ_API_BASE_URL: "https://linq.example.test/api/partner/v3",
        LINQ_API_TOKEN: "linq-token",
      });
      const cacheText = await readFile(registrationCachePath, "utf8");
      expect(cacheText).not.toContain("linq-webhook-secret");
      expect(cacheText).not.toContain("+15550000001");
      expect(cacheText).not.toContain("unrelated-secret");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("fails if Linq returns a different signing secret", async () => {
    const { registerHostedLocalLinqWebhookSubscription } = await import(
      "./linq-webhook-tunnel.ts"
    );
    createLinqWebhookSubscription.mockResolvedValueOnce({
      createdAt: null,
      id: "subscription-2",
      isActive: true,
      phoneNumbers: [],
      signingSecret: "different-secret",
      subscribedEvents: ["message.received"],
      targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
      updatedAt: null,
    });

    await expect(registerHostedLocalLinqWebhookSubscription({
      env: {
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
      setup: {
        phoneNumbers: null,
        publicBaseUrl: "https://tunnel.example.test",
        shouldRegister: true,
        shouldStartTunnel: false,
        targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
        tunnelConfigPath: null,
        tunnelName: null,
      },
      registrationCachePath: null,
    })).rejects.toThrow("does not match local LINQ_WEBHOOK_SECRET");
  });
});
