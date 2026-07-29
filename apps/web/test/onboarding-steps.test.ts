import assert from "node:assert/strict";

import {
  cloneElement,
  createElement,
  isValidElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

vi.mock("next/link", () => ({
  default(props: {
    children?: ReactNode;
    className?: string;
    href: string;
    "data-slot"?: string;
  }) {
    return createElement(
      "a",
      {
        className: props.className,
        "data-slot": props["data-slot"],
        href: props.href,
      },
      props.children,
    );
  },
}));

vi.mock("@/src/components/ui/auth-button", () => ({
  AuthButton(props: {
    children?: ReactNode;
    className?: string;
    render?: ReactNode;
  }) {
    if (isValidElement<{ children?: ReactNode; className?: string; "data-slot"?: string }>(props.render)) {
      return cloneElement(
        props.render,
        {
          className: props.className,
          "data-slot": "auth-button",
        },
        props.children,
      );
    }

    return createElement(
      "button",
      {
        className: props.className,
        "data-slot": "auth-button",
        type: "button",
      },
      props.children,
    );
  },
}));

test("OnboardingSteps gates the connect devices action with AuthButton", async () => {
  const { OnboardingSteps } = await import("@/src/components/home/onboarding-steps");
  const markup = renderToStaticMarkup(createElement(OnboardingSteps));

  assert.match(markup, /data-slot="auth-button"[^>]*>Connect/);
  assert.doesNotMatch(markup, /data-slot="auth-button"[^>]*>Connect devices/);
});

test("OnboardingSteps hides the connect devices card when the device step is complete", async () => {
  const { OnboardingSteps } = await import("@/src/components/home/onboarding-steps");
  const markup = renderToStaticMarkup(createElement(OnboardingSteps, {
    showDeviceStep: false,
  }));

  assert.doesNotMatch(markup, /Connect devices/);
  assert.doesNotMatch(markup, /href="\/connect"/);
  assert.match(markup, /Sync labs/);
  assert.match(markup, /Start an experiment/);
  assert.match(markup, /Step 1/);
  assert.doesNotMatch(markup, /Step 3/);
});

test("OnboardingSteps hides the labs card when lab sync is complete", async () => {
  const { OnboardingSteps } = await import("@/src/components/home/onboarding-steps");
  const markup = renderToStaticMarkup(createElement(OnboardingSteps, {
    hideLabsStep: true,
  }));

  assert.match(markup, /Connect devices/);
  assert.doesNotMatch(markup, /Sync labs/);
  assert.doesNotMatch(markup, /href="\/settings"/);
  assert.match(markup, /Start an experiment/);
  assert.match(markup, /Step 2/);
  assert.doesNotMatch(markup, /Step 3/);
});

test("OnboardingSteps hides the message card until an action is supplied", async () => {
  const { OnboardingSteps } = await import("@/src/components/home/onboarding-steps");
  const markup = renderToStaticMarkup(createElement(OnboardingSteps));

  assert.doesNotMatch(markup, /Message Murph/);
});

test("OnboardingSteps leads with the message card and takes the primary style", async () => {
  const { OnboardingSteps } = await import("@/src/components/home/onboarding-steps");
  const markup = renderToStaticMarkup(createElement(OnboardingSteps, {
    messageMurphAction: createElement("a", { href: "https://t.me/example_bot" }, "Message"),
  }));

  assert.match(markup, /Message Murph/);
  assert.match(markup, /Murph can&#x27;t message you first/);
  assert.ok(markup.indexOf("Message Murph") < markup.indexOf("Connect devices"));
  assert.match(markup, /href="https:\/\/t\.me\/example_bot"/);
  // The message step takes over the primary treatment from connect devices.
  assert.equal(markup.match(/border-primary\/35/gu)?.length, 1);
  assert.ok(
    markup.indexOf("border-primary/35") < markup.indexOf("Connect devices"),
  );
});

test("OnboardingSteps keeps four desktop cards on one horizontal track", async () => {
  const { OnboardingSteps } = await import("@/src/components/home/onboarding-steps");
  const markup = renderToStaticMarkup(createElement(OnboardingSteps, {
    messageMurphAction: createElement("a", { href: "/message" }, "Message"),
  }));

  assert.match(markup, /data-onboarding-steps="true"/);
  assert.match(markup, /lg:flex/);
  assert.match(markup, /lg:overflow-x-auto/);
  assert.doesNotMatch(markup, /xl:grid-cols-3/);
  assert.equal(markup.match(/data-onboarding-step=/gu)?.length, 4);
  assert.equal(
    markup.match(/lg:basis-\[calc\(\(100%-2\.5rem\)\/3\)\]/gu)?.length,
    4,
  );
});
