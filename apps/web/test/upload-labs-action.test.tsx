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
  const prisma = { prisma: true };

  return {
    getHostedPageAuthSnapshot: vi.fn(),
    getPrisma: vi.fn(() => prisma),
    prisma,
    readHostedAccountSettingsSnapshot: vi.fn(),
    readHostedMemberRoutingState: vi.fn(),
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
}));

vi.mock("@/src/lib/hosted-onboarding/account-settings-snapshot", () => ({
  readHostedAccountSettingsSnapshot: mocks.readHostedAccountSettingsSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    linkedAccounts: [],
    memberLookup: null,
    session: null,
  });
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValue(null);
  mocks.readHostedMemberRoutingState.mockResolvedValue(null);
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
  assert.equal(mocks.readHostedAccountSettingsSnapshot.mock.calls.length, 0);
  assert.equal(mocks.readHostedMemberRoutingState.mock.calls.length, 0);
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
    memberLookup: null,
    session: null,
  });
  mocks.readHostedMemberRoutingState.mockResolvedValue({
    linqChatId: null,
    linqRecipientPhone: "+15550100001",
    memberId: "member_labs",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  });
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValue({
    email: {
      address: "member@example.test",
      verifiedAt: new Date("2026-02-26T00:00:00.000Z"),
    },
    phone: {
      number: "+14045550123",
      verifiedAt: new Date("2026-02-26T00:00:00.000Z"),
    },
    telegram: null,
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
  assert.deepEqual(mocks.readHostedMemberRoutingState.mock.calls[0]?.[0], {
    memberId: "member_labs",
    prisma: mocks.prisma,
  });
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
    memberLookup: null,
    session: null,
  });
  mocks.readHostedMemberRoutingState.mockResolvedValue({
    linqChatId: null,
    linqRecipientPhone: "+15550100001",
    memberId: "member_labs_email",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  });
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValue({
    email: {
      address: "member@example.test",
      murphEmailAddress: "murph+alias123@mail.withmurph.ai",
      verifiedAt: new Date("2026-02-26T00:00:00.000Z"),
    },
    phone: null,
    telegram: null,
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
    memberLookup: null,
    session: null,
  });
  mocks.readHostedMemberRoutingState.mockResolvedValue({
    linqChatId: null,
    linqRecipientPhone: null,
    memberId: "member_labs_email_without_alias",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  });
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValue({
    email: {
      address: "member@example.test",
      murphEmailAddress: null,
      verifiedAt: new Date("2026-02-26T00:00:00.000Z"),
    },
    phone: null,
    telegram: null,
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
    memberLookup: null,
    session: null,
  });
  mocks.readHostedMemberRoutingState.mockResolvedValue(null);
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValue({
    email: {
      address: "member@example.test",
      murphEmailAddress: "murph+alias123@mail.withmurph.ai",
      verifiedAt: new Date("2026-02-26T00:00:00.000Z"),
    },
    phone: null,
    telegram: {
      telegramUserId: "tg_user_123",
      username: "member_handle",
    },
  });

  const { UploadLabsMurphContactAction } = await import(
    "@/src/components/home/upload-labs-action"
  );
  const markup = renderToStaticMarkup(await UploadLabsMurphContactAction());

  assert.match(
    markup,
    /href="tg:\/\/resolve\?domain=withmurph_bot&amp;text=Here%20are%20some%20lab%20reports%20I%20want%20you%20to%20check%20out%3A"/,
  );
  assert.match(
    markup,
    /aria-label="Sync labs with Murph in Telegram"/,
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
    memberLookup: null,
    session: null,
  });
  mocks.readHostedMemberRoutingState.mockResolvedValue(null);
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValue({
    email: null,
    phone: null,
    telegram: {
      telegramUserId: "tg_user_123",
      username: "member_handle",
    },
  });

  const { UploadLabsMurphContactAction } = await import(
    "@/src/components/home/upload-labs-action"
  );
  const markup = renderToStaticMarkup(await UploadLabsMurphContactAction());

  assert.match(
    markup,
    /href="tg:\/\/resolve\?domain=withmurph_bot&amp;text=Here%20are%20some%20lab%20reports%20I%20want%20you%20to%20check%20out%3A"/,
  );
  assert.match(
    markup,
    /aria-label="Sync labs with Murph in Telegram"/,
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
