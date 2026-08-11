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

test("HeroClocksIn renders the solo exchange without animation for reduced motion", async () => {
  const view = await renderHero({ messengerChannel: "imessage" });

  const text = view.container.textContent ?? "";
  assert.equal(view.container.querySelectorAll("h1").length, 1);
  assert.match(text, /Did the magnesium actually do anything\?/);
  assert.match(text, /Day 14 · Magnesium/);
  assert.match(
    text,
    /Two weeks in, deep sleep up 18% and HRV up 12% vs your baseline/,
  );
  assert.doesNotMatch(text, /HRV up 12 ms/);
  assert.match(text, /referees the week/);
  assert.doesNotMatch(text, /walk challenge starts tomorrow/);
  const groupHeader = [...view.container.querySelectorAll(".hero-header-layer")]
    .find((element) => element.textContent?.includes("4 People"));
  assert.ok(groupHeader);
  assert.equal(groupHeader.getAttribute("aria-hidden"), "true");
  const composer = view.container.querySelector<HTMLInputElement>(
    'input[aria-label="Message Murph"]',
  );
  const topic = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Ask Murph about Steps"]',
  );
  const member = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Start a group chat with Theo"]',
  );
  assert.ok(composer);
  assert.ok(topic);
  assert.ok(member);
  assert.ok(topic.classList.contains("text-[#756c5a]"));
  assert.ok(topic.classList.contains("focus-visible:ring-2"));
  assert.ok(member.classList.contains("text-[#736a58]"));
  const controls = [...view.container.querySelectorAll("input, button")];
  assert.ok(controls.indexOf(composer) < controls.indexOf(topic));
  assert.ok(
    view.scrollTo.mock.calls.some(
      ([options]) =>
        options?.top === Number.MAX_SAFE_INTEGER && options.behavior === "auto",
    ),
  );

  await view.cleanup();
});

test("automatic demo switches to the group after one private Murph exchange", async () => {
  vi.useFakeTimers();

  const view = await renderHero({
    messengerChannel: "imessage",
    reducedMotion: false,
    flushInitialTimers: false,
  });

  const copyLayerFor = (needle: string) =>
    [...view.container.querySelectorAll(".hero-copy-layer")].find((element) =>
      element.textContent?.includes(needle),
    );
  const soloCopyLayer = copyLayerFor("Wearables, bloodwork");
  const groupCopyLayer = copyLayerFor("Start a health challenge");
  assert.ok(soloCopyLayer);
  assert.ok(groupCopyLayer);
  assert.equal(soloCopyLayer.getAttribute("aria-hidden"), "false");
  assert.equal(groupCopyLayer.getAttribute("aria-hidden"), "true");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_500);
  });

  const privateThread = view.container.textContent ?? "";
  assert.match(privateThread, /Did the magnesium actually do anything\?/);
  assert.match(privateThread, /Two weeks in, deep sleep up 18%/);
  assert.doesNotMatch(privateThread, /DEXA|BodySpec/);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_700);
  });

  const groupThread = view.container.textContent ?? "";
  assert.match(groupThread, /4 People/);
  assert.match(groupThread, /referees the week/);
  assert.doesNotMatch(groupThread, /DEXA|BodySpec/);
  assert.doesNotMatch(groupThread, /Did the magnesium actually do anything\?/);
  assert.equal(soloCopyLayer.getAttribute("aria-hidden"), "true");
  assert.equal(groupCopyLayer.getAttribute("aria-hidden"), "false");

  await view.cleanup();
});

test("topic controls wait for Murph to finish the current reply", async () => {
  vi.useFakeTimers();

  const view = await renderHero({
    messengerChannel: "imessage",
    reducedMotion: false,
    flushInitialTimers: false,
  });

  const stepsButton = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Ask Murph about Steps"]',
  );
  assert.ok(stepsButton);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_500);
  });

  assert.equal(stepsButton.disabled, true);
  await act(async () => {
    stepsButton.click();
    await vi.advanceTimersByTimeAsync(1_900);
  });

  let thread = view.container.textContent ?? "";
  assert.match(thread, /Did the magnesium actually do anything\?/);
  assert.match(thread, /Two weeks in, deep sleep up 18%/);
  assert.doesNotMatch(thread, /How are my steps this week\?/);
  assert.equal(stepsButton.disabled, false);

  await act(async () => {
    stepsButton.click();
    await vi.advanceTimersByTimeAsync(3_200);
  });

  thread = view.container.textContent ?? "";
  assert.match(thread, /How are my steps this week\?/);
  assert.match(thread, /Average 8\.4k a day, up 600 from last week/);

  await view.cleanup();
});

test("a private composer draft cancels the automatic group handoff", async () => {
  vi.useFakeTimers();

  const view = await renderHero({
    messengerChannel: "imessage",
    reducedMotion: false,
    flushInitialTimers: false,
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_500);
  });

  const composer = view.container.querySelector<HTMLInputElement>(
    'input[aria-label="Message Murph"]',
  );
  assert.ok(composer);
  await act(async () => {
    composer.focus();
    composer.dispatchEvent(
      new view.window.Event("focusin", { bubbles: true }),
    );
    setNativeInputValue(
      view.window,
      composer,
      "Can you check my private sleep trend?",
    );
    dispatchInputValueChange(view.window, composer);
  });
  assert.equal(composer.value, "Can you check my private sleep trend?");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(8_000);
  });

  const groupHeader = [...view.container.querySelectorAll(".hero-header-layer")]
    .find((element) => element.textContent?.includes("4 People"));
  assert.ok(groupHeader);
  assert.equal(groupHeader.getAttribute("aria-hidden"), "true");
  assert.doesNotMatch(
    view.container.textContent ?? "",
    /walk challenge starts tomorrow/,
  );
  assert.equal(composer.value, "Can you check my private sleep trend?");

  const send = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Send"]',
  );
  assert.ok(send);
  await act(async () => {
    submitComposer(view.window, send);
    await vi.advanceTimersByTimeAsync(1_600);
  });

  const privateThread = view.container.textContent ?? "";
  assert.match(privateThread, /Can you check my private sleep trend\?/);
  assert.doesNotMatch(privateThread, /walk challenge starts tomorrow/);
  assert.equal(groupHeader.getAttribute("aria-hidden"), "true");

  await view.cleanup();
});

test("the private composer preempts an automatic reply with visible progress", async () => {
  vi.useFakeTimers();

  const view = await renderHero({
    messengerChannel: "imessage",
    reducedMotion: false,
    flushInitialTimers: false,
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_500);
  });

  const composer = view.container.querySelector<HTMLInputElement>(
    'input[aria-label="Message Murph"]',
  );
  assert.ok(composer);
  assert.equal(composer.disabled, false);

  await act(async () => {
    composer.focus();
    composer.dispatchEvent(
      new view.window.Event("focusin", { bubbles: true }),
    );
    setNativeInputValue(view.window, composer, "Show my latest recovery.");
    dispatchInputValueChange(view.window, composer);
  });
  const send = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Send"]',
  );
  assert.ok(send);
  await act(async () => {
    submitComposer(view.window, send);
  });

  assert.match(view.container.textContent ?? "", /Murph is replying/);
  assert.equal(composer.disabled, true);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_600);
  });

  const privateThread = view.container.textContent ?? "";
  assert.match(privateThread, /Show my latest recovery\./);
  assert.match(privateThread, /shoot me a message and we can get started/);
  assert.doesNotMatch(privateThread, /walk challenge starts tomorrow/);
  assert.equal(composer.disabled, false);

  await view.cleanup();
});

test("topic activation exposes progress and results in the conversation log", async () => {
  vi.useFakeTimers();

  const view = await renderHero({
    messengerChannel: "imessage",
    reducedMotion: false,
    flushInitialTimers: false,
  });

  const stepsButton = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Ask Murph about Steps"]',
  );
  const conversation = view.container.querySelector<HTMLDivElement>(
    '[aria-label="Private conversation with Murph"]',
  );
  const composer = view.container.querySelector<HTMLInputElement>(
    'input[aria-label="Message Murph"]',
  );
  assert.ok(stepsButton);
  assert.ok(conversation);
  assert.ok(composer);

  await act(async () => {
    stepsButton.click();
    await vi.advanceTimersByTimeAsync(1);
  });

  assert.equal(conversation.getAttribute("tabindex"), "-1");
  assert.equal(conversation.getAttribute("role"), "log");
  assert.equal(conversation.getAttribute("aria-live"), "polite");
  assert.equal(conversation.getAttribute("aria-busy"), "true");
  assert.equal(composer.disabled, true);
  assert.match(view.container.textContent ?? "", /Murph is replying/);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_200);
  });

  assert.equal(conversation.getAttribute("aria-busy"), "false");
  assert.match(
    conversation.textContent ?? "",
    /How are my steps this week\?.*Average 8\.4k a day/s,
  );
  assert.equal(composer.disabled, false);

  await view.cleanup();
});

test("the Sleep quality journey uses deep sleep from question through answer", async () => {
  vi.useFakeTimers();

  const view = await renderHero({
    messengerChannel: "imessage",
    reducedMotion: false,
    flushInitialTimers: false,
  });

  const sleepButton = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Ask Murph about Sleep quality"]',
  );
  assert.ok(sleepButton);
  await act(async () => {
    sleepButton.click();
    await vi.advanceTimersByTimeAsync(3_200);
  });

  const thread = view.container.textContent ?? "";
  assert.match(thread, /Why am I sleeping so badly this week\?/);
  assert.match(thread, /18 night deep sleep window/);
  assert.match(thread, /1h 34m.*1h 11m.*-24%/s);
  assert.match(
    thread,
    /less deep sleep after afternoon espresso: 1h 11m vs 1h 34m, down 24%/,
  );
  assert.doesNotMatch(thread, /\bHRV\b|58.*ms.*44.*ms/s);

  await view.cleanup();
});

test("topic controls render order and bloodwork artifacts in the private thread", async () => {
  vi.useFakeTimers();

  const view = await renderHero({
    messengerChannel: "imessage",
    reducedMotion: false,
    flushInitialTimers: false,
  });

  const boneDensityButton = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Ask Murph about Bone density"]',
  );
  assert.ok(boneDensityButton);
  await act(async () => {
    boneDensityButton.click();
    await vi.advanceTimersByTimeAsync(3_200);
  });

  let thread = view.container.textContent ?? "";
  assert.match(thread, /Book me a DEXA scan nearby\./);
  assert.match(thread, /Appointment booked · today/);
  assert.match(thread, /BodySpec DEXA scan/);
  assert.match(thread, /Added to your calendar/);
  assert.match(thread, /Booked BodySpec on Mission for Thursday at 2pm/);

  const ldlButton = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Ask Murph about LDL cholesterol"]',
  );
  assert.ok(ldlButton);
  await act(async () => {
    ldlButton.click();
    await vi.advanceTimersByTimeAsync(3_200);
  });

  thread = view.container.textContent ?? "";
  assert.match(thread, /Did my LDL get worse\?/);
  assert.match(thread, /Latest panel · vs March/);
  assert.match(thread, /2 flagged/);
  assert.match(thread, /108.*122.*mg\/dL/s);
  assert.match(thread, /LDL up 14 since March/);
  const groupHeader = [...view.container.querySelectorAll(".hero-header-layer")]
    .find((element) => element.textContent?.includes("4 People"));
  assert.ok(groupHeader);
  assert.equal(groupHeader.getAttribute("aria-hidden"), "true");

  await view.cleanup();
});

test("topic controls wait for Murph to finish the group kickoff reply", async () => {
  vi.useFakeTimers();

  const view = await renderHero({
    messengerChannel: "imessage",
    reducedMotion: false,
    flushInitialTimers: false,
  });

  const theoButton = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Start a group chat with Theo"]',
  );
  const saunaButton = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Ask Murph about Sauna"]',
  );
  assert.ok(theoButton);
  assert.ok(saunaButton);

  await act(async () => {
    theoButton.click();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7_000);
  });

  assert.equal(saunaButton.disabled, true);
  await act(async () => {
    saunaButton.click();
    await vi.advanceTimersByTimeAsync(1_200);
  });

  let thread = view.container.textContent ?? "";
  assert.match(thread, /walk challenge starts tomorrow/);
  assert.match(thread, /Baselines are set from everyone's wearables/);
  assert.doesNotMatch(thread, /Did the sauna actually help my HRV\?/);
  assert.equal(saunaButton.disabled, false);

  await act(async () => {
    saunaButton.click();
    await vi.advanceTimersByTimeAsync(3_200);
  });

  thread = view.container.textContent ?? "";
  assert.match(thread, /Did the sauna actually help my HRV\?/);
  assert.doesNotMatch(thread, /walk challenge starts tomorrow/);

  await view.cleanup();
});

test("an explicit member selection immediately owns the group audience", async () => {
  vi.useFakeTimers();

  const view = await renderHero({
    messengerChannel: "imessage",
    reducedMotion: false,
    flushInitialTimers: false,
  });

  const stepsButton = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Ask Murph about Steps"]',
  );
  assert.ok(stepsButton);
  await act(async () => {
    stepsButton.click();
    await vi.advanceTimersByTimeAsync(3_200);
  });

  const theoButton = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Start a group chat with Theo"]',
  );
  assert.ok(theoButton);
  await act(async () => {
    theoButton.click();
  });

  const groupConversation = view.container.querySelector<HTMLDivElement>(
    '[aria-label="Group conversation with Murph"]',
  );
  const groupComposer = view.container.querySelector<HTMLInputElement>(
    'input[aria-label="Message Murph"]',
  );
  const groupHeader = [...view.container.querySelectorAll(".hero-header-layer")]
    .find((element) => element.textContent?.includes("4 People"));
  const audienceStatus =
    view.container.querySelector<HTMLElement>('[role="status"]');
  assert.ok(groupConversation);
  assert.ok(groupComposer);
  assert.ok(groupHeader);
  assert.ok(audienceStatus);
  assert.equal(groupHeader.getAttribute("aria-hidden"), "false");
  assert.equal(groupConversation.getAttribute("role"), "log");
  assert.equal(view.window.document.activeElement, groupConversation);
  assert.equal(audienceStatus.textContent, "Group conversation selected.");
  assert.doesNotMatch(
    groupConversation.textContent ?? "",
    /How are my steps this week\?|Average 8\.4k a day/,
  );

  await act(async () => {
    groupComposer.focus();
    groupComposer.dispatchEvent(
      new view.window.Event("focusin", { bubbles: true }),
    );
    setNativeInputValue(view.window, groupComposer, "Keep this with the group.");
    dispatchInputValueChange(view.window, groupComposer);
  });
  const send = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Send"]',
  );
  assert.ok(send);
  await act(async () => {
    submitComposer(view.window, send);
    await vi.advanceTimersByTimeAsync(1_600);
  });

  assert.match(
    groupConversation.textContent ?? "",
    /Keep this with the group\./,
  );
  assert.doesNotMatch(
    groupConversation.textContent ?? "",
    /How are my steps this week\?/,
  );
  assert.equal(groupHeader.getAttribute("aria-hidden"), "false");

  await view.cleanup();
});

test("composer focus restores and announces the private audience from the automatic group", async () => {
  vi.useFakeTimers();

  const view = await renderHero({
    messengerChannel: "imessage",
    reducedMotion: false,
    flushInitialTimers: false,
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(9_000);
  });
  const groupHeader = [...view.container.querySelectorAll(".hero-header-layer")]
    .find((element) => element.textContent?.includes("4 People"));
  const composer = view.container.querySelector<HTMLInputElement>(
    'input[aria-label="Message Murph"]',
  );
  const audienceStatus =
    view.container.querySelector<HTMLElement>('[role="status"]');
  assert.ok(groupHeader);
  assert.ok(composer);
  assert.ok(audienceStatus);
  assert.equal(groupHeader.getAttribute("aria-hidden"), "false");

  await act(async () => {
    composer.focus();
    composer.dispatchEvent(
      new view.window.Event("focusin", { bubbles: true }),
    );
  });

  assert.equal(groupHeader.getAttribute("aria-hidden"), "true");
  assert.equal(audienceStatus.textContent, "Private conversation selected.");
  assert.match(
    view.container.textContent ?? "",
    /Did the magnesium actually do anything\?.*Two weeks in, deep sleep up 18%/s,
  );

  await view.cleanup();
});

test("group start clears the private 1:1 thread and topic clicks return to a fresh private thread", async () => {
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
  });
  await act(async () => {
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
  const groupConversation = view.container.querySelector<HTMLDivElement>(
    '[aria-label="Group conversation with Murph"]',
  );
  assert.ok(groupConversation);
  assert.doesNotMatch(
    view.container.textContent ?? "",
    /How are my steps this week\?/,
  );
  assert.match(view.container.textContent ?? "", /4 People/);
  assert.match(view.container.textContent ?? "", /referees the week/);

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

  // Sheet revealed: wait for Murph to finish the visible kickoff answer before
  // allowing another topic to replace the group.
  assert.equal(view.container.querySelector(".hero-compose-sheet"), null);
  assert.equal(saunaButton.disabled, true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_700);
  });
  assert.match(
    view.container.textContent ?? "",
    /Baselines are set from everyone's wearables/,
  );
  assert.equal(saunaButton.disabled, false);

  // Topic floaters remain useful, but a health topic leaves the group rather
  // than sharing private readings into that conversation.
  await act(async () => {
    saunaButton.click();
    await vi.advanceTimersByTimeAsync(3_200);
  });

  const privateThread = view.container.textContent ?? "";
  const audienceStatus =
    view.container.querySelector<HTMLElement>('[role="status"]');
  assert.ok(audienceStatus);
  assert.match(privateThread, /Did the sauna actually help my HRV\?/);
  assert.match(
    privateThread,
    /Sauna nights show \+9 ms HRV vs non-sauna nights/,
  );
  assert.equal(audienceStatus.textContent, "Private conversation selected.");
  assert.doesNotMatch(privateThread, /Walk challenge · Day 5 of 7/);
  assert.doesNotMatch(privateThread, /Standings, day 5 of 7/);
  const activeGroupHeader = [...view.container.querySelectorAll(".hero-header-layer")]
    .find((element) => element.textContent?.includes("4 People"));
  assert.ok(activeGroupHeader);
  assert.equal(activeGroupHeader.getAttribute("aria-hidden"), "true");

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
  const { cleanup: cleanupGlobals, scrollTo } = installGlobals(
    window,
    document,
    { reducedMotion },
  );
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
    scrollTo,
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
  const scrollTo = vi.fn();
  Object.defineProperty(window.HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
  const originalFocusDescriptor = Object.getOwnPropertyDescriptor(
    window.HTMLElement.prototype,
    "focus",
  );
  const originalActiveElementDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "activeElement",
  );
  // LinkeDOM can deadlock React's act queue when a focused control is disabled
  // during the same commit that moves focus. Keep the observable focus contract
  // while avoiding that DOM-emulator behavior.
  Object.defineProperty(document, "activeElement", {
    configurable: true,
    value: document.body,
  });
  Object.defineProperty(window.HTMLElement.prototype, "focus", {
    configurable: true,
    value(this: HTMLElement) {
      Object.defineProperty(document, "activeElement", {
        configurable: true,
        value: this,
      });
    },
  });
  // React's legacy input-event fallback probes these IE hooks when LinkeDOM
  // does not advertise native input-event support.
  Object.defineProperty(window.HTMLElement.prototype, "attachEvent", {
    configurable: true,
    value(
      this: HTMLElement,
      eventName: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      this.addEventListener(eventName.replace(/^on/u, ""), listener);
    },
  });
  Object.defineProperty(window.HTMLElement.prototype, "detachEvent", {
    configurable: true,
    value(
      this: HTMLElement,
      eventName: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      this.removeEventListener(eventName.replace(/^on/u, ""), listener);
    },
  });

  const restoreEntries = [
    () => {
      if (originalFocusDescriptor) {
        Object.defineProperty(
          window.HTMLElement.prototype,
          "focus",
          originalFocusDescriptor,
        );
      } else {
        Reflect.deleteProperty(window.HTMLElement.prototype, "focus");
      }
      if (originalActiveElementDescriptor) {
        Object.defineProperty(
          document,
          "activeElement",
          originalActiveElementDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "activeElement");
      }
    },
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

  return {
    cleanup: () => {
      for (const restore of restoreEntries.reverse()) {
        restore();
      }
    },
    scrollTo,
  };
}

function setNativeInputValue(
  window: Window & typeof globalThis,
  input: HTMLInputElement,
  value: string,
) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  assert.ok(setter);
  setter.call(input, value);
}

function dispatchInputValueChange(
  window: Window & typeof globalThis,
  input: HTMLInputElement,
) {
  const event = new window.Event("propertychange", { bubbles: true });
  Object.defineProperty(event, "propertyName", {
    configurable: true,
    value: "value",
  });
  input.dispatchEvent(event);
}

function submitComposer(
  window: Window & typeof globalThis,
  send: HTMLButtonElement,
) {
  const form = send.closest("form");
  assert.ok(form);
  form.dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
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
