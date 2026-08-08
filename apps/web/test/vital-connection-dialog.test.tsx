import assert from "node:assert/strict";
import type { HTMLAttributes, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

vi.mock("@/src/components/ui/button", () => ({
  Button: ({ children }: { children?: ReactNode }) =>
    createElement("button", null, children),
  buttonVariants: () => "",
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children?: ReactNode; open: boolean }) =>
    open ? createElement("div", null, children) : null,
  DialogContent: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props, children),
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

test("Vital handoff explains the processor boundary for a standard source", async () => {
  const { VitalConnectionDialog } = await import(
    "../app/(dashboard)/connect/connect-page-dialogs"
  );
  const markup = renderToStaticMarkup(
    createElement(VitalConnectionDialog, {
      onContinue: vi.fn(),
      onOpenChange: vi.fn(),
      source: { id: "fitbit", name: "Fitbit" },
    }),
  );

  assert.match(markup, /Vital connects Fitbit to Murph/u);
  assert.match(markup, /may say Vital/u);
  assert.match(markup, /processes the data you approve/u);
  assert.match(markup, /does not allow Vital to sell it/u);
  assert.match(markup, /model training/u);
  assert.match(markup, /Disconnect anytime/u);
  assert.match(markup, />Continue to Fitbit<\/button>/u);
  assert.doesNotMatch(markup, /Turn on Historical Data/u);
});

test("Vital handoff keeps Garmin's first-connect Historical Data reminder", async () => {
  const { VitalConnectionDialog } = await import(
    "../app/(dashboard)/connect/connect-page-dialogs"
  );
  const markup = renderToStaticMarkup(
    createElement(VitalConnectionDialog, {
      onContinue: vi.fn(),
      onOpenChange: vi.fn(),
      source: { id: "garmin", name: "Garmin" },
      voiceMemoSrc: "/test/garmin-history.mp3",
    }),
  );

  assert.match(markup, /Vital connects Garmin to Murph/u);
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
      source: { id: "garmin", name: "Garmin", requiresReconnect: true },
    }),
  );

  assert.match(markup, /Vital connects Garmin to Murph/u);
  assert.doesNotMatch(markup, /Turn on Historical Data/u);
  assert.doesNotMatch(markup, /Garmin Historical Data reminder/u);
});
