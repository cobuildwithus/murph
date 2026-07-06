import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  readConfiguredMurphPhoneNumbers: vi.fn<() => string[]>(),
  readHostedFamilyInviteAcceptanceView: vi.fn(),
  signInButtonProps: null as {
    bindingLabel: string;
    description?: string;
    variant?: string;
  } | null,
  signInButtonRendered: false,
  webAcceptButtonProps: null as { inviteCode: string } | null,
}));

vi.mock("@/src/components/family/family-invite-accept-client", () => ({
  FamilyInviteSignInButton(props: {
    bindingLabel: string;
    description?: string;
    variant?: string;
  }) {
    mocks.signInButtonProps = props;
    mocks.signInButtonRendered = true;
    return createElement(
      "button",
      { "data-family-sign-in": props.variant ?? "primary" },
      props.variant === "link" ? "Sign in on the web instead" : "Sign in to join",
    );
  },
  FamilyInviteWebAcceptButton(props: { inviteCode: string }) {
    mocks.webAcceptButtonProps = props;
    return createElement(
      "button",
      { "data-family-web-accept": props.inviteCode },
      "Accept invite",
    );
  },
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  buildHostedFamilyInviteMessagesHref: (input: {
    inviteCode: string;
    murphPhoneNumber: string;
  }) => `sms:${input.murphPhoneNumber}?body=Hi%20Murph%2C%20joining%20the%20family%20plan%20(code%20family_${input.inviteCode})`,
  readHostedFamilyInviteAcceptanceView: mocks.readHostedFamilyInviteAcceptanceView,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/device-sync/messaging-return-destination", () => ({
  readConfiguredMurphPhoneNumbers: mocks.readConfiguredMurphPhoneNumbers,
}));

const BASE_VIEW = {
  groupActive: true,
  groupDisplayName: "Kim Family",
  inviteCode: "CODE",
  isEmailBound: false,
  isPhoneBound: false,
  isTelegramBound: false,
  messagesRecipientPhone: null,
  seatAvailable: true,
  status: "pending",
  targetLabel: "Pat",
  telegramInviteUrl: null,
  webAcceptable: false,
};

const EMAIL_BOUND_VIEW = {
  ...BASE_VIEW,
  inviteCode: "CODEMAIL",
  isEmailBound: true,
  webAcceptable: true,
};

const PHONE_BOUND_VIEW = {
  ...BASE_VIEW,
  inviteCode: "CODEPHONE",
  isPhoneBound: true,
  messagesRecipientPhone: "+15551230000",
  webAcceptable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signInButtonProps = null;
  mocks.signInButtonRendered = false;
  mocks.webAcceptButtonProps = null;
  mocks.readConfiguredMurphPhoneNumbers.mockReturnValue([]);
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue(EMAIL_BOUND_VIEW);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({ authenticated: false });
});

test("renders the web sign-in path for unauthenticated email-bound invites", async () => {
  const markup = await renderFamilyAcceptPage("CODEMAIL");

  expect(mocks.signInButtonRendered).toBe(true);
  expect(mocks.signInButtonProps).toEqual({ bindingLabel: "email address" });
  expect(markup).toContain("Sign in to join");
  expect(markup).toContain("Sign in with the email address this invite was sent to");
  expect(markup).not.toContain("Continue in Telegram");
  expect(markup).not.toContain("Continue in Messages");
});

test("renders the web accept path for authenticated email-bound invites", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({ authenticated: true });

  const markup = await renderFamilyAcceptPage("CODEMAIL");

  expect(mocks.webAcceptButtonProps).toEqual({ inviteCode: "CODEMAIL" });
  expect(markup).toContain("Accept invite");
  expect(markup).not.toContain("Continue in Telegram");
  expect(markup).not.toContain("Continue in Messages");
});

test("leads phone-bound invites with the Messages accept path, not Telegram", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue(PHONE_BOUND_VIEW);

  const markup = await renderFamilyAcceptPage("CODEPHONE");

  expect(markup).toContain("Continue in Messages");
  expect(markup).toContain(
    "sms:+15551230000?body=Hi%20Murph%2C%20joining%20the%20family%20plan%20(code%20family_CODEPHONE)",
  );
  expect(markup).toContain("This opens a text to Murph");
  // The web sign-in is offered only as a compact secondary option.
  expect(mocks.signInButtonProps).toEqual({
    bindingLabel: "phone number",
    variant: "link",
  });
  expect(markup).not.toContain("Continue in Telegram");
});

test("falls back to a configured Murph line for a brand-new phone invitee", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue({
    ...PHONE_BOUND_VIEW,
    messagesRecipientPhone: null,
  });
  mocks.readConfiguredMurphPhoneNumbers.mockReturnValue(["+15559990000"]);

  const markup = await renderFamilyAcceptPage("CODEPHONE");

  expect(markup).toContain(
    "sms:+15559990000?body=Hi%20Murph%2C%20joining%20the%20family%20plan%20(code%20family_CODEPHONE)",
  );
  expect(markup).toContain("Continue in Messages");
});

test("uses the one-tap web accept path for authenticated phone-bound invites", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue(PHONE_BOUND_VIEW);
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({ authenticated: true });

  const markup = await renderFamilyAcceptPage("CODEPHONE");

  expect(mocks.webAcceptButtonProps).toEqual({ inviteCode: "CODEPHONE" });
  expect(markup).toContain("Accept invite");
  expect(markup).toContain("Continue in Messages");
  expect(markup).toContain(
    "sms:+15551230000?body=Hi%20Murph%2C%20joining%20the%20family%20plan%20(code%20family_CODEPHONE)",
  );
  expect(markup).toContain(
    "Joining by text works from the phone this invite was sent to.",
  );
});

test("continues in Telegram only for Telegram-bound invites", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue({
    ...BASE_VIEW,
    inviteCode: "CODETG",
    isTelegramBound: true,
    telegramInviteUrl: "https://t.me/withmurph_bot?start=family_CODETG",
  });

  const markup = await renderFamilyAcceptPage("CODETG");

  expect(markup).toContain("Continue in Telegram");
  expect(markup).toContain("https://t.me/withmurph_bot?start=family_CODETG");
  expect(markup).not.toContain("Continue in Messages");
  expect(mocks.signInButtonRendered).toBe(false);
});

test("shows Messages, web sign-in, and Telegram options for a label-only invite", async () => {
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue({
    ...BASE_VIEW,
    inviteCode: "CODELABEL",
    telegramInviteUrl: "https://t.me/withmurph_bot?start=family_CODELABEL",
    webAcceptable: true,
  });
  mocks.readConfiguredMurphPhoneNumbers.mockReturnValue(["+15559990000"]);

  const markup = await renderFamilyAcceptPage("CODELABEL");

  expect(markup).toContain("Continue in Messages");
  expect(markup).toContain(
    "sms:+15559990000?body=Hi%20Murph%2C%20joining%20the%20family%20plan%20(code%20family_CODELABEL)",
  );
  expect(markup).toContain("Sign in on the web instead");
  expect(markup).toContain("Continue in Telegram");
  expect(markup).toContain("https://t.me/withmurph_bot?start=family_CODELABEL");
  expect(mocks.signInButtonProps).toEqual({
    bindingLabel: "your phone number or email address",
    description: "Sign in with your own phone number or email address. We'll bring you back here.",
    variant: "link",
  });
  expect(markup).not.toContain("Open this invite from the chat where you received it");
});

async function renderFamilyAcceptPage(inviteCode: string): Promise<string> {
  const { default: FamilyAcceptPage } = await import("../app/family/accept/[inviteCode]/page");

  return renderToStaticMarkup(
    await FamilyAcceptPage({
      params: Promise.resolve({ inviteCode }),
    }),
  );
}
