import { existsSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

import { LinkPageVeil, releaseLinkPageVeil } from "@/src/components/link-page/link-page-veil";
import { resolveConnectLogoSrc } from "@/src/lib/device-sync/connect-logos";

const CLAIM = `dc_${"a".repeat(32)}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

function runVeil(location: { hash?: string; pathname: string; search?: string }) {
  const script = renderToStaticMarkup(createElement(LinkPageVeil))
    .replace(/^<script>/u, "")
    .replace(/<\/script>$/u, "")
    .replaceAll("&quot;", "\"")
    .replaceAll("&amp;", "&");
  const appended: Array<{ id: string; remove: () => void; textContent: string }> = [];
  const timers: Array<() => void> = [];
  const documentStub = {
    createElement: () => ({ id: "", remove: vi.fn(), textContent: "" }),
    head: { appendChild: (node: (typeof appended)[number]) => appended.push(node) },
  };

  new Function("document", "location", "setTimeout", script)(
    documentStub,
    { hash: "", search: "", ...location },
    (callback: () => void) => timers.push(callback),
  );

  return { appended, timers };
}

test.each([
  ["a wearable link", { hash: `#deviceConnectIntent=${CLAIM}&connectSource=oura`, pathname: "/connect" }],
  ["a wearable result", { pathname: "/settings", search: "?deviceSyncCompletion=1&connectSource=oura" }],
  ["an app result", { pathname: "/settings", search: "?connectedAppCompletion=1&toolkit=gmail" }],
])("hides the dashboard frame for %s, and lifts on its own", (_label, location) => {
  const { appended, timers } = runVeil(location);

  expect(appended).toHaveLength(1);
  expect(appended[0]?.textContent).toContain("visibility:hidden");
  expect(timers).toHaveLength(1);

  timers[0]?.();
  expect(appended[0]?.remove).toHaveBeenCalledOnce();
});

test.each([
  ["the ordinary hub", { pathname: "/connect" }],
  ["a source card", { hash: "#oura", pathname: "/connect" }],
  ["a malformed claim", { hash: "#deviceConnectIntent=nope&connectSource=oura", pathname: "/connect" }],
  ["plain Home", { pathname: "/home" }],
  ["a claim on another page", { hash: `#deviceConnectIntent=${CLAIM}`, pathname: "/settings" }],
])("leaves %s alone", (_label, location) => {
  expect(runVeil(location).appended).toHaveLength(0);
});

test("releasing the veil removes it, and does nothing when there is none", () => {
  const remove = vi.fn();
  vi.stubGlobal("document", {
    getElementById: vi.fn()
      .mockReturnValueOnce({ remove })
      .mockReturnValueOnce(null),
  });

  releaseLinkPageVeil();
  releaseLinkPageVeil();

  expect(remove).toHaveBeenCalledOnce();
});

test.each([
  ["oura", "/brand-logos/connect/oura.png"],
  ["WHOOP", "/brand-logos/connect/whoop.svg"],
  ["gmail", "/brand-logos/connect/gmail.svg"],
  ["googlecalendar", "/brand-logos/connect/google-calendar.svg"],
])("finds the logo for %s on disk", (id, src) => {
  expect(resolveConnectLogoSrc(id)).toBe(src);
  expect(existsSync(path.join(__dirname, "..", "public", src))).toBe(true);
});

test.each(["outlook", "junction", "", null])(
  "falls back when %s has no logo",
  (id) => {
    expect(resolveConnectLogoSrc(id)).toBeNull();
  },
);

test("a link page steps aside while consent is showing", async () => {
  const { LinkPageTakeover, LinkPageTakeoverHold } = await import(
    "@/src/components/link-page/link-page-takeover"
  );

  const markup = renderToStaticMarkup(
    <LinkPageTakeoverHold held>
      <LinkPageTakeover label="Connect Oura">Link page</LinkPageTakeover>
    </LinkPageTakeoverHold>,
  );

  expect(markup).toBe("");
});
