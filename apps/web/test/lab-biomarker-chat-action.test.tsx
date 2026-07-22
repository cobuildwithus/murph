import assert from "node:assert/strict";

import {
  cloneElement,
  createElement,
  isValidElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveHostedMurphContactOption: vi.fn(),
}));

vi.mock("next/link", () => ({
  default(props: { "aria-label"?: string; children?: ReactNode; href: string }) {
    return createElement(
      "a",
      { "aria-label": props["aria-label"], href: props.href },
      props.children,
    );
  },
}));

vi.mock("@/src/components/murph/hosted-murph-contact-action", () => ({
  resolveHostedMurphContactOption: mocks.resolveHostedMurphContactOption,
}));

vi.mock("@/src/components/murph/murph-contact-auth-button", () => ({
  MurphContactAuthButton(props: {
    actionLabel: string;
    children?: ReactNode;
    option: { href: string };
  }) {
    return createElement(
      "a",
      { "aria-label": props.actionLabel, href: props.option.href },
      props.children,
    );
  },
}));

vi.mock("@/src/components/ui/auth-button", () => ({
  AuthButton(props: { "aria-label"?: string; children?: ReactNode }) {
    return createElement(
      "button",
      { "aria-label": props["aria-label"], type: "button" },
      props.children,
    );
  },
}));

vi.mock("@/src/components/ui/button", () => ({
  Button(props: {
    "aria-label"?: string;
    children?: ReactNode;
    render?: ReactNode;
  }) {
    if (isValidElement<{ "aria-label"?: string; children?: ReactNode }>(props.render)) {
      return cloneElement(
        props.render,
        { "aria-label": props["aria-label"] },
        props.children,
      );
    }

    return createElement(
      "button",
      { "aria-label": props["aria-label"], type: "button" },
      props.children,
    );
  },
  buttonVariants: () => "button",
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveHostedMurphContactOption.mockResolvedValue({
    href: "sms:+15550100001?body=Let%27s%20chat%20about%20my%20Hemoglobin.",
    kind: "text",
    label: "Messages",
  });
});

test("biomarker chat action uses the existing contact route with a marker-specific draft", async () => {
  const { LabBiomarkerChatAction } = await import(
    "@/src/components/biomarkers/lab-biomarker-chat-action"
  );
  const markup = renderToStaticMarkup(await LabBiomarkerChatAction({
    authenticated: true,
    displayName: "Hemoglobin",
  }));

  assert.equal(mocks.resolveHostedMurphContactOption.mock.calls.length, 1);
  assert.deepEqual(mocks.resolveHostedMurphContactOption.mock.calls[0]?.[0], {
    message: {
      body: "Let's chat about my Hemoglobin.",
      subject: "My Hemoglobin result",
    },
  });
  assert.match(markup, /href="sms:\+15550100001\?body=/u);
  assert.match(markup, /aria-label="Chat with Murph about Hemoglobin"/u);
  assert.match(markup, />Chat with Murph</u);
});

test("biomarker chat action routes a signed-in member without a channel to settings", async () => {
  mocks.resolveHostedMurphContactOption.mockResolvedValue(null);
  const { LabBiomarkerChatAction } = await import(
    "@/src/components/biomarkers/lab-biomarker-chat-action"
  );
  const markup = renderToStaticMarkup(await LabBiomarkerChatAction({
    authenticated: true,
    displayName: "Hemoglobin",
  }));

  assert.match(markup, /href="\/settings"/u);
  assert.match(markup, /Link a contact method to chat with Murph/u);
});

test("biomarker chat action asks a signed-out visitor to authenticate when no channel resolves", async () => {
  mocks.resolveHostedMurphContactOption.mockResolvedValue(null);
  const { LabBiomarkerChatAction } = await import(
    "@/src/components/biomarkers/lab-biomarker-chat-action"
  );
  const markup = renderToStaticMarkup(await LabBiomarkerChatAction({
    authenticated: false,
    displayName: "Hemoglobin",
  }));

  assert.match(markup, /aria-label="Sign in to chat with Murph"/u);
  assert.doesNotMatch(markup, /href="\/settings"/u);
  assert.match(markup, />Chat with Murph</u);
});
