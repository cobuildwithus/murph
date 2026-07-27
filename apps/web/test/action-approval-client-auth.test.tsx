import { createElement } from "react";
import { act } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  openAuthDialog: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
  setup: {
    clientAuthenticated: false,
    error: null as string | null,
    pendingLabel: null as string | null,
    ready: true,
  },
  signChallenge: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({
  useAuth: () => ({
    authenticated: true,
    openAuthDialog: mocks.openAuthDialog,
  }),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

vi.mock("@/src/components/sensitive-actions/use-sensitive-action-authorization", () => ({
  useSensitiveActionAuthorization: () => ({
    setup: mocks.setup,
    signChallenge: mocks.signChallenge,
  }),
}));

import { ActionApprovalCard } from "@/src/components/sensitive-actions/action-approval-card";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestHostedOnboardingJson.mockReset();
  mocks.signChallenge.mockReset();
  mocks.setup.clientAuthenticated = false;
  mocks.setup.error = null;
  mocks.setup.pendingLabel = null;
  mocks.setup.ready = true;
});

test("reauthenticates the Privy client before issuing an approval challenge", async () => {
  const rendered = await renderClientComponent(createElement(ActionApprovalCard, {
    approval: pendingApproval(),
  }));

  expect(rendered.button.textContent).toBe("Sign in to approve");

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(mocks.openAuthDialog).toHaveBeenCalledTimes(1);
  expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  expect(mocks.signChallenge).not.toHaveBeenCalled();

  await rendered.cleanup();
});

test("preserves the first approval click while Privy is still initializing", async () => {
  mocks.setup.ready = false;
  mocks.requestHostedOnboardingJson.mockReturnValue(new Promise(() => {}));
  const rendered = await renderClientComponent(createElement(ActionApprovalCard, {
    approval: pendingApproval(),
  }));

  expect(rendered.button.textContent).toBe("Approve with passkey");

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  expect(mocks.openAuthDialog).not.toHaveBeenCalled();
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);

  await rendered.cleanup();
});

test("recovers a first-click hydration race into the sign-in action", async () => {
  const signing = deferred<void>();
  mocks.setup.ready = false;
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    message: "approval challenge",
    token: "challenge-token",
  });
  mocks.signChallenge.mockReturnValue(signing.promise);
  const rendered = await renderClientComponent(createElement(ActionApprovalCard, {
    approval: pendingApproval(),
  }));

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
  expect(mocks.signChallenge).toHaveBeenCalledTimes(1);

  mocks.setup.ready = true;
  await rendered.rerender(createElement(ActionApprovalCard, {
    approval: pendingApproval(),
  }));

  expect(rendered.button.textContent).toBe("Sign in to approve");
  expect(rendered.button.disabled).toBe(true);

  await act(async () => {
    signing.reject(new Error("Sign in on this device to continue."));
    await Promise.resolve();
  });

  expect(rendered.button.textContent).toBe("Sign in to approve");
  expect(rendered.button.disabled).toBe(false);

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(mocks.openAuthDialog).toHaveBeenCalledTimes(1);
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);

  await rendered.cleanup();
});

function pendingApproval() {
  return {
    approvalId: "approval-test",
    continuation: "automatic" as const,
    expiresAt: "2099-01-01T00:00:00.000Z",
    presentation: {
      body: "Allow the requested action.",
      title: "Approve action",
    },
    returnContactKind: null,
    status: "pending" as const,
  };
}

function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
