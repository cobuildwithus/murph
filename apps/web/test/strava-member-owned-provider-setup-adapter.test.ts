import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStravaDeviceSyncProvider } from "@murphai/device-syncd/providers/strava";

import {
  MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
  type MemberOwnedProviderSetupComputer,
} from "@/src/lib/device-sync/provider-setup/adapter";
import {
  StravaMemberOwnedProviderSetupAdapter,
  STRAVA_PROVIDER_SETUP_CATEGORY,
  STRAVA_PROVIDER_SETUP_WEBSITE,
  buildStravaMemberOwnedProviderApplicationMarker,
  readStravaMemberOwnedProviderCallback,
} from "@/src/lib/device-sync/provider-setup/strava-adapter";
import type { DeviceProviderApplicationView } from "@/src/lib/device-sync/provider-applications";

const MEMBER_ID = "member_fake_dashboard";
const SETUP_ID = "dps_fake_dashboard";
const RUN_ID = "hcr_fake_dashboard_owned";
const TEST_CLIENT_ID = "NON_CREDENTIAL_TEST_CLIENT_ID";
const TEST_CLIENT_SECRET = "NON_CREDENTIAL_TEST_SECRET_DO_NOT_USE";
const CREATED_AT = "2026-08-11T12:00:00.000Z";

type DashboardMode =
  | "challenge"
  | "prerequisite"
  | "ready"
  | "signed_out"
  | "unavailable";

interface FakeApplication {
  callbackDomain: string;
  category: string;
  clientId: string;
  clientSecret: string;
  description: string;
  id: string;
  name: string;
  website: string;
}

interface FakeDashboardState {
  ambiguousForms: boolean;
  ambiguousSubmit: boolean;
  applications: FakeApplication[];
  createAttempts: number;
  deleteAttempts: string[];
  mode: DashboardMode;
  oauthAuthorizations: URLSearchParams[];
  oauthTokenExchanges: Array<{
    clientIdMatched: boolean;
    clientSecretMatched: boolean;
    codeMatched: boolean;
    fieldNames: string[];
  }>;
  submissions: Array<Pick<
    FakeApplication,
    "callbackDomain" | "category" | "description" | "name" | "website"
  >>;
}

class FakeStravaSurface {
  readonly state: FakeDashboardState = {
    ambiguousForms: false,
    ambiguousSubmit: false,
    applications: [],
    createAttempts: 0,
    deleteAttempts: [],
    mode: "ready",
    oauthAuthorizations: [],
    oauthTokenExchanges: [],
    submissions: [],
  };

  private server: Server | null = null;
  baseUrl = "";

  async start(): Promise<void> {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", this.baseUrl || "http://127.0.0.1");
      if (requestUrl.pathname === "/settings/api") {
        if (this.state.mode === "signed_out") {
          response.writeHead(302, { location: "/login" });
          response.end();
          return;
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(this.renderDashboard());
        return;
      }
      if (requestUrl.pathname === "/login") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><html><body><main><input type=\"password\" name=\"password\"></main></body></html>");
        return;
      }
      if (requestUrl.pathname === "/dashboard") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><html><body><main data-safe-landing>Strava home</main></body></html>");
        return;
      }
      if (requestUrl.pathname === "/oauth/authorize") {
        this.state.oauthAuthorizations.push(new URLSearchParams(requestUrl.searchParams));
        const callback = new URL(requestUrl.searchParams.get("redirect_uri") ?? "", this.baseUrl);
        callback.searchParams.set("code", "NON_CREDENTIAL_TEST_AUTHORIZATION_CODE");
        callback.searchParams.set("state", requestUrl.searchParams.get("state") ?? "");
        response.writeHead(302, { location: callback.toString() });
        response.end();
        return;
      }
      if (requestUrl.pathname === "/oauth/token" && request.method === "POST") {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
        });
        request.on("end", () => {
          const parameters = new URLSearchParams(body);
          const fieldNames: string[] = [];
          parameters.forEach((_value, fieldName) => {
            if (!fieldNames.includes(fieldName)) {
              fieldNames.push(fieldName);
            }
          });
          this.state.oauthTokenExchanges.push({
            clientIdMatched: parameters.get("client_id") === TEST_CLIENT_ID,
            clientSecretMatched: parameters.get("client_secret") === TEST_CLIENT_SECRET,
            codeMatched: parameters.get("code") === "NON_CREDENTIAL_TEST_AUTHORIZATION_CODE",
            fieldNames: fieldNames.sort(),
          });
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({
            access_token: "NON_CREDENTIAL_TEST_ACCESS_TOKEN",
            athlete: { id: 424242 },
            expires_at: 1_800_000_000,
            refresh_token: "NON_CREDENTIAL_TEST_REFRESH_TOKEN",
            scope: "activity:read,read",
            token_type: "Bearer",
          }));
        });
        return;
      }
      if (requestUrl.pathname === "/oauth/callback") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          codePresent: Boolean(requestUrl.searchParams.get("code")),
          state: requestUrl.searchParams.get("state"),
        }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new TypeError("Fake Strava surface did not bind a TCP address.");
    }
    this.server = server;
    this.baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  addApplication(input: Partial<FakeApplication> & Pick<FakeApplication, "id" | "name">): void {
    this.state.applications.push({
      callbackDomain: input.callbackDomain ?? "unrelated.example.test",
      category: input.category ?? "Other",
      clientId: input.clientId ?? "NON_CREDENTIAL_TEST_UNRELATED_CLIENT_ID",
      clientSecret: input.clientSecret ?? "NON_CREDENTIAL_TEST_UNRELATED_SECRET",
      description: input.description ?? "Unrelated developer application.",
      id: input.id,
      name: input.name,
      website: input.website ?? "https://unrelated.example.test",
    });
  }

  submitApplication(fields: Pick<
    FakeApplication,
    "callbackDomain" | "category" | "description" | "name" | "website"
  >): void {
    this.state.createAttempts += 1;
    this.state.submissions.push(fields);
    this.addApplication({
      ...fields,
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      id: `app_${this.state.createAttempts}`,
    });
    if (this.state.ambiguousSubmit) {
      this.state.ambiguousSubmit = false;
      throw new Error("Synthetic submit response was lost after provider commit.");
    }
  }

  deleteApplication(id: string): void {
    this.state.deleteAttempts.push(id);
    this.state.applications = this.state.applications.filter(
      (application) => application.id !== id,
    );
  }

  private renderDashboard(): string {
    if (this.state.mode === "challenge") {
      return "<!doctype html><html><body><main><input autocomplete=\"one-time-code\" name=\"otp\"></main></body></html>";
    }
    if (this.state.mode === "prerequisite") {
      return "<!doctype html><html><body><main><div data-murph-state=\"subscription-required\">Developer subscription required</div></main></body></html>";
    }
    if (this.state.mode === "unavailable") {
      return "<!doctype html><html><body><main><p>Developer dashboard temporarily unavailable.</p></main></body></html>";
    }

    const applications = this.state.applications.map((application) => `
      <section data-strava-application data-app-id="${escapeHtml(application.id)}">
        <h2 data-application-name>${escapeHtml(application.name)}</h2>
        <input name="client_id" value="${escapeHtml(application.clientId)}">
        <input name="client_secret" value="${escapeHtml(application.clientSecret)}">
        <button type="button" data-action="delete-application">Delete application</button>
      </section>
    `).join("");
    const form = `
      <form data-strava-application-form action="/settings/api">
        <input name="name">
        <input name="website">
        <input name="callback_domain">
        <textarea name="description"></textarea>
        <select name="category"><option>Training</option><option>${STRAVA_PROVIDER_SETUP_CATEGORY}</option></select>
        <button type="submit">Create application</button>
      </form>
    `;
    return `<!doctype html><html><body><main>${applications}${form}${this.state.ambiguousForms ? form : ""}</main></body></html>`;
  }
}

class FakeLocator {
  constructor(
    private readonly page: FakePage,
    private readonly elements: Element[],
  ) {}

  async count(): Promise<number> {
    return this.elements.length;
  }

  first(): FakeLocator {
    return this.nth(0);
  }

  nth(index: number): FakeLocator {
    const element = this.elements[index];
    return new FakeLocator(this.page, element ? [element] : []);
  }

  locator(selector: string): FakeLocator {
    return new FakeLocator(
      this.page,
      this.elements.flatMap((element) => Array.from(element.querySelectorAll(selector))),
    );
  }

  getByRole(role: string, options: { name?: RegExp | string } = {}): FakeLocator {
    return new FakeLocator(
      this.page,
      this.elements.flatMap((element) => this.page.findByRole(element, role, options.name)),
    );
  }

  async isVisible(): Promise<boolean> {
    const element = this.elements[0];
    return Boolean(element && !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
  }

  async textContent(): Promise<string | null> {
    return this.elements[0]?.textContent ?? null;
  }

  async inputValue(): Promise<string> {
    const element = this.requireElement();
    const value = Reflect.get(element, "value");
    return typeof value === "string" ? value : element.getAttribute("value") ?? "";
  }

  async fill(value: string): Promise<void> {
    const element = this.requireElement();
    Reflect.set(element, "value", value);
    element.setAttribute("value", value);
    if (element.tagName.toLowerCase() === "textarea") {
      element.textContent = value;
    }
  }

  async selectOption(input: { label: string }): Promise<void> {
    const element = this.requireElement();
    const option = Array.from(element.querySelectorAll("option")).find(
      (candidate) => (candidate.textContent ?? "").trim() === input.label,
    );
    if (!option) {
      throw new Error("Synthetic select option was not found.");
    }
    for (const candidate of Array.from(element.querySelectorAll("option"))) {
      candidate.removeAttribute("selected");
    }
    option.setAttribute("selected", "selected");
    const optionValue = option.getAttribute("value") ?? (option.textContent ?? "").trim();
    Reflect.set(element, "value", optionValue);
  }

  async allTextContents(): Promise<string[]> {
    return this.elements.map((element) => element.textContent ?? "");
  }

  async click(): Promise<void> {
    await this.page.click(this.requireElement());
  }

  async evaluate<T>(callback: (element: Element) => T): Promise<T> {
    return callback(this.requireElement());
  }

  private requireElement(): Element {
    const element = this.elements[0];
    if (!element) {
      throw new Error("Synthetic locator has no element.");
    }
    return element;
  }
}

class FakePage {
  private document: Document | null = null;
  private domWindow: Record<string, unknown> | null = null;
  private currentUrl = "about:blank";

  constructor(private readonly surface: FakeStravaSurface) {}

  async goto(url: string): Promise<void> {
    const response = await fetch(url);
    const html = await response.text();
    const parsed = parseHTML(html);
    this.document = requireSyntheticDocument(parsed.document);
    this.domWindow = requireSyntheticWindow(parsed.window);
    this.currentUrl = response.url;
  }

  url(): string {
    return this.currentUrl;
  }

  locator(selector: string): FakeLocator {
    const document = this.requireDocument();
    return new FakeLocator(this, Array.from(document.querySelectorAll(selector)));
  }

  getByText(pattern: RegExp | string): FakeLocator {
    const elements = Array.from(this.requireDocument().querySelectorAll("body *"));
    return new FakeLocator(this, elements.filter((element) =>
      textMatches(element.textContent ?? "", pattern)));
  }

  getByRole(role: string, options: { name?: RegExp | string } = {}): FakeLocator {
    return new FakeLocator(
      this,
      this.findByRole(this.requireDocument(), role, options.name),
    );
  }

  findByRole(
    root: ParentNode,
    role: string,
    name: RegExp | string | undefined,
  ): Element[] {
    if (role !== "button") {
      return [];
    }
    return Array.from(root.querySelectorAll("button, input[type='button'], input[type='submit']"))
      .filter((element) => name === undefined || textMatches(accessibleName(element), name));
  }

  async waitForLoadState(): Promise<void> {
    return undefined;
  }

  async evaluate<T>(callback: () => T): Promise<T> {
    const document = this.requireDocument();
    const window = this.domWindow;
    if (!window) {
      throw new Error("Synthetic page window is unavailable.");
    }
    const replacements = new Map<string, unknown>([
      ["document", document],
      ["HTMLInputElement", Reflect.get(window, "HTMLInputElement")],
      ["HTMLTextAreaElement", Reflect.get(window, "HTMLTextAreaElement")],
    ]);
    const previous = new Map<string, { existed: boolean; value: unknown }>();
    for (const [key, value] of replacements) {
      previous.set(key, {
        existed: Object.prototype.hasOwnProperty.call(globalThis, key),
        value: Reflect.get(globalThis, key),
      });
      Reflect.set(globalThis, key, value);
    }
    try {
      return callback();
    } finally {
      for (const [key, state] of previous) {
        if (state.existed) {
          Reflect.set(globalThis, key, state.value);
        } else {
          Reflect.deleteProperty(globalThis, key);
        }
      }
    }
  }

  async click(element: Element): Promise<void> {
    const action = element.getAttribute("data-action");
    if (action === "delete-application") {
      const application = element.closest("[data-strava-application]");
      const applicationId = application?.getAttribute("data-app-id");
      if (!applicationId) {
        throw new Error("Synthetic application identity is missing.");
      }
      const dialog = this.requireDocument().createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("data-murph-delete-confirmation", "true");
      const confirm = this.requireDocument().createElement("button");
      confirm.setAttribute("type", "button");
      confirm.setAttribute("data-action", "confirm-delete");
      confirm.setAttribute("data-app-id", applicationId);
      confirm.textContent = "Confirm deletion";
      dialog.append(confirm);
      this.requireDocument().body.append(dialog);
      return;
    }
    if (action === "confirm-delete") {
      const applicationId = element.getAttribute("data-app-id");
      if (!applicationId) {
        throw new Error("Synthetic deletion identity is missing.");
      }
      this.surface.deleteApplication(applicationId);
      element.remove();
      return;
    }
    if (element.getAttribute("type") === "submit") {
      const form = element.closest("form");
      if (!form) {
        throw new Error("Synthetic application form is missing.");
      }
      this.surface.submitApplication({
        callbackDomain: readFormValue(form, "input[name='callback_domain']"),
        category: readFormValue(form, "select[name='category']"),
        description: readFormValue(form, "textarea[name='description']"),
        name: readFormValue(form, "input[name='name']"),
        website: readFormValue(form, "input[name='website']"),
      });
    }
  }

  serialize(): string {
    return String(this.requireDocument());
  }

  private requireDocument(): Document {
    if (!this.document) {
      throw new Error("Synthetic page has not navigated yet.");
    }
    return this.document;
  }
}

function requireSyntheticDocument(value: unknown): Document {
  if (
    !value
    || typeof value !== "object"
    || typeof Reflect.get(value, "querySelectorAll") !== "function"
    || typeof Reflect.get(value, "createElement") !== "function"
  ) {
    throw new TypeError("Synthetic dashboard document is invalid.");
  }
  return value as Document;
}

function requireSyntheticWindow(value: unknown): Record<string, unknown> {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    throw new TypeError("Synthetic dashboard window is invalid.");
  }
  return value as Record<string, unknown>;
}

type BrowserProgram = (page: FakePage) => Promise<unknown>;
type BrowserProgramConstructor = new (...parameters: string[]) => BrowserProgram;
const AsyncFunction = Object.getPrototypeOf(async function noop() {
  return undefined;
}).constructor as BrowserProgramConstructor;

class FakeSetupComputer implements MemberOwnedProviderSetupComputer {
  readonly page: FakePage;
  readonly finishOwnedRun = vi.fn(async (input: {
    memberId: string;
    outcome: "canceled" | "completed";
    ownerKey: string;
    ownerPurpose: typeof MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE;
    runId: string;
  }) => {
    this.assertOwner(input);
    this.assertRun(input.runId);
    return { ok: true as const, runId: RUN_ID, status: input.outcome };
  });
  runtimeSnapshot = "";

  constructor(surface: FakeStravaSurface) {
    this.page = new FakePage(surface);
  }

  async acquireOwnedRun(input: {
    expectedRunId: string | null;
    memberId: string;
    ownerKey: string;
    ownerPurpose: typeof MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE;
  }) {
    this.assertOwner(input);
    if (input.expectedRunId !== null && input.expectedRunId !== RUN_ID) {
      throw new Error("Synthetic run ownership mismatch.");
    }
    return {
      awaitingReason: null,
      reused: input.expectedRunId === RUN_ID,
      runId: RUN_ID,
      status: "running",
    };
  }

  async actOwnedRun(input: {
    code: string;
    memberId: string;
    ownerKey: string;
    ownerPurpose: typeof MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE;
    runId: string;
    timeoutMs: number;
  }) {
    this.assertOwner(input);
    this.assertRun(input.runId);
    const result = await executeBrowserProgram(input.code, this.page);
    const serialized = JSON.stringify(result);
    if (serialized.includes(TEST_CLIENT_SECRET)) {
      throw new Error("General browser action exposed a provider secret.");
    }
    return { result, title: "Fake Strava developer dashboard", url: this.page.url() };
  }

  async captureAndSealProviderCredentialsInOwnedRun<T>(input: {
    code: string;
    consume: (credentials: { clientId: string; clientSecret: string }) => Promise<T>;
    memberId: string;
    ownerKey: string;
    ownerPurpose: typeof MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE;
    runId: string;
    timeoutMs: number;
  }) {
    this.assertOwner(input);
    this.assertRun(input.runId);
    const raw = await executeBrowserProgram(input.code, this.page);
    const record = requireRecord(raw);
    const clientId = requireString(Reflect.get(record, "clientId"));
    const clientSecret = requireString(Reflect.get(record, "clientSecret"));
    try {
      const value = await input.consume({ clientId, clientSecret });
      return { title: "Fake Strava home", url: this.page.url(), value };
    } finally {
      Reflect.set(record, "clientId", "");
      Reflect.set(record, "clientSecret", "");
      this.runtimeSnapshot = JSON.stringify({
        page: this.page.serialize(),
        result: record,
        runId: RUN_ID,
      });
    }
  }

  async pauseOwnedRunForUser(input: {
    handoffPurpose: "captcha" | "managed_login" | "manual_browser_help";
    memberId: string;
    ownerKey: string;
    ownerPurpose: typeof MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE;
    reason: "login_needed" | "other";
    runId: string;
    suggestedReply: string | null;
  }) {
    this.assertOwner(input);
    this.assertRun(input.runId);
    return {
      handoffUrl: `${this.page.url().replace(/\/$/u, "")}/handoff/${SETUP_ID}`,
      runId: RUN_ID,
    };
  }

  private assertOwner(input: {
    memberId: string;
    ownerKey: string;
    ownerPurpose: typeof MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE;
  }): void {
    expect(input).toMatchObject({
      memberId: MEMBER_ID,
      ownerKey: SETUP_ID,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
    });
  }

  private assertRun(runId: string): void {
    if (runId !== RUN_ID) {
      throw new Error("Synthetic run ID does not belong to this setup.");
    }
  }
}

let surface: FakeStravaSurface;

beforeEach(async () => {
  surface = new FakeStravaSurface();
  await surface.start();
});

afterEach(async () => {
  await surface.close();
});

describe("Strava member-owned provider setup adapter", () => {
  it("executes signed-out and verification pauses against the served dashboard", async () => {
    const computer = new FakeSetupComputer(surface);
    const adapter = createAdapter(computer, surface);

    surface.state.mode = "signed_out";
    await expect(adapter.inspectDashboard(operationInput())).resolves.toEqual({
      kind: "authentication_required",
      reason: "signed_out",
    });

    surface.state.mode = "challenge";
    await expect(adapter.inspectDashboard(operationInput())).resolves.toEqual({
      kind: "authentication_required",
      reason: "challenge",
    });
    await expect(adapter.pauseForUser({
      ...operationInput(),
      reason: "challenge",
    })).resolves.toMatchObject({ runId: RUN_ID });
  });

  it("models the current subscription prerequisite and unavailable create surface", async () => {
    const computer = new FakeSetupComputer(surface);
    const adapter = createAdapter(computer, surface);

    surface.state.mode = "prerequisite";
    await expect(adapter.inspectDashboard(operationInput())).resolves.toEqual({
      kind: "prerequisite_required",
    });
    await expect(adapter.createOwnedApplication(operationInput())).resolves.toEqual({
      kind: "known_unsent",
      reason: "prerequisite",
    });

    surface.state.mode = "unavailable";
    await expect(adapter.createOwnedApplication(operationInput())).resolves.toEqual({
      kind: "known_unsent",
      reason: "unavailable",
    });
    expect(surface.state.createAttempts).toBe(0);
  });

  it("cancels only the exact setup-owned browser run", async () => {
    const computer = new FakeSetupComputer(surface);
    const adapter = createAdapter(computer, surface);

    await expect(adapter.cancelBrowserRun({
      memberId: MEMBER_ID,
      runId: RUN_ID,
      setupId: SETUP_ID,
    })).resolves.toBe("canceled");
    expect(computer.finishOwnedRun).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      outcome: "canceled",
      ownerKey: SETUP_ID,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId: RUN_ID,
    });
  });

  it("completes only the exact setup-owned browser run after credentials are sealed", async () => {
    const computer = new FakeSetupComputer(surface);
    const adapter = createAdapter(computer, surface);

    await expect(adapter.finishBrowserRun({
      memberId: MEMBER_ID,
      runId: RUN_ID,
      setupId: SETUP_ID,
    })).resolves.toBe("completed");
    expect(computer.finishOwnedRun).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      outcome: "completed",
      ownerKey: SETUP_ID,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId: RUN_ID,
    });
  });

  it("creates the deterministic marked app with exact product fields and recovers it", async () => {
    const computer = new FakeSetupComputer(surface);
    const callbackUrl = new URL("/api/device-sync/oauth/strava/callback", surface.baseUrl);
    const adapter = createAdapter(computer, surface, callbackUrl);
    const marker = buildStravaMemberOwnedProviderApplicationMarker(MEMBER_ID);

    await expect(adapter.inspectDashboard(operationInput())).resolves.toEqual({ kind: "missing" });
    await expect(adapter.createOwnedApplication(operationInput())).resolves.toEqual({ kind: "submitted" });
    expect(surface.state.submissions).toEqual([{
      callbackDomain: callbackUrl.hostname,
      category: STRAVA_PROVIDER_SETUP_CATEGORY,
      description: "Private read-only activity sync for this Murph member.",
      name: marker,
      website: STRAVA_PROVIDER_SETUP_WEBSITE,
    }]);
    await expect(adapter.inspectDashboard(operationInput())).resolves.toEqual({
      kind: "owned_application",
    });
    expect(surface.state.applications).toHaveLength(1);
  });

  it("never adopts, modifies, or deletes an unrelated application", async () => {
    const unrelated = "Member's unrelated training app";
    surface.addApplication({ id: "unrelated_app", name: unrelated });
    const computer = new FakeSetupComputer(surface);
    const adapter = createAdapter(computer, surface);

    await expect(adapter.inspectDashboard(operationInput())).resolves.toEqual({
      kind: "unrelated_application",
    });
    await expect(adapter.deleteOwnedApplication(operationInput())).resolves.toEqual({
      kind: "unrelated_application",
    });
    expect(surface.state.createAttempts).toBe(0);
    expect(surface.state.deleteAttempts).toEqual([]);
    expect(surface.state.applications.map((application) => application.name)).toEqual([unrelated]);
  });

  it("fails closed on ambiguous forms and recovers an ambiguous committed submit without duplication", async () => {
    const computer = new FakeSetupComputer(surface);
    const adapter = createAdapter(computer, surface);

    surface.state.ambiguousForms = true;
    await expect(adapter.inspectDashboard(operationInput())).resolves.toEqual({ kind: "ambiguous" });
    await expect(adapter.createOwnedApplication(operationInput())).resolves.toEqual({ kind: "ambiguous" });
    expect(surface.state.createAttempts).toBe(0);

    surface.state.ambiguousForms = false;
    surface.state.ambiguousSubmit = true;
    await expect(adapter.createOwnedApplication(operationInput())).resolves.toEqual({ kind: "ambiguous" });
    expect(surface.state.createAttempts).toBe(1);
    await expect(adapter.inspectDashboard(operationInput())).resolves.toEqual({
      kind: "owned_application",
    });
    expect(surface.state.applications).toHaveLength(1);
  });

  it("passes raw credentials only to sealing and scrubs browser and returned state immediately", async () => {
    surface.addApplication({
      callbackDomain: new URL(surface.baseUrl).hostname,
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      id: "owned_app",
      name: buildStravaMemberOwnedProviderApplicationMarker(MEMBER_ID),
    });
    const computer = new FakeSetupComputer(surface);
    let sealedShape: { expectedRevision: number | null; provider: string } | null = null;
    const savedView: DeviceProviderApplicationView = {
      applicationId: "dpa_fake_sealed",
      createdAt: CREATED_AT,
      provider: "strava",
      revision: 7,
      updatedAt: CREATED_AT,
    };
    const adapter = new StravaMemberOwnedProviderSetupAdapter({
      callbackUrl: new URL("/oauth/callback", surface.baseUrl),
      computer,
      dashboardUrl: new URL("/settings/api", surface.baseUrl).toString(),
      safeLandingUrl: new URL("/dashboard", surface.baseUrl).toString(),
      saveApplication: async (input) => {
        expect(input.clientId).toBe(TEST_CLIENT_ID);
        expect(input.clientSecret).toBe(TEST_CLIENT_SECRET);
        sealedShape = {
          expectedRevision: input.expectedRevision,
          provider: input.provider,
        };
        return savedView;
      },
    });

    const result = await adapter.captureAndSealOwnedApplication({
      ...operationInput(),
      expectedRevision: 6,
    });

    expect(result).toEqual(savedView);
    expect(sealedShape).toEqual({ expectedRevision: 6, provider: "strava" });
    expect(JSON.stringify(result)).not.toContain(TEST_CLIENT_SECRET);
    expect(computer.runtimeSnapshot).not.toContain(TEST_CLIENT_SECRET);
    expect(computer.runtimeSnapshot).not.toContain(TEST_CLIENT_ID);
    expect(computer.page.serialize()).not.toContain(TEST_CLIENT_SECRET);
    expect(computer.page.url()).toBe(new URL("/dashboard", surface.baseUrl).toString());
  });

  it("deletes only the exact Murph-marked app and preserves unrelated apps", async () => {
    const marker = buildStravaMemberOwnedProviderApplicationMarker(MEMBER_ID);
    surface.addApplication({ id: "owned_app", name: marker });
    surface.addApplication({ id: "unrelated_app", name: "Unrelated app" });
    const adapter = createAdapter(new FakeSetupComputer(surface), surface);

    await expect(adapter.deleteOwnedApplication(operationInput())).resolves.toEqual({
      kind: "deleted",
    });
    expect(surface.state.deleteAttempts).toEqual(["owned_app"]);
    expect(surface.state.applications.map((application) => application.id)).toEqual([
      "unrelated_app",
    ]);
  });

  it("does not report deletion until the marked app is proved absent", async () => {
    const marker = buildStravaMemberOwnedProviderApplicationMarker(MEMBER_ID);
    surface.addApplication({ id: "owned_app", name: marker });
    vi.spyOn(surface, "deleteApplication").mockImplementation(() => {});
    const adapter = createAdapter(new FakeSetupComputer(surface), surface);

    await expect(adapter.deleteOwnedApplication(operationInput())).resolves.toEqual({
      kind: "ambiguous",
    });
    expect(surface.state.applications.map((application) => application.id)).toEqual([
      "owned_app",
    ]);
  });


  it("exchanges through the real Strava provider boundary and schedules backfill plus polling", async () => {
    const provider = createStravaDeviceSyncProvider({
      apiBaseUrl: `${surface.baseUrl}/api/v3`,
      authBaseUrl: surface.baseUrl,
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      fetchImpl: fetch,
      scopes: ["activity:read"],
    });

    const result = await provider.oauthAdapter.exchangeAuthorizationCode({
      callbackUrl: new URL("/oauth/callback", surface.baseUrl).toString(),
      grantedScopes: ["activity:read"],
      now: CREATED_AT,
      state: "NON_CREDENTIAL_TEST_OAUTH_STATE",
    }, "NON_CREDENTIAL_TEST_AUTHORIZATION_CODE");

    expect(surface.state.oauthTokenExchanges).toEqual([{
      clientIdMatched: true,
      clientSecretMatched: true,
      codeMatched: true,
      fieldNames: ["client_id", "client_secret", "code", "grant_type"],
    }]);
    expect(result).toMatchObject({
      externalAccountId: "424242",
      initialJobs: [{
        kind: "backfill",
        priority: 100,
        payload: expect.objectContaining({
          includeAthlete: true,
          windowKind: "backfill",
        }),
      }],
      nextReconcileAt: expect.any(String),
      scopes: ["activity:read", "read"],
    });
    expect(result.scopes).not.toContain("activity:write");

    const tokens = result.tokens;
    const scopes = result.scopes;
    if (!tokens || !scopes) {
      throw new TypeError("Strava OAuth exchange must return tokens and scopes.");
    }

    const createScheduledJobs = provider.jobExecutor.createScheduledJobs;
    if (!createScheduledJobs) {
      throw new TypeError("Strava provider must expose scheduled polling.");
    }
    expect(createScheduledJobs({
      accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
      connectedAt: CREATED_AT,
      createdAt: CREATED_AT,
      credential: {
        accessTokenEncrypted: "NON_CREDENTIAL_TEST_ENCRYPTED_ACCESS_TOKEN",
        accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
        credentialMetadata: {},
        kind: "oauth_tokens",
        refreshTokenEncrypted: "NON_CREDENTIAL_TEST_ENCRYPTED_REFRESH_TOKEN",
      },
      disconnectGeneration: 0,
      displayName: result.displayName ?? null,
      externalAccountId: result.externalAccountId,
      hostedObservedConnectionRevision: 0,
      hostedObservedTokenRevision: 0,
      hostedObservedTokenVersion: null,
      hostedObservedUpdatedAt: null,
      id: "dsc_fake_strava",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastSyncStartedAt: null,
      lastWebhookAt: null,
      localConnectionRevision: 0,
      localTokenRevision: 0,
      metadata: {},
      nextReconcileAt: CREATED_AT,
      provider: "strava",
      scopes,
      status: "active",
      updatedAt: CREATED_AT,
    }, CREATED_AT).jobs).toEqual([
      expect.objectContaining({
        kind: "reconcile",
        payload: expect.objectContaining({ windowKind: "reconcile" }),
      }),
    ]);
  });

  it("uses the canonical callback shape and least-privilege read scope at the fake OAuth surface", async () => {
    const callback = readStravaMemberOwnedProviderCallback({
      DEVICE_SYNC_PUBLIC_BASE_URL: `${surface.baseUrl}/api/device-sync`,
    });
    expect(callback.toString()).toBe(`${surface.baseUrl}/api/device-sync/oauth/strava/callback`);

    const exactBinding = {
      applicationId: "dpa_fake_sealed",
      provider: "strava" as const,
      revision: 7,
    };
    const state = "NON_CREDENTIAL_TEST_OAUTH_STATE";
    const authorization = new URL("/oauth/authorize", surface.baseUrl);
    authorization.searchParams.set("client_id", TEST_CLIENT_ID);
    authorization.searchParams.set("redirect_uri", new URL("/oauth/callback", surface.baseUrl).toString());
    authorization.searchParams.set("scope", "activity:read");
    authorization.searchParams.set("state", state);
    authorization.searchParams.set("application_id", exactBinding.applicationId);
    authorization.searchParams.set("application_revision", String(exactBinding.revision));

    const response = await fetch(authorization, { redirect: "follow" });
    const callbackResult = await response.json() as {
      codePresent: boolean;
      state: string;
    };
    expect(callbackResult).toEqual({ codePresent: true, state });
    expect(surface.state.oauthAuthorizations).toHaveLength(1);
    const parameters = surface.state.oauthAuthorizations[0];
    expect(parameters?.get("scope")).toBe("activity:read");
    expect(parameters?.get("application_id")).toBe(exactBinding.applicationId);
    expect(parameters?.get("application_revision")).toBe(String(exactBinding.revision));
    expect(parameters?.get("scope")).not.toContain("write");
  });
});

function createAdapter(
  computer: MemberOwnedProviderSetupComputer,
  fakeSurface: FakeStravaSurface,
  callbackUrl = new URL("/oauth/callback", fakeSurface.baseUrl),
): StravaMemberOwnedProviderSetupAdapter {
  return new StravaMemberOwnedProviderSetupAdapter({
    callbackUrl,
    computer,
    dashboardUrl: new URL("/settings/api", fakeSurface.baseUrl).toString(),
    safeLandingUrl: new URL("/dashboard", fakeSurface.baseUrl).toString(),
    saveApplication: async () => ({
      applicationId: "dpa_fake_sealed",
      createdAt: CREATED_AT,
      provider: "strava",
      revision: 7,
      updatedAt: CREATED_AT,
    }),
  });
}

function operationInput() {
  return {
    memberId: MEMBER_ID,
    runId: RUN_ID,
    setupId: SETUP_ID,
  };
}

async function executeBrowserProgram(code: string, page: FakePage): Promise<unknown> {
  const program = new AsyncFunction("page", code);
  return program(page);
}

function readFormValue(form: Element, selector: string): string {
  const element = form.querySelector(selector);
  if (!element) {
    return "";
  }
  const reflected = Reflect.get(element, "value");
  if (typeof reflected === "string" && reflected.trim()) {
    return reflected.trim();
  }
  const selected = element.querySelector("option[selected]");
  return (selected?.getAttribute("value") ?? selected?.textContent ?? element.textContent ?? "").trim();
}

function accessibleName(element: Element): string {
  const reflected = Reflect.get(element, "value");
  return (
    element.getAttribute("aria-label")
    ?? (typeof reflected === "string" ? reflected : null)
    ?? element.textContent
    ?? ""
  ).trim();
}

function textMatches(value: string, pattern: RegExp | string): boolean {
  if (typeof pattern === "string") {
    return value.trim() === pattern;
  }
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Synthetic browser capture result must be an object.");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Synthetic browser capture value must be a string.");
  }
  return value;
}
