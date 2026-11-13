import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import type { HTMLAttributes, ReactNode } from "react";
import { act, Children, createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";

import { JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG } from "@murphai/device-syncd/fitbit-migration";

import { renderClientComponent } from "./render-client-component";

import ConnectPage from "../app/(dashboard)/connect/connect-page-content";
import {
  resolveConfiguredConnectSources,
  resolveConnectSourceConnectionStates,
  resolveConnectedConnectSourceConnections,
  resolveHistoricalResetIncompleteConnectSourceIds,
} from "../src/lib/device-sync/connect-sources";
import {
  filterConnectSourcesForSearch,
  ConnectSourcesGrid,
  requiresVitalConnectionPreflight,
} from "../app/(dashboard)/connect/connect-page-client";
import { SourceCard } from "../app/(dashboard)/connect/connect-source-card";
import { markLocallyDisconnectedSources } from "../app/(dashboard)/connect/connect-page-helpers";

const WHOOP_SOURCE = {
  id: "whoop",
  name: "Whoop",
  description: "Recovery, strain, sleep, and heart rate.",
  logo: {
    className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
    height: 15,
    src: "/brand-logos/connect/whoop.svg",
    width: 96,
  },
};

const GARMIN_SOURCE = {
  id: "garmin",
  name: "Garmin",
  description: "Workouts, sleep, stress, heart rate, and body battery.",
  logo: {
    className: "size-11 object-contain",
    height: 44,
    src: "/brand-logos/connect/garmin.png",
    width: 44,
  },
};

const OURA_SOURCE = {
  id: "oura",
  name: "Oura",
  description: "Sleep, readiness, activity, heart rate, and temperature trends.",
  logo: {
    className: "size-11 object-contain",
    height: 44,
    src: "/brand-logos/connect/oura.png",
    width: 44,
  },
};

const CONNECTED_WHOOP_V2 = {
  providerLabel: "WHOOP",
  resourceCount: 3,
  sourceProviderSlug: "whoop_v2",
  status: "connected",
} as const;

vi.mock("next/image", () => ({
  default: (props: {
    alt?: string;
    className?: string;
    height?: number;
    src: string;
    width?: number;
  }) =>
    createElement("img", {
      alt: props.alt ?? "",
      className: props.className,
      height: props.height,
      src: props.src,
      width: props.width,
    }),
}));

vi.mock("@/src/components/ui/dialog", () => {
  let activeOnOpenChange: ((open: boolean) => void) | undefined;

  return {
    Dialog: ({
      children,
      onOpenChange,
      open,
    }: {
      children?: ReactNode;
      onOpenChange?: (open: boolean) => void;
      open?: boolean;
    }) => {
      if (!open) {
        return null;
      }
      activeOnOpenChange = onOpenChange;
      return createElement("div", { "data-dialog-open": "true" }, children);
    },
    DialogContent: ({
      children,
      className,
      inert,
      showCloseButton = true,
    }: HTMLAttributes<HTMLDivElement> & { showCloseButton?: boolean }) =>
      createElement(
        "div",
        {
          className,
          "data-dialog-content": "true",
          "data-dialog-inert": inert ? "true" : "false",
        },
        children,
        showCloseButton
          ? createElement(
              "button",
              {
                "aria-label": "Close",
                onClick: () => activeOnOpenChange?.(false),
                type: "button",
              },
              "Close",
            )
          : null,
      ),
    DialogDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
      createElement("p", props),
    DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
      createElement("div", props),
    DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
      createElement("h2", props),
  };
});

vi.mock("@/src/components/legal/hosted-legal-consent-card", () => ({
  HostedLegalConsentCard: (props: {
    mode?: string;
    onAccepted?: () => void | Promise<void>;
    preferredScope?: string;
    source: string;
  }) =>
    createElement(
      "button",
      {
        "data-consent-mode": props.mode,
        "data-consent-scope": props.preferredScope,
        "data-consent-source": props.source,
        "data-hosted-legal-consent-card": "true",
        onClick: () => void props.onAccepted?.(),
        type: "button",
      },
      "Accept consent",
    ),
}));

const desktopMatchMedia: typeof window.matchMedia = (query) => ({
  addEventListener: () => {},
  addListener: () => {},
  dispatchEvent: () => false,
  matches: false,
  media: query,
  onchange: null,
  removeEventListener: () => {},
  removeListener: () => {},
});

const mocks = vi.hoisted(() => ({
  authDialogProps: null as { open?: boolean } | null,
  buildHostedDeviceSyncSettingsResponse: vi.fn(),
  getHostedPageAuthSnapshot: vi.fn(),
  resolveHostedMurphContactOption: vi.fn(),
  resolveHostedMurphContactOptions: vi.fn(),
  routerRefresh: vi.fn(),
  searchParams: null as URLSearchParams | null,
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();

  return {
    ...actual,
    useRouter: () => ({ refresh: mocks.routerRefresh }),
    useSearchParams: () => mocks.searchParams,
  };
});

vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog(props: { open?: boolean }) {
    mocks.authDialogProps = props;
    return props.open
      ? createElement("div", { "data-auth-dialog-open": "true" }, "Auth dialog")
      : null;
  },
  preloadHostedAuthPanelIsland: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/settings-service", () => ({
  buildHostedDeviceSyncSettingsResponse:
    mocks.buildHostedDeviceSyncSettingsResponse,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
  getHostedDashboardPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/components/murph/hosted-murph-contact-action", () => ({
  resolveHostedMurphContactOption: mocks.resolveHostedMurphContactOption,
  resolveHostedMurphContactOptions: mocks.resolveHostedMurphContactOptions,
}));

beforeEach(() => {
  mocks.searchParams = null;
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValue({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [],
  });
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    },
    linkedAccounts: [],
    session: null,
  });
  mocks.resolveHostedMurphContactOption.mockResolvedValue(null);
  mocks.resolveHostedMurphContactOptions.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mocks.authDialogProps = null;
});

test("ConnectPage renders search, source availability, native setup, and valid decorative logos", async () => {
  const { metadata } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.equal(metadata.title, "Connect Devices — Murph");
  const ogImages = metadata.openGraph?.images;
  assert.ok(Array.isArray(ogImages));
  const [ogImage] = ogImages;
  assert.ok(typeof ogImage === "object" && ogImage !== null && "url" in ogImage);
  assert.equal(String(ogImage.url), "/connect/opengraph-image");
  assert.match(markup, /aria-label="Search sources"/u);
  assert.match(markup, /data-connect-source="fitbit"/u);
  assert.match(markup, /data-connect-source="oura"/u);
  assert.match(markup, /aria-label="Oura connection is not available yet"/u);
  assert.match(markup, /Oura not connected/u);
  assert.match(markup, /aria-label="Download app for Apple Health"/u);
  assert.match(markup, /href="https:\/\/apps\.apple\.com\/us\/app\/murph-ai\/id6786145859"/u);
  assert.match(markup, /rel="noopener noreferrer"/u);
  assert.match(markup, /aria-label="Dexcom web setup is not available yet"[^>]+disabled/u);
  assert.doesNotMatch(markup, /aria-label="Connect Dexcom"/u);
  assert.doesNotMatch(markup, /Mobvoi \/ TicWatch|Get Murph for Android|play\.google\.com/u);

  for (const relayName of [
    "Zepp / Amazfit",
    "Xiaomi / Mi Fitness",
    "RingConn",
    "COROS",
    "Suunto",
    "Huawei Health",
  ]) {
    assert.match(
      markup,
      new RegExp(`aria-label="Set up sync for ${escapeRegExp(relayName)}"`, "u"),
    );
  }

  const logos = [...markup.matchAll(/<img[^>]*src="(\/brand-logos\/connect\/[^"]+)"[^>]*>/gu)];
  assert.ok(logos.length > 0);
  for (const [image, assetPath] of logos) {
    assert.match(image, /alt=""/u);
    assert.ok(
      existsSync(path.join(process.cwd(), "apps/web/public", assetPath)),
      `${assetPath} should exist under apps/web/public`,
    );
  }
});

test("ConnectPage maps the WHOOP setup Messages option at the server boundary", async () => {
  mocks.resolveHostedMurphContactOptions.mockResolvedValueOnce([
    {
      href: "sms:+15550100001?body=Help%20me%20finish%20setting%20up%20WHOOP",
      kind: "text",
      label: "Messages",
    },
  ]);

  const page = await ConnectPage();

  assert.deepEqual(readWhoopSyncContactAction(page), {
    href: "sms:+15550100001?body=Help%20me%20finish%20setting%20up%20WHOOP",
    kind: "imessage",
    label: "Text Murph",
  });
});

test("ConnectPage preserves the WHOOP setup Telegram option at the server boundary", async () => {
  mocks.resolveHostedMurphContactOptions.mockResolvedValueOnce([
    {
      href: "https://t.me/withmurph_bot?text=Help%20me%20finish%20setting%20up%20WHOOP",
      kind: "telegram",
      label: "Telegram",
      rel: "noopener noreferrer",
      target: "_blank",
    },
  ]);

  const page = await ConnectPage();

  assert.deepEqual(readWhoopSyncContactAction(page), {
    href: "https://t.me/withmurph_bot?text=Help%20me%20finish%20setting%20up%20WHOOP",
    kind: "telegram",
    label: "Text Murph",
    rel: "noopener noreferrer",
    target: "_blank",
  });
});

test("ConnectPage fails open when the WHOOP setup contact route cannot resolve", async () => {
  mocks.resolveHostedMurphContactOptions.mockRejectedValueOnce(
    new Error("contact routing unavailable"),
  );

  const page = await ConnectPage();

  assert.equal(readWhoopSyncContactAction(page), null);
});

test("ConnectPage maps the Zepp setup Messages option at the server boundary", async () => {
  mocks.resolveHostedMurphContactOptions
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        href: "sms:+15550100001?body=Help%20me%20set%20up%20Zepp",
        kind: "text",
        label: "Messages",
      },
    ]);

  const page = await ConnectPage();

  assert.deepEqual(readConnectSourcesGridProp(page, "zeppSyncContactAction"), {
    href: "sms:+15550100001?body=Help%20me%20set%20up%20Zepp",
    kind: "imessage",
    label: "Text Murph",
  });
});

test("ConnectPage maps brand-specific Apple Health relay setup Messages options", async () => {
  mocks.resolveHostedMurphContactOptions
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        href: "sms:+15550100001?body=Help%20me%20set%20up%20my%20wearable",
        kind: "text",
        label: "Messages",
      },
    ]);

  const page = await ConnectPage();

  assert.deepEqual(
    readConnectSourcesGridProp(page, "appleHealthRelaySyncContactActions"),
    {
      "xiaomi-mi-fitness-apple-health": {
        href: "sms:+15550100001?body=Help%20me%20set%20up%20my%20wearable",
        kind: "imessage",
        label: "Text Murph",
      },
      "ringconn-apple-health": null,
      "coros-apple-health": null,
      "suunto-apple-health": null,
      "huawei-health-apple-health": null,
    },
  );
});

test("filterConnectSourcesForSearch matches source names, ids, and descriptions", async () => {
  const sources = [
    {
      id: "oura",
      name: "Oura",
      description:
        "Oura sleep, readiness, activity, temperature, heart, and nightly recovery trends.",
      logo: {
        className: "size-11 object-contain",
        height: 44,
        src: "/oura.png",
        width: 44,
      },
    },
    {
      id: "freestyle-libre",
      name: "Freestyle Libre",
      description:
        "Libre glucose history, sensor trends, and daily time-in-range context patterns.",
      logo: {
        className: "size-11 object-contain",
        height: 44,
        src: "/libre.png",
        width: 44,
      },
    },
    {
      id: "xiaomi-mi-fitness",
      name: "Xiaomi / Mi Fitness",
      description: "Mi Band and Redmi Watch data through Apple Health.",
      logo: {
        className: "size-11 object-contain",
        height: 44,
        src: "/xiaomi.png",
        width: 44,
      },
    },
  ];

  assert.deepEqual(
    filterConnectSourcesForSearch(sources, "sleep").map((source) => source.id),
    ["oura"],
  );
  assert.deepEqual(
    filterConnectSourcesForSearch(sources, "freeStyle").map(
      (source) => source.id,
    ),
    ["freestyle-libre"],
  );
  assert.deepEqual(
    filterConnectSourcesForSearch(sources, "mi band").map(
      (source) => source.id,
    ),
    ["xiaomi-mi-fitness"],
  );
  assert.deepEqual(
    filterConnectSourcesForSearch(sources, "  ").map((source) => source.id),
    ["oura", "freestyle-libre", "xiaomi-mi-fitness"],
  );
});

test("ConnectSourcesGrid opens source hashes in a dialog and clears them on close", async () => {
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "fitbit",
          description: "Sleep, activity, heart rate, and workouts.",
          id: "fitbit",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/fitbit.svg",
            width: 44,
          },
          name: "Fitbit",
        },
        {
          connectTarget: "oura",
          description: "Sleep and recovery.",
          id: "oura",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/oura.png",
            width: 44,
          },
          name: "Oura",
        },
      ],
    }),
    {
      location: {
        hash: "#fitbit",
        href: "https://example.test/connect#fitbit",
        origin: "https://example.test",
        pathname: "/connect",
        search: "",
      },
      requireButton: false,
    },
  );

  const dialog = rendered.container.querySelector("[data-dialog-open]");
  assert.ok(dialog);
  assert.match(dialog.textContent ?? "", /Fitbit/u);
  assert.doesNotMatch(dialog.textContent ?? "", /Oura/u);
  assert.ok(dialog.querySelector('[data-connect-source="fitbit"]'));

  const closeButton = dialog.querySelector('button[aria-label="Close"]');
  assert.ok(closeButton instanceof rendered.window.HTMLButtonElement);
  await act(async () => {
    closeButton.click();
  });

  assert.equal(rendered.container.querySelector("[data-dialog-open]"), null);
  assert.equal(rendered.window.location.hash, "");
  assert.equal(rendered.replaceState.mock.calls.length, 1);
  assert.equal(
    String(rendered.replaceState.mock.calls[0]?.[2]),
    "https://example.test/connect",
  );

  Object.assign(rendered.window.location, {
    hash: "#oura",
    href: "https://example.test/connect#oura",
  });
  await act(async () => {
    rendered.window.dispatchEvent(new rendered.window.Event("hashchange"));
  });

  const reopenedDialog = rendered.container.querySelector("[data-dialog-open]");
  assert.ok(reopenedDialog);
  assert.match(reopenedDialog.textContent ?? "", /Oura/u);
  assert.doesNotMatch(reopenedDialog.textContent ?? "", /Fitbit/u);
  assert.ok(reopenedDialog.querySelector('[data-connect-source="oura"]'));
  await rendered.cleanup();
});

test("ConnectSourcesGrid hands a signed-out source dialog to auth without losing its continuation hash", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const { AuthProvider } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
      createElement(ConnectSourcesGrid, {
        authenticated: false,
        sources: [
          {
            connectTarget: "fitbit",
            description: "Sleep, activity, heart rate, and workouts.",
            id: "fitbit",
            logo: {
              className: "size-11 object-contain",
              height: 44,
              src: "/fitbit.svg",
              width: 44,
            },
            name: "Fitbit",
          },
        ],
      }),
    ),
    {
      location: {
        hash: "#fitbit",
        href: "https://example.test/connect#fitbit",
        origin: "https://example.test",
        pathname: "/connect",
        search: "",
      },
      requireButton: false,
    },
  );

  const sourceDialog = rendered.container.querySelector("[data-dialog-open]");
  assert.ok(sourceDialog);
  const signInButton = sourceDialog.querySelector(
    'button[aria-label="Sign in to Murph"]',
  );
  assert.ok(signInButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, signInButton);

  await vi.waitFor(() => {
    assert.equal(mocks.authDialogProps?.open, true);
    assert.match(rendered.container.textContent ?? "", /Auth dialog/u);
  });
  assert.equal(rendered.container.querySelector("[data-dialog-open]"), null);
  assert.equal(rendered.window.location.hash, "#fitbit");
  assert.equal(rendered.replaceState.mock.calls.length, 0);
  assert.equal(fetch.mock.calls.length, 0);

  await rendered.cleanup();
});

test("ConnectSourcesGrid keeps source-dialog errors visible until authorization owns the handoff", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json(
      {
        error: {
          code: "DEVICE_SYNC_CONNECT_FAILED",
          message: "Oura could not open. Please try again.",
        },
      },
      { status: 502 },
    ))
    .mockResolvedValueOnce(Response.json({
      authorizationUrl: "https://oura.example.test/oauth/start",
    }));
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "oura",
          description: "Sleep and recovery.",
          id: "oura",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/oura.png",
            width: 44,
          },
          name: "Oura",
        },
      ],
    }),
    {
      location: {
        hash: "#oura",
        href: "https://example.test/connect#oura",
        origin: "https://example.test",
        pathname: "/connect",
        search: "",
      },
      requireButton: false,
    },
  );

  const connectButton = rendered.container.querySelector(
    '[data-dialog-open] button[aria-label="Connect Oura"]',
  );
  assert.ok(connectButton instanceof rendered.window.HTMLButtonElement);
  await clickButton(rendered, connectButton);

  await vi.waitFor(() => {
    const sourceDialog = rendered.container.querySelector("[data-dialog-open]");
    assert.ok(sourceDialog);
    assert.match(
      sourceDialog.querySelector("[role='alert']")?.textContent ?? "",
      /Oura could not open\. Please try again\./u,
    );
  });
  assert.equal(rendered.window.location.hash, "#oura");
  assert.equal(rendered.replaceState.mock.calls.length, 0);
  assert.equal(rendered.assign.mock.calls.length, 0);
  assert.equal(connectButton.disabled, false);

  await clickButton(rendered, connectButton);

  await vi.waitFor(() => {
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "https://oura.example.test/oauth/start",
    );
  });
  assert.equal(rendered.container.querySelector("[data-dialog-open]"), null);
  assert.equal(rendered.window.location.hash, "");
  assert.equal(rendered.replaceState.mock.calls.length, 1);
  assert.equal(fetch.mock.calls.length, 2);

  await rendered.cleanup();
});

test("ConnectSourcesGrid replaces a focused source dialog with its connection preflight", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "garmin",
          description: "Workouts, sleep, stress, and heart rate.",
          id: "garmin",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/garmin.png",
            width: 44,
          },
          name: "Garmin",
          requiresVitalDisclosure: true,
        },
      ],
    }),
    {
      location: {
        hash: "#garmin",
        href: "https://example.test/connect#garmin",
        origin: "https://example.test",
        pathname: "/connect",
        search: "",
      },
      requireButton: false,
    },
  );

  const connectButton = rendered.container.querySelector(
    '[data-dialog-open] button[aria-label="Connect Garmin"]',
  );
  assert.ok(connectButton instanceof rendered.window.HTMLButtonElement);
  await clickButton(rendered, connectButton);

  const successorDialog = rendered.container.querySelector("[data-dialog-open]");
  assert.ok(successorDialog);
  assert.match(successorDialog.textContent ?? "", /Turn on Historical Data/u);
  assert.equal(
    successorDialog.querySelector('[data-connect-source="garmin"]'),
    null,
  );
  assert.equal(rendered.window.location.hash, "");
  assert.equal(rendered.replaceState.mock.calls.length, 1);
  assert.equal(fetch.mock.calls.length, 0);

  await rendered.cleanup();
});

test("ConnectSourcesGrid keeps a failed focused Fitbit migration retry in its dialog", async () => {
  const fetch = vi.fn(async () => Response.json(
    {
      error: {
        code: "DEVICE_SYNC_DISCONNECT_FAILED",
        message: "Fitbit migration could not be retried right now.",
      },
    },
    { status: 502 },
  ));
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [createFitbitMigrationSource({
        migrationRetryRequired: true,
        migrationState: "cutover_ready",
      })],
    }),
    {
      location: {
        hash: "#fitbit",
        href: "https://example.test/connect#fitbit",
        origin: "https://example.test",
        pathname: "/connect",
        search: "",
      },
      requireButton: false,
    },
  );

  const retryButton = rendered.container.querySelector(
    '[data-dialog-open] button[aria-label="Retry Fitbit migration now"]',
  );
  assert.ok(retryButton instanceof rendered.window.HTMLButtonElement);
  await clickButton(rendered, retryButton);

  await vi.waitFor(() => {
    const sourceDialog = rendered.container.querySelector("[data-dialog-open]");
    assert.ok(sourceDialog);
    assert.match(
      sourceDialog.querySelector("[role='alert']")?.textContent ?? "",
      /Fitbit migration could not be retried right now\./u,
    );
  });
  assert.equal(rendered.window.location.hash, "#fitbit");
  assert.equal(rendered.replaceState.mock.calls.length, 0);
  assert.equal(retryButton.disabled, false);

  await rendered.cleanup();
});

test("connect source card screenshot study makes its focused dialog inert", async () => {
  mocks.searchParams = new URLSearchParams("connectSourceDialog=fitbit");
  const { ConnectSourceCardStudy } = await import(
    "../app/design/connect-source-card-study"
  );
  const markup = renderToStaticMarkup(createElement(ConnectSourceCardStudy));

  assert.match(markup, /id="connect-source-dialog"/u);
  assert.match(markup, /data-dialog-inert="true"/u);
});

test("sortConnectSourcesByConnectionState keeps connected sources first, then popularity order", async () => {
  const { sortConnectSourcesByConnectionState } = await import(
    "../src/lib/device-sync/connect-source-order"
  );
  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
  const sources = [
    {
      id: "whoop",
      name: "Whoop",
      description: "Recovery.",
      logo,
    },
    {
      id: "freestyle-libre",
      name: "Freestyle Libre",
      description: "Glucose.",
      logo,
    },
    {
      id: "abbott-libreview",
      name: "Abbott LibreView",
      description: "Glucose reports.",
      logo,
    },
    {
      connected: true,
      id: "oura",
      name: "Oura",
      description: "Sleep.",
      logo,
    },
    {
      id: "garmin",
      name: "Garmin",
      description: "Training.",
      logo,
    },
    {
      id: "zepp",
      name: "Zepp / Amazfit",
      description: "Activity.",
      logo,
    },
    {
      id: "fitbit",
      name: "Fitbit",
      description: "Activity.",
      logo,
    },
    {
      id: "google-fit",
      name: "Google Fit",
      description: "Activity.",
      logo,
    },
    {
      id: "dexcom",
      name: "Dexcom",
      description: "Glucose.",
      logo,
    },
    {
      id: "dexcom-g6-and-older",
      name: "Dexcom (G6 and older)",
      description: "Legacy glucose.",
      logo,
    },
    {
      id: "polar",
      name: "Polar",
      description: "Training.",
      logo,
    },
    {
      id: "strava",
      name: "Strava",
      description: "Workouts.",
      logo,
    },
    {
      id: "ringconn",
      name: "RingConn",
      description: "Sleep.",
      logo,
    },
    {
      id: "huawei-health",
      name: "Huawei Health",
      description: "Activity.",
      logo,
    },
    {
      id: "coros",
      name: "COROS",
      description: "Training.",
      logo,
    },
    {
      id: "withings",
      name: "Withings",
      description: "Health.",
      logo,
    },
    {
      id: "xiaomi-mi-fitness",
      name: "Xiaomi / Mi Fitness",
      description: "Activity.",
      logo,
    },
    {
      id: "suunto",
      name: "Suunto",
      description: "Training.",
      logo,
    },
  ];

  assert.deepEqual(
    sortConnectSourcesByConnectionState(sources).map((source) => source.id),
    [
      "oura",
      "whoop",
      "garmin",
      "fitbit",
      "google-fit",
      "strava",
      "huawei-health",
      "xiaomi-mi-fitness",
      "zepp",
      "withings",
      "coros",
      "suunto",
      "ringconn",
      "dexcom",
      "dexcom-g6-and-older",
      "freestyle-libre",
      "abbott-libreview",
      "polar",
    ],
  );
});

test("ConnectSourcesGrid shows an empty-state alert when no sources are available", async () => {
  const markup = renderToStaticMarkup(
    createElement(ConnectSourcesGrid, { sources: [] }),
  );

  assert.match(markup, /Sources/);
  assert.match(markup, />0 of 0 sources</);
  assert.match(markup, /No sources matched/);
  assert.match(
    markup,
    /Try a different search to get back to the full source list\./,
  );
  assert.doesNotMatch(markup, />Connect<\/button>/u);
});

test("ConnectSourcesGrid opens the Zepp Apple Health setup guide without claiming a direct connection", async () => {
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectionAvailable: false,
          connected: true,
          description:
            "Amazfit activity, sleep, heart rate, and workouts through Apple Health.",
          disconnectConnectionId: "impossible-zepp-provider-state",
          historicalResetIncomplete: true,
          id: "zepp",
          logo: {
            className: "size-11 rounded-md object-contain",
            height: 44,
            src: "/brand-logos/connect/zepp.png",
            width: 44,
          },
          name: "Zepp / Amazfit",
          recoveryKind: "connection_reset",
          requiresReconnect: true,
          setupGuideActionLabel: "Set up sync",
          setupGuideId: "zepp-apple-health",
        },
      ],
      zeppSyncContactAction: {
        href: "sms:+15550100001?body=Help%20me%20set%20up%20Zepp",
        kind: "imessage",
        label: "Text Murph",
      },
    }),
  );

  const setupButton = rendered.container.querySelector(
    'button[aria-label="Set up sync for Zepp / Amazfit"]',
  );
  assert.ok(setupButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(
    rendered.container.querySelector("[data-connection-state]"),
    null,
  );
  assert.equal(
    rendered.container.querySelector(
      'button[aria-label="Disconnect Zepp / Amazfit"]',
    ),
    null,
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Zepp \/ Amazfit (?:connected|not connected)/u,
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /needs a fresh connection|needs reconnect|Please reconnect/u,
  );

  await clickButton(rendered, setupButton);

  assert.match(
    rendered.container.textContent ?? "",
    /Sync Zepp through Apple Health/,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Turn on Apple Health in Zepp/,
  );
  assert.match(rendered.container.textContent ?? "", /Continue with Murph/);
  assert.doesNotMatch(rendered.container.textContent ?? "", /direct Zepp/u);
  assert.equal(rendered.container.querySelector("audio"), null);
  assert.ok(
    rendered.container.querySelector(
      'a[href="https://apps.apple.com/us/app/murph-ai/id6786145859"]',
    ),
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid opens a reusable Xiaomi Apple Health setup guide", async () => {
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      appleHealthRelaySyncContactActions: {
        "xiaomi-mi-fitness-apple-health": {
          href: "sms:+15550100001?body=Help%20me%20set%20up%20Xiaomi",
          kind: "imessage",
          label: "Text Murph",
        },
      },
      sources: [
        {
          connectionAvailable: false,
          description:
            "Mi Band, Xiaomi Smart Band, and Redmi Watch activity, sleep, heart rate, and workouts through Apple Health.",
          id: "xiaomi-mi-fitness",
          logo: {
            className: "size-11 rounded-md object-contain",
            height: 44,
            src: "/brand-logos/connect/mi-fitness.png",
            width: 44,
          },
          name: "Xiaomi / Mi Fitness",
          setupGuideActionLabel: "Set up sync",
          setupGuideId: "xiaomi-mi-fitness-apple-health",
        },
      ],
    }),
  );

  const setupButton = rendered.container.querySelector(
    'button[aria-label="Set up sync for Xiaomi / Mi Fitness"]',
  );
  assert.ok(setupButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(
    rendered.container.querySelector("[data-connection-state]"),
    null,
  );

  await clickButton(rendered, setupButton);

  assert.match(
    rendered.container.textContent ?? "",
    /Sync Xiaomi \/ Mi Fitness through Apple Health/,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Turn on Apple Health in Mi Fitness/,
  );
  assert.match(rendered.container.textContent ?? "", /Continue with Murph/);
  assert.doesNotMatch(rendered.container.textContent ?? "", /direct Xiaomi/u);

  await rendered.cleanup();
});

test("ConnectSourcesGrid requires account authentication before opening the Zepp guide", async () => {
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      authenticated: false,
      sources: [
        {
          connectionAvailable: false,
          description:
            "Amazfit activity, sleep, heart rate, and workouts through Apple Health.",
          id: "zepp",
          logo: {
            className: "size-11 rounded-md object-contain",
            height: 44,
            src: "/brand-logos/connect/zepp.png",
            width: 44,
          },
          name: "Zepp / Amazfit",
          setupGuideActionLabel: "Set up sync",
          setupGuideId: "zepp-apple-health",
        },
      ],
    }),
  );

  assert.ok(
    rendered.container.querySelector(
      'button[aria-label="Sign in to Murph"]',
    ),
  );
  assert.equal(
    rendered.container.querySelector(
      'button[aria-label="Sign in to Murph"]',
    )?.textContent,
    "Sign in",
  );
  assert.equal(
    rendered.container.querySelector(
      'button[aria-label="Set up sync for Zepp / Amazfit"]',
    ),
    null,
  );
  assert.equal(
    rendered.container.querySelector("[data-connection-state]"),
    null,
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Sync Zepp through Apple Health/u,
  );

  await rendered.cleanup();
});

test("ConnectPage enables Garmin when Junction exposes Garmin as a connect target", async () => {
  configureJunction("garmin");

  const markup = await renderConnectPage();

  assert.match(markup, /aria-label="Connect Garmin"/u);
  assert.match(markup, />Connect<\/button>/u);
  assert.equal(markup.match(/>Connect<\/button>/gu)?.length, 1);
});

test("ConnectPage hides Strava when Junction connection routes are configured", async () => {
  configureJunction("strava");

  const markup = await renderConnectPage();

  assert.doesNotMatch(markup, />Strava</u);
  assert.doesNotMatch(markup, /Connect Strava/u);
});

test("ConnectPage preserves an existing Strava connection for status and disconnect only", async () => {
  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_strava_123",
      provider: "strava",
      state: "active",
      upstreamSources: [],
    },
  ]);

  assert.match(markup, /Strava connected/u);
  assert.match(markup, /aria-label="Disconnect Strava"/u);
  assert.doesNotMatch(markup, /aria-label="Connect Strava"/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Strava"/u);
});

test("ConnectPage does not offer Strava reconnection for an existing account needing access", async () => {
  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_strava_123",
      connectSourceId: "strava",
      connectTarget: "strava",
      primaryAction: {
        kind: "reconnect",
        label: "Reconnect",
      },
      provider: "strava",
      state: "reauthorization_required",
      upstreamSources: [],
    },
  ]);

  assert.match(markup, /Strava needs attention from the connected app/u);
  assert.match(markup, /aria-label="Disconnect Strava"/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Strava"/u);
});

test("ConnectPage enables every Link source exposed by the shared Junction defaults", async () => {
  configureJunction("");

  const { JUNCTION_DEFAULT_PROVIDER_FILTER } = await import(
    "@murphai/device-syncd/config"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.equal(
    markup.match(/>Connect<\/button>/gu)?.length,
    JUNCTION_DEFAULT_PROVIDER_FILTER.filter(
      (providerSlug) =>
        providerSlug !== "strava"
        && providerSlug !== "dexcom_v3"
        && providerSlug !== "google_fit",
    ).length,
  );
  assert.equal(markup.match(/>Not available<\/button>/gu)?.length ?? 0, 0);
  assert.doesNotMatch(markup, /data-connect-source="google-fit"/u);
  assert.match(markup, /aria-label="Download app for Apple Health"/u);
  assert.doesNotMatch(markup, />Accu-Chek</u);
  assert.doesNotMatch(markup, />Samsung Health</u);

  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
  const resolvedConnectSources = resolveConfiguredConnectSources([
    {
      id: "dexcom-g6-and-older",
      name: "Dexcom (G6 and older)",
      description: "Legacy Dexcom.",
      logo,
    },
    {
      id: "dexcom",
      name: "Dexcom",
      description: "Current Dexcom.",
      logo,
      unavailableActionLabel: "Coming soon",
      unavailableMessage: "Dexcom connections are coming soon.",
    },
    {
      id: "mapmyfitness",
      name: "MapMyFitness",
      description: "Workouts.",
      logo,
    },
    {
      id: "accuchek",
      name: "Accu-Chek",
      description: "Glucose meter.",
      logo,
    },
  ]);
  assert.deepEqual(
    resolvedConnectSources.map((source) => source.id),
    ["dexcom", "dexcom-g6-and-older", "mapmyfitness", "accuchek"],
  );
  assert.deepEqual(
    Object.fromEntries(
      resolvedConnectSources.map((source) => [source.id, source.connectTarget]),
    ),
    {
      accuchek: undefined,
      dexcom: undefined,
      "dexcom-g6-and-older": "dexcom",
      mapmyfitness: "map_my_fitness",
    },
  );
  assert.equal(
    resolvedConnectSources.find((source) => source.id === "dexcom")
      ?.connectionAvailable,
    false,
  );
});

test("ConnectPage enables mapped Junction Link source slugs only", async () => {
  configureJunction("map_my_fitness,beurer_api");

  const markup = await renderConnectPage();

  assert.match(markup, /aria-label="Connect MapMyFitness"/u);
  assert.match(markup, /aria-label="Connect Beurer"/u);
  assert.match(markup, /aria-label="Garmin connection is not available yet"/u);
  assert.doesNotMatch(markup, />Accu-Chek</u);
  assert.doesNotMatch(markup, /aria-label="Connect Accu-Chek"/u);
  assert.equal(markup.match(/>Connect<\/button>/gu)?.length, 2);
});

test("ConnectSourcesGrid posts mapped Junction connect targets", async () => {
  configureJunction("map_my_fitness");

  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({
      authorizationUrl: "https://junction.example.test/link/mapmyfitness",
    });
  });
  vi.stubGlobal("fetch", fetch);

  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
  const [source] = resolveConfiguredConnectSources([
    {
      id: "mapmyfitness",
      name: "MapMyFitness",
      description: "Workouts.",
      logo,
    },
  ]);
  assert.ok(source);
  assert.equal(source.connectTarget, "map_my_fitness");
  assert.equal(source.requiresVitalDisclosure, true);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [source],
    }),
  );

  await clickButton(rendered, rendered.button);

  assert.equal(fetch.mock.calls.length, 0);
  assert.match(
    rendered.container.textContent ?? "",
    /Connect MapMyFitness to Murph/u,
  );

  const continueButton = [
    ...rendered.container.querySelectorAll("button"),
  ].find((button) => button.textContent === "Continue to MapMyFitness");
  assert.ok(continueButton instanceof rendered.window.HTMLButtonElement);
  await clickButton(rendered, continueButton);

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
  });
  assert.equal(fetch.mock.calls[0]?.[0], "/api/connect-sources/mapmyfitness/start");
  assert.deepEqual(fetch.mock.calls[0]?.[1], {
    body: JSON.stringify({ connectTarget: "map_my_fitness" }),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
    keepalive: false,
  });
  assert.equal(
    rendered.assign.mock.calls[0]?.[0],
    "https://junction.example.test/link/mapmyfitness",
  );

  await rendered.cleanup();
});

test("ConnectPage marks explicit and upstream Junction sources connected from hosted state", async () => {
  configureJunction("oura,strava");

  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_123",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          providerLabel: "Oura",
          resourceCount: 3,
          sourceProviderSlug: "oura",
          status: "connected",
        },
      ],
    },
    {
      connectionId: "dsc_whoop_123",
      provider: "junction",
      connectSourceId: "whoop",
      state: "active",
      upstreamSources: [],
    },
  ]);

  assert.match(markup, /Oura connected/);
  assert.match(markup, /Whoop connected/);
  assert.equal(markup.match(/data-connection-state="connected"/gu)?.length, 2);
  assert.match(markup, /aria-label="Disconnect Oura"/u);
  assert.match(markup, /aria-label="Disconnect Whoop"/u);
  assert.ok(
    sourceHeadingIndex(markup, "Oura") < sourceHeadingIndex(markup, "Whoop"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Whoop") < sourceHeadingIndex(markup, "Garmin"),
  );
  assert.doesNotMatch(markup, /aria-label="Connect Oura"/u);
  assert.doesNotMatch(markup, /aria-label="Connect Whoop"/u);
});

test("ConnectPage marks iOS Apple Health Junction SDK source connected from hosted state", async () => {
  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_apple_health",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          providerLabel: "Apple Health",
          resourceCount: 4,
          sourceProviderSlug: "apple_health_kit",
          status: "connected",
        },
      ],
    },
  ]);

  assert.match(markup, /Apple Health connected/u);
  assert.match(markup, /aria-label="Disconnect Apple Health"/u);
  assert.doesNotMatch(markup, /aria-label="Connect Apple Health"/u);
  assert.equal(markup.match(/data-connection-state="connected"/gu)?.length, 1);
  assert.ok(
    sourceHeadingIndex(markup, "Apple Health") <
      sourceHeadingIndex(markup, "Garmin"),
  );
});

test("ConnectPage keeps Mobvoi statusless when Health Connect is active", async () => {
  vi.stubEnv("MURPH_ANDROID_APP_ENABLED", "1");
  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_health_connect",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          providerLabel: "Health Connect",
          resourceCount: 4,
          sourceProviderSlug: "health_connect",
          status: "connected",
        },
      ],
    },
  ]);

  assert.match(
    markup,
    /aria-label="Get Murph for Android for Mobvoi \/ TicWatch"/u,
  );
  assert.match(
    markup,
    /Sync through Mobvoi Health or Google Fit, then connect Health Connect in Murph\./u,
  );
  assert.match(markup, /src="\/brand-logos\/connect\/mobvoi-health\.png"/u);
  assert.match(markup, /rounded-full/u);
  assert.doesNotMatch(markup, /Mobvoi \/ TicWatch (?:connected|not connected)/u);
});

test("ConnectPage shows source-scoped disconnects for multi-source Junction accounts", async () => {
  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_multi_source",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          providerLabel: "Apple Health",
          resourceCount: 4,
          sourceProviderSlug: "apple_health_kit",
          status: "connected",
        },
        CONNECTED_WHOOP_V2,
      ],
    },
  ]);

  assert.match(markup, /Apple Health connected/u);
  assert.match(markup, /Whoop connected/u);
  assert.equal(markup.match(/data-connection-state="connected"/gu)?.length, 2);
  assert.match(markup, /aria-label="Disconnect Apple Health"/u);
  assert.match(markup, /aria-label="Disconnect Whoop"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect account"/u);
});

test("ConnectPage scopes disconnects by every non-disconnected Junction upstream", async () => {
  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_multi_source",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          providerLabel: "Garmin",
          resourceCount: 2,
          sourceProviderSlug: "garmin",
          status: "connected",
        },
        {
          providerLabel: "Apple Health",
          resourceCount: 4,
          sourceProviderSlug: "apple_health_kit",
          status: "unavailable",
        },
      ],
    },
  ]);

  assert.match(markup, /Garmin connected/u);
  assert.doesNotMatch(markup, /Apple Health connected/u);
  assert.match(markup, /aria-label="Disconnect Garmin"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect Apple Health"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect account"/u);
});

test("ConnectPage keeps source disconnects visible for parent-level Junction reauthorization", async () => {
  configureJunction("garmin");
  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_multi",
      provider: "junction",
      state: "reauthorization_required",
      upstreamSources: [
        {
          connectProvider: "junction",
          connectTarget: "garmin",
          providerLabel: "Garmin",
          resourceCount: 2,
          sourceProviderSlug: "garmin",
          status: "unavailable",
        },
        {
          providerLabel: "Apple Health",
          resourceCount: 4,
          sourceProviderSlug: "apple_health_kit",
          status: "unavailable",
        },
      ],
    },
  ]);

  assert.match(markup, /Apple Health needs reconnect/u);
  assert.match(markup, /Garmin needs reconnect/u);
  assert.match(markup, /aria-label="Reconnect Garmin"/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Apple Health"/u);
  assert.match(markup, /aria-label="Disconnect Apple Health"/u);
  assert.match(markup, /aria-label="Disconnect Garmin"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect account"/u);
});

test("ConnectPage does not apply parent Junction reauthorization to disconnected upstream projections", async () => {
  configureJunction("garmin");
  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_multi",
      provider: "junction",
      state: "reauthorization_required",
      upstreamSources: [
        {
          connectProvider: "junction",
          connectTarget: "garmin",
          providerLabel: "Garmin",
          resourceCount: 2,
          sourceProviderSlug: "garmin",
          status: "unavailable",
        },
        {
          providerLabel: "Apple Health",
          resourceCount: 4,
          sourceProviderSlug: "apple_health_kit",
          status: "disconnected",
        },
      ],
    },
  ]);

  assert.match(markup, /Garmin needs reconnect/u);
  assert.match(markup, /aria-label="Reconnect Garmin"/u);
  assert.match(markup, /Apple Health not connected/u);
  assert.match(markup, /aria-label="Download app for Apple Health"/u);
  assert.doesNotMatch(markup, /Apple Health needs reconnect/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Apple Health"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect Apple Health"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect account"/u);
});

test("ConnectPage shows mobile-managed guidance for Apple Health reconnect states without web target", async () => {
  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_apple_health",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          providerLabel: "Apple Health",
          requiresReconnect: true,
          resourceCount: 4,
          sourceProviderSlug: "apple_health_kit",
          status: "error",
        },
      ],
    },
  ]);

  assert.match(markup, /Apple Health needs reconnect/u);
  assert.match(
    markup,
    /Apple Health needs attention from the connected app before Murph can keep syncing it\./u,
  );
  assert.match(markup, /aria-label="Disconnect Apple Health"/u);
  assert.match(markup, /aria-label="Download app for Apple Health"/u);
  assert.match(markup, /data-connection-state="needs-access"/u);
  assert.doesNotMatch(
    markup,
    /aria-label="Apple Health connection is not available yet"/u,
  );
  assert.doesNotMatch(
    markup,
    /Please reconnect Apple Health to resume syncing\./u,
  );
});

test("ConnectPage ignores disconnected Junction upstream projections on active connections", async () => {
  configureJunction("garmin,oura");

  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_123",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          providerLabel: "Garmin",
          resourceCount: 2,
          sourceProviderSlug: "garmin",
          status: "disconnected",
        },
        {
          providerLabel: "Oura",
          resourceCount: 3,
          sourceProviderSlug: "oura",
          status: "connected",
        },
      ],
    },
  ]);

  assert.match(markup, /Oura connected/u);
  assert.match(markup, /Garmin not connected/u);
  assert.match(markup, /aria-label="Disconnect Oura"/u);
  assert.match(markup, /aria-label="Connect Garmin"/u);
  assert.equal(markup.match(/data-connection-state="connected"/gu)?.length, 1);
  assert.ok(
    sourceHeadingIndex(markup, "Oura") < sourceHeadingIndex(markup, "Garmin"),
  );
  assert.doesNotMatch(markup, /Garmin connected/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect Garmin"/u);
});

test.each([
  {
    name: "reauthorization-required sources",
    connection: { state: "reauthorization_required" },
  },
  {
    name: "active sources with reconnect action",
    connection: {
      state: "active",
      primaryAction: { kind: "reconnect", label: "Reconnect" },
    },
  },
])("ConnectPage surfaces $name as reconnectable", async ({ connection }) => {
  configureJunction();
  const markup = await renderConnectedPage([
    {
      ...connection,
      connectionId: "dsc_whoop_123",
      provider: "junction",
      connectSourceId: "whoop",
      upstreamSources: [],
    },
  ]);

  assert.match(markup, /Whoop needs reconnect/);
  assert.match(markup, /Please reconnect Whoop to resume syncing\./u);
  assert.match(markup, /data-connection-state="needs-access"/u);
  assert.match(markup, /aria-label="Reconnect Whoop"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect Whoop"/u);
  assert.doesNotMatch(markup, /Whoop connected/u);
  assert.doesNotMatch(markup, /aria-label="Connect Whoop"/u);
});

test.each([
  {
    name: "explicit sources",
    label: "Whoop",
    providerFilter: undefined,
    connection: { connectSourceId: "whoop", upstreamSources: [] },
  },
  {
    name: "Junction upstream sources",
    label: "Oura",
    providerFilter: "oura",
    connection: {
      upstreamSources: [{
        providerLabel: "Oura",
        resourceCount: 3,
        sourceProviderSlug: "oura",
        status: "connected",
      }],
    },
  },
])("ConnectPage keeps disconnected $name quiet and connectable", async ({ label, connection, providerFilter }) => {
  configureJunction(providerFilter);
  const markup = await renderConnectedPage([
    {
      ...connection,
      connectionId: "dsc_disconnected",
      provider: "junction",
      state: "disconnected",
    },
  ]);

  assert.ok(markup.includes(label + " not connected"));
  assert.match(markup, /data-connection-state="idle"/u);
  assert.ok(markup.includes('aria-label="Connect ' + label + '"'));
  assert.ok(!markup.includes(label + " needs reconnect"));
  assert.ok(!markup.includes("Please reconnect " + label + " to resume syncing."));
  assert.doesNotMatch(markup, /did not finish/u);
  assert.ok(!markup.includes('aria-label="Reconnect ' + label + '"'));
  assert.ok(!markup.includes('aria-label="Disconnect ' + label + '"'));
});

test("ConnectPage preserves unambiguous Junction source reconnects with upstream projections", async () => {
  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_whoop",
      primaryAction: {
        kind: "reconnect",
        label: "Reconnect",
      },
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          ...CONNECTED_WHOOP_V2,
          connectProvider: "junction",
          connectSourceId: "whoop",
          connectTarget: "whoop",
        },
      ],
    },
  ]);

  assert.match(markup, /Whoop needs reconnect/u);
  assert.match(markup, /Please reconnect Whoop to resume syncing\./u);
  assert.match(markup, /aria-label="Reconnect Whoop"/u);
  assert.match(markup, /data-connection-state="needs-access"/u);
  assert.doesNotMatch(markup, /Whoop connected/u);
});

test("ConnectPage lets active state win when duplicate rows mention the same source", async () => {

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "whoop" }],
      [
        {
          connectionId: "dsc_whoop_reauth",
          provider: "junction",
          connectSourceId: "whoop",
          state: "reauthorization_required",
          upstreamSources: [],
        },
        {
          connectionId: "dsc_whoop_disconnected",
          provider: "junction",
          connectSourceId: "whoop",
          state: "disconnected",
          upstreamSources: [],
        },
        {
          connectionId: "dsc_whoop_active",
          provider: "junction",
          connectSourceId: "whoop",
          state: "active",
          upstreamSources: [],
        },
      ],
    ),
    [
      {
        connectionId: "dsc_whoop_active",
        connectProvider: "junction",
        connectTarget: null,
        requiresReconnect: false,
        sourceId: "whoop",
        state: "active",
      },
    ],
  );
});

test("ConnectPage maps Apple Health Junction upstream slugs to the visible source", async () => {

  for (const sourceProviderSlug of ["apple_health_kit", "apple_health"]) {
    assert.deepEqual(
      resolveConnectSourceConnectionStates(
        [{ id: "apple-health" }],
        [
          {
            connectionId: "dsc_junction_apple_health",
            provider: "junction",
            state: "active",
            upstreamSources: [
              {
                providerLabel: "Apple Health",
                resourceCount: 4,
                sourceProviderSlug,
                status: "connected",
              },
            ],
          },
        ],
      ),
      [
        {
          connectionId: "dsc_junction_apple_health",
          connectProvider: "junction",
          connectTarget: null,
          disconnectSourceProviderSlug: sourceProviderSlug,
          requiresReconnect: false,
          sourceId: "apple-health",
          state: "active",
        },
      ],
    );
  }
});

test("ConnectPage carries source-scoped disconnect ids for multi-source upstream projections", async () => {

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "apple-health" }, { id: "whoop" }],
      [
        {
          connectionId: "dsc_junction_multi_source",
          provider: "junction",
          state: "active",
          upstreamSources: [
            {
              providerLabel: "Apple Health",
              resourceCount: 4,
              sourceProviderSlug: "apple_health_kit",
              status: "connected",
            },
            CONNECTED_WHOOP_V2,
          ],
        },
      ],
    ),
    [
      {
        connectionId: "dsc_junction_multi_source",
        connectProvider: "junction",
        connectTarget: null,
        disconnectSourceProviderSlug: "apple_health_kit",
        requiresReconnect: false,
        sourceId: "apple-health",
        state: "active",
      },
      {
        connectionId: "dsc_junction_multi_source",
        connectProvider: "junction",
        connectTarget: null,
        disconnectSourceProviderSlug: "whoop_v2",
        requiresReconnect: false,
        sourceId: "whoop",
        state: "active",
      },
    ],
  );
});

test("ConnectPage preserves reconnect action on active source matches", async () => {

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "whoop" }],
      [
        {
          connectionId: "dsc_whoop_active_error",
          primaryAction: {
            kind: "reconnect",
            label: "Reconnect",
          },
          provider: "junction",
          connectSourceId: "whoop",
          state: "active",
          upstreamSources: [],
        },
      ],
    ),
    [
      {
        connectionId: "dsc_whoop_active_error",
        connectProvider: "junction",
        connectTarget: null,
        requiresReconnect: true,
        sourceId: "whoop",
        state: "active",
      },
    ],
  );
});

test("ConnectPage lets Junction source reconnect win over healthy duplicate explicit source", async () => {

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "whoop" }],
      [
        {
          connectionId: "dsc_junction_whoop_healthy",
          provider: "junction",
          connectSourceId: "whoop",
          state: "active",
          upstreamSources: [],
        },
        {
          connectionId: "dsc_junction_whoop",
          provider: "junction",
          state: "active",
          upstreamSources: [
            {
              connectProvider: "junction",
              connectSourceId: "whoop",
              connectTarget: "whoop",
              providerLabel: "WHOOP",
              requiresReconnect: true,
              resourceCount: 3,
              sourceProviderSlug: "whoop_v2",
              status: "error",
            },
          ],
        },
      ],
    ),
    [
      {
        connectionId: "dsc_junction_whoop",
        connectProvider: "junction",
        connectTarget: "whoop",
        disconnectSourceProviderSlug: "whoop_v2",
        requiresReconnect: true,
        sourceId: "whoop",
        state: "active",
      },
    ],
  );
});

test("ConnectPage keeps healthy Junction child sources connected when another child needs reconnect", async () => {

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "garmin" }, { id: "whoop" }],
      [
        {
          connectionId: "dsc_junction_multi",
          connectSourceId: "whoop",
          connectTarget: "whoop",
          primaryAction: {
            kind: "reconnect",
            label: "Reconnect",
          },
          provider: "junction",
          state: "active",
          upstreamSources: [
            {
              providerLabel: "Garmin",
              resourceCount: 2,
              sourceProviderSlug: "garmin",
              status: "connected",
            },
            {
              providerLabel: "WHOOP",
              requiresReconnect: true,
              resourceCount: 3,
              sourceProviderSlug: "whoop_v2",
              status: "error",
            },
          ],
        },
      ],
    ),
    [
      {
        connectionId: "dsc_junction_multi",
        connectProvider: "junction",
        connectTarget: null,
        disconnectSourceProviderSlug: "garmin",
        requiresReconnect: false,
        sourceId: "garmin",
        state: "active",
      },
      {
        connectionId: "dsc_junction_multi",
        connectProvider: "junction",
        connectTarget: null,
        disconnectSourceProviderSlug: "whoop_v2",
        requiresReconnect: true,
        sourceId: "whoop",
        state: "active",
      },
    ],
  );
});

test("ConnectPage gives each reconnect-required Junction child its own target", async () => {

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "garmin" }, { id: "whoop" }],
      [
        {
          connectionId: "dsc_junction_multi",
          connectSourceId: "whoop",
          connectTarget: "whoop",
          primaryAction: {
            kind: "reconnect",
            label: "Reconnect",
          },
          provider: "junction",
          state: "active",
          upstreamSources: [
            {
              connectProvider: "junction",
              connectSourceId: "garmin",
              connectTarget: "garmin",
              providerLabel: "Garmin",
              requiresReconnect: true,
              resourceCount: 2,
              sourceProviderSlug: "garmin",
              status: "error",
            },
            {
              connectProvider: "junction",
              connectSourceId: "whoop",
              connectTarget: "whoop",
              providerLabel: "WHOOP",
              requiresReconnect: true,
              resourceCount: 3,
              sourceProviderSlug: "whoop_v2",
              status: "error",
            },
          ],
        },
      ],
    ),
    [
      {
        connectionId: "dsc_junction_multi",
        connectProvider: "junction",
        connectTarget: "garmin",
        disconnectSourceProviderSlug: "garmin",
        requiresReconnect: true,
        sourceId: "garmin",
        state: "active",
      },
      {
        connectionId: "dsc_junction_multi",
        connectProvider: "junction",
        connectTarget: "whoop",
        disconnectSourceProviderSlug: "whoop_v2",
        requiresReconnect: true,
        sourceId: "whoop",
        state: "active",
      },
    ],
  );
});

test("ConnectPage adds source-scoped disconnects beside Junction reconnect actions", async () => {
  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_multi",
      connectSourceId: "whoop",
      connectTarget: "whoop",
      primaryAction: {
        kind: "reconnect",
        label: "Reconnect",
      },
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          connectProvider: "junction",
          connectSourceId: "garmin",
          connectTarget: "garmin",
          providerLabel: "Garmin",
          requiresReconnect: true,
          resourceCount: 2,
          sourceProviderSlug: "garmin",
          status: "error",
        },
        {
          connectProvider: "junction",
          connectSourceId: "whoop",
          connectTarget: "whoop",
          providerLabel: "WHOOP",
          requiresReconnect: true,
          resourceCount: 3,
          sourceProviderSlug: "whoop_v2",
          status: "error",
        },
      ],
    },
  ]);

  assert.match(markup, /Garmin needs reconnect/u);
  assert.match(markup, /Whoop needs reconnect/u);
  assert.match(markup, /aria-label="Reconnect Garmin"/u);
  assert.match(markup, /aria-label="Reconnect Whoop"/u);
  assert.match(markup, /aria-label="Disconnect Garmin"/u);
  assert.match(markup, /aria-label="Disconnect Whoop"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect account"/u);
});

test("ConnectPage projects Junction connection-reset sources with account-scoped disconnects", async () => {

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "garmin" }],
      [
        {
          connectionId: "dsc_junction_garmin",
          provider: "junction",
          state: "active",
          upstreamSources: [
            {
              providerLabel: "Garmin",
              recoveryKind: "connection_reset",
              resourceCount: 3,
              sourceProviderSlug: "garmin",
              status: "error",
            },
          ],
        },
      ],
    ),
    [
      {
        connectionId: "dsc_junction_garmin",
        connectProvider: "junction",
        connectTarget: null,
        disconnectScope: "junction_account",
        recoveryKind: "connection_reset",
        requiresReconnect: false,
        sourceId: "garmin",
        state: "active",
      },
    ],
  );
});

test("ConnectPage keeps single-source Junction historical recovery on disconnect, never reconnect", async () => {
  configureJunction("garmin");

  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_garmin",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          providerLabel: "Garmin",
          recoveryKind: "connection_reset",
          resourceCount: 3,
          sourceProviderSlug: "garmin",
          status: "error",
        },
      ],
    },
  ]);

  assert.match(markup, /Garmin needs a fresh connection/u);
  assert.match(markup, /Disconnect it first, then connect it again\./u);
  assert.match(markup, /data-connection-state="needs-access"/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Garmin"/u);
  assert.doesNotMatch(markup, /aria-label="Connect Garmin"/u);
  assert.doesNotMatch(markup, /Garmin connected/u);
  assert.match(markup, /aria-label="Disconnect account"/u);
});

test("ConnectPage keeps multi-source Junction historical recovery on disconnect, never reconnect", async () => {
  configureJunction("garmin");

  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_multi",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          providerLabel: "Garmin",
          recoveryKind: "connection_reset",
          resourceCount: 3,
          sourceProviderSlug: "garmin",
          status: "error",
        },
        CONNECTED_WHOOP_V2,
      ],
    },
  ]);

  assert.match(markup, /Garmin needs a fresh connection/u);
  assert.match(markup, /Whoop connected/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Garmin"/u);
  assert.doesNotMatch(markup, /aria-label="Connect Garmin"/u);
  assert.equal(markup.match(/aria-label="Disconnect account"/gu)?.length, 1);
  assert.match(markup, /aria-label="Disconnect Whoop"/u);
});

test("SourceCard offers account reset without an unavailable reconnect", async () => {
  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
  const cardProps = {
    authenticated: true,
    errorMessage: null,
    onDisconnectTargetChange: () => {},
    onStartConnection: async () => {},
    pending: false,
    pendingDisconnect: false,
  };

  const resetMarkup = renderToStaticMarkup(
    createElement(SourceCard, {
      ...cardProps,
      source: {
        description:
          "Garmin workouts, sleep, stress, heart, body battery, and activity data.",
        disconnectConnectionId: "dsc_junction_garmin",
        disconnectScope: "junction_account" as const,
        id: "garmin",
        logo,
        name: "Garmin",
        recoveryKind: "connection_reset" as const,
      },
    }),
  );

  assert.match(
    resetMarkup,
    /Garmin needs a fresh connection\. Disconnect it first, then connect it again\./u,
  );
  assert.match(resetMarkup, /aria-label="Disconnect account"/u);
  assert.doesNotMatch(
    resetMarkup,
    /aria-label="(?:Connect|Reconnect) Garmin"/u,
  );

});

test("SourceCard shows modern Dexcom as coming soon without hiding existing-account controls", async () => {
  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/brand-logos/connect/dexcom.png",
    width: 44,
  };
  const cardProps = {
    errorMessage: null,
    onDisconnectTargetChange: () => {},
    onStartConnection: async () => {},
    pending: false,
    pendingDisconnect: false,
  };
  const source = {
    connectionAvailable: false,
    description: "CGM glucose readings and trends.",
    id: "dexcom",
    logo,
    name: "Dexcom",
    unavailableActionLabel: "Coming soon",
    unavailableMessage: "Dexcom connections are coming soon.",
  };

  const signedOutMarkup = renderToStaticMarkup(
    createElement(SourceCard, {
      ...cardProps,
      authenticated: false,
      source,
    }),
  );

  assert.match(signedOutMarkup, /Dexcom connections are coming soon\./u);
  assert.match(signedOutMarkup, />Sign in<\/button>/u);
  assert.doesNotMatch(signedOutMarkup, />Coming soon<\/button>/u);
  assert.doesNotMatch(signedOutMarkup, /aria-label="Connect Dexcom"/u);

  const connectedMarkup = renderToStaticMarkup(
    createElement(SourceCard, {
      ...cardProps,
      authenticated: true,
      source: {
        ...source,
        connected: true,
        disconnectConnectionId: "dsc_dexcom_existing",
        disconnectScope: "junction_account" as const,
      },
    }),
  );

  assert.match(connectedMarkup, /aria-label="Disconnect account"/u);
  assert.doesNotMatch(connectedMarkup, />Coming soon<\/button>/u);

  const recoveryMarkup = renderToStaticMarkup(
    createElement(SourceCard, {
      ...cardProps,
      authenticated: true,
      source: {
        ...source,
        connected: true,
        disconnectConnectionId: "dsc_dexcom_recovery",
        disconnectScope: "junction_account" as const,
        requiresReconnect: true,
      },
    }),
  );

  assert.match(
    recoveryMarkup,
    /Dexcom reconnects are not available yet\. Your existing history is still available\./u,
  );
  assert.match(recoveryMarkup, />Coming soon<\/button>/u);
  assert.match(recoveryMarkup, /aria-label="Disconnect account"/u);
  assert.doesNotMatch(recoveryMarkup, /connected app/u);
  assert.doesNotMatch(recoveryMarkup, /aria-label="Reconnect Dexcom"/u);
});

test("SourceCard does not promise unavailable Strava recovery connections", async () => {
  const logo = {
    className: "h-auto max-h-9 w-auto max-w-[8rem] object-contain",
    height: 20,
    src: "/brand-logos/connect/strava.svg",
    width: 96,
  };
  const cardProps = {
    authenticated: true,
    errorMessage: null,
    onDisconnectTargetChange: () => {},
    onStartConnection: async () => {},
    pending: false,
    pendingDisconnect: false,
  };

  const resetMarkup = renderToStaticMarkup(
    createElement(SourceCard, {
      ...cardProps,
      source: {
        connectionAvailable: false,
        description:
          "Rides, runs, workouts, route context, power, and training load.",
        disconnectConnectionId: "dsc_strava_reset",
        id: "strava",
        logo,
        name: "Strava",
        recoveryKind: "connection_reset" as const,
      },
    }),
  );

  assert.match(
    resetMarkup,
    /Strava needs a fresh connection, but reconnecting is temporarily unavailable\./u,
  );
  assert.doesNotMatch(resetMarkup, /then connect it again/u);
  assert.doesNotMatch(
    resetMarkup,
    /aria-label="(?:Connect|Reconnect) Strava"/u,
  );
  assert.doesNotMatch(resetMarkup, />Not available</u);

  const historicalResetMarkup = renderToStaticMarkup(
    createElement(SourceCard, {
      ...cardProps,
      source: {
        connectionAvailable: false,
        description:
          "Rides, runs, workouts, route context, power, and training load.",
        disconnectConnectionId: "dsc_strava_historical_reset",
        disconnectScope: "junction_account" as const,
        historicalResetIncomplete: true,
        id: "strava",
        logo,
        name: "Strava",
      },
    }),
  );

  assert.match(
    historicalResetMarkup,
    /Reconnecting through Murph is temporarily unavailable\./u,
  );
  assert.doesNotMatch(historicalResetMarkup, /connect it again here/u);
  assert.doesNotMatch(
    historicalResetMarkup,
    /aria-label="(?:Connect|Reconnect) Strava"/u,
  );
  assert.doesNotMatch(historicalResetMarkup, />Not available</u);
});

test("SourceCard directs Apple Health setup to the iPhone app", async () => {
  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };

  const appDownloadMarkup = renderToStaticMarkup(
    createElement(SourceCard, {
      authenticated: true,
      errorMessage: null,
      onDisconnectTargetChange: () => {},
      onStartConnection: async () => {},
      pending: false,
      pendingDisconnect: false,
      source: {
        description:
          "iPhone and Apple Watch activity, sleep, vitals, and workouts.",
        id: "apple-health",
        logo,
        name: "Apple Health",
        unavailableActionLabel: "Download app",
        unavailableActionUrl:
          "https://apps.apple.com/us/app/murph-ai/id6786145859",
        unavailableMessage:
          "Download Murph on your iPhone, then connect Apple Health in the app.",
      },
    }),
  );

  assert.match(
    appDownloadMarkup,
    /Download Murph on your iPhone, then connect Apple Health in the app\./u,
  );
  assert.match(appDownloadMarkup, />Download app<\/a>/u);
  assert.match(
    appDownloadMarkup,
    /href="https:\/\/apps\.apple\.com\/us\/app\/murph-ai\/id6786145859"/u,
  );
});

test("SourceCard uses one sign-in action for every signed-out source type", async () => {
  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
  const sources = [
    {
      connectTarget: "oura",
      description: "Sleep, readiness, activity, heart rate, and temperature trends.",
      id: "oura",
      logo,
      name: "Oura",
    },
    {
      connectionAvailable: false,
      description: "Amazfit activity, sleep, heart rate, and workouts through Apple Health.",
      id: "zepp",
      logo,
      name: "Zepp / Amazfit",
      setupGuideActionLabel: "Set up sync",
      setupGuideId: "zepp-apple-health" as const,
    },
    {
      description: "iPhone and Apple Watch activity, sleep, vitals, and workouts.",
      id: "apple-health",
      logo,
      name: "Apple Health",
      unavailableActionLabel: "Download app",
      unavailableActionUrl:
        "https://apps.apple.com/us/app/murph-ai/id6786145859",
    },
    {
      connectionAvailable: false,
      description: "CGM glucose readings and trends.",
      id: "dexcom",
      logo,
      name: "Dexcom",
      unavailableActionLabel: "Coming soon",
      unavailableMessage: "Dexcom connections are coming soon.",
    },
  ];

  for (const source of sources) {
    const markup = renderToStaticMarkup(
      createElement(SourceCard, {
        authenticated: false,
        errorMessage: null,
        onDisconnectTargetChange: () => {},
        onStartConnection: async () => {},
        pending: false,
        pendingDisconnect: false,
        source,
      }),
    );

    assert.match(markup, /aria-label="Sign in to Murph"/u);
    assert.equal(markup.match(/>Sign in<\/button>/gu)?.length, 1);
    assert.doesNotMatch(markup, />Log in or sign up<\/button>/u);
    assert.doesNotMatch(markup, />Download app<\/a>/u);
    assert.doesNotMatch(markup, />Set up sync<\/button>/u);
  }
});

test("connect source card design study renders the production action states", async () => {
  const { ConnectSourceCardStudy } = await import(
    "../app/design/connect-source-card-study"
  );
  const markup = renderToStaticMarkup(createElement(ConnectSourceCardStudy));

  assert.match(markup, /id="connect-source-card-actions"/u);
  assert.match(markup, /data-design-state="signed-out-source-actions"/u);
  assert.doesNotMatch(
    markup,
    /Google authorization is handled through/u,
  );
  assert.match(markup, /aria-label="Disconnect Garmin"/u);
  assert.match(markup, /aria-label="Download app for Apple Health"/u);
  assert.match(markup, /aria-label="Connect Fitbit"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect Fitbit"/u);
  assert.equal(markup.match(/aria-label="Sign in to Murph"/gu)?.length, 4);
  assert.equal(markup.match(/role="status"/gu)?.length, 4);
  assert.match(markup, /aria-label="Retry Fitbit migration now"/u);
  assert.match(markup, />Retry now<\/button>/u);
  assert.match(markup, /Dexcom connections are coming soon\./u);
  assert.match(markup, /Whoop needs a fresh connection/u);
  assert.match(markup, /aria-label="Disconnect account"/u);
  assert.match(markup, /Peloton could not open\. Please try again\./u);
});

test("ConnectPage lets active reconnect rows win over stale reconnectable rows", async () => {

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "whoop" }],
      [
        {
          connectionId: "dsc_whoop_reauth",
          provider: "junction",
          connectSourceId: "whoop",
          state: "reauthorization_required",
          upstreamSources: [],
        },
        {
          connectionId: "dsc_whoop_active_error",
          primaryAction: {
            kind: "reconnect",
            label: "Reconnect",
          },
          provider: "junction",
          connectSourceId: "whoop",
          state: "active",
          upstreamSources: [],
        },
      ],
    ),
    [
      {
        connectionId: "dsc_whoop_active_error",
        connectProvider: "junction",
        connectTarget: null,
        requiresReconnect: true,
        sourceId: "whoop",
        state: "active",
      },
    ],
  );
});

test("ConnectPage treats Junction reauthorization as reconnectable even when upstream status is stale", async () => {
  configureJunction("oura");

  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_123",
      provider: "junction",
      state: "reauthorization_required",
      upstreamSources: [
        {
          providerLabel: "Oura",
          resourceCount: 1,
          sourceProviderSlug: "oura",
          status: "unavailable",
        },
      ],
    },
  ]);

  assert.match(markup, /Oura needs reconnect/);
  assert.match(markup, /aria-label="Reconnect Oura"/u);
});

test("resolveConnectedConnectSourceConnections carries connection ids for explicit and upstream Junction matches", async () => {
  const sources = [{ id: "oura" }, { id: "whoop" }, { id: "garmin" }];

  assert.deepEqual(
    resolveConnectedConnectSourceConnections(sources, [
      {
        connectionId: "dsc_junction_123",
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            providerLabel: "Oura",
            resourceCount: 1,
            sourceProviderSlug: "oura",
            status: "connected",
          },
          {
            providerLabel: "Garmin",
            resourceCount: 1,
            sourceProviderSlug: "garmin",
            status: "unavailable",
          },
        ],
      },
      {
        connectionId: "dsc_whoop_123",
        provider: "junction",
        connectSourceId: "whoop",
        state: "active",
        upstreamSources: [],
      },
    ]),
    [
      { connectionId: "dsc_junction_123", sourceId: "oura" },
      { connectionId: "dsc_whoop_123", sourceId: "whoop" },
    ],
  );
});

test("ConnectPage keeps unfinished-reset guidance visible on disconnected Junction sources", async () => {
  configureJunction("garmin");

  const markup = await renderConnectedPage([
    {
      connectionId: "dsc_junction_garmin",
      historicalResetIncomplete: true,
      provider: "junction",
      state: "disconnected",
      upstreamSources: [
        {
          providerLabel: "Garmin",
          resourceCount: 0,
          sourceProviderSlug: "garmin",
          status: "disconnected",
        },
      ],
    },
  ]);

  assert.match(
    markup,
    /The last reset for Garmin did not finish\. Remove the old connection in your wearable provider account, then connect it again here\./u,
  );
  assert.match(markup, /aria-label="Connect Garmin"/u);
  assert.match(markup, /data-connection-state="needs-access"/u);
  assert.doesNotMatch(markup, /HISTORICAL_RESET_REVOKE_FAILED/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Garmin"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect account"/u);
});

test("resolveHistoricalResetIncompleteConnectSourceIds maps explicit and upstream Junction disconnected sources", async () => {

  const sourceIds = resolveHistoricalResetIncompleteConnectSourceIds(
    [{ id: "whoop" }, { id: "garmin" }],
    [
      {
        connectionId: "dsc_junction_whoop",
        historicalResetIncomplete: true,
        provider: "junction",
        connectSourceId: "whoop",
        state: "disconnected",
        upstreamSources: [],
      },
      {
        connectionId: "dsc_junction_garmin",
        historicalResetIncomplete: true,
        provider: "junction",
        state: "disconnected",
        upstreamSources: [
          {
            providerLabel: "Garmin",
            resourceCount: 0,
            sourceProviderSlug: "garmin",
            status: "disconnected",
          },
        ],
      },
      {
        connectionId: "dsc_oura_plain",
        provider: "oura",
        state: "disconnected",
        upstreamSources: [],
      },
    ],
  );

  assert.deepEqual([...sourceIds].sort(), ["garmin", "whoop"]);
});

test("ConnectPage keeps configured sources visible but renders sign-in actions when signed out", async () => {
  configureJunction("garmin");
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: false,
    authenticatedMember: null,
    linkedAccounts: [],
    session: null,
  });

  const markup = await renderConnectPage();

  assert.match(markup, />Sign in<\/button>/);
  assert.match(markup, /aria-label="Sign in to Murph"/u);
  assert.doesNotMatch(markup, /aria-label="Connect Garmin"/u);
  expectSettingResponseNotLoaded();
});

test("ConnectSourcesGrid signs in on the page for a pending device connect intent while signed out without a pre-auth source target", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const { AuthProvider } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
      createElement(ConnectSourcesGrid, {
        authenticated: false,
        sources: [
          {
            ...WHOOP_SOURCE,
          },
        ],
      }),
    ),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
        pathname: "/connect",
        search: "",
      },
      matchMedia: desktopMatchMedia,
      requireButton: false,
    },
  );

  await vi.waitFor(() => {
    assert.match(rendered.container.textContent ?? "", /Sign in to connect Whoop\./u);
  });

  assert.equal(mocks.authDialogProps?.open, false);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Auth dialog/);
  assert.equal(fetch.mock.calls.length, 0);

  await rendered.cleanup();
});

test("ConnectSourcesGrid ignores malformed pending device connect intents while signed out", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const { AuthProvider } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
      createElement(ConnectSourcesGrid, {
        authenticated: false,
        sources: [
          {
            ...WHOOP_SOURCE,
            connectTarget: "whoop",
          },
        ],
      }),
    ),
    {
      location: {
        hash: "#deviceConnectIntent=not-a-claim&connectSource=whoop",
        href: "https://join.example.test/connect#deviceConnectIntent=not-a-claim&connectSource=whoop",
        pathname: "/connect",
        search: "",
      },
      requireButton: false,
    },
  );

  assert.equal(mocks.authDialogProps?.open, false);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Auth dialog/);
  assert.equal(fetch.mock.calls.length, 0);

  await rendered.cleanup();
});

test("ConnectSourcesGrid keeps sign-in on the page for unmatched device connect intents", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const { AuthProvider } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
      createElement(ConnectSourcesGrid, {
        authenticated: false,
        sources: [
          {
            ...WHOOP_SOURCE,
            connectTarget: "whoop",
          },
        ],
      }),
    ),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=garmin`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=garmin`,
        pathname: "/connect",
        search: "",
      },
      matchMedia: desktopMatchMedia,
      requireButton: false,
    },
  );

  assert.equal(mocks.authDialogProps?.open, false);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Auth dialog/);
  assert.match(rendered.container.textContent ?? "", /Sign in to connect your device\./u);
  assert.equal(fetch.mock.calls.length, 0);

  await rendered.cleanup();
});

test("ConnectSourcesGrid explains Garmin Historical Data before starting the connection", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({
      authorizationUrl: "https://junction.example.test/link/garmin",
    });
  });
  vi.stubGlobal("fetch", fetch);
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      garminHistoricalDataVoiceMemoSrc:
        "/audio/garmin-historical-data-memos/grandpa.mp3",
      sources: [
        {
          ...GARMIN_SOURCE,
          connectTarget: "garmin",
          requiresVitalDisclosure: true,
        },
      ],
    }),
  );

  assert.equal(rendered.button.disabled, false);
  assert.equal(rendered.button.textContent, "Connect");

  await clickButton(rendered, rendered.button);

  assert.equal(fetch.mock.calls.length, 0);
  assert.match(rendered.container.textContent ?? "", /Turn on Historical Data/);
  assert.match(
    rendered.container.textContent ?? "",
    /When Garmin opens, turn on Historical Data before approving\./,
  );
  assert.ok(
    rendered.container.querySelector(
      "audio[src='/audio/garmin-historical-data-memos/grandpa.mp3']",
    ),
    "expected the member's picked-voice Garmin reminder",
  );

  const dialogButtons = [...rendered.container.querySelectorAll("button")]
    .map((button) => button.textContent?.trim())
    .filter((label) => label === "Cancel" || label === "Continue to Garmin");
  assert.deepEqual(dialogButtons, ["Continue to Garmin"]);

  const continueButton = [
    ...rendered.container.querySelectorAll("button"),
  ].find((button) => button.textContent === "Continue to Garmin");
  assert.ok(continueButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, continueButton);

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
  });

  assert.equal(fetch.mock.calls[0]?.[0], "/api/connect-sources/garmin/start");
  assert.deepEqual(fetch.mock.calls[0]?.[1], {
    body: JSON.stringify({ connectTarget: "garmin" }),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
    keepalive: false,
  });
  assert.equal(
    rendered.assign.mock.calls[0]?.[0],
    "https://junction.example.test/link/garmin",
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid redeems an initial device connect intent through the app page", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({
      authorizationUrl: "https://provider.example.test/oauth/start",
    });
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          description: "Activity, sleep, and heart rate.",
          id: "fitbit",
          logo: {
            className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
            height: 15,
            src: "/brand-logos/connect/fitbit.svg",
            width: 96,
          },
          name: "Fitbit",
          requiresVitalDisclosure: false,
        },
      ],
    }),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=fitbit&connectProvider=junction`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=fitbit&connectProvider=junction`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "https://provider.example.test/oauth/start",
    );
  });

  assert.equal(fetch.mock.calls[0]?.[0], `/device/connect/${claim}`);
  assert.deepEqual(fetch.mock.calls[0]?.[1], {
    body: undefined,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
    },
    method: "POST",
    keepalive: false,
  });
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Connect Fitbit to Murph/u,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid explains Vital before redeeming a WHOOP device connect intent", async () => {
  const claim = "dc_12345678901234567890123456789012";
  let resolveAuthorizationResponse:
    | ((response: Response) => void)
    | null = null;
  const fetch = vi.fn(
    (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Promise<Response>((resolve) => {
        resolveAuthorizationResponse = resolve;
      });
    },
  );
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "whoop_v2",
          description: "Recovery, strain, sleep, and heart rate.",
          id: "whoop",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/whoop.svg",
            width: 44,
          },
          name: "Whoop",
        },
      ],
    }),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=whoop&connectProvider=junction`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop&connectProvider=junction`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Connect Whoop\./u,
    );
  });
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(rendered.assign.mock.calls.length, 0);

  const continueButton = [
    ...rendered.container.querySelectorAll("button"),
  ].find((button) => button.textContent === "Continue to Whoop");
  assert.ok(continueButton instanceof rendered.window.HTMLButtonElement);
  await clickButton(rendered, continueButton);

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(rendered.container.textContent ?? "", /Connecting Whoop/u);
  });
  assert.equal(rendered.assign.mock.calls.length, 0);
  assert.equal(fetch.mock.calls[0]?.[0], `/device/connect/${claim}`);
  assert.deepEqual(fetch.mock.calls[0]?.[1], {
    body: undefined,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
    },
    method: "POST",
    keepalive: false,
  });

  assert.ok(resolveAuthorizationResponse);
  await act(async () => {
    resolveAuthorizationResponse?.(
      Response.json({
        authorizationUrl: "https://junction.example.test/link/whoop",
      }),
    );
  });
  await vi.waitFor(() => {
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "https://junction.example.test/link/whoop",
    );
  });
  assert.equal(fetch.mock.calls.length, 1);

  await rendered.cleanup();
});

test("ConnectSourcesGrid clears signed-intent progress when Vital redemption fails", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn(async () =>
    Response.json(
      {
        error: {
          code: "HOSTED_DEVICE_CONNECT_INTENT_MISSING",
          message:
            "This connection link could not be found. Ask Murph for a new one.",
          retryable: false,
        },
      },
      { status: 410 },
    ),
  );
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...OURA_SOURCE,
          connectTarget: "oura",
          requiresVitalDisclosure: true,
        },
      ],
    }),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=oura&connectProvider=junction`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=oura&connectProvider=junction`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.match(rendered.container.textContent ?? "", /Connect Oura\./u);
  });
  const continueButton = [...rendered.container.querySelectorAll("button")]
    .find((button) => button.textContent === "Continue to Oura");
  assert.ok(continueButton instanceof rendered.window.HTMLButtonElement);
  await clickButton(rendered, continueButton);

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /This link isn’t working\./u,
    );
  });
  assert.equal(fetch.mock.calls.length, 1);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Connecting Oura/u);
  assert.equal(rendered.assign.mock.calls.length, 0);

  await rendered.cleanup();
});

test("ConnectSourcesGrid shows a recovery dialog when a device connect intent is unavailable", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn(async () =>
    Response.json(
      {
        error: {
          code: "HOSTED_DEVICE_CONNECT_INTENT_MISSING",
          message:
            "This connection link could not be found. Ask Murph for a new one.",
          retryable: false,
        },
      },
      { status: 410 },
    ),
  );
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      deviceConnectRecoveryContactAction: {
        href: "sms:+15550100001?body=Can%20you%20send%20me%20a%20fresh%20device%20connection%20link%3F",
        kind: "text",
        label: "Messages",
      },
      sources: [
        {
          ...WHOOP_SOURCE,
        },
      ],
    }),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(
      rendered.container.textContent ?? "",
      /This link isn’t working\./,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /This connection link could not be found\. Ask Murph for a new one\./,
    );
  });

  const contactLink = rendered.container.querySelector("a[href^='sms:']");
  assert.ok(contactLink instanceof rendered.window.HTMLAnchorElement);
  assert.equal(contactLink.textContent, "Open Messages");
  assert.match(
    contactLink.getAttribute("aria-label") ?? "",
    /fresh Whoop connection link/,
  );
  assert.equal(rendered.assign.mock.calls.length, 0);

  await rendered.cleanup();
});

test("ConnectSourcesGrid offers a retry of the same link when an intent cannot start", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json(
      {
        error: {
          code: "DEVICE_PROVIDER_UNAVAILABLE",
          message: "Connection could not be started.",
          retryable: true,
        },
      },
      { status: 503 },
    );
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...WHOOP_SOURCE,
        },
      ],
    }),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.match(rendered.container.textContent ?? "", /Whoop didn’t connect\./u);
  });
  assert.match(rendered.container.textContent ?? "", /Nothing changed\. Try again\./u);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Connecting Whoop/u);

  const retryButton = [...rendered.container.querySelectorAll("button")]
    .find((button) => button.textContent === "Try again");
  assert.ok(retryButton instanceof rendered.window.HTMLButtonElement);
  await clickButton(rendered, retryButton);

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 2);
  });
  assert.equal(fetch.mock.calls[1]?.[0], `/device/connect/${claim}`);

  await rendered.cleanup();
});

test("ConnectSourcesGrid settles an intent for a source that is already connected", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...WHOOP_SOURCE,
          connected: true,
        },
      ],
    }),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.match(rendered.container.textContent ?? "", /Whoop is connected\./u);
  });
  assert.equal(fetch.mock.calls.length, 0);

  const exploreButton = [...rendered.container.querySelectorAll("button")]
    .find((button) => button.textContent === "Continue exploring");
  assert.ok(exploreButton instanceof rendered.window.HTMLButtonElement);
  await clickButton(rendered, exploreButton);

  assert.doesNotMatch(rendered.container.textContent ?? "", /Whoop is connected\./u);
  assert.ok(
    rendered.container.querySelector("input[aria-label='Search sources']"),
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid keeps the Garmin Historical Data reminder on a link's Ready page", async () => {
  const claim = "dc_12345678901234567890123456789012";
  vi.stubGlobal("fetch", vi.fn());

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...GARMIN_SOURCE,
          requiresVitalDisclosure: true,
        },
      ],
    }),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=garmin&connectProvider=junction`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=garmin&connectProvider=junction`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /When Garmin opens, turn on Historical Data before approving\./u,
    );
  });
  assert.match(rendered.container.textContent ?? "", /Connect Garmin\./u);

  await rendered.cleanup();
});

test("ConnectSourcesGrid opens the WHOOP setup dialog when an intent reaches capacity", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json(
      {
        error: {
          code: "WHOOP_DIRECT_CONNECT_CAP_REACHED",
          message:
            "Direct WHOOP connections are full right now. You can keep WHOOP syncing through Apple Health in the Murph app.",
          retryable: false,
        },
      },
      { status: 409 },
    );
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      initialConnectIntent: {
        claim,
        connectSource: "whoop",
      },
      sources: [
        {
          ...WHOOP_SOURCE,
        },
      ],
    }),
  );

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(rendered.container.textContent ?? "", /Get your full sync/);
  });

  assert.equal(fetch.mock.calls[0]?.[0], `/device/connect/${claim}`);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Connecting Whoop/);
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /This link isn’t working\./,
  );
  assert.ok(
    rendered.container.querySelector("input[aria-label='Search sources']"),
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Two quick steps and Murph sees everything WHOOP tracks\./,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Download Murph and sign in/,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Turn on Apple Health in WHOOP/,
  );
  assert.doesNotMatch(rendered.container.textContent ?? "", /full right now/);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Junction/);

  const memoButton = rendered.container.querySelector(
    "button[aria-label='Play voice memo']",
  );
  assert.ok(memoButton instanceof rendered.window.HTMLButtonElement);
  const memoAudio = rendered.container.querySelector(
    "audio[src='/audio/whoop-sync-memos/upbeat.mp3']",
  );
  assert.ok(memoAudio, "expected the default-voice WHOOP sync memo");

  const appStoreLink = rendered.container.querySelector(
    "a[href='https://apps.apple.com/us/app/murph-ai/id6786145859']",
  );
  assert.ok(appStoreLink instanceof rendered.window.HTMLAnchorElement);
  assert.equal(appStoreLink.target, "_blank");
  assert.equal(appStoreLink.rel, "noopener noreferrer");
  assert.equal(
    appStoreLink.getAttribute("aria-label"),
    "Download App to sync WHOOP through Apple Health",
  );
  assert.equal(rendered.assign.mock.calls.length, 0);

  assert.equal(
    [...rendered.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Continue with Murph",
    ),
    undefined,
  );
  const closeButton = rendered.container.querySelector(
    'button[aria-label="Close"]',
  );
  assert.ok(closeButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, closeButton);

  assert.ok(
    rendered.container.querySelector("input[aria-label='Search sources']"),
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Get your full sync/,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid opens the WHOOP setup dialog for a manual start", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json(
      {
        error: {
          code: "WHOOP_DIRECT_CONNECT_CAP_REACHED",
          message:
            "Direct WHOOP connections are full right now. You can keep WHOOP syncing through Apple Health in the Murph app.",
          retryable: false,
        },
      },
      { status: 409 },
    );
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...WHOOP_SOURCE,
          connectTarget: "whoop",
        },
      ],
      whoopSyncContactAction: {
        href: "https://t.me/withmurph_bot?text=Help%20me%20finish%20setting%20up%20WHOOP",
        kind: "telegram",
        label: "Text Murph",
        rel: "noopener noreferrer",
        target: "_blank",
      },
      whoopSyncVoiceMemoSrc: "/audio/whoop-sync-memos/grandpa.mp3",
    }),
  );

  await clickButton(rendered, rendered.button);

  await vi.waitFor(() => {
    assert.match(rendered.container.textContent ?? "", /Get your full sync/);
  });

  assert.equal(fetch.mock.calls[0]?.[0], "/api/connect-sources/whoop/start");
  assert.equal(rendered.assign.mock.calls.length, 0);
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Connection could not be started/,
  );
  assert.ok(
    rendered.container.querySelector(
      "audio[src='/audio/whoop-sync-memos/grandpa.mp3']",
    ),
    "expected the member's picked-voice WHOOP sync memo",
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Download Murph and sign in/,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Turn on Apple Health in WHOOP/,
  );

  const continueLink = rendered.container.querySelector(
    'a[aria-label="Continue with Murph in Telegram (opens in a new tab)"]',
  );
  assert.ok(continueLink instanceof rendered.window.HTMLAnchorElement);
  assert.equal(continueLink.textContent, "Continue with Murph");
  assert.equal(continueLink.target, "_blank");

  await rendered.cleanup();
});

test("ConnectSourcesGrid gives a no-route manual capacity dialog a truthful close control", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json(
      {
        error: {
          code: "WHOOP_DIRECT_CONNECT_CAP_REACHED",
          message:
            "Direct WHOOP connections are full right now. You can keep WHOOP syncing through Apple Health in the Murph app.",
          retryable: false,
        },
      },
      { status: 409 },
    );
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...WHOOP_SOURCE,
          connectTarget: "whoop",
        },
      ],
    }),
  );

  await clickButton(rendered, rendered.button);

  await vi.waitFor(() => {
    assert.match(rendered.container.textContent ?? "", /Get your full sync/);
  });
  assert.equal(fetch.mock.calls[0]?.[0], "/api/connect-sources/whoop/start");
  assert.equal(
    [...rendered.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Continue with Murph",
    ),
    undefined,
  );
  const closeButton = rendered.container.querySelector(
    'button[aria-label="Close"]',
  );
  assert.ok(closeButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, closeButton);

  assert.ok(
    rendered.container.querySelector("input[aria-label='Search sources']"),
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Get your full sync/,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid labels Telegram recovery as texting Murph", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn(async () =>
    Response.json(
      {
        error: {
          code: "HOSTED_DEVICE_CONNECT_INTENT_MISSING",
          message:
            "This connection link could not be found. Ask Murph for a new one.",
          retryable: false,
        },
      },
      { status: 410 },
    ),
  );
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      deviceConnectRecoveryContactAction: {
        href: "https://t.me/murph",
        kind: "telegram",
        label: "Telegram",
        rel: "noreferrer",
        target: "_blank",
      },
      sources: [
        {
          ...WHOOP_SOURCE,
        },
      ],
    }),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(
      rendered.container.textContent ?? "",
      /This link isn’t working\./,
    );
  });

  const contactLink = rendered.container.querySelector(
    "a[href='https://t.me/murph']",
  );
  assert.ok(contactLink instanceof rendered.window.HTMLAnchorElement);
  assert.equal(contactLink.textContent, "Text Murph");
  assert.doesNotMatch(rendered.container.textContent ?? "", /Open Telegram/);
  assert.match(
    contactLink.getAttribute("aria-label") ?? "",
    /\(opens in a new tab\)/,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid falls back to email when no preferred recovery contact action is available", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn(async () =>
    Response.json(
      {
        error: {
          code: "HOSTED_DEVICE_CONNECT_INTENT_EXPIRED",
          message: "This connection link has expired. Ask Murph for a new one.",
          retryable: false,
        },
      },
      { status: 410 },
    ),
  );
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...WHOOP_SOURCE,
        },
      ],
    }),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /This link isn’t working\./,
    );
  });

  const contactLink = rendered.container.querySelector("a[href^='mailto:']");
  assert.ok(contactLink instanceof rendered.window.HTMLAnchorElement);
  assert.equal(contactLink.textContent, "Email Murph");
  assert.match(contactLink.href, /Start%20a%20private%20Murph%20conversation/);
  assert.match(
    decodeURIComponent(contactLink.href),
    /Please send me a private Murph reply\./,
  );
  assert.doesNotMatch(contactLink.href, /Fresh%20device%20connection%20link/);
  assert.match(
    rendered.container.textContent ?? "",
    /receive a private reply, then ask for a fresh connection link/,
  );
  assert.match(rendered.container.textContent ?? "", /within a few minutes/);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Set up contact/);

  await rendered.cleanup();
});

test.each([
  { name: "source refresh", authenticated: [true], redirects: true },
  { name: "logout", authenticated: [false], redirects: false },
  { name: "logout then login", authenticated: [false, true], redirects: false },
])("ConnectSourcesGrid preserves only the authorized pending intent after $name", async (scenario) => {
  const claim = "dc_12345678901234567890123456789012";
  let resolveFetch: ((response: Response) => void) | undefined;
  const fetch = vi.fn(
    async () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);

  const renderGrid = (authenticated = true) => createElement(ConnectSourcesGrid, {
      authenticated,
      sources: [
        {
          ...WHOOP_SOURCE,
          connectTarget: "whoop",
        },
      ],
    });
  const rendered = await renderClientComponent(
    renderGrid(),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(rendered.container.textContent ?? "", /Connecting Whoop/);
  });

  for (const authenticated of scenario.authenticated) {
    await rendered.rerender(renderGrid(authenticated));
  }

  await act(async () => {
    resolveFetch?.(
      Response.json({
        authorizationUrl: "https://provider.example.test/oauth/start",
      }),
    );
  });

  if (scenario.redirects) {
    await vi.waitFor(() => {
      assert.equal(
        rendered.assign.mock.calls[0]?.[0],
        "https://provider.example.test/oauth/start",
      );
    });
  }

  assert.equal(fetch.mock.calls.length, 1);
  assert.equal(rendered.assign.mock.calls.length, scenario.redirects ? 1 : 0);
  await rendered.cleanup();
});

test.each([
  "logout",
  "logout then login",
  "member change",
] as const)("ConnectPage resets pending authorization after %s", async (transition) => {
  configureJunction("oura");
  let resolveFetch: ((response: Response) => void) | undefined;
  const fetch = vi.fn(() => new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  }));
  vi.stubGlobal("fetch", fetch);
  const claim = "dc_12345678901234567890123456789012";
  const rendered = await renderClientComponent(await ConnectPage(), {
    location: {
      hash: `#deviceConnectIntent=${claim}&connectSource=oura`,
      href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=oura`,
    },
  });
  try {
    const continueButton = [...rendered.container.querySelectorAll("button")]
      .find((button) => button.textContent === "Continue to Oura");
    assert.ok(continueButton);
    await clickButton(rendered, continueButton);
    await vi.waitFor(() => {
      assert.equal(fetch.mock.calls.length, 1);
      assert.match(rendered.container.textContent ?? "", /Connecting Oura/u);
    });
    const previousAuth = await mocks.getHostedPageAuthSnapshot();
    mocks.getHostedPageAuthSnapshot.mockResolvedValue(transition === "member change"
      ? {
          ...previousAuth,
          authenticatedMember: { ...previousAuth.authenticatedMember, id: "member_other" },
        }
      : { ...previousAuth, authenticated: false, authenticatedMember: null });
    await rendered.rerender(await ConnectPage());
    assert.doesNotMatch(rendered.container.textContent ?? "", /Connecting Oura/u);

    if (transition === "logout then login") {
      mocks.getHostedPageAuthSnapshot.mockResolvedValue(previousAuth);
      await rendered.rerender(await ConnectPage());
    }
    await act(async () => {
      resolveFetch?.(Response.json({
        authorizationUrl: "https://provider.example.test/oauth/previous-member",
      }));
    });
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(rendered.assign.mock.calls.length, 0);
    assert.doesNotMatch(rendered.container.textContent ?? "", /Connecting Oura/u);
    const nextAction = rendered.container.querySelector<HTMLButtonElement>(
      `[data-connect-source="oura"] button[aria-label="${transition === "logout" ? "Sign in to Murph" : "Connect Oura"}"]`,
    );
    assert.ok(nextAction);
    assert.equal(nextAction.disabled, false);
  } finally {
    await rendered.cleanup();
  }
});

test("ConnectSourcesGrid disconnects a connected source after confirmation", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...WHOOP_SOURCE,
          connectTarget: "whoop",
          connected: true,
          disconnectConnectionId: "dsc_whoop_123",
        },
      ],
    }),
  );

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect Whoop']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(disconnectButton.textContent, "Disconnect");

  await clickButton(rendered, disconnectButton);

  assert.match(rendered.container.textContent ?? "", /Disconnect Whoop\?/);
  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(confirmButton.textContent, "Disconnect");

  await clickButton(rendered, confirmButton);

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnected Whoop\. Your history is still saved\./,
    );
  });

  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_whoop_123/disconnect",
  );
  assert.deepEqual(fetch.mock.calls[0]?.[1], {
    body: undefined,
    cache: "no-store",
    credentials: "same-origin",
    headers: {},
    method: "POST",
    keepalive: false,
  });
  assert.match(rendered.container.textContent ?? "", /Whoop not connected/);
  assert.equal(
    rendered.container.querySelector("button[aria-label='Connect Whoop']")
      ?.textContent,
    "Connect",
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid disconnects one reconnect-required Junction source without hiding siblings", async () => {
  const fetch = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      if (String(input).includes("/disconnect")) {
        return Response.json({
          sourceProviderSlug: "oura",
          status: "disconnected",
        });
      }

      return Response.json({
        authorizationUrl: "https://oura.example.test/oauth/start",
      });
    },
  );
  vi.stubGlobal("fetch", fetch);

  const sharedConnectionId = "dsc_junction_shared";
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...OURA_SOURCE,
          connected: true,
          connectProvider: "junction",
          connectTarget: "oura",
          disconnectConnectionId: sharedConnectionId,
          disconnectSourceProviderSlug: "oura",
          requiresReconnect: true,
          requiresVitalDisclosure: false,
        },
        {
          ...WHOOP_SOURCE,
          connected: true,
          disconnectConnectionId: sharedConnectionId,
          disconnectSourceProviderSlug: "whoop_v2",
        },
      ],
    }),
  );

  const reconnectButton = rendered.container.querySelector(
    "button[aria-label='Reconnect Oura']",
  );
  assert.ok(reconnectButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, reconnectButton);

  assert.match(rendered.container.textContent ?? "", /We use Vital/u);
  assert.equal(fetch.mock.calls.length, 0);
  const closeButton = rendered.container.querySelector(
    "button[aria-label='Close']",
  );
  assert.ok(closeButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, closeButton);

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect Oura']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, disconnectButton);

  assert.match(rendered.container.textContent ?? "", /Disconnect Oura\?/u);
  assert.match(
    rendered.container.textContent ?? "",
    /Murph will stop syncing new data from Oura\. Your history is kept\./u,
  );
  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, confirmButton);

  await vi.waitFor(() => {
    assert.match(rendered.container.textContent ?? "", /Oura not connected/u);
    assert.match(rendered.container.textContent ?? "", /Whoop connected/u);
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    `/api/settings/device-sync/connections/${sharedConnectionId}/sources/oura/disconnect`,
  );
  assert.ok(
    rendered.container.querySelector("button[aria-label='Disconnect Whoop']"),
  );
  const connectButton = rendered.container.querySelector(
    "button[aria-label='Connect Oura']",
  );
  assert.ok(connectButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, connectButton);

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 2);
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "https://oura.example.test/oauth/start",
    );
  });
  assert.doesNotMatch(rendered.container.textContent ?? "", /We use Vital/u);
  assert.equal(fetch.mock.calls[1]?.[0], "/api/connect-sources/oura/start");
  assert.deepEqual(fetch.mock.calls[1]?.[1], {
    body: JSON.stringify({ connectTarget: "oura" }),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
    keepalive: false,
  });

  await rendered.cleanup();
});

test("ConnectSourcesGrid hides a connection-disabled source after its local disconnect", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectionAvailable: false,
          connected: true,
          description:
            "Rides, runs, workouts, route context, power, and training load.",
          disconnectConnectionId: "dsc_strava_123",
          id: "strava",
          logo: {
            className: "h-auto max-h-9 w-auto max-w-[8rem] object-contain",
            height: 20,
            src: "/brand-logos/connect/strava.svg",
            width: 96,
          },
          name: "Strava",
        },
      ],
    }),
  );

  assert.match(rendered.container.textContent ?? "", /1 of 1 sources/u);
  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect Strava']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, disconnectButton);

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, confirmButton);

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnected Strava\. Your history is still saved\./u,
    );
    assert.match(rendered.container.textContent ?? "", /0 of 0 sources/u);
  });

  assert.equal(
    [...rendered.container.querySelectorAll("h2")].some(
      (heading) => heading.textContent === "Strava",
    ),
    false,
  );
  assert.equal(
    rendered.container.querySelector("button[aria-label='Disconnect Strava']"),
    null,
  );
  assert.doesNotMatch(rendered.container.textContent ?? "", /Not available/u);

  await rendered.cleanup();
});

test("ConnectSourcesGrid keeps Apple Health mobile guidance after local disconnect", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connected: true,
          description:
            "iPhone and Apple Watch activity, sleep, vitals, and workouts.",
          disconnectConnectionId: "dsc_apple_health_123",
          id: "apple-health",
          logo: {
            className: "h-9 w-auto object-contain",
            height: 48,
            src: "/brand-logos/connect/apple-health.png",
            width: 48,
          },
          name: "Apple Health",
          unavailableActionLabel: "Download app",
          unavailableActionUrl:
            "https://apps.apple.com/us/app/murph-ai/id6786145859",
          unavailableMessage:
            "Download Murph on your iPhone, then connect Apple Health in the app.",
        },
      ],
    }),
  );

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect Apple Health']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, disconnectButton);

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, confirmButton);

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnected Apple Health\. Your history is still saved\./,
    );
  });

  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_apple_health_123/disconnect",
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Apple Health not connected/,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Download Murph on your iPhone, then connect Apple Health in the app\./,
  );
  const appDownloadLink = rendered.container.querySelector(
    "a[aria-label='Download app for Apple Health']",
  );
  assert.equal(appDownloadLink?.textContent, "Download app");
  assert.equal(
    appDownloadLink?.getAttribute("href"),
    "https://apps.apple.com/us/app/murph-ai/id6786145859",
  );
  assert.doesNotMatch(rendered.container.textContent ?? "", /Not available/u);

  await rendered.cleanup();
});

test("ConnectSourcesGrid warns when a Garmin account reset also disconnects unavailable Dexcom", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...GARMIN_SOURCE,
          connectionAvailable: true,
          connectTarget: "garmin",
          connected: true,
          disconnectConnectionId: "dsc_shared_garmin_dexcom",
          disconnectScope: "junction_account",
          recoveryKind: "connection_reset",
        },
        {
          connectionAvailable: false,
          connected: true,
          description: "CGM glucose readings and trends.",
          disconnectConnectionId: "dsc_shared_garmin_dexcom",
          disconnectScope: "junction_account",
          id: "dexcom",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/dexcom.png",
            width: 44,
          },
          name: "Dexcom",
          unavailableActionLabel: "Coming soon",
          unavailableMessage: "Dexcom connections are coming soon.",
        },
      ],
    }),
  );

  const garminHeading = [...rendered.container.querySelectorAll("h2")]
    .find((heading) => heading.textContent === "Garmin");
  const garminCard = garminHeading?.closest("div.relative");
  const disconnectButton = garminCard?.querySelector(
    "button[aria-label='Disconnect account']",
  ) ?? null;
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, disconnectButton);

  assert.match(
    rendered.container.textContent ?? "",
    /This also disconnects Dexcom, which cannot be reconnected yet\./u,
  );
  const cancelButton = [...rendered.container.querySelectorAll("button")]
    .find((button) => button.textContent === "Cancel");
  assert.ok(cancelButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, cancelButton);

  assert.match(rendered.container.textContent ?? "", /Garmin needs a fresh connection/u);
  assert.match(rendered.container.textContent ?? "", /Dexcom connected/u);
  assert.equal(fetch.mock.calls.length, 0);

  await clickButton(rendered, disconnectButton);
  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, confirmButton);

  await vi.waitFor(() => {
    assert.match(rendered.container.textContent ?? "", /Garmin not connected/u);
    assert.match(rendered.container.textContent ?? "", /Dexcom not connected/u);
    assert.match(rendered.container.textContent ?? "", /Dexcom connections are coming soon\./u);
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_shared_garmin_dexcom/disconnect",
  );
  assert.ok(
    rendered.container.querySelector("button[aria-label='Connect Garmin']"),
  );
  assert.ok(
    rendered.container.querySelector("button[aria-label='Dexcom web setup is not available yet']"),
  );
  assert.equal(
    rendered.container.querySelector("button[aria-label='Connect Dexcom']"),
    null,
  );
  assert.equal(
    rendered.container.querySelector("button[aria-label='Reconnect Dexcom']"),
    null,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid uses account-scoped disconnect copy without naming Junction", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...WHOOP_SOURCE,
          connected: true,
          disconnectConnectionId: "dsc_junction_multi",
          disconnectScope: "junction_account",
        },
      ],
    }),
  );

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect account']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(disconnectButton.textContent, "Disconnect");
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Junction account/u,
  );

  await clickButton(rendered, disconnectButton);

  assert.match(rendered.container.textContent ?? "", /Disconnect account\?/);
  assert.match(
    rendered.container.textContent ?? "",
    /Murph will stop syncing new data from every source in this connection\. Your history is kept\./,
  );

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, confirmButton);

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnected this connection\. Your history is still saved\./,
    );
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_junction_multi/disconnect",
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid walks connection-reset sources through account disconnect then connect", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...GARMIN_SOURCE,
          connectTarget: "garmin",
          disconnectConnectionId: "dsc_junction_garmin",
          disconnectScope: "junction_account",
          recoveryKind: "connection_reset",
        },
      ],
    }),
  );

  assert.match(
    rendered.container.textContent ?? "",
    /Garmin needs a fresh connection\. Disconnect it first, then connect it again\./,
  );
  assert.equal(
    rendered.container.querySelector("button[aria-label='Reconnect Garmin']"),
    null,
  );
  assert.equal(
    rendered.container.querySelector("button[aria-label='Connect Garmin']"),
    null,
  );

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect account']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, disconnectButton);

  assert.match(rendered.container.textContent ?? "", /Disconnect account\?/);
  assert.match(
    rendered.container.textContent ?? "",
    /Murph will stop syncing new data from every source in this connection\. Your history is kept\./,
  );

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, confirmButton);

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnected this connection\. Your history is still saved\./,
    );
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_junction_garmin/disconnect",
  );

  const connectButton = rendered.container.querySelector(
    "button[aria-label='Connect Garmin']",
  );
  assert.ok(connectButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(connectButton.textContent, "Connect");
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /needs a fresh connection/u,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid keeps an unfinished historical-reset disconnect open for retry", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({
      warning: {
        code: "HISTORICAL_RESET_REVOKE_FAILED",
        historicalResetIncomplete: true,
        message:
          "Provider revoke did not complete while a historical data reset is pending. " +
          "Remove the connection in the provider account before reconnecting.",
      },
    });
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...GARMIN_SOURCE,
          connectTarget: "garmin",
          disconnectConnectionId: "dsc_junction_garmin",
          disconnectScope: "junction_account",
          recoveryKind: "connection_reset",
        },
      ],
    }),
  );

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect account']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, disconnectButton);

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, confirmButton);

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnect not finished\. Remove the old connection in your wearable provider account, then retry Disconnect here\./,
    );
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_junction_garmin/disconnect",
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /did not fully confirm/u,
  );

  assert.match(rendered.container.textContent ?? "", /Disconnect account\?/);
  assert.equal(
    rendered.container.querySelector("button[aria-label='Connect Garmin']"),
    null,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid keeps a shared historical-reset disconnect open for retry", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({
      warning: {
        code: "HISTORICAL_RESET_REVOKE_FAILED",
        historicalResetIncomplete: true,
        message:
          "Provider revoke did not complete while a historical data reset is pending. " +
          "Remove the connection in the provider account before reconnecting.",
      },
    });
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...GARMIN_SOURCE,
          connectTarget: "garmin",
          disconnectConnectionId: "dsc_junction_multi",
          disconnectScope: "junction_account",
          recoveryKind: "connection_reset",
        },
        {
          ...WHOOP_SOURCE,
          connectTarget: "whoop",
          connected: true,
          disconnectConnectionId: "dsc_junction_multi",
          disconnectScope: "junction_account",
        },
      ],
    }),
  );

  // Start the shared-account disconnect from the healthy Whoop card, not the
  // Garmin card that carries the historical reset.
  const disconnectButton = [
    ...rendered.container.querySelectorAll(
      "button[aria-label='Disconnect account']",
    ),
  ].find((button) =>
    button.closest("div.relative")?.textContent?.includes("Whoop"),
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, disconnectButton);

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, confirmButton);

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnect not finished\. Remove the old connection in your wearable provider account, then retry Disconnect here\./,
    );
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_junction_multi/disconnect",
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /did not fully confirm/u,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid keeps ordinary failed revokes on the disconnect path", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({
      warning: {
        code: "PROVIDER_REVOKE_FAILED",
        message: "Provider revoke request failed during disconnect.",
      },
    });
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...WHOOP_SOURCE,
          connectTarget: "whoop",
          connected: true,
          disconnectConnectionId: "dsc_whoop_123",
        },
      ],
    }),
  );

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect Whoop']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, disconnectButton);

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, confirmButton);

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnect not finished\. Remove Murph access in the provider account, then retry Disconnect here\./,
    );
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_whoop_123/disconnect",
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /historical reset/iu,
  );
  assert.match(rendered.container.textContent ?? "", /Disconnect Whoop\?/);
  assert.equal(
    rendered.container.querySelector("button[aria-label='Connect Whoop']"),
    null,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid shows reconnect guidance without a disconnect action", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({
      authorizationUrl: "https://provider.example.test/oauth/start",
    });
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...WHOOP_SOURCE,
          connectTarget: "whoop",
          disconnectConnectionId: "dsc_whoop_123",
          requiresReconnect: true,
        },
      ],
    }),
  );

  assert.match(
    rendered.container.textContent ?? "",
    /Please reconnect Whoop to resume syncing\./,
  );
  assert.equal(
    rendered.container.querySelector("button[aria-label='Disconnect Whoop']"),
    null,
  );
  const reconnectButton = rendered.container.querySelector(
    "button[aria-label='Reconnect Whoop']",
  );
  assert.ok(reconnectButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(reconnectButton.textContent, "Reconnect");

  await clickButton(rendered, reconnectButton);

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "https://provider.example.test/oauth/start",
    );
  });

  assert.equal(fetch.mock.calls[0]?.[0], "/api/connect-sources/whoop/start");
  assert.deepEqual(fetch.mock.calls[0]?.[1], {
    body: JSON.stringify({ connectTarget: "whoop" }),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
    keepalive: false,
  });

  await rendered.cleanup();
});

test("ConnectSourcesGrid shows disconnect failures inside the confirmation dialog", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json(
      {
        error: {
          code: "DEVICE_SYNC_DISCONNECT_FAILED",
          message: "We could not disconnect Whoop right now.",
        },
      },
      { status: 502 },
    );
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...WHOOP_SOURCE,
          connectTarget: "whoop",
          connected: true,
          disconnectConnectionId: "dsc_whoop_123",
        },
      ],
    }),
  );

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect Whoop']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, disconnectButton);

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await clickButton(rendered, confirmButton);

  await vi.waitFor(() => {
    const alert = rendered.container.querySelector("[role='alert']");
    assert.ok(alert);
    assert.equal(alert.textContent, "We could not disconnect Whoop right now.");
  });
  assert.match(rendered.container.textContent ?? "", /Disconnect Whoop\?/);
  assert.match(rendered.container.textContent ?? "", /Whoop connected/);
  assert.equal(
    rendered.container.querySelector("button[aria-label='Connect Whoop']"),
    null,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid rejects malformed connect responses before redirecting", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({
      authorizationUrl: 42,
    });
  });
  vi.stubGlobal("fetch", fetch);
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "oura",
          description:
            "Sleep, readiness, activity, temperature, and heart rate.",
          id: "oura",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/oura.png",
            width: 44,
          },
          name: "Oura",
        },
      ],
    }),
  );

  await clickButton(rendered, rendered.button);

  assert.equal(rendered.assign.mock.calls.length, 0);
  assert.match(
    rendered.container.textContent ?? "",
    /Connection could not be started\./,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid rejects unsafe connect response URLs before redirecting", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({
      authorizationUrl: "javascript:alert(1)",
    });
  });
  vi.stubGlobal("fetch", fetch);
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "oura",
          description:
            "Sleep, readiness, activity, temperature, and heart rate.",
          id: "oura",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/oura.png",
            width: 44,
          },
          name: "Oura",
        },
      ],
    }),
  );

  await clickButton(rendered, rendered.button);

  assert.equal(rendered.assign.mock.calls.length, 0);
  assert.match(
    rendered.container.textContent ?? "",
    /Connection could not be started\./,
  );

  await rendered.cleanup();
});

test("ConnectPage shows callback success with the original source label", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_oura",
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            providerLabel: "Oura",
            resourceCount: 1,
            sourceProviderSlug: "oura",
            status: "connected",
          },
        ],
      },
    ],
  });

  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "oura",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "connected",
      }),
    }),
  );

  assert.match(markup, /Connected Oura\./);
  assert.match(markup, /data-connection-state="connected"/u);
  assert.ok(
    sourceHeadingIndex(markup, "Oura") < sourceHeadingIndex(markup, "Whoop"),
  );
  assert.doesNotMatch(markup, /aria-label="Connect Oura"/u);
});

test("ConnectPage suppresses unverified connected callbacks from query params", async () => {
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "oura",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "connected",
      }),
    }),
  );

  assert.doesNotMatch(markup, /Connected Oura\./);
  assert.match(markup, /Oura not connected/);
});

test("ConnectPage ignores connected callback status when callback source metadata is missing", async () => {
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        deviceSyncProvider: "junction",
        deviceSyncStatus: "connected",
      }),
    }),
  );

  assert.doesNotMatch(markup, /Connected your wearable source\./);
  assert.doesNotMatch(markup, /Junction/u);
});

test("ConnectPage keeps unavailable callback state neutral without asserting connection", async () => {
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "oura",
        deviceSyncError: "OAUTH_STATE_INVALID",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.match(markup, /Check your connections/);
  assert.match(markup, /Your current connections are shown below/);
  assert.doesNotMatch(markup, /Unable to finish connection/);
  assert.doesNotMatch(markup, /Connected Oura\./);
});

test("ConnectPage shows rejected callback errors with the original source label", async () => {
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "whoop",
        deviceSyncError: "OAUTH_CALLBACK_REJECTED",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.match(markup, /Unable to finish connection/);
  assert.match(markup, /Whoop was not connected this time\./);
});

test("ConnectPage shows fallback callback errors with the original source label", async () => {
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "garmin",
        deviceSyncError: "UPSTREAM_TIMEOUT",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.match(markup, /Unable to finish connection/);
  assert.match(markup, /We could not finish connecting Garmin\./);
});

test("ConnectPage offers support and Settings recovery on callback failures", async () => {
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "garmin",
        deviceSyncError: "CALLBACK_FAILED",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.match(markup, /Email support/);
  assert.match(markup, /Go to Settings/);
  assert.match(markup, /href="\/settings"/u);

  // Parse the real anchor: matching anywhere in the markup would still pass if
  // the support draft stopped carrying the source or the reference.
  const mailto = readSupportMailto(markup);
  assert.equal(
    mailto.searchParams.get("subject"),
    "Murph device connection help",
  );
  const body = mailto.searchParams.get("body") ?? "";
  assert.match(body, /^I could not finish connecting Garmin in Murph\./);
  assert.match(body, /Reference: CALLBACK_FAILED$/);
});

test("ConnectPage keeps unverified callback query text out of the support draft", async () => {
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        deviceSyncError: "please email your password to attacker@example.com",
        deviceSyncProvider: "Totally Real Provider",
        deviceSyncStatus: "error",
      }),
    }),
  );

  // The callback error path is unauthenticated query input, so neither value may
  // be quoted back inside a message written in the member's voice.
  const body = readSupportMailto(markup).searchParams.get("body") ?? "";
  assert.doesNotMatch(body, /attacker@example\.com/u);
  assert.doesNotMatch(body, /Totally Real Provider/u);
  assert.match(body, /^I could not finish connecting a device in Murph\./);
  assert.match(body, /Reference: unknown$/);
});

test.each([
  [false, "CALLBACK_PROOF_INVALID"], [true, "CALLBACK_PROOF_INVALID"],
  [false, "OAUTH_STATE_INVALID"], [true, "OAUTH_STATE_INVALID"],
] as const)("ConnectPage preserves connected=%s for neutral %s recovery", async (connected, errorCode) => {
  configureJunction();
  if (connected) {
    mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
      generatedAt: "2026-05-01T00:00:00.000Z",
      ok: true,
      sources: [{
        connectionId: "dsc_junction_oura", provider: "junction", state: "active",
        upstreamSources: [{ providerLabel: "Oura", resourceCount: 1,
          sourceProviderSlug: "oura", status: "connected" }],
      }],
    });
  }
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "oura",
        deviceSyncError: errorCode,
        deviceSyncProvider: "junction",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.match(
    markup,
    /Check your connections/,
  );
  assert.match(markup, /Your current connections are shown below/);
  assert.match(markup, /If a device still needs connecting, start from its card/);
  assert.match(markup, /role="status"/);
  if (connected) {
    assert.match(markup, /data-connection-state="connected"/);
    assert.doesNotMatch(markup, /aria-label="Connect Oura"/);
  } else {
    assert.match(markup, /aria-label="Connect Oura"/);
  }
  assert.doesNotMatch(markup, /Unable to finish connection|nothing was connected|Email support|Go to Settings/);
});

test("ConnectPage offers sign-in recovery when the callback arrived signed out", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: false,
    authenticatedMember: null,
    linkedAccounts: [],
    session: null,
  });

  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "oura",
        deviceSyncError: "CALLBACK_SESSION_REQUIRED",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.match(markup, /You were signed out before Oura finished connecting\./);
  assert.match(markup, /Log in, then start the connection again\./);
  // Signing in is the actual recovery here, so it must be offered in the notice
  // rather than leaving support and home as the only actions.
  assert.match(markup, />Log in</u);
  assert.match(markup, /Email support/);
});

test("ConnectPage omits sign-in recovery when the member is already signed in", async () => {
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "oura",
        deviceSyncError: "CALLBACK_PROOF_INVALID",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.doesNotMatch(markup, />Log in</u);
  assert.doesNotMatch(markup, /Email support/);
});

test("ConnectPage keeps successful callbacks free of failure recovery actions", async () => {
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "oura",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "connected",
      }),
    }),
  );

  assert.doesNotMatch(markup, /Email support/);
  assert.doesNotMatch(markup, /Go to Settings/);
});

test("resolveConfiguredConnectSources keeps Fitbit on its dedicated Junction disclosure", async () => {
  configureJunction();
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "fitbit");

  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
  const resolved = resolveConfiguredConnectSources([
    { id: "whoop", name: "Whoop", description: "Recovery.", logo },
    { id: "fitbit", name: "Fitbit", description: "Activity.", logo },
  ]);

  assert.deepEqual(
    Object.fromEntries(
      resolved.map((source) => [
        source.id,
        source.requiresVitalDisclosure === true,
      ]),
    ),
    { fitbit: false, whoop: false },
  );
});

test("Vital disclosure follows reconnect and fresh providers across local disconnects", async () => {
  configureJunction();
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "oura,whoop_v2");

  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
  const resolved = resolveConfiguredConnectSources(
    [
      { id: "oura", name: "Oura", description: "Sleep.", logo },
      { id: "whoop", name: "Whoop", description: "Recovery.", logo },
    ],
    {
      connectionStates: ["oura", "whoop"].map((sourceId) => ({
        connectionId: null,
        connectProvider: "junction",
        connectTarget: sourceId,
        requiresReconnect: true,
        sourceId,
        state: "reauthorization_required",
      })),
    },
  );
  const oura = resolved.find((source) => source.id === "oura");
  const whoop = resolved.find((source) => source.id === "whoop");
  assert.ok(oura);
  assert.ok(whoop);

  assert.equal(oura.connectProvider, "junction");
  assert.equal(oura.requiresVitalDisclosure, true);
  assert.equal(requiresVitalConnectionPreflight(oura), true);
  assert.equal(whoop.connectProvider, "junction");
  assert.equal(whoop.requiresVitalDisclosure, true);
  assert.equal(requiresVitalConnectionPreflight(whoop), true);

  const locallyDisconnected = markLocallyDisconnectedSources(
    resolved,
    new Set(),
    new Set(["oura", "whoop"]),
  );
  const disconnectedOura = locallyDisconnected.find(
    (source) => source.id === "oura",
  );
  const disconnectedWhoop = locallyDisconnected.find(
    (source) => source.id === "whoop",
  );
  assert.ok(disconnectedOura);
  assert.ok(disconnectedWhoop);
  assert.equal(requiresVitalConnectionPreflight(disconnectedOura), true);
  assert.equal(requiresVitalConnectionPreflight(disconnectedWhoop), true);
});

test("ConnectSourcesGrid explains Vital before a Vital-backed authorization", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return Response.json({
      authorizationUrl: "https://junction.example.test/link/oura",
    });
  });
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...OURA_SOURCE,
          connectTarget: "oura",
          requiresVitalDisclosure: true,
        },
      ],
    }),
  );

  const connectButton = rendered.container.querySelector(
    "button[aria-label='Connect Oura']",
  );
  assert.ok(connectButton instanceof rendered.window.HTMLButtonElement);
  await clickButton(rendered, connectButton);

  assert.equal(fetch.mock.calls.length, 0);
  assert.match(
    rendered.container.textContent ?? "",
    /Connect Oura to Murph/u,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /We use Vital to connect this health source to Murph\./u,
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Turn on Historical Data/u,
  );
  assert.equal(rendered.container.querySelector("audio"), null);

  const continueButton = [
    ...rendered.container.querySelectorAll("button"),
  ].find((button) => button.textContent === "Continue to Oura");
  assert.ok(continueButton instanceof rendered.window.HTMLButtonElement);
  await clickButton(rendered, continueButton);

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "https://junction.example.test/link/oura",
    );
  });
  assert.equal(fetch.mock.calls[0]?.[0], "/api/connect-sources/oura/start");

  await rendered.cleanup();
});

test("ConnectSourcesGrid dismisses a Vital handoff without starting a connection", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          ...OURA_SOURCE,
          connectTarget: "oura",
          requiresVitalDisclosure: true,
        },
      ],
    }),
  );

  const connectButton = rendered.container.querySelector(
    "button[aria-label='Connect Oura']",
  );
  assert.ok(connectButton instanceof rendered.window.HTMLButtonElement);
  await clickButton(rendered, connectButton);

  assert.match(
    rendered.container.textContent ?? "",
    /Connect Oura to Murph/u,
  );
  const closeButton = rendered.container.querySelector(
    'button[aria-label="Close"]',
  );
  assert.ok(closeButton instanceof rendered.window.HTMLButtonElement);
  await clickButton(rendered, closeButton);

  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(rendered.assign.mock.calls.length, 0);
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Connect Oura to Murph/u,
  );
  assert.ok(
    rendered.container.querySelector("button[aria-label='Connect Oura']"),
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid keeps Fitbit on its dedicated connection flow", async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      authorizationUrl: "https://junction.example.test/link/fitbit",
    }),
  );
  vi.stubGlobal("fetch", fetch);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "fitbit",
          description: "Activity, sleep, and heart rate.",
          id: "fitbit",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/fitbit.svg",
            width: 44,
          },
          name: "Fitbit",
        },
      ],
    }),
  );

  const connectButton = rendered.container.querySelector(
    "button[aria-label='Connect Fitbit']",
  );
  assert.ok(connectButton instanceof rendered.window.HTMLButtonElement);
  await clickButton(rendered, connectButton);

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "https://junction.example.test/link/fitbit",
    );
  });
  assert.doesNotMatch(rendered.container.textContent ?? "", /We use Vital/u);

  await rendered.cleanup();
});

function readSupportMailto(markup: string): URL {
  const match = markup.match(/href="(mailto:[^"]+)"/u);
  assert.ok(match, "expected a support mailto anchor in the rendered markup");
  return new URL(match[1].replaceAll("&amp;", "&"));
}

function readWhoopSyncContactAction(page: ReactNode): unknown {
  return readConnectSourcesGridProp(page, "whoopSyncContactAction");
}

function readConnectSourcesGridProp(
  page: ReactNode,
  propName: string,
): unknown {
  assert.ok(isValidElement<{ children?: ReactNode }>(page));
  const connectSourcesGrid = Children.toArray(page.props.children).find(
    (child) => {
      if (!isValidElement(child)) {
        return false;
      }
      return propName in (child.props as Record<string, unknown>);
    },
  );

  assert.ok(isValidElement(connectSourcesGrid));
  return (connectSourcesGrid.props as Record<string, unknown>)[propName];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceHeadingIndex(markup: string, sourceName: string): number {
  const index = markup.indexOf(`>${sourceName}</h2>`);
  assert.notEqual(index, -1, `${sourceName} heading should exist`);
  return index;
}

function expectSettingResponseNotLoaded() {
  assert.equal(
    mocks.buildHostedDeviceSyncSettingsResponse.mock.calls.length,
    0,
  );
}

test("ConnectPage projects one truthful Fitbit and Pixel Watch migration card", async () => {
  const legacy = {
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastDataAt: "2026-08-10T00:00:00.000Z",
    lastSeenAt: "2026-08-10T00:00:00.000Z",
    providerLabel: "Fitbit",
    resourceCount: 4,
    sourceProviderSlug: "fitbit",
    status: "connected" as const,
  };
  const successor = {
    fitbitMigrationCoverageReady: true as const,
    firstSeenAt: "2026-08-11T10:00:00.000Z",
    historicalBackfillComplete: true as const,
    lastDataAt: "2026-08-11T10:05:00.000Z",
    lastSeenAt: "2026-08-11T10:06:00.000Z",
    providerLabel: "Google Health",
    resourceCount: 3,
    sourceProviderSlug: "google_health",
    status: "connected" as const,
  };
  const cases = [
    {
      expected: {
        connectProvider: "junction",
        connectTarget: "fitbit",
        migrationState: "authorization_required",
      },
      name: "explicit Google authorization",
      upstreamSources: [legacy],
    },
    {
      expected: {
        connectProvider: null,
        connectTarget: null,
        migrationState: "verifying_successor",
      },
      name: "legacy stays active while successor proof is incomplete",
      upstreamSources: [
        legacy,
        { ...successor, fitbitMigrationCoverageReady: undefined },
      ],
    },
    {
      expected: {
        connectProvider: null,
        connectTarget: null,
        disconnectSourceProviderSlug: JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
        migrationState: "cutover_ready",
      },
      name: "targeted automatic cutover",
      upstreamSources: [legacy, successor],
    },
    {
      expected: {
        connectProvider: null,
        connectTarget: null,
        disconnectSourceProviderSlug: JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
        migrationRetryRequired: true,
        migrationState: "cutover_ready",
      },
      name: "durable provider failure retry",
      upstreamSources: [{
        ...legacy,
        lastErrorCode: "GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED",
      }, successor],
    },
  ];

  for (const value of cases) {
    const states = resolveConnectSourceConnectionStates(
      [{ id: "fitbit" }],
      [{
        connectionId: "dsc_junction_fitbit",
        provider: "junction",
        state: "active",
        upstreamSources: value.upstreamSources,
      }],
    );
    assert.equal(states.length, 1, value.name);
    assert.deepEqual(states[0], {
      connectionId: "dsc_junction_fitbit",
      lastDataAt: value.upstreamSources.at(-1)?.lastDataAt ?? null,
      requiresReconnect: false,
      sourceId: "fitbit",
      state: "active",
      ...value.expected,
    }, value.name);
  }
});

test("ConnectSourcesGrid keeps automatic Fitbit continuation live and accelerable", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const expectedCutoverUrl =
    "/api/settings/device-sync/connections/dsc_junction_fitbit/fitbit-migration/cutover";
  const expectedRequestInit = {
    body: undefined,
    cache: "no-store",
    credentials: "same-origin",
    headers: {},
    keepalive: false,
    method: "POST",
  };
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({
      connectionId: "dsc_junction_fitbit",
      status: "pending",
    }))
    .mockResolvedValueOnce(Response.json({
      connectionId: "dsc_junction_fitbit",
      status: "complete",
    }));
  vi.stubGlobal("fetch", fetch);
  const renderMigration = (input: {
    migrationRetryRequired?: true;
    migrationState: "verifying_successor" | "cutover_ready";
  }) => createElement(ConnectSourcesGrid, {
    sources: [createFitbitMigrationSource(input)],
  });
  const rendered = await renderClientComponent(
    renderMigration({ migrationState: "verifying_successor" }),
    { requireButton: false },
  );

  try {
    const status = rendered.container.querySelector('[role="status"]');
    assert.ok(status);
    assert.equal(
      rendered.container.querySelectorAll('[role="status"]').length,
      1,
    );
    assert.equal(status.getAttribute("aria-live"), "polite");
    assert.equal(status.getAttribute("aria-atomic"), "true");
    assert.match(
      status.textContent ?? "",
      /new data can take a day to arrive\./u,
    );
    assert.match(status.textContent ?? "", /You can leave this page/u);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    assert.equal(mocks.routerRefresh.mock.calls.length, 1);

    await rendered.rerender(renderMigration({
      migrationRetryRequired: true,
      migrationState: "cutover_ready",
    }));
    assert.equal(rendered.container.querySelector('[role="status"]'), status);
    assert.match(
      status.textContent ?? "",
      /Murph is retrying the switch/u,
    );
    assert.match(status.textContent ?? "", /You can leave this page/u);
    assert.equal(rendered.container.querySelector('[role="alert"]'), null);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    assert.equal(mocks.routerRefresh.mock.calls.length, 2);

    const retryButton = rendered.container.querySelector(
      'button[aria-label="Retry Fitbit migration now"]',
    );
    assert.ok(retryButton instanceof rendered.window.HTMLButtonElement);
    await clickButton(rendered, retryButton);

    await vi.waitFor(() => {
      assert.match(rendered.container.textContent ?? "", /Retry requested/u);
    });
    assert.deepEqual(fetch.mock.calls[0], [
      expectedCutoverUrl,
      expectedRequestInit,
    ]);
    assert.equal(rendered.container.querySelector('[role="status"]'), status);
    assert.match(
      rendered.container.textContent ?? "",
      /Fitbit is still syncing while Murph retries the switch\./u,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Murph could not stop the legacy Fitbit connection/u,
    );
    assert.equal(mocks.routerRefresh.mock.calls.length, 3);

    const retryAgainButton = rendered.container.querySelector(
      'button[aria-label="Retry Fitbit migration now"]',
    );
    assert.ok(retryAgainButton instanceof rendered.window.HTMLButtonElement);
    await clickButton(rendered, retryAgainButton);

    await vi.waitFor(() => {
      assert.match(
        rendered.container.textContent ?? "",
        /Fitbit migration complete/u,
      );
    });
    assert.deepEqual(fetch.mock.calls, [
      [expectedCutoverUrl, expectedRequestInit],
      [expectedCutoverUrl, expectedRequestInit],
    ]);
    assert.match(
      rendered.container.textContent ?? "",
      /Fitbit now uses Google Health\. Your history is still saved\./u,
    );
    assert.equal(rendered.container.querySelector('[role="status"]'), null);
    assert.equal(
      rendered.container.querySelector(
        'button[aria-label="Retry Fitbit migration now"]',
      ),
      null,
    );
    assert.ok(
      rendered.container.querySelector('button[aria-label="Disconnect Fitbit"]'),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    assert.equal(mocks.routerRefresh.mock.calls.length, 3);
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});

function createFitbitMigrationSource(input: {
  migrationRetryRequired?: true;
  migrationState: "verifying_successor" | "cutover_ready";
}) {
  return {
    connected: true,
    description: "Fitbit and Pixel Watch sleep, activity, heart rate, and workouts.",
    disconnectConnectionId: "dsc_junction_fitbit",
    ...(input.migrationState === "cutover_ready"
      ? { disconnectSourceProviderSlug: JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG }
      : {}),
    id: "fitbit",
    logo: {
      className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
      height: 36,
      src: "/brand-logos/connect/fitbit.svg",
      width: 128,
    },
    ...input,
    name: "Fitbit",
  };
}

function configureJunction(providerFilter?: string) {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_REGION", "us");
  if (providerFilter !== undefined) {
    vi.stubEnv("JUNCTION_PROVIDER_FILTER", providerFilter);
  }
}

async function renderConnectPage() {
  return renderToStaticMarkup(await ConnectPage());
}

async function renderConnectedPage(sources: unknown[]) {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources,
  });
  return renderConnectPage();
}

async function clickButton(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  button: Element,
) {
  await act(async () => {
    button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
}
