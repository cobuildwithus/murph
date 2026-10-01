import { act, createElement, useState, type ReactElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { AuthContext } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { renderClientComponent } from "./render-client-component";

const publicOption = { href: "sms:+15550100001", kind: "text" as const, label: "Messages" };
const privateOption = { href: "sms:+15550100002", kind: "text" as const, label: "Messages" };

function signedIn(children: ReactElement, unavailable = false) {
  return createElement(AuthContext.Provider, {
    value: {
      authenticated: !unavailable,
      authenticationStatus: unavailable ? "unavailable" : "ready",
      openAuthDialog: vi.fn(), prepareAuth: vi.fn(), shared: false,
    },
  }, children);
}

function contactResponse(option = privateOption) {
  return new Response(JSON.stringify({ option }), {
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

test.each(["click", "Enter"])("member composer %s opens the assigned line and keeps the draft off the network", async (action) => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(contactResponse());
  vi.stubGlobal("fetch", fetchMock);
  const rendered = await renderClientComponent(<div />, { requireButton: false });
  const { GoalComposer } = await import("@/src/components/goals/goal-composer");
  function Composer() {
    const [query, setQuery] = useState("build a walking habit");
    return <GoalComposer onQueryChange={setQuery} placeholders={[]} query={query} startOption={publicOption} />;
  }
  try {
    await rendered.rerender(signedIn(<Composer />));
    expect(fetchMock).not.toHaveBeenCalled();
    const input = rendered.container.querySelector("input")!;
    const send = rendered.container.querySelector<HTMLButtonElement>("[data-goal-composer-send]")!;
    await act(async () => {
      if (action === "click") send.click();
      else {
        // LinkeDOM selects React’s legacy input-event fallback, as in hero-clocks-in.
        Object.defineProperties(input, {
          attachEvent: { value: (name: string, listener: EventListener) => input.addEventListener(name.slice(2), listener) },
          detachEvent: { value: (name: string, listener: EventListener) => input.removeEventListener(name.slice(2), listener) },
        });
        input.focus();
        input.dispatchEvent(new rendered.window.Event("focusin", { bubbles: true }));
        const event = new rendered.window.Event("keydown", { bubbles: true });
        Object.defineProperty(event, "key", { value: "Enter" });
        input.dispatchEvent(event);
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/goals/contact", expect.objectContaining({ method: "POST", body: "{}", cache: "no-store", credentials: "same-origin" }),
    ]);
    expect(rendered.assign).toHaveBeenCalledWith(`sms:+15550100002?body=${encodeURIComponent("Hey Murph, help me build a walking habit")}`);
    expect(input.value).toBe("build a walking habit");
  } finally { await rendered.cleanup(); }
});

test("member homepage card resolves the private chat with its selected prompt", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(contactResponse());
  vi.stubGlobal("fetch", fetchMock);
  const rendered = await renderClientComponent(<div />, { requireButton: false });
  const { GoalsSection } = await import("@/src/components/homepage/goals-section");
  try {
    await rendered.rerender(signedIn(<GoalsSection personas={[{
      id: "feel-better", label: "Just feel better", goals: [{
        href: "/goals/walk-every-day", phrase: "walk every day", illustrationSrc: null,
      }],
    }]} startOption={publicOption} totalGoalCount={1} />));
    const card = rendered.container.querySelector<HTMLButtonElement>("li button")!;
    await act(async () => card.click());
    expect(rendered.assign).toHaveBeenCalledWith(`sms:+15550100002?body=${encodeURIComponent("Hey Murph, help me walk every day")}`);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe("{}");
  } finally { await rendered.cleanup(); }
});

test("private resolution failure permits retry without falling back to the public number", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValueOnce(contactResponse());
  vi.stubGlobal("fetch", fetchMock);
  const { GoalComposer } = await import("@/src/components/goals/goal-composer");
  const rendered = await renderClientComponent(signedIn(
    <GoalComposer onQueryChange={() => {}} placeholders={[]} query="walk every day" startOption={publicOption} />,
    true,
  ));
  try {
    await act(async () => rendered.button.click());
    expect(rendered.assign).not.toHaveBeenCalled();
    expect(rendered.container.textContent).toContain("Couldn’t open your Murph chat. Try again.");
    expect(rendered.container.querySelector('a[href^="sms:"]')).toBeNull();
    await act(async () => rendered.button.click());
    expect(rendered.assign).toHaveBeenCalledTimes(1);
    expect(rendered.container.querySelector("input")?.value).toBe("walk every day");
  } finally { await rendered.cleanup(); }
});

test.each(["pagehide", "popstate", "unmount"])("pending contact lookup ignores repeat clicks and cancels on %s", async (exit) => {
  let resolve!: (response: Response) => void;
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise((done) => { resolve = done; }));
  vi.stubGlobal("fetch", fetchMock);
  const { GoalComposer } = await import("@/src/components/goals/goal-composer");
  const rendered = await renderClientComponent(signedIn(
    <GoalComposer onQueryChange={() => {}} placeholders={[]} query="walk every day" startOption={publicOption} />,
  ));
  try {
    await act(async () => { rendered.button.click(); rendered.button.click(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rendered.button.getAttribute("aria-busy")).toBe("true");
    if (exit === "unmount") await rendered.rerender(<div />);
    else await act(async () => rendered.window.dispatchEvent(new rendered.window.Event(exit)));
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await act(async () => resolve(contactResponse()));
    expect(rendered.assign).not.toHaveBeenCalled();
  } finally { await rendered.cleanup(); }
});

test("member Telegram handoff attaches the draft to the resolved channel", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    option: { kind: "telegram", label: "Telegram", href: "https://t.me/withmurph_bot?text=default" },
  }), { headers: { "content-type": "application/json" } })));
  const { GoalComposer } = await import("@/src/components/goals/goal-composer");
  const rendered = await renderClientComponent(signedIn(
    <GoalComposer onQueryChange={() => {}} placeholders={[]} query="walk every day" startOption={publicOption} />,
  ));
  try {
    await act(async () => rendered.button.click());
    const url = new URL(rendered.assign.mock.calls[0]![0]);
    expect(url.origin).toBe("https://t.me");
    expect(url.searchParams.get("text")).toBe("Hey Murph, help me walk every day");
  } finally { await rendered.cleanup(); }
});

test("a timed-out member lookup offers retry and cannot launch a late response", async () => {
  vi.useFakeTimers();
  let resolve!: (response: Response) => void;
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise((done) => { resolve = done; }));
  vi.stubGlobal("fetch", fetchMock);
  const { GoalComposer } = await import("@/src/components/goals/goal-composer");
  const rendered = await renderClientComponent(signedIn(
    <GoalComposer onQueryChange={() => {}} placeholders={[]} query="walk every day" startOption={publicOption} />,
  ), { location: { href: "https://example.test/goals" } });
  try {
    await act(async () => rendered.button.click());
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(rendered.container.textContent).toContain("Couldn’t open your Murph chat. Try again.");
    expect(rendered.button.disabled).toBe(false);
    await act(async () => resolve(contactResponse()));
    expect(rendered.assign).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
});
