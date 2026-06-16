import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostedLocalDevConfig } from "../../src/dev-hosted-local/types.ts";

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
  vi.unstubAllGlobals();
});

const config: HostedLocalDevConfig = {
  databaseUrlOverride: null,
  forceResetLocalDatabase: false,
  forceResetLocalTemporal: false,
  linqWebhookPublicUrl: null,
  linqWebhookTunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
  linqWebhookTunnelMode: "auto",
  linqWebhookTunnelName: "dev",
  skipHealthCommonsWatch: false,
  skipLinqWebhookRegister: false,
  skipPrismaMigrate: false,
  skipRunnerSmoke: false,
  skipStripeListen: false,
  skipWeb: false,
  skipVercelPull: false,
  temporal: {
    host: "127.0.0.1",
    mode: "disabled",
    namespace: "default",
    port: 7233,
    taskQueue: "murph-hosted-runtime",
  },
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
    const { normalizeLinqWebhookPublicUrl } = await import("../../src/dev-hosted-local/linq-webhook-tunnel.ts");

    expect(normalizeLinqWebhookPublicUrl("https://tunnel.example.test")).toEqual({
      publicBaseUrl: "https://tunnel.example.test",
      targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
    });
  });

  it("accepts the exact hosted Linq webhook URL", async () => {
    const { normalizeLinqWebhookPublicUrl } = await import("../../src/dev-hosted-local/linq-webhook-tunnel.ts");

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
    const { normalizeLinqWebhookPublicUrl } = await import("../../src/dev-hosted-local/linq-webhook-tunnel.ts");

    expect(() =>
      normalizeLinqWebhookPublicUrl("http://tunnel.example.test")
    ).toThrow("must use HTTPS");
  });

  it("rejects query and hash values before appending the webhook path", async () => {
    const { normalizeLinqWebhookPublicUrl } = await import("../../src/dev-hosted-local/linq-webhook-tunnel.ts");

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
    const { parseCloudflaredTunnelHostname } = await import("../../src/dev-hosted-local/linq-webhook-tunnel.ts");

    expect(parseCloudflaredTunnelHostname([
      "tunnel: dev",
      "ingress:",
      "  - hostname: \"tunnel.example.test\"",
      "    service: http://localhost:3000",
    ].join("\n"))).toBe("tunnel.example.test");
  });

  it("selects the hostname whose ingress service routes to hosted web", async () => {
    const { parseCloudflaredTunnelHostname } = await import("../../src/dev-hosted-local/linq-webhook-tunnel.ts");

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
    const { parseCloudflaredTunnelHostname } = await import("../../src/dev-hosted-local/linq-webhook-tunnel.ts");

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
    const { parseCloudflaredTunnelHostname } = await import("../../src/dev-hosted-local/linq-webhook-tunnel.ts");

    expect(() =>
      parseCloudflaredTunnelHostname("ingress:\n  - service: http://localhost:3000")
    ).toThrow("must include an ingress hostname");
  });
});

describe("resolveHostedLocalLinqWebhookSetup", () => {
  it("derives the tunnel target from the local cloudflared config when Linq env is present", async () => {
    const { resolveHostedLocalLinqWebhookSetup } = await import("../../src/dev-hosted-local/linq-webhook-tunnel.ts");

    await expect(resolveHostedLocalLinqWebhookSetup({
      config,
      env: {
        HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS:
          " +15550000001, +15550000002 ",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS: "+15550000003",
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
    const { resolveHostedLocalLinqWebhookSetup } = await import("../../src/dev-hosted-local/linq-webhook-tunnel.ts");

    await expect(resolveHostedLocalLinqWebhookSetup({
      config,
      env: {
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS: "+15550000003",
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
      fileExists: async () => false,
    })).resolves.toBeNull();
  });

  it("uses an explicit public URL without requiring a managed tunnel config", async () => {
    const { resolveHostedLocalLinqWebhookSetup } = await import("../../src/dev-hosted-local/linq-webhook-tunnel.ts");

    await expect(resolveHostedLocalLinqWebhookSetup({
      config: {
        ...config,
        linqWebhookPublicUrl: "https://manual.example.test",
      },
      env: {
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS: "+15550000003",
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

  it("requires a local inbound allowlist before enabling Linq webhook handling", async () => {
    const { resolveHostedLocalLinqWebhookSetup } = await import("../../src/dev-hosted-local/linq-webhook-tunnel.ts");

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
    })).rejects.toThrow("HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS must be set");
  });

  it("fails when the tunnel is required but the config is absent", async () => {
    const { resolveHostedLocalLinqWebhookSetup } = await import("../../src/dev-hosted-local/linq-webhook-tunnel.ts");

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
      "../../src/dev-hosted-local/linq-webhook-tunnel.ts"
    );
    const stderrTarget = new CapturingWritable();
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ subscriptions: [] })
    );

    await registerHostedLocalLinqWebhookSubscription({
      env: {
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
      fetchImplementation,
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
      "../../src/dev-hosted-local/linq-webhook-tunnel.ts"
    );
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-linq-registration-cache-"));
    const registrationCachePath = path.join(tempDir, "cache.json");
    const stderrTarget = new CapturingWritable();
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ subscriptions: [] })
    );
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
        fetchImplementation,
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
        fetchImplementation,
        registrationCachePath,
        setup,
        stderrTarget,
      });

      expect(createLinqWebhookSubscription).toHaveBeenCalledTimes(1);
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
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

  it("uses the remote Linq subscription list to avoid duplicate create calls", async () => {
    const { registerHostedLocalLinqWebhookSubscription } = await import(
      "../../src/dev-hosted-local/linq-webhook-tunnel.ts"
    );
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-linq-registration-cache-"));
    const registrationCachePath = path.join(tempDir, "cache.json");
    const stderrTarget = new CapturingWritable();
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({
        subscriptions: [
          {
            id: "subscription-existing",
            is_active: true,
            phone_numbers: ["+15550000001"],
            signing_secret: "linq-webhook-secret",
            subscribed_events: ["message.received"],
            target_url: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
          },
        ],
      })
    );

    try {
      await registerHostedLocalLinqWebhookSubscription({
        env: {
          LINQ_API_BASE_URL: "https://linq.example.test/api/partner/v3",
          LINQ_API_TOKEN: "linq-token",
          LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
        },
        fetchImplementation,
        registrationCachePath,
        setup: {
          phoneNumbers: ["+15550000001"],
          publicBaseUrl: "https://tunnel.example.test",
          shouldRegister: true,
          shouldStartTunnel: true,
          targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
          tunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
          tunnelName: "dev",
        },
        stderrTarget,
      });

      expect(createLinqWebhookSubscription).not.toHaveBeenCalled();
      expect(fetchImplementation).toHaveBeenCalledWith(
        new URL("webhook-subscriptions", "https://linq.example.test/api/partner/v3/"),
        expect.objectContaining({
          headers: {
            authorization: "Bearer linq-token",
          },
          method: "GET",
        }),
      );
      const cacheText = await readFile(registrationCachePath, "utf8");
      expect(cacheText).toContain("subscription-existing");
      expect(cacheText).toContain("\"secretVerified\": true");
      expect(cacheText).not.toContain("linq-webhook-secret");
      expect(cacheText).not.toContain("+15550000001");
      expect(stderrTarget.writeMock).toHaveBeenCalledWith(expect.stringContaining(
        "is already registered for 1 configured phone number(s)",
      ));
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("continues without caching when Linq does not expose an existing signing secret", async () => {
    const { registerHostedLocalLinqWebhookSubscription } = await import(
      "../../src/dev-hosted-local/linq-webhook-tunnel.ts"
    );
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-linq-registration-cache-"));
    const registrationCachePath = path.join(tempDir, "cache.json");
    const stderrTarget = new CapturingWritable();
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({
        subscriptions: [
          {
            id: "subscription-existing",
            is_active: true,
            phone_numbers: ["+15550000001"],
            subscribed_events: ["message.received"],
            target_url: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
          },
        ],
      })
    );

    try {
      await registerHostedLocalLinqWebhookSubscription({
        env: {
          LINQ_API_TOKEN: "linq-token",
          LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
        },
        fetchImplementation,
        registrationCachePath,
        setup: {
          phoneNumbers: ["+15550000001"],
          publicBaseUrl: "https://tunnel.example.test",
          shouldRegister: true,
          shouldStartTunnel: true,
          targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
          tunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
          tunnelName: "dev",
        },
        stderrTarget,
      });

      expect(createLinqWebhookSubscription).not.toHaveBeenCalled();
      await expect(readFile(registrationCachePath, "utf8")).rejects.toThrow();
      expect(stderrTarget.writeMock).toHaveBeenCalledWith(expect.stringContaining(
        "did not return its signing secret",
      ));
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("fails when an existing Linq webhook subscription returns a different signing secret", async () => {
    const { registerHostedLocalLinqWebhookSubscription } = await import(
      "../../src/dev-hosted-local/linq-webhook-tunnel.ts"
    );
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({
        subscriptions: [
          {
            id: "subscription-existing",
            is_active: true,
            phone_numbers: ["+15550000001"],
            signing_secret: "different-secret",
            subscribed_events: ["message.received"],
            target_url: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
          },
        ],
      })
    );

    await expect(registerHostedLocalLinqWebhookSubscription({
      env: {
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
      fetchImplementation,
      registrationCachePath: null,
      setup: {
        phoneNumbers: ["+15550000001"],
        publicBaseUrl: "https://tunnel.example.test",
        shouldRegister: true,
        shouldStartTunnel: true,
        targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
        tunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
        tunnelName: "dev",
      },
    })).rejects.toThrow("Existing Linq webhook subscription uses a signing secret");
    expect(createLinqWebhookSubscription).not.toHaveBeenCalled();
  });

  it("does not trust a legacy local cache without explicit secret verification", async () => {
    const { registerHostedLocalLinqWebhookSubscription } = await import(
      "../../src/dev-hosted-local/linq-webhook-tunnel.ts"
    );
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-linq-registration-cache-"));
    const registrationCachePath = path.join(tempDir, "cache.json");
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ subscriptions: [] })
    );

    try {
      await registerHostedLocalLinqWebhookSubscription({
        env: {
          LINQ_API_TOKEN: "linq-token",
          LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
        },
        fetchImplementation,
        registrationCachePath,
        setup: {
          phoneNumbers: ["+15550000001"],
          publicBaseUrl: "https://tunnel.example.test",
          shouldRegister: true,
          shouldStartTunnel: true,
          targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
          tunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
          tunnelName: "dev",
        },
      });
      const verifiedCacheText = await readFile(registrationCachePath, "utf8");
      await rm(registrationCachePath, { force: true });
      await writeFile(
        registrationCachePath,
        verifiedCacheText.replace(/\n  "secretVerified": true,\n/u, "\n"),
        "utf8",
      );

      await registerHostedLocalLinqWebhookSubscription({
        env: {
          LINQ_API_TOKEN: "linq-token",
          LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
        },
        fetchImplementation,
        registrationCachePath,
        setup: {
          phoneNumbers: ["+15550000001"],
          publicBaseUrl: "https://tunnel.example.test",
          shouldRegister: true,
          shouldStartTunnel: true,
          targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
          tunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
          tunnelName: "dev",
        },
      });

      expect(fetchImplementation).toHaveBeenCalledTimes(2);
      expect(createLinqWebhookSubscription).toHaveBeenCalledTimes(2);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("continues without duplicate create when the remote target has extra events", async () => {
    const { registerHostedLocalLinqWebhookSubscription } = await import(
      "../../src/dev-hosted-local/linq-webhook-tunnel.ts"
    );
    const stderrTarget = new CapturingWritable();
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({
        subscriptions: [
          {
            id: "subscription-broader",
            is_active: true,
            phone_numbers: null,
            subscribed_events: ["message.received", "message.sent"],
            target_url: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
          },
        ],
      })
    );

    await registerHostedLocalLinqWebhookSubscription({
      env: {
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
      fetchImplementation,
      registrationCachePath: null,
      setup: {
        phoneNumbers: null,
        publicBaseUrl: "https://tunnel.example.test",
        shouldRegister: true,
        shouldStartTunnel: true,
        targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
        tunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
        tunnelName: "dev",
      },
      stderrTarget,
    });

    expect(createLinqWebhookSubscription).not.toHaveBeenCalled();
    expect(stderrTarget.writeMock).toHaveBeenCalledWith(expect.stringContaining(
      "event set differs",
    ));
  });

  it("continues without duplicate create when the remote target has a different phone filter", async () => {
    const { registerHostedLocalLinqWebhookSubscription } = await import(
      "../../src/dev-hosted-local/linq-webhook-tunnel.ts"
    );
    const stderrTarget = new CapturingWritable();
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({
        subscriptions: [
          {
            id: "subscription-filtered",
            is_active: true,
            phone_numbers: ["+15550000001"],
            subscribed_events: ["message.received"],
            target_url: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
          },
        ],
      })
    );

    await registerHostedLocalLinqWebhookSubscription({
      env: {
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
      fetchImplementation,
      registrationCachePath: null,
      setup: {
        phoneNumbers: null,
        publicBaseUrl: "https://tunnel.example.test",
        shouldRegister: true,
        shouldStartTunnel: true,
        targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
        tunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
        tunnelName: "dev",
      },
      stderrTarget,
    });

    expect(createLinqWebhookSubscription).not.toHaveBeenCalled();
    expect(stderrTarget.writeMock).toHaveBeenCalledWith(expect.stringContaining(
      "phone-number filter differs",
    ));
  });

  it("waits for the public webhook target before Linq registration", async () => {
    const { waitForHostedLocalLinqWebhookTarget } = await import(
      "../../src/dev-hosted-local/linq-webhook-tunnel.ts"
    );
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not ready", { status: 530 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const sleep = vi.fn(async () => {});

    await waitForHostedLocalLinqWebhookTarget({
      fetchImplementation,
      intervalMs: 1,
      setup: {
        phoneNumbers: null,
        publicBaseUrl: "https://tunnel.example.test",
        shouldRegister: true,
        shouldStartTunnel: false,
        targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
        tunnelConfigPath: null,
        tunnelName: null,
      },
      sleep,
      timeoutMs: 30_000,
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("calls default readiness fetch with the global receiver", async () => {
    const { waitForHostedLocalLinqWebhookTarget } = await import(
      "../../src/dev-hosted-local/linq-webhook-tunnel.ts"
    );
    const fetchMock = vi.fn(function (
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(Response.json({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await waitForHostedLocalLinqWebhookTarget({
      setup: {
        phoneNumbers: null,
        publicBaseUrl: "https://tunnel.example.test",
        shouldRegister: true,
        shouldStartTunnel: false,
        targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
        tunnelConfigPath: null,
        tunnelName: null,
      },
      timeoutMs: 30_000,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails before Linq registration when the public webhook target is unreachable", async () => {
    const { waitForHostedLocalLinqWebhookTarget } = await import(
      "../../src/dev-hosted-local/linq-webhook-tunnel.ts"
    );
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not ready", { status: 530 }));

    await expect(waitForHostedLocalLinqWebhookTarget({
      fetchImplementation,
      setup: {
        phoneNumbers: null,
        publicBaseUrl: "https://tunnel.example.test",
        shouldRegister: true,
        shouldStartTunnel: false,
        targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
        tunnelConfigPath: null,
        tunnelName: null,
      },
      timeoutMs: 0,
    })).rejects.toThrow("Last readiness check: HTTP 530");
  });

  it("fails if Linq returns a different signing secret", async () => {
    const { registerHostedLocalLinqWebhookSubscription } = await import(
      "../../src/dev-hosted-local/linq-webhook-tunnel.ts"
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
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ subscriptions: [] })
    );

    await expect(registerHostedLocalLinqWebhookSubscription({
      env: {
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
      fetchImplementation,
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
