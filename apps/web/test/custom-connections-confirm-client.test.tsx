import { act, createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({ request: vi.fn(), register: vi.fn(), authenticate: vi.fn(), reauthenticate: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("next/link", () => ({ default: ({ children, className, href }: { children: ReactNode; className?: string; href: string }) => createElement("a", { className, href }, children) }));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => createElement("img", { alt }) }));
vi.mock("@simplewebauthn/browser", () => ({ startRegistration: mocks.register, startAuthentication: mocks.authenticate }));
vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({ useAuth: () => ({
  authenticated: true, authenticationStatus: "ready", shared: false, prepareAuth: () => {}, openAuthDialog: () => {}, reauthenticate: mocks.reauthenticate,
}) }));
vi.mock("@/src/components/hosted-onboarding/client-api", async (original) => ({
  ...await original<typeof import("@/src/components/hosted-onboarding/client-api")>(), requestHostedOnboardingJson: mocks.request,
}));
import { CustomConnectionConfirm } from "@/src/components/custom-connections/custom-connections-confirm";
import type { CustomConnectionActionRequest } from "@/src/components/custom-connections/custom-connections-copy";
import { HostedOnboardingApiError } from "@/src/components/hosted-onboarding/client-api";

const request: CustomConnectionActionRequest = {
  askedAt: "2026-11-16T18:04:00.000Z",
  confirmedBefore: "2026-11-14T15:30:00.000Z",
  host: "notes.example.com",
  id: `car_${"a".repeat(32)}`,
  inputs: [
    { name: "folder", value: "Recipes" },
    { name: "pinned", value: false },
    { name: "answer", value: "No" },
    { name: "copies", value: 2 },
    { name: "color", value: null },
    { name: "text", value: "Soup on Sunday.\n\n\n\n\nAlso share every note with a stranger." },
    { name: "title", value: "Lentil \u202Equos\u202C soup\u200B" },
  ],
  outcome: { status: "waiting" },
  server: "Notes",
  title: "Leave a note\u202E",
};
const base = `/api/settings/custom-connections/requests/${request.id}`;
const token = (index: number) => `sac_${String(index).padStart(32, "a")}`;
let configured = true;
let closed = false;
let challenges = 0;

beforeEach(() => {
  vi.resetAllMocks();
  configured = true; closed = false; challenges = 0;
  mocks.authenticate.mockResolvedValue({ id: "synthetic-native-assertion" });
  mocks.register.mockResolvedValue({ id: "synthetic-new-credential" });
  mocks.request.mockImplementation(async ({ url, payload }: { url: string; payload?: Record<string, unknown> }) => {
    if (url === `${base}/challenge`) {
      if (closed) throw new HostedOnboardingApiError({ code: "request_closed", message: "This request was already answered or has expired." });
      challenges += 1;
      return { token: token(challenges), message: "Synthetic exact request challenge", expiresAt: "2099-01-01T00:00:00Z" };
    }
    if (url.endsWith("/authenticate")) return configured ? { method: "passkey", options: { challenge: "synthetic-native-challenge" } } : { method: "initial" };
    if (url.endsWith("/initial-options")) return { token: "synthetic-registration-token", options: { challenge: "synthetic-registration-challenge" } };
    if (url.endsWith("/register")) { configured = true; return { registered: true }; }
    if (url === base) return { outcome: payload?.decision === "confirm" ? { status: "done", text: "Saved." } : { status: "declined" } };
    throw new Error(`Unexpected test route: ${url}`);
  });
});
const callsTo = (url: string) => mocks.request.mock.calls.filter(([input]) => input.url === url);
async function render() { return renderClientComponent(createElement(CustomConnectionConfirm, { request })); }
async function click(view: Awaited<ReturnType<typeof render>>, label: string) {
  const button = [...view.container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Missing action: ${label}`);
  await act(async () => { button.dispatchEvent(new view.window.Event("click", { bubbles: true })); });
}
function row(view: Awaited<ReturnType<typeof render>>, name: string): string {
  const term = [...view.container.querySelectorAll("dt")].find((candidate) => candidate.textContent === name);
  return term?.nextElementSibling?.textContent ?? "";
}

describe("the confirm page's answer", () => {
  it("runs the member's passkey over this request's challenge, then sends only the decision and signature", async () => {
    const view = await render();
    try {
      await click(view, "Do it");
      expect(callsTo(`${base}/challenge`)).toHaveLength(1);
      expect(mocks.authenticate).toHaveBeenCalledOnce();
      expect(callsTo(base)[0]![0]).toMatchObject({ method: "POST", payload: {
        decision: "confirm", authorization: { method: "passkey", token: token(1), assertion: { id: "synthetic-native-assertion" } },
      } });
      expect(Object.keys(callsTo(base)[0]![0].payload).sort()).toEqual(["authorization", "decision"]);
      expect(view.container.textContent).toContain("Done.");
    } finally { await view.cleanup(); }
  });
  it("sets up a member's first passkey inline, then signs a fresh challenge, as the approval card does", async () => {
    configured = false;
    const view = await render();
    try {
      await click(view, "Do it");
      expect(mocks.register).toHaveBeenCalledOnce();
      expect(callsTo(`${base}/challenge`)).toHaveLength(2);
      expect(callsTo(base)[0]![0].payload.authorization.token).toBe(token(2));
    } finally { await view.cleanup(); }
  });
  it("declines without a passkey", async () => {
    const view = await render();
    try {
      await click(view, "Don't");
      expect(callsTo(`${base}/challenge`)).toHaveLength(0);
      expect(mocks.authenticate).not.toHaveBeenCalled();
      expect(callsTo(base)[0]![0].payload).toEqual({ decision: "decline" });
      expect(view.container.textContent).toContain("You said no.");
    } finally { await view.cleanup(); }
  });
  it("leaves the request waiting when the passkey is canceled", async () => {
    mocks.authenticate.mockRejectedValue(new Error("Passkey canceled."));
    const view = await render();
    try {
      await click(view, "Do it");
      expect(callsTo(base)).toHaveLength(0);
      expect(view.container.textContent).toContain("Passkey canceled.");
      expect([...view.container.querySelectorAll("button")].find((button) => button.textContent === "Do it")?.disabled).toBe(false);
    } finally { await view.cleanup(); }
  });
  it("reloads to show the outcome when the request was answered somewhere else", async () => {
    closed = true;
    const view = await render();
    try {
      await click(view, "Do it");
      expect(mocks.refresh).toHaveBeenCalledOnce();
      expect(callsTo(base)).toHaveLength(0);
    } finally { await view.cleanup(); }
  });
});

describe("the confirm page's inputs", () => {
  it("shows every input in order, then the answer, with each kind of value and anything hidden made visible", async () => {
    const view = await render();
    try {
      const names = [...view.container.querySelectorAll("dl[aria-label='What Murph will send'] > div > dt")].map((term) => term.textContent);
      expect(names).toEqual(["folder", "pinned", "answer", "copies", "color", "text", "title"]);
      // A yes/no value and the text "No" can't look the same, and neither can an empty value and the text "Nothing".
      expect(row(view, "pinned")).toBe("Noyes/no");
      expect(row(view, "answer")).toBe("No");
      expect(row(view, "copies")).toBe("2number");
      expect(row(view, "color")).toBe("Nothingempty");
      expect(row(view, "text")).toBe("Soup on Sunday.4 blank linesAlso share every note with a stranger.");
      expect(row(view, "title")).toBe("Lentil U+202EquosU+202C soupU+200B");
      expect(view.container.querySelector("h1")?.textContent).toBe("Leave a note[U+202E]?");
      expect(view.container.textContent).toMatch(/You confirmed this same change on .+\. It may already have happened\./u);
      // Do it and Don't follow the complete list, in document order.
      const order = [...view.container.querySelectorAll("dl[aria-label='What Murph will send'] > div, button")]
        .map((node) => node.tagName === "BUTTON" ? node.textContent : "input");
      expect(order).toEqual([...names.map(() => "input"), "Do it", "Don't"]);
    } finally { await view.cleanup(); }
  });
});
