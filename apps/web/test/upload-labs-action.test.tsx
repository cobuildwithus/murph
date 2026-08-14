import assert from "node:assert/strict";

import {
  cloneElement,
  createElement,
  isValidElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    getHostedPageAuthSnapshot: vi.fn(),
    getHostedMurphContactContext: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default(props: { children?: ReactNode; className?: string; href: string }) {
    return createElement(
      "a",
      { className: props.className, href: props.href },
      props.children,
    );
  },
}));

vi.mock("@/src/components/ui/auth-button", () => ({
  AuthButton(props: {
    "aria-label"?: string;
    children?: ReactNode;
    className?: string;
    disabled?: boolean;
    render?: ReactNode;
  }) {
    if (isValidElement<{
      children?: ReactNode;
      className?: string;
      "data-slot"?: string;
    }>(props.render)) {
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
        "aria-label": props["aria-label"],
        className: props.className,
        "data-slot": "auth-button",
        disabled: props.disabled,
        type: "button",
      },
      props.children,
    );
  },
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
  getHostedDashboardPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-contact-context", () => ({
  getHostedMurphContactContext: mocks.getHostedMurphContactContext,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    linkedAccounts: [],
    session: null,
  });
  mocks.getHostedMurphContactContext.mockResolvedValue({
    initialContactChannels: {
      email: false,
      telegram: false,
      text: false,
    },
    murphEmailAddress: null,
    murphPhoneNumber: null,
  });
});

test("UploadLabsMurphContactAction opens auth before login", async () => {
  const { UploadLabsMurphContactAction } = await import(
    "@/src/components/home/upload-labs-action"
  );
  const markup = renderToStaticMarkup(await UploadLabsMurphContactAction());

  assert.match(markup, /data-slot="auth-button"/);
  assert.match(markup, /aria-label="Sync labs with Murph"/);
  assert.match(markup, />Sync<svg/u);
  assert.doesNotMatch(markup, /disabled=""/);
  assert.doesNotMatch(markup, /href=/);
  assert.equal(mocks.getHostedMurphContactContext.mock.calls.length, 1);
});

test("UploadLabsMurphContactAction opens assigned SMS with the lab-report message", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_labs",
    },
    linkedAccounts: [
      {
        latest_verified_at: 1771977600,
        phone_number: "+14045550123",
        type: "phone",
      },
      {
        address: "member@example.test",
        latest_verified_at: 1771977600,
        type: "email",
      },
    ],
    session: null,
  });
  mocks.getHostedMurphContactContext.mockResolvedValue({
    initialContactChannels: {
      email: false,
      telegram: false,
      text: true,
    },
    murphEmailAddress: null,
    murphPhoneNumber: "+15550100001",
  });

  const { UploadLabsMurphContactAction } = await import(
    "@/src/components/home/upload-labs-action"
  );
  const markup = renderToStaticMarkup(await UploadLabsMurphContactAction());

  assert.match(
    markup,
    /data-slot="auth-button"[^>]*href="sms:\+15550100001\?body=Here%20are%20some%20lab%20reports%20I%20want%20you%20to%20check%20out%3A"/,
  );
  assert.match(markup, /aria-label="Sync labs with Murph in Messages"/);
  assert.doesNotMatch(markup, /\+14045550123/);
  assert.doesNotMatch(markup, /member@example\.test/);
  assert.equal(mocks.getHostedMurphContactContext.mock.calls.length, 1);
});

test("UploadLabsMurphContactAction falls back to a prefilled email when SMS is not eligible", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_labs_email",
    },
    linkedAccounts: [
      {
        address: "member@example.test",
        latest_verified_at: 1771977600,
        type: "email",
      },
    ],
    session: null,
  });
  mocks.getHostedMurphContactContext.mockResolvedValue({
    initialContactChannels: {
      email: true,
      telegram: false,
      text: false,
    },
    murphEmailAddress: "murph+alias123@mail.withmurph.ai",
    murphPhoneNumber: "+15550100001",
  });

  const { UploadLabsMurphContactAction } = await import(
    "@/src/components/home/upload-labs-action"
  );
  const markup = renderToStaticMarkup(await UploadLabsMurphContactAction());

  assert.match(markup, /href="mailto:murph\+alias123@mail\.withmurph\.ai\?/);
  assert.match(markup, /subject=Lab%20reports%20for%20Murph/);
  assert.match(
    markup,
    /body=Here%20are%20some%20lab%20reports%20I%20want%20you%20to%20check%20out%3A/,
  );
  assert.doesNotMatch(markup, /href="sms:\+15550100001/);
  assert.doesNotMatch(markup, /member@example\.test/);
});

test("UploadLabsMurphContactAction skips verified email without a reply alias", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_labs_email_without_alias",
    },
    linkedAccounts: [
      {
        address: "member@example.test",
        latest_verified_at: 1771977600,
        type: "email",
      },
    ],
    session: null,
  });
  mocks.getHostedMurphContactContext.mockResolvedValue({
    initialContactChannels: {
      email: false,
      telegram: false,
      text: false,
    },
    murphEmailAddress: null,
    murphPhoneNumber: null,
  });

  const { UploadLabsMurphContactAction } = await import(
    "@/src/components/home/upload-labs-action"
  );
  const markup = renderToStaticMarkup(await UploadLabsMurphContactAction());

  assert.match(markup, /data-slot="auth-button"/);
  assert.doesNotMatch(markup, /href="mailto:/);
  assert.doesNotMatch(markup, /murph@mail\.withmurph\.ai/);
  assert.doesNotMatch(markup, /member@example\.test/);
});

test("UploadLabsMurphContactAction prefers Telegram over email with the lab-report draft", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_labs_telegram_email",
    },
    linkedAccounts: [
      {
        address: "member@example.test",
        latest_verified_at: 1771977600,
        type: "email",
      },
      {
        id: "tg_user_123",
        type: "telegram",
        username: "member_handle",
      },
    ],
    session: null,
  });
  mocks.getHostedMurphContactContext.mockResolvedValue({
    initialContactChannels: {
      email: true,
      telegram: true,
      text: false,
    },
    murphEmailAddress: "murph+alias123@mail.withmurph.ai",
    murphPhoneNumber: null,
  });

  const { UploadLabsMurphContactAction } = await import(
    "@/src/components/home/upload-labs-action"
  );
  const markup = renderToStaticMarkup(await UploadLabsMurphContactAction());

  assert.match(
    markup,
    /href="https:\/\/t\.me\/withmurph_bot\?text=Here\+are\+some\+lab\+reports\+I\+want\+you\+to\+check\+out%3A"/,
  );
  assert.match(
    markup,
    /aria-label="Sync labs with Murph in Telegram \(opens in a new tab\)"/,
  );
  assert.doesNotMatch(markup, /href="mailto:murph@mail\.withmurph\.ai/);
  assert.doesNotMatch(markup, /tg_user_123/);
  assert.doesNotMatch(markup, /member_handle/);
  assert.doesNotMatch(markup, /member@example\.test/);
});

test("UploadLabsMurphContactAction opens Telegram with the lab-report draft when it is the only connected channel", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_labs_telegram",
    },
    linkedAccounts: [
      {
        id: "tg_user_123",
        type: "telegram",
        username: "member_handle",
      },
    ],
    session: null,
  });
  mocks.getHostedMurphContactContext.mockResolvedValue({
    initialContactChannels: {
      email: false,
      telegram: true,
      text: false,
    },
    murphEmailAddress: null,
    murphPhoneNumber: null,
  });

  const { UploadLabsMurphContactAction } = await import(
    "@/src/components/home/upload-labs-action"
  );
  const markup = renderToStaticMarkup(await UploadLabsMurphContactAction());

  assert.match(
    markup,
    /href="https:\/\/t\.me\/withmurph_bot\?text=Here\+are\+some\+lab\+reports\+I\+want\+you\+to\+check\+out%3A"/,
  );
  assert.match(
    markup,
    /aria-label="Sync labs with Murph in Telegram \(opens in a new tab\)"/,
  );
  assert.doesNotMatch(markup, /tg_user_123/);
  assert.doesNotMatch(markup, /member_handle/);
});

test("OnboardingSteps renders a supplied Upload labs action instead of the settings link", async () => {
  const { OnboardingSteps } = await import("@/src/components/home/onboarding-steps");
  const markup = renderToStaticMarkup(
    <OnboardingSteps
      uploadLabsAction={<a href="sms:+15550100001">Upload labs</a>}
    />,
  );

  assert.match(markup, /href="sms:\+15550100001"[^>]*>Upload labs<\/a>/);
  assert.doesNotMatch(markup, /href="\/settings"[^>]*>Upload labs<\/a>/);
});
