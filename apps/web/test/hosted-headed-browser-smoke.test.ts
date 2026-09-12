import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";

import { chromium, type Browser } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  completeExternalJunctionAuthorizationForTest,
  disconnectHostedLocalJunctionAccountForTest,
  navigateToHostedLocalJunctionStartForTest,
  readHostedLocalJunctionBrowserConfigForTest,
  requireHostedLocalJunctionPersistedConnectionForTest,
} from "../scripts/run-hosted-local-junction-wearable-browser";

const smokeEnabled = process.env.MURPH_E2E_HEADED_BROWSER_SMOKE === "1";

function createWhoopConfig() {
  return readHostedLocalJunctionBrowserConfigForTest({
    CI: "1",
    NODE_ENV: "test",
    MURPH_E2E_CONNECT_URL:
      "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=whoop",
    MURPH_E2E_HOSTED_SESSION_COOKIE: "opaque-session",
    MURPH_E2E_PROVIDER_EMAIL: "browser-canary@example.invalid",
    MURPH_E2E_PROVIDER_HEADLESS: "0",
    MURPH_E2E_PROVIDER_PASSWORD: "opaque-password",
    MURPH_E2E_PROVIDER_SOURCE: "whoop",
    MURPH_E2E_PROVIDER_TIMEOUT_MS: "30000",
    MURPH_E2E_WEB_BASE_URL: "https://app.example.test",
  });
}

function createGarminConfig() {
  return readHostedLocalJunctionBrowserConfigForTest({
    CI: "1",
    NODE_ENV: "test",
    MURPH_E2E_CONNECT_URL:
      "https://app.example.test/connect#deviceConnectIntent=opaque&connectSource=garmin",
    MURPH_E2E_HOSTED_SESSION_COOKIE: "opaque-session",
    MURPH_E2E_PROVIDER_EMAIL: "browser-canary@example.invalid",
    MURPH_E2E_PROVIDER_HEADLESS: "0",
    MURPH_E2E_PROVIDER_PASSWORD: "opaque-password",
    MURPH_E2E_PROVIDER_SOURCE: "garmin",
    MURPH_E2E_PROVIDER_TIMEOUT_MS: "30000",
    MURPH_E2E_WEB_BASE_URL: "https://app.example.test",
  });
}

describe("hosted headed browser boundary", () => {
  it.runIf(smokeEnabled).each(["navigation", "reload"] as const)(
    "rejects a failed persisted connect %s before accepting rendered connection state",
    async (phase) => {
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        let requests = 0;
        await page.route("https://app.example.test/connect", (route) => {
          requests += 1;
          return route.fulfill({
            status: requests === (phase === "navigation" ? 1 : 2) ? 503 : 200,
            contentType: "text/html",
            body: '<div><h2>Garmin</h2><span data-connection-state="connected" style="display:block;width:10px;height:10px"></span></div>',
          });
        });
        await expect(requireHostedLocalJunctionPersistedConnectionForTest(
          page,
          createGarminConfig(),
        )).rejects.toThrow("Persisted connect navigation returned HTTP 503.");
        expect(requests).toBe(phase === "navigation" ? 1 : 2);
      } finally {
        await browser.close();
      }
    },
  );

  it.runIf(smokeEnabled)("rejects a persisted connect redirect even with connected markup", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/connect") {
        response.writeHead(302, { location: "/signin?private=synthetic" });
        response.end();
      } else {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end('<div><h2>Garmin</h2><span data-connection-state="connected" style="display:block;width:10px;height:10px"></span></div>');
      }
    });
    const browser = await chromium.launch({ headless: false });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test port.");
      const webBaseUrl = `http://127.0.0.1:${address.port}`;
      const page = await browser.newPage();
      await expect(requireHostedLocalJunctionPersistedConnectionForTest(page, {
        ...createGarminConfig(),
        webBaseUrl,
        webOrigin: webBaseUrl,
      })).rejects.toThrow("Persisted connect navigation left the expected page.");
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it.runIf(smokeEnabled)("requires connected state after both successful persisted page loads", async () => {
    const browser = await chromium.launch({ headless: false });
    try {
      const page = await browser.newPage();
      let requests = 0;
      await page.route("https://app.example.test/connect", (route) => {
        requests += 1;
        return route.fulfill({
          contentType: "text/html",
          body: '<div><h2>Garmin</h2><span data-connection-state="connected" style="display:block;width:10px;height:10px"></span></div>',
        });
      });
      await expect(requireHostedLocalJunctionPersistedConnectionForTest(
        page,
        createGarminConfig(),
      )).resolves.toBeUndefined();
      expect(requests).toBe(2);
    } finally {
      await browser.close();
    }
  });

  it.runIf(smokeEnabled)(
    "reaches warm transport health before a connect response slower than five seconds",
    async () => {
      await withNavigationServer({ connectDelayMs: 5_500, timeoutMs: 10_000 }, async ({
        config, page, requests, tunnel,
      }) => {
        await navigateToHostedLocalJunctionStartForTest(page, config, tunnel);
        expect(await page.title()).toBe("Synthetic connect page");
        expect(requests.filter((route) => route === "/api/internal/health")).toHaveLength(1);
        expect(requests.filter((route) => route === "/connect")).toHaveLength(1);
        expect(requests[0]).toBe("/api/internal/health");
      });
    },
  );

  it.runIf(smokeEnabled)("rejects non-200 transport health without opening connect", async () => {
    await withNavigationServer({ healthStatus: 503, timeoutMs: 1_500 }, async ({
      config, page, requests, tunnel,
    }) => {
      await expect(navigateToHostedLocalJunctionStartForTest(page, config, tunnel))
        .rejects.toThrow("Kernel reverse tunnel did not reach hosted-local Web in time.");
      expect(requests).toContain("/api/internal/health");
      expect(requests).not.toContain("/connect");
    });
  });

  it.runIf(smokeEnabled)("rejects an exited tunnel before any browser request", async () => {
    await withNavigationServer({}, async ({ config, page, requests, stopTunnel, tunnel }) => {
      await stopTunnel();
      await expect(navigateToHostedLocalJunctionStartForTest(page, config, tunnel))
        .rejects.toThrow("Kernel reverse tunnel exited before reaching hosted-local Web.");
      expect(requests).toEqual([]);
    });
  });

  it.runIf(smokeEnabled)("keeps the configured connect deadline and its failure content-free", async () => {
    await withNavigationServer({ connectDelayMs: 1_500, timeoutMs: 1_000 }, async ({
      config, page, requests, tunnel,
    }) => {
      await expect(navigateToHostedLocalJunctionStartForTest(page, config, tunnel))
        .rejects.toEqual(new Error("Hosted-local connect navigation did not complete."));
      expect(requests.filter((route) => route === "/api/internal/health")).toHaveLength(1);
      expect(requests.filter((route) => route === "/connect")).toHaveLength(1);
    });
  });

  it.runIf(smokeEnabled)("launches Chromium headed inside the CI virtual display", async () => {
    const browser = await chromium.launch({ headless: false });
    try {
      expect(browser.isConnected()).toBe(true);
      const page = await browser.newPage();
      await page.setContent("<title>Hosted headed browser smoke</title>");
      await expect(page.title()).resolves.toBe("Hosted headed browser smoke");
    } finally {
      await browser.close();
    }
  });

  it.runIf(smokeEnabled)(
    "waits for the reloaded connect page before disconnecting Garmin",
    async () => {
      const browser = await chromium.launch({ headless: false });
      let releaseLoad: (() => void) | undefined;
      const loadGate = new Promise<void>((resolve) => {
        releaseLoad = resolve;
      });
      try {
        const page = await browser.newPage();
        await page.route("https://app.example.test/hold-load", async (route) => {
          await loadGate;
          await route.fulfill({ body: "", contentType: "image/png" });
        });
        await page.route("https://app.example.test/connect", (route) =>
          route.fulfill({
            body: [
              "<main>",
              "<div>",
              "<h2>Garmin</h2>",
              '<span data-connection-state="connected" ',
              'style="display:block;width:1px;height:1px"></span>',
              '<button aria-label="Disconnect account">Disconnect</button>',
              "</div>",
              '<div id="dialog-root"></div>',
              '<div id="notice"></div>',
              "</main>",
              "<script>",
              "window.disconnectClickAttempts = 0;",
              "document.addEventListener('click', (event) => {",
              "if (event.target.closest('[aria-label=\"Disconnect account\"]')) {",
              "window.disconnectClickAttempts += 1;",
              "}",
              "}, true);",
              "window.addEventListener('load', () => {",
              "document.querySelector('[aria-label=\"Disconnect account\"]')",
              ".addEventListener('click', () => {",
              "document.querySelector('#dialog-root').innerHTML = [",
              "'<div role=\"dialog\">',",
              "'<h2>Disconnect account?</h2>',",
              "'<button>Disconnect</button>',",
              "'</div>',",
              "].join('');",
              "document.querySelector('[role=\"dialog\"] button')",
              ".addEventListener('click', () => {",
              "document.querySelector('#notice').textContent = 'Source disconnected';",
              "document.querySelector('[data-connection-state]')",
              ".setAttribute('data-connection-state', 'idle');",
              "});",
              "});",
              "});",
              "</script>",
              '<img src="https://app.example.test/hold-load" alt="">',
            ].join(""),
            contentType: "text/html",
          })
        );
        await page.goto("https://app.example.test/connect", {
          waitUntil: "domcontentloaded",
        });

        const cleanup = disconnectHostedLocalJunctionAccountForTest(
          page,
          createGarminConfig(),
        );
        await expect(page.getByRole("button", { name: "Disconnect account" }).isVisible())
          .resolves.toBe(true);
        await expect(page.getByRole("dialog").count()).resolves.toBe(0);
        await expect(page.evaluate(() => Reflect.get(
          window,
          "disconnectClickAttempts",
        ))).resolves.toBe(0);

        releaseLoad?.();
        await expect(cleanup).resolves.toBeUndefined();
        await expect(page.evaluate(() => Reflect.get(
          window,
          "disconnectClickAttempts",
        ))).resolves.toBe(1);
        await expect(page.getByText("Source disconnected", { exact: true }).isVisible())
          .resolves.toBe(true);
        await expect(page.locator('[data-connection-state="idle"]').count())
          .resolves.toBe(1);
      } finally {
        releaseLoad?.();
        await browser.close();
      }
    },
  );

  it.runIf(smokeEnabled)(
    "completes Garmin's exact two-step consent flow",
    async () => {
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        await page.route("https://connect.garmin.com/**", (route) => {
          const url = new URL(route.request().url());
          const progressed = url.searchParams.has("permissionsUpdated")
            && url.searchParams.has("selectedCapabilities");
          return route.fulfill({
            body: progressed
              ? [
                '<button onclick="setTimeout(() => location.href=\'https://app.example.test/home\', 750)">',
                "Agree</button>",
                '<button onclick="location.href=\'https://app.example.test/declined\'">',
                "Do Not Agree</button>",
              ].join("")
              : [
                '<input type="checkbox" disabled>',
                '<input type="checkbox" disabled>',
                '<input type="checkbox" disabled>',
                '<button id="save">Save</button>',
                '<button onclick="location.href=\'https://app.example.test/cancel\'">',
                "Cancel</button>",
                "<script>",
                "setTimeout(() => {",
                "document.querySelectorAll('input[type=checkbox]')",
                ".forEach((input) => input.disabled = false);",
                "}, 500);",
                "document.querySelector('#save').addEventListener('click', () => {",
                "const allChecked = [...document.querySelectorAll('input[type=checkbox]')]",
                ".every((input) => input.checked);",
                "location.href = allChecked",
                "? 'https://connect.garmin.com/partner/oauthConfirm",
                "?oauth_token=opaque&oauth_callback=opaque",
                "&permissionsUpdated=1&selectedCapabilities=opaque'",
                ": 'https://app.example.test/incomplete';",
                "});",
                "</script>",
              ].join(""),
            contentType: "text/html",
          });
        });
        await page.route("https://app.example.test/**", (route) => route.fulfill({
          body: "",
          contentType: "text/html",
        }));
        await page.goto([
          "https://connect.garmin.com/partner/oauthConfirm",
          "?oauth_token=opaque&oauth_callback=opaque",
        ].join(""));

        await expect(completeExternalJunctionAuthorizationForTest(
          page,
          createGarminConfig(),
        )).resolves.toBeUndefined();
        expect(new URL(page.url()).pathname).toBe("/home");
      } finally {
        await browser.close();
      }
    },
  );

  it.runIf(smokeEnabled)(
    "does not authorize an exact-looking Garmin consent surface on another route",
    async () => {
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        await page.route("https://connect.garmin.com/**", (route) => route.fulfill({
          body: [
            '<input type="checkbox">',
            '<input type="checkbox">',
            '<input type="checkbox">',
            '<button onclick="location.href=\'https://app.example.test/unexpected\'">',
            "Save</button>",
          ].join(""),
          contentType: "text/html",
        }));
        await page.route("https://app.example.test/**", (route) => route.fulfill({
          body: "",
          contentType: "text/html",
        }));
        await page.goto("https://connect.garmin.com/partner/oauthReview");
        let now = 0;
        const timedPage = new Proxy(page, {
          get(target, property) {
            if (property === "waitForTimeout") {
              return async (duration: number) => {
                now += duration;
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });

        await expect(completeExternalJunctionAuthorizationForTest(
          timedPage,
          createGarminConfig(),
          () => now,
        )).rejects.toThrow(
          "Garmin did not expose an automated authorization action.",
        );
        await expect(page.locator('input[type="checkbox"]:checked').count())
          .resolves.toBe(0);
        expect(new URL(page.url()).pathname).toBe("/partner/oauthReview");
        expect(now).toBe(15_000);
      } finally {
        await browser.close();
      }
    },
  );

  it.runIf(smokeEnabled)(
    "keeps a failed Garmin consent checkbox action content-free",
    async () => {
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(1_000);
        await page.route("https://connect.garmin.com/**", (route) => route.fulfill({
          body: [
            '<input type="checkbox">',
            '<input type="checkbox">',
            '<input type="checkbox">',
            "<button>Save</button>",
            '<div style="position:fixed;inset:0;z-index:1">',
            "overlay-synthetic-private-marker</div>",
          ].join(""),
          contentType: "text/html",
        }));
        await page.goto("https://connect.garmin.com/partner/oauthConfirm");

        let failure: Error | undefined;
        try {
          await completeExternalJunctionAuthorizationForTest(
            page,
            createGarminConfig(),
          );
        } catch (error) {
          if (error instanceof Error) failure = error;
        }
        expect(failure?.message).toBe(
          "Authorization consent selection failed (timeout).",
        );
        expect(failure?.message).not.toContain("synthetic-private-marker");
        expect(failure?.message).not.toContain("connect.garmin.com");
        expect(failure?.message).not.toContain("browser-canary@example.invalid");
        expect(failure?.message).not.toContain("opaque-password");
      } finally {
        await browser.close();
      }
    },
    120_000,
  );

  it.runIf(smokeEnabled)(
    "reports Playwright authorization semantics across frames without content",
    async () => {
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        await page.route("https://id.whoop.com/**", (route) => route.fulfill({
          body: [
            '<span id="continue-label">Continue synthetic-private-marker</span>',
            '<div style="width:10px;height:10px" role="button"',
            ' aria-labelledby="continue-label" aria-disabled="true"></div>',
            '<button>Proceed synthetic-private-marker</button>',
            '<a href="#">Privacy policy synthetic-private-marker</a>',
            '<iframe srcdoc="<button>Authorize synthetic-private-marker</button>',
            '<button>Proceed synthetic-private-marker</button>',
            '<input type=checkbox aria-label=&quot;Required consent',
            ' synthetic-private-marker&quot;>"></iframe>',
          ].join(""),
          contentType: "text/html",
        }));
        await page.goto("https://id.whoop.com/sign-in");
        await page.waitForFunction(() =>
          document.querySelector("iframe")?.contentDocument?.readyState === "complete"
        );
        await expect(page.getByRole("button", { name: /continue/iu }).isEnabled())
          .resolves.toBe(false);

        const config = createWhoopConfig();
        const readFailure = async (subjectPage: typeof page) => {
          let now = 0;
          const timedPage = new Proxy(subjectPage, {
            get(target, property) {
              if (property === "waitForTimeout") {
                return async (duration: number) => {
                  now += duration;
                };
              }
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
          let failure: Error | undefined;
          try {
            await completeExternalJunctionAuthorizationForTest(
              timedPage,
              config,
              () => now,
            );
          } catch (error) {
            if (error instanceof Error) failure = error;
          }
          return { failure, now };
        };

        const complex = await readFailure(page);
        expect(complex.failure?.message).toContain([
          "Authorization surface: childFrames=1 mainActions=1",
          "mainEnabledActions=0 mainOtherActions=2 childActions=1",
          "childEnabledActions=1 childOtherActions=1",
          "mainUncheckedCheckboxes=0 childUncheckedCheckboxes=1.",
        ].join(" "));
        expect(complex.failure?.message).not.toContain("synthetic-private-marker");
        expect(complex.failure?.message).not.toContain("id.whoop.com");
        expect(complex.failure?.message).not.toContain("browser-canary@example.invalid");
        expect(complex.failure?.message).not.toContain("opaque-password");
        expect(complex.now).toBe(15_000);

        const emptyPage = await browser.newPage();
        await emptyPage.route("https://id.whoop.com/empty", (route) =>
          route.fulfill({ body: "", contentType: "text/html" })
        );
        await emptyPage.goto("https://id.whoop.com/empty");
        const empty = await readFailure(emptyPage);

        const unknownPage = await browser.newPage();
        await unknownPage.route("https://id.whoop.com/unknown", (route) =>
          route.fulfill({
            body: "<button>Proceed synthetic-private-marker</button>",
            contentType: "text/html",
          })
        );
        await unknownPage.goto("https://id.whoop.com/unknown");
        const unknown = await readFailure(unknownPage);

        expect(empty.failure?.message).toContain(
          "mainOtherActions=0 childActions=0",
        );
        expect(unknown.failure?.message).toContain(
          "mainOtherActions=1 childActions=0",
        );
        expect(unknown.failure?.message).not.toContain("synthetic-private-marker");
      } finally {
        await browser.close();
      }
    },
    120_000,
  );

  it.runIf(smokeEnabled)(
    "keeps WHOOP rendered GRANT bound to one denial-safe live button",
    async () => {
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        await page.route("https://id.whoop.com/**", (route) => route.fulfill({
          body: [
            '<span id="deny-label">Cancel data access</span>',
            '<button aria-labelledby="deny-label" ',
            'onclick="location.href=\'https://app.example.test/negative\'">',
            "GRANT</button>",
            '<button aria-label="Review hidden value" value="GRANT" ',
            'onclick="location.href=\'https://app.example.test/hidden\'">',
            "Review data access</button>",
            '<button aria-label="Review requested data access" ',
            'onclick="location.href=\'https://app.example.test/home\'">',
            "GRANT</button>",
          ].join(""),
          contentType: "text/html",
        }));
        await page.route("https://app.example.test/**", (route) => route.fulfill({
          body: "",
          contentType: "text/html",
        }));
        await page.goto("https://id.whoop.com/consent");

        await expect(completeExternalJunctionAuthorizationForTest(
          page,
          createWhoopConfig(),
        )).resolves.toBeUndefined();
        expect(new URL(page.url()).pathname).toBe("/home");
      } finally {
        await browser.close();
      }
    },
  );

  it.runIf(smokeEnabled)(
    "keeps a failed WHOOP consent click content-free",
    async () => {
      const browser = await chromium.launch({ headless: false });
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(1_000);
        await page.route("https://id.whoop.com/**", (route) => route.fulfill({
          body: [
            '<button aria-label="Review synthetic-private-marker access">',
            "GRANT</button>",
            '<div style="position:fixed;inset:0;z-index:1">',
            "overlay-synthetic-private-marker</div>",
          ].join(""),
          contentType: "text/html",
        }));
        await page.goto("https://id.whoop.com/consent");

        let failure: Error | undefined;
        try {
          await completeExternalJunctionAuthorizationForTest(
            page,
            createWhoopConfig(),
          );
        } catch (error) {
          if (error instanceof Error) failure = error;
        }
        expect(failure?.message).toBe(
          "Authorization action failed (timeout); action=whoop_grant; "
          + "before=whoop.com/other; after=whoop.com/other.",
        );
        expect(failure?.message).not.toContain("synthetic-private-marker");
        expect(failure?.message).not.toContain("id.whoop.com");
      } finally {
        await browser.close();
      }
    },
    120_000,
  );
});

async function withNavigationServer(
  input: { connectDelayMs?: number; healthStatus?: number; timeoutMs?: number },
  run: (fixture: {
    config: ReturnType<typeof createGarminConfig>;
    page: Parameters<typeof navigateToHostedLocalJunctionStartForTest>[0];
    requests: string[];
    stopTunnel: () => Promise<void>;
    tunnel: NonNullable<Parameters<typeof navigateToHostedLocalJunctionStartForTest>[2]>;
  }) => Promise<void>,
): Promise<void> {
  const requests: string[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const respond = (response: ServerResponse, body: string, status = 200) => {
    response.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "text/html" });
    response.end(body);
  };
  const server = createServer((request, response) => {
    const route = new URL(request.url ?? "/", "http://localhost").pathname;
    requests.push(route);
    if (route === "/api/internal/health") {
      respond(response, "healthy", input.healthStatus);
    } else if (route === "/connect") {
      const timer = setTimeout(() => {
        timers.delete(timer);
        respond(response, "<title>Synthetic connect page</title>");
      }, input.connectDelayMs ?? 0);
      timers.add(timer);
    } else {
      respond(response, "", 404);
    }
  });
  // Only process lifetime is represented here; HTTP and Chromium are real.
  // The protected provider lane remains the proof of Kernel's actual SSH tunnel.
  const child = spawn(process.execPath, ["-e", "process.stdin.resume()"], {
    env: { NODE_ENV: "test" },
    stdio: ["pipe", "ignore", "ignore"],
  });
  const childExited = once(child, "exit");
  const stopTunnel = async () => {
    child.stdin.end();
    await childExited;
  };
  let browser: Browser | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string" || child.pid === undefined) {
      throw new Error("Synthetic navigation fixture did not start.");
    }
    const webBaseUrl = `http://127.0.0.1:${address.port}`;
    const config = {
      ...createGarminConfig(),
      startUrl: `${webBaseUrl}/connect`,
      timeoutMs: input.timeoutMs ?? 10_000,
      webBaseUrl,
      webOrigin: webBaseUrl,
    };
    browser = await chromium.launch({
      env: {
        DISPLAY: process.env.DISPLAY ?? "",
        XAUTHORITY: process.env.XAUTHORITY ?? "",
      },
      headless: false,
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(config.timeoutMs);
    await run({
      config,
      page,
      requests,
      stopTunnel,
      tunnel: {
        child,
        processId: child.pid,
        removeParentExitHandler: () => undefined,
        spawnFailed: false,
      },
    });
  } finally {
    for (const timer of timers) clearTimeout(timer);
    const cleanup = await Promise.allSettled([
      browser?.close(),
      stopTunnel(),
      new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      }),
    ]);
    for (const result of cleanup) {
      if (result.status === "rejected") throw new Error("Synthetic navigation fixture cleanup failed.");
    }
  }
}
