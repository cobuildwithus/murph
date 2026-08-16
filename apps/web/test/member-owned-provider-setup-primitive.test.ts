import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import { parseHostedRuntimeProviderSetupToolRequest } from "@murphai/hosted-execution/provider-setup";

import {
  STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
  buildMemberOwnedProviderSetupBrowserContract,
  listMemberOwnedProviderSetupRegistrations,
} from "@/src/lib/device-sync/provider-setup/registry";
import {
  buildBlindOwnedApplicationDeleteCode,
  buildBlindProviderCredentialCaptureCode,
} from "@/src/lib/device-sync/provider-setup/service";
import {
  toMemberOwnedProviderSetupView,
  type MemberOwnedProviderSetupRecord,
} from "@/src/lib/device-sync/provider-setup/types";

const MEMBER_ID = "member_synthetic";
const CREDENTIALS_URL = "https://provider.example.test/settings/api";

const SETUP: MemberOwnedProviderSetupRecord = {
  active: true,
  browserRunId: null,
  completedAt: null,
  connectSourceId: "strava",
  connectTarget: "strava",
  createdAt: new Date("2026-08-11T12:00:00.000Z"),
  id: "dps_synthetic",
  memberId: MEMBER_ID,
  provider: "strava",
  providerApplicationId: null,
  providerApplicationRevision: null,
  sourceProviderSlug: null,
  status: "pending",
  updatedAt: new Date("2026-08-11T12:00:00.000Z"),
  version: 1,
};

describe("member-owned provider setup contract", () => {
  it("keeps Strava declarative and derives the browser contract from shared OAuth metadata", () => {
    const registrations = listMemberOwnedProviderSetupRegistrations();
    const contract = buildMemberOwnedProviderSetupBrowserContract({
      env: { HOSTED_WEB_BASE_URL: "https://web.example.test" },
      provider: "strava",
    });

    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      browser: {
        applicationCategory: "Other",
        applicationWebsite: "https://withmurph.ai",
        developerPortalUrl: "https://www.strava.com/settings/api",
        trustedAuthority: {
          clientIdSelector: "[data-strava-client-id]",
          clientSecretSelector: "[data-strava-client-secret]",
          credentialsPageUrl: "https://www.strava.com/settings/api",
          revealSecretSelector: "[data-strava-client-secret-reveal]",
        },
      },
      coordinates: {
        connectSourceId: "strava",
        connectTarget: "strava",
        provider: "strava",
      },
    });
    expect(contract).toMatchObject({
      application: {
        callbackUrl: "https://web.example.test/api/device-sync/oauth/strava/callback",
        category: "Other",
        readOnlyScopes: ["activity:read"],
        website: "https://withmurph.ai",
      },
      credentialsPageUrl: "https://www.strava.com/settings/api",
      developerPortalUrl: "https://www.strava.com/settings/api",
      provider: "strava",
    });
    expect(contract.application).not.toHaveProperty("name");
    expect(contract.application).not.toHaveProperty("marker");
    expect(contract.guidance.join(" ")).toMatch(/ordinary computer-use browsing/iu);
    expect(contract.guidance.join(" ")).toMatch(/without reading, copying, or transcribing/iu);
    expect(contract.guidance.join(" ")).toMatch(/provider_setup capture/iu);
    expect(contract.guidance.join(" ")).not.toMatch(
      /input\[|button\.|data-testid|xpath/iu,
    );
  });

  it("keeps capture selector-free and rejects names, selectors, or credential values", () => {
    const parsed = parseHostedRuntimeProviderSetupToolRequest({
      action: "capture",
      provider: "strava",
      runId: "hcr_synthetic",
      setupId: "dps_synthetic",
    });

    expect(parsed).toEqual({
      action: "capture",
      provider: "strava",
      runId: "hcr_synthetic",
      setupId: "dps_synthetic",
    });
    for (const extra of [
      { applicationName: "Synthetic Application" },
      { clientId: "client-id" },
      { clientSecret: "client-secret" },
      { clientIdSelector: "[data-client-id]" },
      { selectorProgram: "await page.locator('provider-specific').click()" },
    ]) {
      expect(() => parseHostedRuntimeProviderSetupToolRequest({
        ...parsed,
        ...extra,
      })).toThrow();
    }
  });

  it("keeps final capture and deletion generic, exact, and blind", () => {
    const capture = buildBlindProviderCredentialCaptureCode({
      clientIdSelector: "#runtime-client-id",
      clientSecretSelector: "#runtime-client-secret",
      credentialsPageUrl: CREDENTIALS_URL,
      revealSecretSelector: "#runtime-reveal",
    });
    const deletion = buildBlindOwnedApplicationDeleteCode({
      clientIdSelector: "#runtime-client-id",
      confirmSelector: "#runtime-confirm",
      credentialsPageUrl: CREDENTIALS_URL,
      deleteSelector: "#runtime-delete",
      expectedClientId: "right-id",
    });

    expect(capture).toContain("return capturedCredentials");
    expect(capture).toContain("client ID selector");
    expect(capture).toContain("client secret selector");
    expect(capture).toContain(CREDENTIALS_URL);
    expect(capture).not.toMatch(/strava/iu);
    expect(deletion).toContain("provider application client ID does not match deletion authority");
    expect(deletion).toContain('return { kind: "already_deleted" }');
    expect(deletion).toContain('return { kind: "deleted" }');
    expect(deletion).not.toMatch(/strava/iu);
  });

  it("captures the registered fields without a reveal click and scrubs the page", async () => {
    const page = createFixturePage();
    page.setRoute(CREDENTIALS_URL, `
      <main>
        <output class="client-secret">right-secret</output>
        <output class="client-id">right-id</output>
      </main>
    `);
    const run = buildCaptureRunner({
      clientIdSelector: ".client-id",
      clientSecretSelector: ".client-secret",
      credentialsPageUrl: CREDENTIALS_URL,
      revealSecretSelector: null,
    });

    await expect(run(page)).resolves.toEqual({
      clientId: "right-id",
      clientSecret: "right-secret",
    });
    expect(page.clickSelectors).toEqual([]);
    expect(page.url()).toBe("about:blank");
  });

  it("clicks the registered reveal control before reading the secret", async () => {
    const page = createFixturePage();
    page.setRoute(CREDENTIALS_URL, `
      <main>
        <output class="client-id">right-id</output>
        <output class="client-secret"></output>
        <button class="reveal" type="button">Reveal</button>
      </main>
    `);
    page.setClickEffect(".reveal", (_element, document) => {
      const secret = document.querySelector(".client-secret");
      if (secret) {
        secret.textContent = "right-secret";
      }
    });
    const run = buildCaptureRunner({
      clientIdSelector: ".client-id",
      clientSecretSelector: ".client-secret",
      credentialsPageUrl: CREDENTIALS_URL,
      revealSecretSelector: ".reveal",
    });

    await expect(run(page)).resolves.toEqual({
      clientId: "right-id",
      clientSecret: "right-secret",
    });
    expect(page.clickSelectors).toEqual([".reveal"]);
  });

  it.each([
    {
      html: `
        <output class="client-id">first-id</output>
        <output class="client-id">second-id</output>
        <output class="client-secret">right-secret</output>
      `,
      label: "client ID selector",
    },
    {
      html: `
        <output class="client-id">right-id</output>
        <output class="client-secret">first-secret</output>
        <output class="client-secret">second-secret</output>
      `,
      label: "client secret selector",
    },
  ])("fails closed when the registered $label is non-unique", async ({ html, label }) => {
    const page = createFixturePage();
    page.setRoute(CREDENTIALS_URL, html);
    const run = buildCaptureRunner({
      clientIdSelector: ".client-id",
      clientSecretSelector: ".client-secret",
      credentialsPageUrl: CREDENTIALS_URL,
      revealSecretSelector: null,
    });

    await expect(run(page)).rejects.toThrow(
      `${label} must resolve to exactly one visible element`,
    );
    expect(page.clickSelectors).toEqual([]);
  });

  it("fails closed when capture lands on a different credentials path", async () => {
    const page = createFixturePage();
    page.setRoute(CREDENTIALS_URL, {
      finalUrl: "https://provider.example.test/settings/profile",
      html: `
        <output class="client-id">right-id</output>
        <output class="client-secret">right-secret</output>
      `,
    });
    const run = buildCaptureRunner({
      clientIdSelector: ".client-id",
      clientSecretSelector: ".client-secret",
      credentialsPageUrl: CREDENTIALS_URL,
      revealSecretSelector: null,
    });

    await expect(run(page)).rejects.toThrow("provider credentials page is unavailable");
  });

  it("deletes only after the on-page client ID matches sealed authority", async () => {
    let deleted = false;
    const page = createFixturePage();
    page.setRoute(CREDENTIALS_URL, () => deleted
      ? "<main>Application removed</main>"
      : `
          <main>
            <output class="client-id">right-id</output>
            <button class="delete" type="button">Delete</button>
            <button class="confirm" type="button">Confirm</button>
          </main>
        `);
    page.setClickEffect(".confirm", () => {
      deleted = true;
    });
    const run = buildDeleteRunner({
      clientIdSelector: ".client-id",
      confirmSelector: ".confirm",
      credentialsPageUrl: CREDENTIALS_URL,
      deleteSelector: ".delete",
      expectedClientId: "right-id",
    });

    await expect(run(page)).resolves.toEqual({ kind: "deleted" });
    expect(page.clickSelectors).toEqual([".delete", ".confirm"]);
  });

  it("fails closed on a deletion client-ID mismatch before clicking controls", async () => {
    const page = createFixturePage();
    page.setRoute(CREDENTIALS_URL, `
      <main>
        <output class="client-id">wrong-id</output>
        <button class="delete" type="button">Delete</button>
      </main>
    `);
    const run = buildDeleteRunner({
      clientIdSelector: ".client-id",
      confirmSelector: null,
      credentialsPageUrl: CREDENTIALS_URL,
      deleteSelector: ".delete",
      expectedClientId: "right-id",
    });

    await expect(run(page)).rejects.toThrow(
      "provider application client ID does not match deletion authority",
    );
    expect(page.clickSelectors).toEqual([]);
  });

  it("treats a clean credentials page with no client-ID element as already absent", async () => {
    const page = createFixturePage();
    page.setRoute(CREDENTIALS_URL, "<main>No private application</main>");
    const run = buildDeleteRunner({
      clientIdSelector: ".client-id",
      confirmSelector: null,
      credentialsPageUrl: CREDENTIALS_URL,
      deleteSelector: ".delete",
      expectedClientId: "right-id",
    });

    await expect(run(page)).resolves.toEqual({ kind: "already_deleted" });
    expect(page.clickSelectors).toEqual([]);
  });

  it("fails closed when deletion authority resolves ambiguously", async () => {
    const page = createFixturePage();
    page.setRoute(CREDENTIALS_URL, `
      <output class="client-id">right-id</output>
      <output class="client-id">right-id</output>
      <button class="delete" type="button">Delete</button>
    `);
    const run = buildDeleteRunner({
      clientIdSelector: ".client-id",
      confirmSelector: null,
      credentialsPageUrl: CREDENTIALS_URL,
      deleteSelector: ".delete",
      expectedClientId: "right-id",
    });

    await expect(run(page)).rejects.toThrow(
      "client ID selector must resolve to exactly one visible element",
    );
    expect(page.clickSelectors).toEqual([]);
  });

  it("projects only member-facing actions from the reduced durable lifecycle", () => {
    expect(toMemberOwnedProviderSetupView(
      SETUP,
      STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    ).action).toBe("authorize");
    expect(toMemberOwnedProviderSetupView(
      { ...SETUP, status: "authorized" },
      STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    ).action).toBe("none");
    expect(toMemberOwnedProviderSetupView(
      { ...SETUP, status: "browser_setup" },
      STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
      { handoffAvailable: true },
    ).action).toBe("continue_handoff");
    expect(toMemberOwnedProviderSetupView(
      {
        ...SETUP,
        providerApplicationId: "dpa_synthetic",
        providerApplicationRevision: 1,
        status: "oauth_ready",
      },
      STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    ).action).toBe("continue_oauth");
    expect(toMemberOwnedProviderSetupView(
      { ...SETUP, status: "disconnect_first" },
      STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    ).action).toBe("disconnect_first");
  });
});

type CaptureBuilderInput = Parameters<
  typeof buildBlindProviderCredentialCaptureCode
>[0];
type DeleteBuilderInput = Parameters<
  typeof buildBlindOwnedApplicationDeleteCode
>[0];

type FixtureWindow = Window & typeof globalThis;
type FixtureRoute = string | {
  finalUrl: string;
  html: string;
};
type FixtureRouteFactory = () => FixtureRoute;
type FixtureClickEffect = (
  element: Element,
  document: Document,
) => void | Promise<void>;

function buildCaptureRunner(input: CaptureBuilderInput): (
  page: FixturePage,
) => Promise<{ clientId: string; clientSecret: string }> {
  const code = buildBlindProviderCredentialCaptureCode(input);
  return new Function("page", `return (async () => {${code}})();`) as (
    page: FixturePage,
  ) => Promise<{ clientId: string; clientSecret: string }>;
}

function buildDeleteRunner(input: DeleteBuilderInput): (
  page: FixturePage,
) => Promise<{ kind: "already_deleted" | "deleted" }> {
  const code = buildBlindOwnedApplicationDeleteCode(input);
  return new Function("page", `return (async () => {${code}})();`) as (
    page: FixturePage,
  ) => Promise<{ kind: "already_deleted" | "deleted" }>;
}

class FixtureLocator {
  constructor(
    private readonly page: FixturePage,
    private readonly roots: readonly Element[],
    private readonly selector: string,
    private readonly index: number | null = null,
  ) {}

  async click(): Promise<void> {
    const element = this.requireOne();
    if (!isVisibleElement(element)) {
      throw new Error(`Fixture locator is not visible for ${this.selector}.`);
    }
    await this.page.withGlobals(() => (element as HTMLElement).click());
    await this.page.runClickEffect(this.selector, element);
    this.page.recordClick(this.selector);
  }

  async count(): Promise<number> {
    return this.elements().length;
  }

  async evaluate<T>(callback: (element: Element) => T): Promise<T> {
    return await this.page.withGlobals(() => callback(this.requireOne()));
  }

  first(): FixtureLocator {
    return new FixtureLocator(this.page, this.roots, this.selector, 0);
  }

  async inputValue(): Promise<string> {
    return (this.requireOne() as HTMLInputElement | HTMLTextAreaElement).value;
  }

  async isVisible(): Promise<boolean> {
    const elements = this.elements();
    return elements.length === 1 && isVisibleElement(elements[0]);
  }

  async textContent(): Promise<string | null> {
    return this.requireOne().textContent;
  }

  async waitFor(): Promise<void> {
    const element = this.requireOne();
    if (!isVisibleElement(element)) {
      throw new Error(`Fixture locator is not visible for ${this.selector}.`);
    }
  }

  private elements(): Element[] {
    const matches = this.roots.flatMap((root) =>
      Array.from(root.querySelectorAll(this.selector))
    );
    if (this.index === null) {
      return matches;
    }
    const match = matches[this.index];
    return match ? [match] : [];
  }

  private requireOne(): Element {
    const elements = this.elements();
    if (elements.length !== 1) {
      throw new Error(`Fixture locator expected one element for ${this.selector}.`);
    }
    return elements[0];
  }
}

class FixturePage {
  readonly clickSelectors: string[] = [];
  private clickEffects = new Map<string, FixtureClickEffect>();
  private currentUrl = "about:blank";
  private document: Document;
  private routes = new Map<string, FixtureRoute | FixtureRouteFactory>();
  private window: FixtureWindow;

  constructor() {
    ({ document: this.document, window: this.window } = parseFixtureDocument(""));
    this.installLocation();
  }

  async close(): Promise<void> {}

  async evaluate<T, TArgument = undefined>(
    callback: (argument: TArgument) => T,
    argument?: TArgument,
  ): Promise<T> {
    return await this.withGlobals(() => callback(argument as TArgument));
  }

  async goto(url: string): Promise<{ ok: () => boolean }> {
    const configured = this.routes.get(url);
    const route = typeof configured === "function" ? configured() : configured;
    const resolved = typeof route === "string"
      ? { finalUrl: url, html: route }
      : route ?? { finalUrl: url, html: "" };
    this.currentUrl = resolved.finalUrl;
    ({ document: this.document, window: this.window } = parseFixtureDocument(
      resolved.html,
    ));
    this.installLocation();
    return { ok: () => true };
  }

  locator(selector: string): FixtureLocator {
    return new FixtureLocator(this, [this.document.documentElement], selector);
  }

  recordClick(selector: string): void {
    this.clickSelectors.push(selector);
  }

  async runClickEffect(selector: string, element: Element): Promise<void> {
    await this.clickEffects.get(selector)?.(element, this.document);
  }

  setClickEffect(selector: string, effect: FixtureClickEffect): void {
    this.clickEffects.set(selector, effect);
  }

  setRoute(url: string, route: FixtureRoute | FixtureRouteFactory): void {
    this.routes.set(url, route);
  }

  url(): string {
    return this.currentUrl;
  }

  async waitForLoadState(): Promise<void> {}

  async withGlobals<T>(callback: () => T | Promise<T>): Promise<T> {
    const previous = new Map<string, PropertyDescriptor | undefined>();
    for (const [name, value] of Object.entries({
      document: this.document,
      window: this.window,
    })) {
      previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value,
        writable: true,
      });
    }
    try {
      return await callback();
    } finally {
      for (const [name, descriptor] of previous) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          Reflect.deleteProperty(globalThis, name);
        }
      }
    }
  }

  private installLocation(): void {
    Object.defineProperty(this.window, "location", {
      configurable: true,
      value: { href: this.currentUrl },
    });
  }
}

function createFixturePage(): FixturePage {
  return new FixturePage();
}

function isVisibleElement(element: Element | undefined): boolean {
  if (!element) {
    return false;
  }
  const style = element.getAttribute("style")?.toLowerCase() ?? "";
  return !element.hasAttribute("hidden")
    && element.getAttribute("aria-hidden") !== "true"
    && element.getAttribute("type") !== "hidden"
    && !style.includes("display:none")
    && !style.includes("display: none")
    && !style.includes("visibility:hidden")
    && !style.includes("visibility: hidden");
}

function parseFixtureDocument(html: string): {
  document: Document;
  window: FixtureWindow;
} {
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`) as {
    document: Document;
    window: FixtureWindow;
  };
}
