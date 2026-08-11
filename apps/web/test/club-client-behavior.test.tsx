import assert from "node:assert/strict";

import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/homepage/phone-mock", async () => {
  const { createElement: createMockElement } = await import("react");

  return {
    PhoneMock: ({
      messages,
      result,
      resultPlacement,
    }: {
      messages: ReadonlyArray<{ text: string }>;
      result?: { eyebrow: string };
      resultPlacement?: "after" | "before";
    }) =>
      createMockElement(
        "div",
        {
          "data-phone-message-count": String(messages.length),
          "data-phone-result": result?.eyebrow ?? "",
          "data-phone-result-placement": resultPlacement ?? "before",
        },
        messages.map((message) => message.text).join(" "),
      ),
  };
});

import { ClubChallengeModes } from "../src/components/clubs/club-challenge-modes";
import { ClubPhoneDemo } from "../src/components/clubs/club-phone-demo";

const reducedMotionMatchMedia: typeof window.matchMedia = (query) => ({
  matches: query === "(prefers-reduced-motion: reduce)",
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() {
    return false;
  },
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("clubs client behavior", () => {
  it("keeps one challenge mode pressed and swaps the corresponding preview", async () => {
    const rendered = await renderClientComponent(
      createElement(ClubChallengeModes),
    );

    try {
      const modes = [
        { label: "All together", preview: "6,842" },
        { label: "Team vs. team", preview: "Three crews. One month." },
        { label: "Head to head", preview: "The finish is getting close." },
      ] as const;

      for (const mode of modes) {
        const button = [...rendered.container.querySelectorAll("button")].find(
          (candidate) => candidate.textContent?.includes(mode.label),
        );
        assert.ok(button instanceof rendered.window.HTMLButtonElement);

        await act(async () => {
          button.click();
        });

        const pressedButtons = [
          ...rendered.container.querySelectorAll('button[aria-pressed="true"]'),
        ];
        expect(pressedButtons).toHaveLength(1);
        expect(pressedButtons[0]?.textContent).toContain(mode.label);
        expect(rendered.container.textContent).toContain(mode.preview);
      }

      const portraitStyles = [
        ...rendered.container.querySelectorAll<HTMLElement>(
          '[aria-hidden="true"][style*="/personas/"]',
        ),
      ].map((portrait) => portrait.getAttribute("style"));
      expect(portraitStyles).toHaveLength(3);
      expect(portraitStyles).toEqual(
        expect.arrayContaining([
          expect.stringContaining("/personas/athlete.jpg"),
          expect.stringContaining("/personas/founder.jpg"),
          expect.stringContaining("/personas/sleeper.jpg"),
        ]),
      );
    } finally {
      await rendered.cleanup();
    }
  });

  it("keeps the complete phone result stable for reduced-motion users", async () => {
    vi.useFakeTimers();

    const rendered = await renderClientComponent(
      createElement(ClubPhoneDemo, {
        murphHeadshotSrc: "/murph-headshots/murph-headshot-01-avatar.avif",
      }),
      {
        matchMedia: reducedMotionMatchMedia,
        requireButton: false,
      },
    );

    try {
      const phone = rendered.container.querySelector(
        "[data-phone-message-count]",
      );
      assert.ok(phone);
      expect(phone.getAttribute("data-phone-message-count")).toBe("4");
      expect(phone.getAttribute("data-phone-result")).toBe(
        "ATL moves together",
      );
      expect(phone.getAttribute("data-phone-result-placement")).toBe("after");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(phone.getAttribute("data-phone-message-count")).toBe("4");
      expect(phone.getAttribute("data-phone-result")).toBe(
        "ATL moves together",
      );
      expect(phone.getAttribute("data-phone-result-placement")).toBe("after");
    } finally {
      await rendered.cleanup();
    }
  });
});
