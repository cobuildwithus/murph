import {
  act,
  createElement,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { HostedHealthDataConsentSettings } from "@/src/components/settings/hosted-health-data-consent-settings";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  publishBrowserVaultSessionInvalidation: vi.fn(),
  reloadCurrentHostedAuthDocument: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/components/hosted-onboarding/client-api")
  >();
  return {
    ...actual,
    requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
  };
});

vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  reloadCurrentHostedAuthDocument: mocks.reloadCurrentHostedAuthDocument,
}));

vi.mock("@/src/lib/browser-vault/session-invalidation", () => ({
  publishBrowserVaultSessionInvalidation:
    mocks.publishBrowserVaultSessionInvalidation,
}));

vi.mock("@/src/components/ui/dialog", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const DialogContext = React.createContext<((open: boolean) => void) | null>(null);
  return {
    Dialog: ({
      children,
      onOpenChange,
      open,
    }: {
      children?: ReactNode;
      onOpenChange?: (open: boolean) => void;
      open?: boolean;
    }) => open
      ? React.createElement(DialogContext.Provider, { value: onOpenChange ?? null }, children)
      : null,
    DialogContent: (
      props: HTMLAttributes<HTMLDivElement> & { showCloseButton?: boolean },
    ) => {
      const onOpenChange = React.useContext(DialogContext);
      const { children, showCloseButton, ...elementProps } = props;
      return React.createElement(
        "div",
        {
          ...elementProps,
          onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Escape") {
              onOpenChange?.(false);
            }
          },
          role: "dialog",
        },
        showCloseButton
          ? React.createElement("button", {
              "aria-label": "Close",
              onClick: () => onOpenChange?.(false),
              type: "button",
            })
          : null,
        React.createElement("button", {
          "aria-label": "Dismiss outside",
          hidden: true,
          onClick: () => onOpenChange?.(false),
          type: "button",
        }),
        children,
      );
    },
    DialogDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
      React.createElement("p", props),
    DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
      React.createElement("div", props),
    DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
      React.createElement("h2", props),
  };
});

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
  vi.useRealTimers();
});

test("renders separate active and paused consent controls", async () => {
  const active = await renderClientComponent(
    createElement(HostedHealthDataConsentSettings, {
      authenticated: true,
      initialStatus: createConsentStatus("granted"),
    }),
    { requireButton: false },
  );
  cleanupRender = active.cleanup;

  expect(active.container.textContent).toContain("Health data use");
  expect(active.container.textContent).toContain("Used to personalize Murph");
  expect(active.container.textContent).toContain("Withdraw consent");
  const sourceReviewLink = active.container.querySelector('a[href="/connect"]');
  expect(sourceReviewLink?.textContent).toContain("Manage sources");
  expect(sourceReviewLink?.className).toContain("min-h-10");
  expect(sourceReviewLink?.parentElement?.className).toContain("flex");
  expect(sourceReviewLink?.parentElement?.className).not.toContain("flex-col");
  expect(active.container.firstElementChild?.className).toContain("items-center");
  expect(active.container.firstElementChild?.className).toContain(
    "grid-cols-[auto_minmax(0,1fr)]",
  );
  expect(active.container.firstElementChild?.className).toContain(
    "sm:grid-cols-[auto_minmax(0,1fr)_auto]",
  );
  const withdrawButton = findButton(active.container, "Withdraw consent");
  expect(withdrawButton.parentElement).toBe(sourceReviewLink?.parentElement);
  expect(withdrawButton.parentElement?.className).toContain("col-start-2");
  expect(withdrawButton.parentElement?.className).toContain("sm:col-start-3");
  expect(withdrawButton.className).toContain("bg-transparent");
  expect(withdrawButton.className).toContain("border-destructive/30");
  expect(withdrawButton.className).toContain("hover:bg-destructive/[0.05]");
  expect(withdrawButton.className).toContain("focus-visible:ring-ring/50");
  expect(withdrawButton.className).toContain("h-7");
  expect(withdrawButton.className).toContain("min-h-10");

  await cleanupRender();
  cleanupRender = null;

  const paused = await renderClientComponent(
    createElement(HostedHealthDataConsentSettings, {
      authenticated: true,
      initialStatus: createConsentStatus("revoked"),
    }),
    { requireButton: false },
  );
  cleanupRender = paused.cleanup;

  expect(paused.container.textContent).toContain("Processing paused");
  expect(paused.container.textContent).toContain("Use Murph again");
  expect(paused.container.firstElementChild?.className).toContain(
    "sm:grid-cols-[auto_minmax(0,1fr)_auto]",
  );
  expect(findButton(paused.container, "Use Murph again").className).toContain(
    "sm:col-start-3",
  );
});

test("renders legacy missing and unavailable consent states without treating either as withdrawn", async () => {
  const notEnabled = await renderClientComponent(
    createElement(HostedHealthDataConsentSettings, {
      authenticated: true,
      initialStatus: createConsentStatus("missing"),
    }),
    { requireButton: false },
  );
  cleanupRender = notEnabled.cleanup;

  expect(notEnabled.container.textContent).toContain("Not enabled");
  expect(findButton(notEnabled.container, "Review").disabled).toBe(false);

  await cleanupRender();
  cleanupRender = null;

  const unavailable = await renderClientComponent(
    createElement(HostedHealthDataConsentSettings, {
      authenticated: true,
      initialStatus: null,
    }),
    { requireButton: false },
  );
  cleanupRender = unavailable.cleanup;

  expect(unavailable.container.textContent).toContain("Status unavailable");
  expect(findButton(unavailable.container, "Retry status").disabled).toBe(false);
});

test("retries an unavailable status into the authoritative current state", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValueOnce(createConsentStatus("revoked"));
  const rendered = await renderClientComponent(
    createElement(HostedHealthDataConsentSettings, {
      authenticated: true,
      initialStatus: null,
    }),
    { requireButton: false },
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    findButton(rendered.container, "Retry status")
      .dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    url: "/api/legal/consent/status",
  });
  expect(rendered.container.textContent).toContain("Processing paused");
  expect(rendered.container.textContent).toContain("Use Murph again");
});

test("keeps keyboard focus available while a status retry is pending", async () => {
  let resolveStatus!: (status: HostedConsentStatus) => void;
  mocks.requestHostedOnboardingJson.mockReturnValueOnce(new Promise((resolve) => {
    resolveStatus = resolve;
  }));
  const rendered = await renderClientComponent(
    createElement(HostedHealthDataConsentSettings, {
      authenticated: true,
      initialStatus: null,
    }),
    { requireButton: false },
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    findButton(rendered.container, "Retry status")
      .dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  expect(findButton(rendered.container, "Checking...").disabled).toBe(false);

  await act(async () => {
    resolveStatus(createConsentStatus("revoked"));
    await Promise.resolve();
  });
});

test("keeps status retry available after another read failure", async () => {
  mocks.requestHostedOnboardingJson.mockRejectedValueOnce(new Error("unavailable"));
  const rendered = await renderClientComponent(
    createElement(HostedHealthDataConsentSettings, {
      authenticated: true,
      initialStatus: null,
    }),
    { requireButton: false },
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    findButton(rendered.container, "Retry status")
      .dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(rendered.container.textContent).toContain("Status is still unavailable. Try again.");
  expect(
    rendered.container.querySelector('[aria-live="polite"]')?.className,
  ).toContain("text-destructive");
  expect(findButton(rendered.container, "Retry status").disabled).toBe(false);
});

test("confirms that withdrawal preserves the account, data, and subscription", async () => {
  const rendered = await renderClientComponent(
    createElement(HostedHealthDataConsentSettings, {
      authenticated: true,
      initialStatus: createConsentStatus("granted"),
    }),
    { requireButton: false },
  );
  cleanupRender = rendered.cleanup;

  const openButton = findButton(rendered.container, "Withdraw consent");
  await act(async () => {
    openButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(rendered.container.textContent).toContain("Withdraw health data consent?");
  expect(rendered.container.textContent).toContain(
    "Murph will pause health data processing and try to disconnect your health sources",
  );
  expect(rendered.container.textContent).toContain(
    "Your account, existing data, and subscription stay unchanged.",
  );
});

test("prevents re-consent dismissal while the legal write is pending", async () => {
  let resolveAcceptance: ((status: HostedConsentStatus) => void) | null = null;
  const acceptance = new Promise<HostedConsentStatus>((resolve) => {
    resolveAcceptance = resolve;
  });
  mocks.requestHostedOnboardingJson.mockReturnValueOnce(acceptance);
  const rendered = await renderClientComponent(
    createElement(HostedHealthDataConsentSettings, {
      authenticated: true,
      initialStatus: createConsentStatus("revoked"),
    }),
    { requireButton: false },
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    findButton(rendered.container, "Use Murph again")
      .dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  expect(rendered.container.querySelector('button[aria-label="Close"]')).not.toBeNull();

  await act(async () => {
    findButton(rendered.container, "Consent")
      .dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  const dialog = rendered.container.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog?.getAttribute("aria-busy")).toBe("true");
  expect(rendered.container.querySelector('button[aria-label="Close"]')).toBeNull();
  const escapeEvent = new rendered.window.Event("keydown", { bubbles: true });
  Object.defineProperty(escapeEvent, "key", { value: "Escape" });
  dialog?.dispatchEvent(escapeEvent);
  rendered.container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss outside"]')
    ?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  expect(rendered.container.querySelector('[role="dialog"]')).not.toBeNull();

  await act(async () => {
    resolveAcceptance?.(createConsentStatus("granted"));
    await acceptance;
  });
  expect(rendered.container.querySelector('[role="dialog"]')).toBeNull();
  act(() => vi.advanceTimersByTime(100));
  expect(mocks.reloadCurrentHostedAuthDocument).toHaveBeenCalledTimes(1);
});

test("keeps a failed re-consent visible and retryable", async () => {
  mocks.requestHostedOnboardingJson.mockRejectedValueOnce(new Error("temporary failure"));
  const rendered = await renderClientComponent(
    createElement(HostedHealthDataConsentSettings, {
      authenticated: true,
      initialStatus: createConsentStatus("revoked"),
    }),
    { requireButton: false },
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    findButton(rendered.container, "Use Murph again")
      .dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  await act(async () => {
    findButton(rendered.container, "Consent")
      .dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(rendered.container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(rendered.container.textContent).toContain("temporary failure");
  expect(rendered.container.querySelector('button[aria-label="Close"]')).not.toBeNull();
  expect(findButton(rendered.container, "Consent").disabled).toBe(false);
});

test("keeps the withdrawal dialog visibly pending while revocation is in flight", async () => {
  mocks.requestHostedOnboardingJson.mockReturnValue(new Promise(() => {}));
  const rendered = await renderClientComponent(
    createElement(HostedHealthDataConsentSettings, {
      authenticated: true,
      initialStatus: createConsentStatus("granted"),
    }),
    { requireButton: false },
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    findButton(rendered.container, "Withdraw consent")
      .dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  await act(async () => {
    findButton(rendered.container, "Withdraw consent", 1)
      .dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(findButton(rendered.container, "Withdrawing...").disabled).toBe(true);
  expect(findButton(rendered.container, "Cancel").disabled).toBe(true);
});

test("withdraws through the health-data route and invalidates the browser vault", async () => {
  const withdrawnStatus = createConsentStatus("revoked");
  mocks.requestHostedOnboardingJson.mockResolvedValue(withdrawnStatus);
  const rendered = await renderClientComponent(
    createElement(HostedHealthDataConsentSettings, {
      authenticated: true,
      initialStatus: createConsentStatus("granted"),
    }),
    { requireButton: false },
  );
  cleanupRender = rendered.cleanup;

  const openButton = findButton(rendered.container, "Withdraw consent");
  await act(async () => {
    openButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  const confirmButton = findButton(rendered.container, "Withdraw consent", 1);
  await act(async () => {
    confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    payload: {
      scope: "launch.health-data",
      source: "settings-health-data",
    },
    url: "/api/legal/consent/revoke",
  });
  expect(mocks.publishBrowserVaultSessionInvalidation).toHaveBeenCalledTimes(1);
  expect(rendered.container.textContent).toContain("Use Murph again");
});

test("shows withdrawal failures inside the open confirmation dialog", async () => {
  mocks.requestHostedOnboardingJson.mockRejectedValueOnce(
    new Error("temporary failure"),
  );
  const rendered = await renderClientComponent(
    createElement(HostedHealthDataConsentSettings, {
      authenticated: true,
      initialStatus: createConsentStatus("granted"),
    }),
    { requireButton: false },
  );
  cleanupRender = rendered.cleanup;

  await act(async () => {
    findButton(rendered.container, "Withdraw consent")
      .dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
  await act(async () => {
    findButton(rendered.container, "Withdraw consent", 1)
      .dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  const dialog = rendered.container.querySelector('[role="dialog"]');
  expect(dialog?.querySelector('[role="alert"]')?.textContent).toContain(
    "Murph could not withdraw health data consent right now.",
  );
});

function findButton(
  container: HTMLElement,
  text: string,
  index = 0,
): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button"))
    .filter((button) => button.textContent?.trim() === text);
  const button = buttons[index];
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

function createConsentStatus(
  healthStatus: "granted" | "missing" | "revoked",
): HostedConsentStatus {
  const healthDocument = {
    href: "/consumer-health-data-privacy-policy",
    id: "consumer-health-data-notice" as const,
    pdfHref: "/legal/consumer-health-data-notice.pdf",
    title: "Murph Consumer Health Data Notice",
    version: "2026-07-23",
  };
  const healthGranted = healthStatus === "granted";

  return {
    documents: [healthDocument],
    generatedAt: "2026-07-30T12:00:00.000Z",
    launchGranted: healthGranted,
    launchScopes: [
      {
        granted: true,
        missingDocuments: [],
        scope: "launch.legal",
      },
      {
        granted: healthGranted,
        missingDocuments: healthGranted ? [] : [healthDocument],
        scope: "launch.health-data",
      },
    ],
    ok: true,
    schema: "murph.hosted-consent-status.v1",
    scopes: [
      {
        current: true,
        documents: [],
        grant: {
          documentVersions: {},
          grantedAt: "2026-07-23T12:00:00.000Z",
          lastEventId: null,
          revokedAt: null,
          scope: "launch.legal",
          source: "test",
          status: "granted",
          updatedAt: "2026-07-23T12:00:00.000Z",
        },
        granted: true,
        label: "Terms, privacy, and AI disclosure",
        missingDocuments: [],
        revocable: false,
        scope: "launch.legal",
      },
      {
        current: healthGranted,
        documents: [healthDocument],
        grant: healthStatus === "missing"
          ? null
          : {
              documentVersions: {
                "consumer-health-data-notice": "2026-07-23",
              },
              grantedAt: "2026-07-23T12:00:00.000Z",
              lastEventId: null,
              revokedAt: healthGranted ? null : "2026-07-30T12:00:00.000Z",
              scope: "launch.health-data",
              source: "test",
              status: healthStatus,
              updatedAt: "2026-07-30T12:00:00.000Z",
            },
        granted: healthGranted,
        label: "Health data notice and processing authorization",
        missingDocuments: healthGranted ? [] : [healthDocument],
        revocable: true,
        scope: "launch.health-data",
      },
    ],
  };
}
