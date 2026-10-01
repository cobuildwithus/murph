import assert from "node:assert/strict";
import { act, createElement } from "react";
import { test, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { JournalView } from "@murphai/query/browser-overview";
import { JournalViewContent } from "../src/components/journal/journal-view";
import { renderClientComponent } from "./render-client-component";

const journal: JournalView = {
  days: [
    { date: "2026-08-12", events: [] },
    { date: "2026-07-01", events: [] },
  ],
  eventCount: 0,
  recordCount: 0,
  weeks: [],
  windowDays: 120,
};

const matchMedia: typeof window.matchMedia = (media) => ({
  media, matches: false, onchange: null,
  addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {}, dispatchEvent: () => false,
});

test("Journal follows the local day until a historical window is selected", async () => {
  const view = (asOfDate: string) => createElement(JournalViewContent, { asOfDate, journal });
  const rendered = await renderClientComponent(view("2026-08-12"), { matchMedia });
  const firstDay = () => rendered.container.querySelector('[id^="journal-day-"]')?.id;
  const click = async (label: string) => {
    const button = rendered.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    assert.ok(button);
    await act(async () => button.click());
  };
  try {
    await rendered.rerender(view("2026-08-13"));
    assert.equal(firstDay(), "journal-day-2026-08-13");
    await click("Previous 7 days");
    assert.equal(firstDay(), "journal-day-2026-08-06");
    await rendered.rerender(view("2026-08-14"));
    assert.equal(firstDay(), "journal-day-2026-08-06");
    const today = Array.from(rendered.container.querySelectorAll("button")).find((button) => button.textContent === "Today");
    assert.ok(today);
    await act(async () => today.click());
    await rendered.rerender(view("2026-08-15"));
    assert.equal(firstDay(), "journal-day-2026-08-15");
    // A local date can also move backward when the browser replaces the UTC snapshot.
    await rendered.rerender(view("2026-08-14"));
    assert.equal(firstDay(), "journal-day-2026-08-14");
    await click("Previous 7 days");
    await click("Next 7 days");
    await rendered.rerender(view("2026-08-15"));
    assert.equal(firstDay(), "journal-day-2026-08-15");
  } finally { await rendered.cleanup(); }
});

test("an empty Journal announces its background refresh without hiding onboarding", async () => {
  const rendered = await renderClientComponent(createElement(JournalViewContent, {
    asOfDate: "2026-08-12", journal: { ...journal, days: [] }, isRefreshing: true,
  }), { matchMedia, requireButton: false });
  try {
    assert.ok(rendered.container.querySelector('[role="status"][aria-label="Updating latest data"]'));
    assert.match(rendered.container.textContent ?? "", /Build your health timeline/);
    assert.equal(rendered.container.querySelector('[aria-label="Previous 7 days"]'), null);
  } finally { await rendered.cleanup(); }
});

test("the Journal calendar exposes its selected end date separately from today", async () => {
  const rendered = await renderClientComponent(createElement(JournalViewContent, { asOfDate: "2026-08-12", journal }), { matchMedia });
  try {
    const selected = rendered.container.querySelector<HTMLButtonElement>('button[aria-label="Monday, August 10, 2026"]');
    assert.ok(selected);
    await act(async () => selected.click());
    assert.equal(selected.getAttribute("aria-pressed"), "true");
    const today = rendered.container.querySelector('button[aria-current="date"]');
    assert.equal(today?.getAttribute("aria-pressed"), "false");
    assert.match(rendered.container.textContent ?? "", /Aug 4–10/);
  } finally { await rendered.cleanup(); }
});


test("Journal replaces the server UTC date with the browser local day during hydration", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-13T01:00:00.000Z"));
  const localYear = vi.spyOn(Date.prototype, "getFullYear").mockReturnValue(2026);
  const localMonth = vi.spyOn(Date.prototype, "getMonth").mockReturnValue(7);
  const localDay = vi.spyOn(Date.prototype, "getDate").mockReturnValue(12);
  try {
    const element = createElement(JournalViewContent, { journal });
    const markup = renderToString(element);
    assert.match(markup, /journal-day-2026-08-13/);
    const onRecoverableError = vi.fn();
    const rendered = await renderClientComponent(element, {
      matchMedia,
      hydrateFrom: { markup, onRecoverableError },
    });
    try {
      assert.equal(rendered.container.querySelector('[id^="journal-day-"]')?.id, "journal-day-2026-08-12");
      assert.equal(onRecoverableError.mock.calls.length, 0);
      assert.equal(rendered.container.querySelector<HTMLButtonElement>('[aria-label="Next 7 days"]')?.disabled, true);
    } finally { await rendered.cleanup(); }
  } finally {
    localYear.mockRestore();
    localMonth.mockRestore();
    localDay.mockRestore();
    vi.useRealTimers();
  }
});
