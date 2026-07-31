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
  return {
    Dialog: ({
      children,
      open,
    }: {
      children?: ReactNode;
      open?: boolean;
    }) => open ? React.createElement(React.Fragment, null, children) : null,
    DialogContent: (
      props: HTMLAttributes<HTMLDivElement> & { showCloseButton?: boolean },
    ) => {
      const elementProps = { ...props };
      delete elementProps.showCloseButton;
      return React.createElement(
        "div",
        { ...elementProps, role: "dialog" },
        props.children,
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
    "Murph will pause health data processing and disconnect your health sources.",
  );
  expect(rendered.container.textContent).toContain(
    "Your account, existing data, and subscription will not be deleted.",
  );
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
  healthStatus: "granted" | "revoked",
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
        grant: {
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
