import assert from "node:assert/strict";
import type { HTMLAttributes, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

vi.mock("@/src/components/ui/button", () => ({
  Button: ({
    children,
    size: _size,
    ...props
  }: HTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    size?: string;
  }) => {
    void _size;
    return createElement("button", props, children);
  },
  buttonVariants: () => "",
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children?: ReactNode; open: boolean }) =>
    open ? createElement("div", null, children) : null,
  DialogContent: ({
    children,
    finalFocus: _finalFocus,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { finalFocus?: boolean }) => {
    void _finalFocus;
    return createElement("div", props, children);
  },
  DialogDescription: ({
    children,
    ...props
  }: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props, children),
  DialogHeader: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props, children),
  DialogTitle: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) =>
    createElement("h2", props, children),
}));

vi.mock("@/src/components/ui/voice-memo-player", () => ({
  VoiceMemoPlayer: ({
    accessibleLabel,
    src,
  }: {
    accessibleLabel: string;
    src: string;
  }) =>
    createElement("div", { "aria-label": accessibleLabel, "data-src": src }),
}));

test("Vital handoff leads with the connection and credits Vital underneath", async () => {
  const { VitalConnectionDialog } = await import(
    "../app/(dashboard)/connect/connect-page-dialogs"
  );
  const markup = renderToStaticMarkup(
    createElement(VitalConnectionDialog, {
      onContinue: vi.fn(),
      onOpenChange: vi.fn(),
      source: {
        id: "fitbit",
        logo: {
          className: "size-11 object-contain",
          height: 44,
          src: "/brand-logos/connect/fitbit.svg",
          width: 44,
        },
        name: "Fitbit",
      },
    }),
  );

  assert.match(markup, /Connect Fitbit to Murph/u);
  assert.match(markup, /brand-logos\/connect\/fitbit\.svg/u);
  assert.match(markup, /icons\/murph-mark\.svg/u);
  assert.doesNotMatch(markup, /src="\/logo\.svg"/u);
  assert.match(
    markup,
    /We use <a href="https:\/\/www\.junction\.com"[^>]*>Vital<\/a> to connect this health source to Murph\./u,
  );
  assert.match(markup, /max-h-10/u);
  assert.match(markup, /max-w-24/u);
  assert.match(markup, /whitespace-normal/u);
  assert.match(markup, />Continue to Fitbit<\/button>/u);
  assert.doesNotMatch(markup, /Turn on Historical Data/u);
});

test("Vital handoff preserves wide logos and lets long actions wrap", async () => {
  const { VitalConnectionDialog } = await import(
    "../app/(dashboard)/connect/connect-page-dialogs"
  );
  const wideMarkup = renderToStaticMarkup(
    createElement(VitalConnectionDialog, {
      onContinue: vi.fn(),
      onOpenChange: vi.fn(),
      source: {
        id: "runkeeper",
        logo: {
          className:
            "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
          height: 20,
          src: "/brand-logos/connect/runkeeper.svg",
          width: 132,
        },
        name: "Runkeeper",
      },
    }),
  );
  const longActionMarkup = renderToStaticMarkup(
    createElement(VitalConnectionDialog, {
      onContinue: vi.fn(),
      onOpenChange: vi.fn(),
      source: {
        id: "dexcom-g6-and-older",
        logo: {
          className: "size-11 object-contain",
          height: 44,
          src: "/brand-logos/connect/dexcom-g6-and-older.png",
          width: 44,
        },
        name: "Dexcom (G6 and older)",
      },
    }),
  );

  assert.match(wideMarkup, /width="132"/u);
  assert.match(wideMarkup, /max-w-24/u);
  assert.match(longActionMarkup, /min-h-14/u);
  assert.match(longActionMarkup, /whitespace-normal/u);
  assert.match(
    longActionMarkup,
    />Continue to Dexcom \(G6 and older\)<\/button>/u,
  );
});

test("Vital handoff keeps Garmin's first-connect Historical Data reminder", async () => {
  const { VitalConnectionDialog } = await import(
    "../app/(dashboard)/connect/connect-page-dialogs"
  );
  const markup = renderToStaticMarkup(
    createElement(VitalConnectionDialog, {
      onContinue: vi.fn(),
      onOpenChange: vi.fn(),
      source: {
        id: "garmin",
        logo: {
          className: "size-11 object-contain",
          height: 44,
          src: "/brand-logos/connect/garmin.png",
          width: 44,
        },
        name: "Garmin",
      },
      voiceMemoSrc: "/test/garmin-history.mp3",
    }),
  );

  assert.match(markup, /Connect Garmin to Murph/u);
  assert.match(markup, /Turn on Historical Data/u);
  assert.match(
    markup,
    /When Garmin opens, turn on Historical Data before approving/u,
  );
  assert.match(markup, /data-src="\/test\/garmin-history\.mp3"/u);
  assert.match(markup, />Continue to Garmin<\/button>/u);
});

test("Vital handoff omits Garmin's Historical Data reminder during reconnect", async () => {
  const { VitalConnectionDialog } = await import(
    "../app/(dashboard)/connect/connect-page-dialogs"
  );
  const markup = renderToStaticMarkup(
    createElement(VitalConnectionDialog, {
      onContinue: vi.fn(),
      onOpenChange: vi.fn(),
      source: {
        id: "garmin",
        logo: {
          className: "size-11 object-contain",
          height: 44,
          src: "/brand-logos/connect/garmin.png",
          width: 44,
        },
        name: "Garmin",
        requiresReconnect: true,
      },
    }),
  );

  assert.match(markup, /Connect Garmin to Murph/u);
  assert.doesNotMatch(markup, /Turn on Historical Data/u);
  assert.doesNotMatch(markup, /Garmin Historical Data reminder/u);
});

test("Dexcom disconnect warns that reconnect is not available", async () => {
  const { ConnectDisconnectDialog } = await import(
    "../app/(dashboard)/connect/connect-page-dialogs"
  );
  const markup = renderToStaticMarkup(
    createElement(ConnectDisconnectDialog, {
      errorMessage: null,
      onConfirm: vi.fn(),
      onOpenChange: vi.fn(),
      pending: false,
      source: {
        connectionAvailable: false,
        connected: true,
        description: "CGM glucose readings and trends.",
        disconnectConnectionId: "dsc_dexcom_existing",
        disconnectScope: "junction_account",
        id: "dexcom",
        logo: {
          className: "size-11 object-contain",
          height: 44,
          src: "/brand-logos/connect/dexcom.png",
          width: 44,
        },
        name: "Dexcom",
      },
    }),
  );

  assert.match(markup, /Disconnect account\?/u);
  assert.match(
    markup,
    /Your history is kept\. You won&#x27;t be able to reconnect Dexcom yet\./u,
  );
  assert.match(markup, />Disconnect<\/button>/u);
  assert.match(markup, />Cancel<\/button>/u);
});
