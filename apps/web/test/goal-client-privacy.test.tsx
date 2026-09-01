import assert from "node:assert/strict";

import {
  act,
  createElement,
  type AnchorHTMLAttributes,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

vi.mock("next/link", async () => {
  const react = await import("react");

  return {
    default: ({
      prefetch,
      ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => {
      const attributes: AnchorHTMLAttributes<HTMLAnchorElement> & {
        "data-next-prefetch"?: string;
      } = {
        ...props,
        "data-next-prefetch": prefetch === false ? "false" : undefined,
      };
      return react.createElement("a", attributes);
    },
  };
});

const telegramOption: MurphContactOption = {
  href: "https://t.me/withmurph_bot?text=Help+me+with+this+goal",
  kind: "telegram",
  label: "Telegram",
  rel: "noopener noreferrer",
  target: "_blank",
};

let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  try {
    await cleanupRender?.();
  } finally {
    cleanupRender = null;
    vi.useRealTimers();
  }
});

describe("public goal client privacy", () => {
  it("deduplicates rapid authenticated handoff clicks", async () => {
    const textOption: MurphContactOption = {
      href: "sms:+15550100001?body=Help%20me%20with%20this%20goal",
      kind: "text",
      label: "Messages",
    };
    let resolveRequest: ((value: { option: MurphContactOption }) => void) | null =
      null;
    mocks.requestHostedOnboardingJson.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const { GoalContactAction } = await import(
      "@/src/components/goals/goal-contact-action"
    );
    const rendered = await renderClientComponent(
      createElement(
        AuthContext.Provider,
        {
          value: {
            authenticated: true,
            authenticationStatus: "ready",
            openAuthDialog: () => {},
            prepareAuth: () => {},
            shared: false,
          },
        },
        createElement(GoalContactAction, {
          goalRouteId: "lower-resting-heart-rate",
          option: telegramOption,
        }),
      ),
      {
        location: {
          href: "https://example.test/goals/lower-resting-heart-rate",
          pathname: "/goals/lower-resting-heart-rate",
          search: "",
        },
        requireButton: false,
      },
    );
    cleanupRender = rendered.cleanup;
    const button = rendered.container.querySelector("button");
    assert.ok(button);

    await act(async () => {
      button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
    expect(rendered.assign).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      assert.ok(resolveRequest);
      resolveRequest({ option: textOption });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.assign).toHaveBeenCalledTimes(1);
    expect(rendered.assign).toHaveBeenCalledWith(textOption.href);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("false");
  });

  it("aborts a delayed authenticated handoff when the CTA unmounts", async () => {
    const textOption: MurphContactOption = {
      href: "sms:+15550100001?body=Help%20me%20with%20this%20goal",
      kind: "text",
      label: "Messages",
    };
    let resolveRequest: ((value: { option: MurphContactOption }) => void) | null =
      null;
    mocks.requestHostedOnboardingJson.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const { GoalContactAction } = await import(
      "@/src/components/goals/goal-contact-action"
    );
    const rendered = await renderClientComponent(
      authenticatedGoalContactAction(GoalContactAction),
      {
        location: {
          href: "https://example.test/goals/lower-resting-heart-rate",
          pathname: "/goals/lower-resting-heart-rate",
          search: "",
        },
        requireButton: false,
      },
    );
    const button = rendered.container.querySelector("button");
    assert.ok(button);

    await act(async () => {
      button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
    });

    const signal = requestSignal(0);
    expect(signal.aborted).toBe(false);
    await rendered.cleanup();
    expect(signal.aborted).toBe(true);

    await act(async () => {
      assert.ok(resolveRequest);
      resolveRequest({ option: textOption });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.assign).not.toHaveBeenCalled();
  });

  it("times out a stalled authenticated handoff and allows retry", async () => {
    vi.useFakeTimers();
    const textOption: MurphContactOption = {
      href: "sms:+15550100001?body=Help%20me%20with%20this%20goal",
      kind: "text",
      label: "Messages",
    };
    mocks.requestHostedOnboardingJson
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce({ option: textOption });
    const { GoalContactAction } = await import(
      "@/src/components/goals/goal-contact-action"
    );
    const rendered = await renderClientComponent(
      authenticatedGoalContactAction(GoalContactAction),
      {
        location: {
          href: "https://example.test/goals/lower-resting-heart-rate",
          pathname: "/goals/lower-resting-heart-rate",
          search: "",
        },
        requireButton: false,
      },
    );
    cleanupRender = rendered.cleanup;
    const button = rendered.container.querySelector("button");
    assert.ok(button);

    await act(async () => {
      button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
    });
    const signal = requestSignal(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(signal.aborted).toBe(true);
    expect(rendered.assign).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(rendered.container.textContent).toContain(
      "Couldn’t open your Murph chat. Try again.",
    );

    await act(async () => {
      button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
    expect(rendered.assign).toHaveBeenCalledOnce();
    expect(rendered.assign).toHaveBeenCalledWith(textOption.href);
  });

  it("allows retry after an authenticated handoff failure", async () => {
    const textOption: MurphContactOption = {
      href: "sms:+15550100001?body=Help%20me%20with%20this%20goal",
      kind: "text",
      label: "Messages",
    };
    mocks.requestHostedOnboardingJson
      .mockRejectedValueOnce(new Error("contact lookup unavailable"))
      .mockResolvedValueOnce({ option: textOption });
    const { GoalContactAction } = await import(
      "@/src/components/goals/goal-contact-action"
    );
    const rendered = await renderClientComponent(
      authenticatedGoalContactAction(GoalContactAction),
      {
        location: {
          href: "https://example.test/goals/lower-resting-heart-rate",
          pathname: "/goals/lower-resting-heart-rate",
          search: "",
        },
        requireButton: false,
      },
    );
    cleanupRender = rendered.cleanup;
    const button = rendered.container.querySelector("button");
    assert.ok(button);

    await act(async () => {
      button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rendered.assign).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);

    await act(async () => {
      button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
    expect(rendered.assign).toHaveBeenCalledOnce();
    expect(rendered.assign).toHaveBeenCalledWith(textOption.href);
  });

  it("aborts a delayed authenticated handoff when its goal changes", async () => {
    const textOption: MurphContactOption = {
      href: "sms:+15550100001?body=Help%20me%20with%20this%20goal",
      kind: "text",
      label: "Messages",
    };
    let resolveRequest: ((value: { option: MurphContactOption }) => void) | null =
      null;
    mocks.requestHostedOnboardingJson.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const { GoalContactAction } = await import(
      "@/src/components/goals/goal-contact-action"
    );
    const rendered = await renderClientComponent(
      authenticatedGoalContactAction(GoalContactAction),
      {
        location: {
          href: "https://example.test/goals/lower-resting-heart-rate",
          pathname: "/goals/lower-resting-heart-rate",
          search: "",
        },
        requireButton: false,
      },
    );
    cleanupRender = rendered.cleanup;
    const button = rendered.container.querySelector("button");
    assert.ok(button);

    await act(async () => {
      button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
    });
    const signal = requestSignal(0);

    await rendered.rerender(
      authenticatedGoalContactAction(GoalContactAction, "improve-deep-sleep"),
    );
    expect(signal.aborted).toBe(true);

    await act(async () => {
      assert.ok(resolveRequest);
      resolveRequest({ option: textOption });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.assign).not.toHaveBeenCalled();
    const nextButton = rendered.container.querySelector("button");
    assert.ok(nextButton);
    expect(nextButton.disabled).toBe(false);
  });

  it("cancels a delayed authenticated handoff after an in-place URL change", async () => {
    const textOption: MurphContactOption = {
      href: "sms:+15550100001?body=Help%20me%20with%20this%20goal",
      kind: "text",
      label: "Messages",
    };
    let resolveRequest: ((value: { option: MurphContactOption }) => void) | null =
      null;
    mocks.requestHostedOnboardingJson.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const { GoalContactAction } = await import(
      "@/src/components/goals/goal-contact-action"
    );
    const rendered = await renderClientComponent(
      authenticatedGoalContactAction(GoalContactAction),
      {
        location: {
          href: "https://example.test/goals/lower-resting-heart-rate",
          pathname: "/goals/lower-resting-heart-rate",
          search: "",
        },
        requireButton: false,
      },
    );
    cleanupRender = rendered.cleanup;
    const button = rendered.container.querySelector("button");
    assert.ok(button);

    await act(async () => {
      button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
    });
    const signal = requestSignal(0);
    rendered.window.location.href = "https://example.test/goals/improve-deep-sleep";

    await act(async () => {
      assert.ok(resolveRequest);
      resolveRequest({ option: textOption });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(signal.aborted).toBe(true);
    expect(rendered.assign).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(rendered.container.textContent).not.toContain(
      "Couldn’t open your Murph chat. Try again.",
    );
  });

  it("resolves the signed-in member's current contact only when they click", async () => {
    const textOption: MurphContactOption = {
      href: "sms:+15550100001?body=Help%20me%20with%20this%20goal",
      kind: "text",
      label: "Messages",
    };
    const reroutedTextOption: MurphContactOption = {
      ...textOption,
      href: "sms:+15550100002?body=Help%20me%20with%20this%20goal",
    };
    mocks.requestHostedOnboardingJson
      .mockResolvedValueOnce({ option: textOption })
      .mockResolvedValueOnce({ option: reroutedTextOption });
    const { GoalContactAction } = await import(
      "@/src/components/goals/goal-contact-action"
    );
    const rendered = await renderClientComponent(
      createElement(
        AuthContext.Provider,
        {
          value: {
            authenticated: true,
            authenticationStatus: "ready",
            openAuthDialog: () => {},
            prepareAuth: () => {},
            shared: false,
          },
        },
        createElement(GoalContactAction, {
          goalRouteId: "lower-resting-heart-rate",
          option: telegramOption,
        }),
      ),
      {
        location: {
          href: "https://example.test/goals/lower-resting-heart-rate",
          pathname: "/goals/lower-resting-heart-rate",
          search: "",
        },
        requireButton: false,
      },
    );
    cleanupRender = rendered.cleanup;

    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
    const button = rendered.container.querySelector("button");
    assert.ok(button);
    expect(rendered.container.querySelector("a")).toBeNull();

    await act(async () => {
      button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: { goalRouteId: "lower-resting-heart-rate" },
      signal: expect.any(AbortSignal),
      url: "/api/goals/contact",
    });
    expect(rendered.assign).toHaveBeenCalledWith(textOption.href);
    expect(rendered.container.querySelector("a")).toBeNull();
    rendered.assign.mockClear();

    await act(async () => {
      button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
    expect(rendered.assign).toHaveBeenCalledWith(reroutedTextOption.href);
    expect(JSON.stringify(mocks.requestHostedOnboardingJson.mock.calls)).not.toContain(
      "resting heart rate.",
    );
  });

  it("retries live contact resolution when the initial auth read is unavailable", async () => {
    const textOption: MurphContactOption = {
      href: "sms:+15550100001?body=Help%20me%20with%20this%20goal",
      kind: "text",
      label: "Messages",
    };
    mocks.requestHostedOnboardingJson.mockResolvedValue({ option: textOption });
    const { GoalContactAction } = await import(
      "@/src/components/goals/goal-contact-action"
    );
    const rendered = await renderClientComponent(
      createElement(
        AuthContext.Provider,
        {
          value: {
            authenticated: false,
            authenticationStatus: "unavailable",
            openAuthDialog: () => {},
            prepareAuth: () => {},
            shared: false,
          },
        },
        createElement(GoalContactAction, {
          goalRouteId: "lower-resting-heart-rate",
          option: telegramOption,
        }),
      ),
      {
        location: {
          href: "https://example.test/goals/lower-resting-heart-rate",
          pathname: "/goals/lower-resting-heart-rate",
          search: "",
        },
        requireButton: false,
      },
    );
    cleanupRender = rendered.cleanup;
    const button = rendered.container.querySelector("button");
    assert.ok(button);

    expect(rendered.container.querySelector("a")).toBeNull();
    expect(rendered.container.textContent).toContain(
      "Couldn’t open your Murph chat. Try again.",
    );
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();

    await act(async () => {
      button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: { goalRouteId: "lower-resting-heart-rate" },
      signal: expect.any(AbortSignal),
      url: "/api/goals/contact",
    });
    expect(rendered.assign).toHaveBeenCalledWith(textOption.href);
    expect(rendered.container.querySelector("a")).toBeNull();
  });

  it("fails closed instead of opening anonymous Telegram when member routing fails", async () => {
    mocks.requestHostedOnboardingJson.mockRejectedValue(
      new Error("contact lookup unavailable"),
    );
    const { GoalContactAction } = await import(
      "@/src/components/goals/goal-contact-action"
    );
    const rendered = await renderClientComponent(
      createElement(
        AuthContext.Provider,
        {
          value: {
            authenticated: true,
            authenticationStatus: "ready",
            openAuthDialog: () => {},
            prepareAuth: () => {},
            shared: false,
          },
        },
        createElement(GoalContactAction, {
          goalRouteId: "lower-resting-heart-rate",
          option: telegramOption,
        }),
      ),
      {
        location: {
          href: "https://example.test/goals/lower-resting-heart-rate",
          pathname: "/goals/lower-resting-heart-rate",
          search: "",
        },
        requireButton: false,
      },
    );
    cleanupRender = rendered.cleanup;
    const button = rendered.container.querySelector("button");
    assert.ok(button);
    expect(rendered.container.querySelector("a")).toBeNull();
    const click = new rendered.window.Event("click", {
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      button.dispatchEvent(click);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.assign).not.toHaveBeenCalled();
    expect(rendered.open).not.toHaveBeenCalled();
    expect(rendered.container.textContent).toContain(
      "Couldn’t open your Murph chat. Try again.",
    );
    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      payload: { goalRouteId: "lower-resting-heart-rate" },
      signal: expect.any(AbortSignal),
      url: "/api/goals/contact",
    });
  });

  it("searches in memory without a successful URL field or history mutation", async () => {
    const { GoalSearchExperience } = await import(
      "@/src/components/goals/goal-search-experience"
    );
    const rendered = await renderClientComponent(
      <GoalSearchExperience
        goals={[
          {
            goalPhrase: "improve my deep sleep",
            key: "goal_template:deep-sleep",
            routeId: "improve-deep-sleep",
            searchText: "improve my deep sleep restorative slow wave sleep",
            title: "Improve My Deep Sleep",
          },
          {
            goalPhrase: "run my first 5k",
            key: "goal_template:first-5k",
            routeId: "run-my-first-5k",
            searchText: "run my first 5k beginner running",
            title: "Run My First 5K",
          },
        ]}
      >
        <div data-goal-directory="landing">Browse goals</div>
      </GoalSearchExperience>,
      {
        location: {
          href: "https://example.test/goals",
          pathname: "/goals",
          search: "",
        },
        requireButton: false,
      },
    );
    cleanupRender = rendered.cleanup;
    const search = rendered.container.querySelector('[role="search"]');
    const input = rendered.container.querySelector("input");
    assert.ok(search);
    assert.ok(input instanceof rendered.window.HTMLInputElement);

    expect(rendered.container.querySelector("form")).toBeNull();
    expect(input.getAttribute("name")).toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        rendered.window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (valueSetter) {
        valueSetter.call(input, "deep sleep");
      } else {
        input.value = "deep sleep";
      }
      input.dispatchEvent(new rendered.window.Event("input", { bubbles: true }));
      input.dispatchEvent(new rendered.window.Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(rendered.container.textContent).toContain("Improve My Deep Sleep");
    expect(rendered.container.textContent).not.toContain("Run My First 5K");
    expect(rendered.container.querySelector('[data-goal-directory="landing"]')).toBeNull();
    const resultLinks = rendered.container.querySelectorAll(
      "[data-goal-search-results] a",
    );
    expect(resultLinks).toHaveLength(1);
    expect(resultLinks[0]?.getAttribute("data-next-prefetch")).toBe("false");
    expect(rendered.window.location.search).toBe("");
    expect(rendered.replaceState).not.toHaveBeenCalled();
    expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  });

  it("materializes broad search results in explicit bounded batches", async () => {
    const { GoalSearchExperience } = await import(
      "@/src/components/goals/goal-search-experience"
    );
    const goals = Array.from({ length: 40 }, (_, index) => ({
      goalPhrase: `improve sleep outcome ${index + 1}`,
      key: `goal_template:sleep-outcome-${index + 1}`,
      routeId: `sleep-outcome-${index + 1}`,
      searchText: `improve sleep outcome ${index + 1}`,
      title: `Improve Sleep Outcome ${index + 1}`,
    }));
    const rendered = await renderClientComponent(
      <GoalSearchExperience goals={goals}>
        <div>Browse goals</div>
      </GoalSearchExperience>,
      {
        location: {
          href: "https://example.test/goals",
          pathname: "/goals",
          search: "",
        },
        requireButton: false,
      },
    );
    cleanupRender = rendered.cleanup;
    const input = rendered.container.querySelector("input");
    assert.ok(input instanceof rendered.window.HTMLInputElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        rendered.window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (valueSetter) {
        valueSetter.call(input, "improve");
      } else {
        input.value = "improve";
      }
      input.dispatchEvent(new rendered.window.Event("input", { bubbles: true }));
      input.dispatchEvent(new rendered.window.Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(rendered.container.textContent).toContain("40 goals");
    expect(
      rendered.container.querySelectorAll(
        '[data-goal-search-results="visible"] a',
      ),
    ).toHaveLength(16);
    expect(rendered.container.textContent).not.toContain(
      "Improve Sleep Outcome 17",
    );
    expect(rendered.container.querySelector("details")).toBeNull();
    const showMore = rendered.container.querySelector(
      "button[data-goal-search-more]",
    );
    assert.ok(showMore);
    expect(showMore.textContent).toContain("Show 16 more");

    await act(async () => {
      showMore.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
    });

    expect(
      rendered.container.querySelectorAll(
        '[data-goal-search-results="visible"] a',
      ),
    ).toHaveLength(32);
    expect(rendered.container.textContent).not.toContain(
      "Improve Sleep Outcome 33",
    );
    expect(showMore.textContent).toContain("Show 8 more");

    await act(async () => {
      showMore.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
    });

    expect(
      rendered.container.querySelectorAll(
        '[data-goal-search-results="visible"] a',
      ),
    ).toHaveLength(40);
    expect(rendered.container.querySelector("[data-goal-search-more]"))
      .toBeNull();
  });
});

function authenticatedGoalContactAction(
  GoalContactAction: typeof import("@/src/components/goals/goal-contact-action")["GoalContactAction"],
  goalRouteId = "lower-resting-heart-rate",
) {
  return createElement(
    AuthContext.Provider,
    {
      value: {
        authenticated: true,
        authenticationStatus: "ready",
        openAuthDialog: () => {},
        prepareAuth: () => {},
        shared: false,
      },
    },
    createElement(GoalContactAction, {
      goalRouteId,
      option: telegramOption,
    }),
  );
}

function requestSignal(callIndex: number): AbortSignal {
  const request = mocks.requestHostedOnboardingJson.mock.calls[callIndex]?.[0] as
    | { signal?: AbortSignal }
    | undefined;
  assert.ok(request?.signal);
  return request.signal;
}
