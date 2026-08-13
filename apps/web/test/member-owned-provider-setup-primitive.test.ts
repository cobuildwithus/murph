import { randomUUID } from "node:crypto";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import { parseHostedRuntimeProviderSetupToolRequest } from "@murphai/hosted-execution/provider-setup";

import {
  STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
  buildMemberOwnedProviderApplicationMarker,
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
      memberId: MEMBER_ID,
      provider: "strava",
    });

    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      browser: {
        applicationCategory: "Other",
        applicationWebsite: "https://withmurph.ai",
        developerPortalUrl: "https://www.strava.com/settings/api",
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
      developerPortalUrl: "https://www.strava.com/settings/api",
      provider: "strava",
    });
    expect(contract.guidance.join(" ")).toMatch(/live page/iu);
    expect(contract.guidance.join(" ")).toMatch(/trusted browser boundary/iu);
    expect(contract.guidance.join(" ")).not.toMatch(/input\[|button\.|data-testid|xpath/iu);
  });

  it("uses a stable opaque ownership marker without exposing the member id", () => {
    const first = buildMemberOwnedProviderApplicationMarker({
      memberId: MEMBER_ID,
      provider: "strava",
    });
    const second = buildMemberOwnedProviderApplicationMarker({
      memberId: MEMBER_ID,
      provider: "strava",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^Murph Private Sync [a-f0-9]{12}$/u);
    expect(first).not.toContain(MEMBER_ID);
  });

  it("accepts only the runtime selector handoff and rejects credential-shaped tool input", () => {
    const parsed = parseHostedRuntimeProviderSetupToolRequest({
      action: "capture",
      clientIdSelector: "[data-client-id]",
      clientSecretSelector: "[data-client-secret]",
      provider: "strava",
      revealSecretSelector: null,
      runId: "hcr_synthetic",
      setupId: "dps_synthetic",
      submitSelector: "button[type=submit]",
    });

    expect(parsed.action).toBe("capture");
    expect(() => parseHostedRuntimeProviderSetupToolRequest({
      ...parsed,
      clientSecret: randomUUID(),
    })).toThrow();
    expect(() => parseHostedRuntimeProviderSetupToolRequest({
      ...parsed,
      selectorProgram: "await page.locator('provider-specific').click()",
    })).toThrow();
  });

  it("keeps final capture and deletion generic, exact, and blind", () => {
    const capture = buildBlindProviderCredentialCaptureCode({
      applicationContainerSelector: "form[data-owned-application]",
      clientIdSelector: "#runtime-client-id",
      clientSecretSelector: "#runtime-client-secret",
      creationFormSelector: "form[data-owned-application]",
      marker: "Murph Private Sync fixture",
      revealSecretSelector: "#runtime-reveal",
      safeLandingUrl: "https://provider.example.test/apps",
      submitSelector: "#runtime-submit",
    });
    const deletion = buildBlindOwnedApplicationDeleteCode({
      applicationContainerSelector: "section[data-owned-application]",
      confirmSelector: "#runtime-confirm",
      deleteSelector: "#runtime-delete",
      marker: "Murph Private Sync fixture",
      safeLandingUrl: "https://provider.example.test/apps",
    });

    expect(capture).toContain("return { clientId, clientSecret }");
    expect(capture).toContain("provider application ownership marker mismatch");
    expect(capture).toContain("https://provider.example.test/apps");
    expect(capture).not.toMatch(/strava/iu);
    expect(deletion).toContain("provider application ownership marker mismatch");
    expect(deletion).toContain('return { kind: "deleted" }');
    expect(deletion).not.toMatch(/strava/iu);
  });

  it("executes trusted capture against the exact marked form and rejects cross-object selectors", async () => {
    const page = createFixturePage(`
        <form data-owned-application>
          <input name="name" value="Unrelated application" />
          <button class="cross-submit" type="button">Create</button>
          <output class="cross-id">wrong-id</output>
          <output class="cross-secret">wrong-secret</output>
        </form>
        <form data-owned-application>
          <input name="name" value="Murph Private Sync fixture" />
          <button class="owned-submit" type="button">Create</button>
          <output class="owned-id">right-id</output>
          <output class="owned-secret">right-secret</output>
        </form>
        <button class="global-submit" type="button">Global create</button>
      `);
      const code = buildBlindProviderCredentialCaptureCode({
        applicationContainerSelector: "form[data-owned-application]",
        clientIdSelector: ".owned-id",
        clientSecretSelector: ".owned-secret",
        creationFormSelector: "form[data-owned-application]",
        marker: "Murph Private Sync fixture",
        revealSecretSelector: null,
        safeLandingUrl: "about:blank",
        submitSelector: null,
      });
      const run = new Function("page", `return (async () => {${code}})();`) as (
        page: FixturePage,
      ) => Promise<{ clientId: string; clientSecret: string }>;

      await expect(run(page)).resolves.toEqual({
        clientId: "right-id",
        clientSecret: "right-secret",
      });

      await page.setContent(`
        <form data-owned-application>
          <input name="name" value="Murph Private Sync fixture" />
          <button class="owned-submit" type="button">Create</button>
        </form>
        <output class="cross-id">wrong-id</output>
        <output class="cross-secret">wrong-secret</output>
      `);
      const crossObject = buildBlindProviderCredentialCaptureCode({
        applicationContainerSelector: "form[data-owned-application]",
        clientIdSelector: ".cross-id",
        clientSecretSelector: ".cross-secret",
        creationFormSelector: "form[data-owned-application]",
        marker: "Murph Private Sync fixture",
        revealSecretSelector: null,
        safeLandingUrl: "about:blank",
        submitSelector: null,
      });
      const runCrossObject = new Function(
        "page",
        `return (async () => {${crossObject}})();`,
      ) as (page: FixturePage) => Promise<unknown>;
      await expect(runCrossObject(page)).rejects.toThrow(
        /owned-application element/u,
      );
  });

  it("rejects duplicate deterministic markers before any irreversible control", async () => {
    const page = createFixturePage(`
        <form data-owned-application>
          <input name="name" value="Murph Private Sync fixture" />
          <button class="owned-submit" type="button">Create</button>
          <output class="owned-id">right-id</output>
          <output class="owned-secret">right-secret</output>
        </form>
        <section data-owned-application>
          <h3>Murph Private Sync fixture</h3>
        </section>
      `);
      const code = buildBlindProviderCredentialCaptureCode({
        applicationContainerSelector: "[data-owned-application]",
        clientIdSelector: ".owned-id",
        clientSecretSelector: ".owned-secret",
        creationFormSelector: "form[data-owned-application]",
        marker: "Murph Private Sync fixture",
        revealSecretSelector: null,
        safeLandingUrl: "about:blank",
        submitSelector: ".owned-submit",
      });
      const run = new Function("page", `return (async () => {${code}})();`) as (
        page: FixturePage,
      ) => Promise<unknown>;

      await expect(run(page)).rejects.toThrow(/marker_ambiguous/u);
  });

  it("derives one application authority when its marker is rendered in multiple fields", async () => {
    const page = createFixturePage(`
        <section data-owned-application>
          <h3>Murph Private Sync fixture</h3>
          <input name="name" value="Murph Private Sync fixture" />
          <output class="owned-id">right-id</output>
          <output class="owned-secret">right-secret</output>
        </section>
      `);
      const code = buildBlindProviderCredentialCaptureCode({
        applicationContainerSelector: "section[data-owned-application]",
        clientIdSelector: ".owned-id",
        clientSecretSelector: ".owned-secret",
        creationFormSelector: "form[data-owned-application]",
        marker: "Murph Private Sync fixture",
        revealSecretSelector: null,
        safeLandingUrl: "about:blank",
        submitSelector: null,
      });
      const run = new Function("page", `return (async () => {${code}})();`) as (
        page: FixturePage,
      ) => Promise<{ clientId: string; clientSecret: string }>;

      await expect(run(page)).resolves.toEqual({
        clientId: "right-id",
        clientSecret: "right-secret",
      });
  });

  it("confines deletion to the marked application and the dialog it opens", async () => {
    const page = createFixturePage(`
        <section data-owned-application id="unrelated-app">
          <h3>Unrelated application</h3>
          <button class="other-delete" type="button">Delete</button>
        </section>
        <section data-owned-application id="owned-app">
          <h3>Murph Private Sync fixture</h3>
          <button class="owned-delete" type="button">Delete</button>
        </section>
        <button class="confirm" id="global-confirm" type="button">Global confirm</button>
      `);
      const clicks: string[] = [];
      await page.exposeFunction("recordProviderFixtureClick", (label: string) => {
        clicks.push(label);
      });
      await page.evaluate(() => {
        document.querySelector(".owned-delete")?.addEventListener("click", () => {
          void Reflect.get(window, "recordProviderFixtureClick")("owned-delete");
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.innerHTML = '<button class="confirm" type="button">Confirm</button>';
          dialog.querySelector(".confirm")?.addEventListener("click", () => {
            void Reflect.get(window, "recordProviderFixtureClick")("owned-confirm");
            document.querySelector("#owned-app")?.remove();
            dialog.remove();
          });
          document.body.append(dialog);
        });
      });
      const code = buildBlindOwnedApplicationDeleteCode({
        applicationContainerSelector: "section[data-owned-application]",
        confirmSelector: ".confirm",
        deleteSelector: ".owned-delete",
        marker: "Murph Private Sync fixture",
        safeLandingUrl: "about:blank",
      });
      const run = new Function("page", `return (async () => {${code}})();`) as (
        page: FixturePage,
      ) => Promise<{ kind: string }>;

      await expect(run(page)).resolves.toEqual({ kind: "deleted" });
      expect(clicks).toEqual(["owned-delete", "owned-confirm"]);

      await page.setContent(`
        <section data-owned-application>
          <h3>Murph Private Sync fixture</h3>
        </section>
        <button class="other-delete" type="button">Delete another app</button>
      `);
      const crossObject = buildBlindOwnedApplicationDeleteCode({
        applicationContainerSelector: "section[data-owned-application]",
        confirmSelector: null,
        deleteSelector: ".other-delete",
        marker: "Murph Private Sync fixture",
        safeLandingUrl: "about:blank",
      });
      const runCrossObject = new Function(
        "page",
        `return (async () => {${crossObject}})();`,
      ) as (page: FixturePage) => Promise<unknown>;
      await expect(runCrossObject(page)).rejects.toThrow(
        /owned-application element/u,
      );
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

type FixtureWindow = Window & typeof globalThis;

class FixtureLocator {
  constructor(
    private readonly page: FixturePage,
    private readonly roots: readonly Element[],
    private readonly selector: string,
    private readonly index: number | null = null,
  ) {}

  async click(): Promise<void> {
    const element = this.requireOne();
    await this.page.withGlobals(() => (element as HTMLElement).click());
  }

  async count(): Promise<number> {
    return this.elements().length;
  }

  async evaluate<T>(callback: (element: Element) => T): Promise<T> {
    return await this.page.withGlobals(() => callback(this.requireOne()));
  }

  async evaluateAll<T, TArgument>(
    callback: (elements: Element[], argument: TArgument) => T,
    argument: TArgument,
  ): Promise<T> {
    return await this.page.withGlobals(() => callback(this.elements(), argument));
  }

  first(): FixtureLocator {
    return new FixtureLocator(this.page, this.roots, this.selector, 0);
  }

  async inputValue(): Promise<string> {
    return (this.requireOne() as HTMLInputElement | HTMLTextAreaElement).value;
  }

  async isVisible(): Promise<boolean> {
    return this.elements().length === 1;
  }

  locator(selector: string): FixtureLocator {
    return new FixtureLocator(this.page, this.elements(), selector);
  }

  async textContent(): Promise<string | null> {
    return this.requireOne().textContent;
  }

  async waitFor(): Promise<void> {
    this.requireOne();
  }

  private elements(): Element[] {
    const matches = this.roots.flatMap((root) =>
      Array.from(root.querySelectorAll(this.selector))
    );
    return this.index === null
      ? matches
      : matches[this.index]
        ? [matches[this.index]]
        : [];
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
  private document: Document;
  private url = "about:blank";
  private window: FixtureWindow;

  constructor(html: string) {
    ({ document: this.document, window: this.window } = parseFixtureDocument(html));
    this.installLocation();
  }

  async evaluate<T, TArgument = undefined>(
    callback: (argument: TArgument) => T,
    argument?: TArgument,
  ): Promise<T> {
    return await this.withGlobals(() => callback(argument as TArgument));
  }

  async exposeFunction<TArguments extends unknown[]>(
    name: string,
    callback: (...args: TArguments) => unknown,
  ): Promise<void> {
    Reflect.set(this.window, name, callback);
  }

  async goto(url: string): Promise<void> {
    this.url = url;
    this.installLocation();
  }

  locator(selector: string): FixtureLocator {
    return new FixtureLocator(this, [this.document.documentElement], selector);
  }

  async setContent(html: string): Promise<void> {
    ({ document: this.document, window: this.window } = parseFixtureDocument(html));
    this.installLocation();
  }

  async waitForFunction<TArgument>(
    callback: (argument: TArgument) => boolean,
    argument: TArgument,
  ): Promise<void> {
    const complete = await this.withGlobals(() => callback(argument));
    if (!complete) {
      throw new Error("Fixture waitForFunction predicate was not satisfied.");
    }
  }

  async waitForLoadState(): Promise<void> {}

  async withGlobals<T>(callback: () => T | Promise<T>): Promise<T> {
    const previous = new Map<string, PropertyDescriptor | undefined>();
    for (const [name, value] of Object.entries({
      document: this.document,
      HTMLInputElement: this.window.HTMLInputElement,
      HTMLTextAreaElement: this.window.HTMLTextAreaElement,
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
      value: { href: this.url },
    });
  }
}

function createFixturePage(html: string): FixturePage {
  return new FixturePage(html);
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
