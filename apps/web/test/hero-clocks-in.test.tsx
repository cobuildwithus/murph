import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";

import {
  HeroClocksIn,
  type HeroMessengerChannel,
} from "@/src/components/homepage/hero-clocks-in";
import { DEFAULT_MURPH_HEADSHOT } from "@/src/components/homepage/murph-headshot-avatar";

vi.mock("@/app/auth-controls", () => ({
  LandingAuthActions(props: {
    authenticated: boolean;
    authLabel: string;
    context: "nav" | "hero" | "footer";
    leadingIcon?: ReactNode;
    preloadAuthPanel?: boolean;
  }) {
    return createElement(
      "div",
      {
        "data-authenticated": String(props.authenticated),
        "data-context": props.context,
        "data-label": props.authLabel,
        "data-preload": String(props.preloadAuthPanel ?? false),
      },
      props.leadingIcon,
      "Landing auth actions",
    );
  },
  LandingAuthDialogButton(props: {
    buttonClassName?: string;
    buttonLabel: string;
  }) {
    return createElement(
      "button",
      {
        className: props.buttonClassName,
        type: "button",
      },
      props.buttonLabel,
    );
  },
}));

const activeCleanups = new Set<() => void | Promise<void>>();
const requireFromHeroTest = createRequire(import.meta.url);
const { parseHTML } = loadLinkedom();

afterEach(async () => {
  for (const cleanup of [...activeCleanups].reverse()) {
    await cleanup();
  }
  activeCleanups.clear();
  vi.useRealTimers();
});

test("HeroClocksIn renders the reduced-motion group seed", async () => {
  const view = await renderHero({ messengerChannel: "imessage" });

  const text = view.container.textContent ?? "";
  assert.equal(view.container.querySelectorAll("h1").length, 1);
  assert.match(text, /walk challenge starts tomorrow\. loser buys steak dinner/);
  assert.match(text, /Baselines are set from everyone's wearables/);
  assert.match(text, /Saturday 9:02 AM/);
  assert.match(text, /no shot you guys are keeping up with me this week/);
  assert.match(text, /Walk challenge · Day 5 of 7/);
  assert.match(text, /Standings, day 5 of 7\. Maya is one sunrise walk/);
  assert.match(text, /Weekly newsletter · Sunday 8:02 AM/);
  assert.match(text, /Your crew: week 3 in health/);
  assert.match(text, /4 People/);
  assert.match(text, /Murph keeps score\./);
  assert.equal(
    view.container.querySelector(
      'button[aria-label="Start a group chat with Theo"]',
    ),
    null,
  );

  await view.cleanup();
});

test("group start clears the private 1:1 thread and topic clicks during group mode keep scheduled group beats", async () => {
  vi.useFakeTimers();

  const view = await renderHero({
    messengerChannel: "imessage",
    reducedMotion: false,
    flushInitialTimers: false,
  });

  // Play a private exchange first so the thread holds personal health talk.
  const stepsButton = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Ask Murph about Steps"]',
  );
  assert.ok(stepsButton);
  await act(async () => {
    stepsButton.click();
    await vi.advanceTimersByTimeAsync(3_200);
  });
  assert.match(view.container.textContent ?? "", /How are my steps this week\?/);

  const theoButton = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Start a group chat with Theo"]',
  );
  assert.ok(theoButton);

  await act(async () => {
    theoButton.click();
    await vi.advanceTimersByTimeAsync(950);
  });

  assert.match(view.container.textContent ?? "", /New Message/);
  assert.match(view.container.textContent ?? "", /To:/);
  assert.equal(
    view.container.querySelectorAll("[data-hero-recipient-chip]").length,
    1,
  );
  assert.ok(
    view.container.querySelector('[data-hero-recipient-chip="Murph"]'),
  );

  // The sheet is a decorative stage prop: hidden from assistive tech, with
  // no operable controls inside.
  const sheet = view.container.querySelector(".hero-compose-sheet");
  assert.ok(sheet);
  assert.equal(sheet.getAttribute("aria-hidden"), "true");
  assert.equal(sheet.querySelectorAll("button").length, 0);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(750);
  });

  // The group is a fresh conversation: the private exchange must be gone.
  assert.doesNotMatch(
    view.container.textContent ?? "",
    /How are my steps this week\?/,
  );
  assert.match(view.container.textContent ?? "", /4 People/);
  assert.match(view.container.textContent ?? "", /Murph keeps score\./);

  // While the sheet covers the thread, every floater is inert so no topic
  // exchange can pollute the fresh conversation before the reveal.
  const saunaButton = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Ask Murph about Sauna"]',
  );
  assert.ok(saunaButton);
  assert.equal(saunaButton.disabled, true);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_900);
  });

  // Mid-burst all three member flights animate concurrently.
  assert.equal(
    view.container.querySelectorAll(".hero-floater--active").length,
    3,
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_500);
  });

  assert.ok(
    view.container.querySelector('[data-hero-recipient-chip="Theo"]'),
  );
  assert.ok(
    view.container.querySelector('[data-hero-recipient-chip="Maya"]'),
  );
  assert.ok(
    view.container.querySelector('[data-hero-recipient-chip="Sam"]'),
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_300);
  });

  // Sheet revealed: topic floaters work again and interleave into the story.
  assert.equal(view.container.querySelector(".hero-compose-sheet"), null);
  assert.equal(saunaButton.disabled, false);
  await act(async () => {
    saunaButton.click();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(14_000);
  });

  assert.match(view.container.textContent ?? "", /Walk challenge · Day 5 of 7/);

  await view.cleanup();
});

async function renderHero({
  messengerChannel,
  reducedMotion = true,
  flushInitialTimers = true,
}: {
  messengerChannel: HeroMessengerChannel;
  reducedMotion?: boolean;
  flushInitialTimers?: boolean;
}) {
  const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const cleanupGlobals = installGlobals(window, document, { reducedMotion });
  activeCleanups.add(cleanupGlobals);
  const container = document.getElementById("root");
  assert.ok(container);

  let root: Root | null = createRoot(container);

  await act(async () => {
    root?.render(
      createElement(HeroClocksIn, {
        authenticated: false,
        contactInfo: {
          phone: "+15555550100",
          telegram: "murph_test_bot",
        },
        messengerChannel,
        murphHeadshotSrc: DEFAULT_MURPH_HEADSHOT,
      }),
    );
  });
  if (flushInitialTimers) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  return {
    cleanup: async () => {
      await act(async () => {
        root?.unmount();
        root = null;
      });
      cleanupGlobals();
      activeCleanups.delete(cleanupGlobals);
    },
    container,
    window,
  };
}

function installGlobals(
  window: Window & typeof globalThis,
  document: Document,
  { reducedMotion }: { reducedMotion: boolean },
) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  const matchMedia: typeof window.matchMedia = (query) => ({
    matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
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

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: matchMedia,
  });
  Object.defineProperty(window.HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value() {},
  });

  const restoreEntries = [
    setGlobal("window", window),
    setGlobal("self", window),
    setGlobal("document", document),
    setGlobal("navigator", window.navigator),
    setGlobal("HTMLElement", window.HTMLElement),
    setGlobal("Node", window.Node),
    setGlobal("Event", window.Event),
    setGlobal("MouseEvent", window.MouseEvent),
    setGlobal("MutationObserver", window.MutationObserver),
    setGlobal("ResizeObserver", ResizeObserverMock),
    setGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }),
    setGlobal("cancelAnimationFrame", () => {}),
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true),
  ];

  return () => {
    for (const restore of restoreEntries.reverse()) {
      restore();
    }
  };
}

function setGlobal(key: string, value: unknown) {
  const hadOwnProperty = Object.prototype.hasOwnProperty.call(globalThis, key);
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, key);

  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });

  return () => {
    if (hadOwnProperty && previousDescriptor) {
      Object.defineProperty(globalThis, key, previousDescriptor);
      return;
    }
    Reflect.deleteProperty(globalThis, key);
  };
}

function loadLinkedom(): {
  parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
} {
  const resolvePaths = [
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "node_modules/.pnpm/node_modules"),
  ];

  for (const resolvePath of resolvePaths) {
    try {
      const resolvedEntry = requireFromHeroTest.resolve("linkedom", {
        paths: [resolvePath],
      });
      return requireFromHeroTest(resolvedEntry) as {
        parseHTML: (html: string) => {
          document: Document;
          window: Window & typeof globalThis;
        };
      };
    } catch {
      // Try the next resolution root.
    }
  }

  throw new Error("Unable to resolve linkedom for hero tests.");
}
