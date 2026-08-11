import {
  chromium,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";

const MOTION_FREEZE_INIT_SCRIPT = String.raw`
(() => {
  const install = () => {
    const target = document.head ?? document.documentElement;
    if (!target) return false;
    const style = document.createElement("style");
    style.textContent =
      "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}";
    target.appendChild(style);
    return true;
  };
  if (!install()) {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  }
})();
`;

const SETTLED_HORIZONTAL_OVERFLOW_EXPRESSION = String.raw`
(async () => {
  await document.fonts?.ready;
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  return document.documentElement.scrollWidth
    - document.documentElement.clientWidth;
})()
`;

const browserCases = [
  {
    contextOptions: {
      hasTouch: true,
      isMobile: true,
      viewport: { height: 844, width: 390 },
    },
    name: "compact-touch",
  },
  {
    contextOptions: {
      viewport: { height: 900, width: 1_280 },
    },
    name: "desktop",
  },
] as const satisfies readonly {
  contextOptions: Omit<BrowserContextOptions, "baseURL">;
  name: string;
}[];

async function main(): Promise<void> {
  const config = readConfig(process.env);
  clearBrowserContractEnvironment();
  const webBaseUrl = new URL(config.webBaseUrl);
  const browser = await chromium.launch({ headless: true });

  try {
    for (const browserCase of browserCases) {
      const context = await browser.newContext({
        ...browserCase.contextOptions,
        baseURL: webBaseUrl.toString(),
        locale: "en-US",
        reducedMotion: "reduce",
      });
      try {
        await addHostedSessionCookie({
          context,
          sessionCookie: config.sessionCookie,
          webBaseUrl,
        });
        const page = await context.newPage();
        page.setDefaultTimeout(config.timeoutMs);
        page.setDefaultNavigationTimeout(config.timeoutMs);
        await prepareStablePrivatePage(page, webBaseUrl);
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => {
          pageErrors.push(sanitizeBrowserSmokeFailure(error));
        });

        await proveConnectJourney({
          caseName: browserCase.name,
          page,
          webBaseUrl,
        });
        if (pageErrors.length !== 0) {
          const distinctErrors = [...new Set(pageErrors)].slice(0, 4);
          throw new Error(
            `Hosted browser ${browserCase.name} emitted ${pageErrors.length} uncaught page error(s): ${JSON.stringify(distinctErrors)}`,
          );
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  process.stdout.write(`MURPH_E2E_RESULT=${JSON.stringify({
    cases: browserCases.map((browserCase) => browserCase.name),
    ok: true,
  })}\n`);
}

async function prepareStablePrivatePage(
  page: Page,
  webBaseUrl: URL,
): Promise<void> {
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === webBaseUrl.origin) {
      await route.continue();
      return;
    }
    await route.abort();
  });
  await page.addInitScript({ content: MOTION_FREEZE_INIT_SCRIPT });
}

async function proveConnectJourney(input: {
  caseName: string;
  page: Page;
  webBaseUrl: URL;
}): Promise<void> {
  const navigation = await input.page.goto("/connect", {
    waitUntil: "load",
  });
  assertSuccessfulNavigation(navigation, input.caseName, "initial");
  await assertConnectPage(input);

  const reload = await input.page.reload({ waitUntil: "load" });
  assertSuccessfulNavigation(reload, input.caseName, "reload");
  await assertConnectPage(input);
}

function assertSuccessfulNavigation(
  response: Response | null,
  caseName: string,
  phase: "initial" | "reload",
): void {
  if (!response?.ok()) {
    throw new Error(
      `Hosted browser ${caseName} ${phase} navigation returned HTTP ${response?.status() ?? "none"}.`,
    );
  }
}

async function assertConnectPage(input: {
  caseName: string;
  page: Page;
  webBaseUrl: URL;
}): Promise<void> {
  const currentUrl = new URL(input.page.url());
  if (
    currentUrl.origin !== input.webBaseUrl.origin
    || currentUrl.pathname !== "/connect"
  ) {
    throw new Error(
      `Hosted browser ${input.caseName} did not remain on the authenticated Connect route.`,
    );
  }
  if (await input.page.title() !== "Connect Devices — Murph") {
    throw new Error(
      `Hosted browser ${input.caseName} rendered the wrong document title.`,
    );
  }

  await input.page.getByRole("heading", {
    exact: true,
    name: "Sync your biomarkers",
  }).waitFor({ state: "visible" });
  await requireSingleVisible({
    caseName: input.caseName,
    label: "source search control",
    locator: input.page.locator('input[aria-label="Search sources"]:visible'),
  });
  await requireSingleVisible({
    caseName: input.caseName,
    label: "source count",
    locator: input.page.locator("p:visible").filter({
      hasText: /^\d+ of \d+ sources$/u,
    }),
  });
  await requireSingleVisible({
    caseName: input.caseName,
    label: "Whoop source heading",
    locator: input.page.locator("h2:visible").filter({ hasText: /^Whoop$/u }),
  });

  const connectButton = await requireSingleVisible({
    caseName: input.caseName,
    label: "Whoop connect action",
    locator: input.page.locator('button[aria-label="Connect Whoop"]:visible'),
  });
  if (!await connectButton.isEnabled()) {
    throw new Error(
      `Hosted browser ${input.caseName} rendered a disabled Whoop connection.`,
    );
  }
  if (
    await input.page.locator(
      '[data-dashboard-legal-consent-gate="true"]',
    ).count() !== 0
  ) {
    throw new Error(
      `Hosted browser ${input.caseName} unexpectedly rendered the launch-consent gate.`,
    );
  }

  const horizontalOverflow = Number(
    await input.page.evaluate(SETTLED_HORIZONTAL_OVERFLOW_EXPRESSION),
  );
  if (horizontalOverflow > 1) {
    throw new Error(
      `Hosted browser ${input.caseName} overflowed horizontally by ${horizontalOverflow}px.`,
    );
  }

  await connectButton.click();
  const disclosureDialog = await requireSingleVisible({
    caseName: input.caseName,
    label: "Whoop disclosure dialog",
    locator: input.page.locator('[role="dialog"]:visible'),
  });
  await disclosureDialog.getByRole("heading", {
    exact: true,
    name: "Connect Whoop to Murph",
  }).waitFor({ state: "visible" });
  await disclosureDialog.getByRole("button", {
    exact: true,
    name: "Continue to Whoop",
  }).waitFor({ state: "visible" });
}

async function requireSingleVisible(input: {
  caseName: string;
  label: string;
  locator: Locator;
}): Promise<Locator> {
  const first = input.locator.first();
  await first.waitFor({ state: "visible" });
  const count = await input.locator.count();
  if (count !== 1) {
    throw new Error(
      `Hosted browser ${input.caseName} rendered ${count} visible ${input.label} elements.`,
    );
  }
  return first;
}

async function addHostedSessionCookie(input: {
  context: BrowserContext;
  sessionCookie: string;
  webBaseUrl: URL;
}): Promise<void> {
  const pair = input.sessionCookie.split(";", 1)[0]?.trim() ?? "";
  const separatorIndex = pair.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error("Hosted browser smoke session cookie was malformed.");
  }

  const cookieName = pair.slice(0, separatorIndex);
  const cookieUrl = new URL(input.webBaseUrl);
  if (cookieName.startsWith("__Host-")) {
    cookieUrl.protocol = "https:";
  }
  await input.context.addCookies([{
    httpOnly: true,
    name: cookieName,
    sameSite: "Lax",
    secure:
      cookieName.startsWith("__Host-")
      || input.webBaseUrl.protocol === "https:",
    url: cookieUrl.toString(),
    value: decodeURIComponent(pair.slice(separatorIndex + 1)),
  }]);
}

function readConfig(env: NodeJS.ProcessEnv): {
  sessionCookie: string;
  timeoutMs: number;
  webBaseUrl: string;
} {
  const webBaseUrl = requireEnvironmentValue(env, "MURPH_E2E_WEB_BASE_URL");
  const sessionCookie = requireEnvironmentValue(
    env,
    "MURPH_E2E_HOSTED_SESSION_COOKIE",
  );
  const timeoutMs = Number(
    env.MURPH_E2E_BROWSER_TIMEOUT_MS?.trim() || "120000",
  );
  if (
    !Number.isInteger(timeoutMs)
    || timeoutMs < 30_000
    || timeoutMs > 300_000
  ) {
    throw new Error(
      "MURPH_E2E_BROWSER_TIMEOUT_MS must be an integer from 30000 to 300000.",
    );
  }

  const parsedBaseUrl = new URL(webBaseUrl);
  if (
    parsedBaseUrl.protocol !== "http:"
    || (
      parsedBaseUrl.hostname !== "localhost"
      && parsedBaseUrl.hostname !== "127.0.0.1"
    )
  ) {
    throw new Error(
      "Hosted browser smoke requires a loopback HTTP web URL.",
    );
  }

  return {
    sessionCookie,
    timeoutMs,
    webBaseUrl: parsedBaseUrl.toString(),
  };
}

function requireEnvironmentValue(
  env: NodeJS.ProcessEnv,
  key: string,
): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Hosted browser smoke requires ${key}.`);
  }
  return value;
}

function clearBrowserContractEnvironment(): void {
  for (const key of [
    "MURPH_E2E_BROWSER_TIMEOUT_MS",
    "MURPH_E2E_HOSTED_SESSION_COOKIE",
    "MURPH_E2E_WEB_BASE_URL",
  ]) {
    delete process.env[key];
  }
}

function sanitizeBrowserSmokeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/murph_session_v2\.[A-Za-z0-9._-]+/gu, "[redacted-session]")
    .replace(/https?:\/\/[^\s)]+/gu, "[redacted-url]")
    .slice(0, 600);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Hosted browser smoke failed: ${sanitizeBrowserSmokeFailure(error)}\n`,
  );
  process.exitCode = 1;
});
