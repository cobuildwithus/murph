import {
  chromium,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";

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
        let pageErrorCount = 0;
        page.on("pageerror", () => {
          pageErrorCount += 1;
        });

        await proveConnectJourney({
          caseName: browserCase.name,
          page,
          webBaseUrl,
        });
        if (pageErrorCount !== 0) {
          throw new Error(
            `Hosted browser ${browserCase.name} emitted ${pageErrorCount} uncaught page error(s).`,
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

async function proveConnectJourney(input: {
  caseName: string;
  page: Page;
  webBaseUrl: URL;
}): Promise<void> {
  const navigation = await input.page.goto("/connect", {
    waitUntil: "domcontentloaded",
  });
  if (!navigation?.ok()) {
    throw new Error(
      `Hosted browser ${input.caseName} navigation returned HTTP ${navigation?.status() ?? "none"}.`,
    );
  }
  await assertConnectPage(input);

  await input.page.reload({ waitUntil: "domcontentloaded" });
  await assertConnectPage(input);
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
  await input.page.getByLabel("Search sources", { exact: true }).waitFor({
    state: "visible",
  });
  await input.page.getByText(/^\d+ of \d+ sources$/u).waitFor({
    state: "visible",
  });
  await input.page.getByRole("heading", {
    exact: true,
    name: "Whoop",
  }).waitFor({ state: "visible" });

  const connectButton = input.page.getByRole("button", {
    exact: true,
    name: "Connect Whoop",
  });
  await connectButton.waitFor({ state: "visible" });
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

  const horizontalOverflow = await input.page.evaluate(() =>
    document.documentElement.scrollWidth
      - document.documentElement.clientWidth
  );
  if (horizontalOverflow > 1) {
    throw new Error(
      `Hosted browser ${input.caseName} overflowed horizontally by ${horizontalOverflow}px.`,
    );
  }
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

await main();
