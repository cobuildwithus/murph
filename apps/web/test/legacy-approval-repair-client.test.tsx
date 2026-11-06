import { act, createElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({ request: vi.fn(), register: vi.fn(), authenticate: vi.fn(), reauthenticate: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
// A module-load assertion, not only a wallet-call assertion.
vi.mock("@privy-io/react-auth", () => { throw new Error("Repair must not load the Privy browser SDK"); });
vi.mock("@simplewebauthn/browser", () => ({ startRegistration: mocks.register, startAuthentication: mocks.authenticate }));
vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({ useAuth: () => ({
  authenticated: true, authenticationStatus: "ready", shared: false, prepareAuth: () => {},
  openAuthDialog: () => { throw new Error("Repair must resume inline"); }, reauthenticate: mocks.reauthenticate,
}) }));
vi.mock("@/src/components/hosted-onboarding/client-api", async (original) => ({
  ...await original<typeof import("@/src/components/hosted-onboarding/client-api")>(), requestHostedOnboardingJson: mocks.request,
}));
import { useApprovalPasskeyEnrollment } from "@/src/components/sensitive-actions/use-approval-passkey-enrollment";
import { ActionApprovalCard } from "@/src/components/sensitive-actions/action-approval-card";
import { HostedOnboardingApiError } from "@/src/components/hosted-onboarding/client-api";
import type { HostedActionApprovalView } from "@/src/lib/action-approvals-shared";

const approval: HostedActionApprovalView = {
  approvalId: `haa_${"a".repeat(32)}`, expiresAt: "2099-01-01T00:00:00Z", returnContactKind: null,
  status: "pending", presentation: { title: "Share this synthetic file?", body: "Share the file requested in this conversation." },
};
const base = `/api/action-approvals/${approval.approvalId}`;
let configured = false;
let stale = false;
let challenges = 0;
let unavailable = false;
let loseRegistrationResponse = false;
const token = (index: number) => `sac_${String(index).padStart(32, "a")}`;

beforeEach(() => {
  vi.resetAllMocks();
  configured = false; stale = false; challenges = 0; unavailable = false; loseRegistrationResponse = false;
  mocks.register.mockResolvedValue({ id: "synthetic-new-credential" });
  mocks.authenticate.mockResolvedValue({ id: "synthetic-native-assertion" });
  mocks.reauthenticate.mockImplementation(async () => { stale = false; });
  mocks.request.mockImplementation(async ({ url, payload }: { url: string; payload?: Record<string, unknown> }) => {
    if (url === "/api/settings/approval-passkeys") return { initialEnrollmentAllowed: !configured };
    if (url === `${base}/challenge`) {
      if (unavailable) throw new Error("This approval expired or was already decided. Request a new link.");
      challenges += 1;
      return { token: token(challenges), message: "Synthetic exact action challenge", expiresAt: "2099-01-01T00:00:00Z" };
    }
    if (url.endsWith("/authenticate")) return configured
      ? { method: "passkey", options: { challenge: "synthetic-native-challenge" } } : { method: "initial" };
    if (url.endsWith("/initial-options")) {
      if (stale) throw new HostedOnboardingApiError({ code: "SENSITIVE_ACTION_FRESH_LOGIN_REQUIRED", message: "Sign in again." });
      return { token: "synthetic-registration-token", options: { challenge: "synthetic-registration-challenge" } };
    }
    if (url.endsWith("/register")) {
      expect(payload).toEqual({ initialToken: "synthetic-registration-token", response: { id: "synthetic-new-credential" } });
      configured = true;
      if (loseRegistrationResponse) throw new Error("Passkey save could not be confirmed. Try the request again.");
      return { registered: true };
    }
    if (url === `${base}/decision`) return { status: payload?.decision, redirectTo: null };
    throw new Error(`Unexpected test route: ${url}`);
  });
});
const callsTo = (suffix: string) => mocks.request.mock.calls.filter(([input]) => input.url.endsWith(suffix));
async function render() { return renderClientComponent(createElement(ActionApprovalCard, { approval })); }
async function click(view: Awaited<ReturnType<typeof render>>, label = "Approve with passkey") {
  const button = [...view.container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Missing synthetic action: ${label}`);
  await act(async () => { button.dispatchEvent(new view.window.Event("click", { bubbles: true })); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

test("fresh legacy approval enrolls inline, refreshes the exact action and still requires native proof", async () => {
  const proof = deferred<{ id: string }>();
  mocks.authenticate.mockReturnValue(proof.promise);
  const view = await render();
  try {
    await click(view);
    expect(callsTo("/register")).toHaveLength(1);
    expect(callsTo("/decision")).toHaveLength(0);
    expect(callsTo("/challenge").map(([input]) => input.url)).toEqual([`${base}/challenge`, `${base}/challenge`]);
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
    await act(async () => { proof.resolve({ id: "synthetic-native-assertion" }); });
    expect(callsTo("/decision")[0][0]).toMatchObject({ url: `${base}/decision`, payload: {
      decision: "approved", authorization: { method: "passkey", token: token(2), assertion: { id: "synthetic-native-assertion" } },
    } });
    expect(view.container.textContent).toContain("Approval recorded.");
  } finally { await view.cleanup(); }
});

test("stale sign-in waits for an inline continuation and never submits the pre-login action token", async () => {
  stale = true;
  const login = deferred<void>();
  mocks.reauthenticate.mockImplementation(async () => { await login.promise; stale = false; });
  const view = await render();
  try {
    await click(view);
    expect(mocks.reauthenticate).toHaveBeenCalledOnce();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(callsTo("/decision")).toHaveLength(0);
    await act(async () => { login.resolve(); });
    expect(callsTo("/initial-options")).toHaveLength(2);
    expect(callsTo("/decision")[0][0].payload.authorization.token).toBe(token(2));
  } finally { await view.cleanup(); }
});

test.each(["registration", "sign-in", "verification"])("canceling %s does not approve or fall back", async (where) => {
  if (where === "registration") mocks.register.mockRejectedValue(new Error("Passkey setup canceled."));
  if (where === "sign-in") { stale = true; mocks.reauthenticate.mockRejectedValue(new Error("Sign-in canceled.")); }
  if (where === "verification") { configured = true; mocks.authenticate.mockRejectedValue(new Error("Passkey canceled.")); }
  const view = await render();
  try {
    await click(view);
    expect(callsTo("/register")).toHaveLength(0);
    expect(callsTo("/decision")).toHaveLength(0);
    if (where === "verification") expect(callsTo("/initial-options")).toHaveLength(0);
    expect(view.container.textContent).toContain("canceled");
  } finally { await view.cleanup(); }
});

test("a lost committed registration response is retry-safe through the native verifier", async () => {
  loseRegistrationResponse = true;
  const view = await render();
  try {
    await click(view);
    expect(configured).toBe(true);
    expect(callsTo("/decision")).toHaveLength(0);
    await click(view);
    expect(callsTo("/register")).toHaveLength(1);
    expect(callsTo("/decision")).toHaveLength(1);
    expect(mocks.authenticate).toHaveBeenCalledOnce();
  } finally { await view.cleanup(); }
});

test("an expired or already-decided action after enrollment cannot be silently approved", async () => {
  mocks.register.mockImplementation(async () => { unavailable = true; return { id: "synthetic-new-credential" }; });
  const view = await render();
  try {
    await click(view);
    expect(configured).toBe(true);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(callsTo("/decision")).toHaveLength(0);
    expect(view.container.textContent).toContain("expired or was already decided");
  } finally { await view.cleanup(); }
});

test("unmount during the authenticator prompt cannot commit registration or a decision", async () => {
  const registration = deferred<{ id: string }>();
  mocks.register.mockReturnValue(registration.promise);
  const view = await render();
  await click(view);
  await view.cleanup();
  await act(async () => { registration.resolve({ id: "synthetic-new-credential" }); });
  expect(callsTo("/register")).toHaveLength(0);
  expect(callsTo("/decision")).toHaveLength(0);
});

test("ordinary native approval remains one challenge and deny never enrolls", async () => {
  configured = true;
  const native = await render();
  try {
    await click(native);
    expect(callsTo("/challenge")).toHaveLength(1);
    expect(callsTo("/initial-options")).toHaveLength(0);
    expect(mocks.register).not.toHaveBeenCalled();
  } finally { await native.cleanup(); }
  mocks.request.mockClear(); configured = false;
  const denied = await render();
  try {
    await click(denied, "Deny");
    expect(callsTo("/decision")[0][0].payload).toEqual({ decision: "denied" });
    expect(callsTo("/challenge")).toHaveLength(0);
    expect(callsTo("/initial-options")).toHaveLength(0);
  } finally { await denied.cleanup(); }
});


test("reload after a lost registration response uses the durable native credential", async () => {
  loseRegistrationResponse = true;
  const first = await render();
  try { await click(first); } finally { await first.cleanup(); }
  expect(configured).toBe(true);
  const reloaded = await render();
  try {
    await click(reloaded);
    expect(callsTo("/register")).toHaveLength(1);
    expect(callsTo("/decision")).toHaveLength(1);
    expect(mocks.authenticate).toHaveBeenCalledOnce();
  } finally { await reloaded.cleanup(); }
});

test("another browser winning enrollment requires an explicit retry and the winning native factor", async () => {
  mocks.register.mockImplementationOnce(async () => {
    configured = true;
    throw new Error("Passkey setup changed. Try again.");
  });
  const view = await render();
  try {
    await click(view);
    expect(callsTo("/decision")).toHaveLength(0);
    expect(callsTo("/register")).toHaveLength(0);
    await click(view);
    expect(mocks.register).toHaveBeenCalledOnce();
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    expect(callsTo("/decision")).toHaveLength(1);
  } finally { await view.cleanup(); }
});


function ExistingPasskeyControl() {
  const enrollment = useApprovalPasskeyEnrollment();
  return createElement("button", { onClick: () => void enrollment.enroll(), disabled: enrollment.pending }, enrollment.registered ? "Saved" : "Add Murph passkey");
}

test.each([false, true])("existing shared enrollment control repairs and refreshes durable status (lost response=%s)", async (lost) => {
  loseRegistrationResponse = lost;
  const view = await renderClientComponent(createElement(ExistingPasskeyControl));
  try {
    await click(view, "Add Murph passkey");
    expect(configured).toBe(true);
    expect(callsTo("/register")).toHaveLength(1);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(callsTo("/decision")).toHaveLength(0);
    expect(view.container.textContent).toBe(lost ? "Add Murph passkey" : "Saved");
  } finally { await view.cleanup(); }
});
