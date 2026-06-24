import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  readHostedFamilyInviteAcceptanceView: vi.fn(),
  signInButtonProps: null as { bindingLabel: string } | null,
  signInButtonRendered: false,
  webAcceptButtonProps: null as { inviteCode: string } | null,
}));

vi.mock("@/src/components/family/family-invite-accept-client", () => ({
  FamilyInviteSignInButton(props: { bindingLabel: string }) {
    mocks.signInButtonProps = props;
    mocks.signInButtonRendered = true;
    return createElement("button", { "data-family-sign-in": "true" }, "Sign in to join");
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
  readHostedFamilyInviteAcceptanceView: mocks.readHostedFamilyInviteAcceptanceView,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

const EMAIL_BOUND_VIEW = {
  groupActive: true,
  groupDisplayName: "Kim Family",
  inviteCode: "CODEMAIL",
  isEmailBound: true,
  isPhoneBound: false,
  seatAvailable: true,
  status: "pending",
  targetLabel: "Pat",
  telegramInviteUrl: "https://t.me/withmurph_bot?start=family_CODEMAIL",
  webAcceptable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signInButtonProps = null;
  mocks.signInButtonRendered = false;
  mocks.webAcceptButtonProps = null;
  mocks.readHostedFamilyInviteAcceptanceView.mockResolvedValue(EMAIL_BOUND_VIEW);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({ authenticated: false });
});

test("renders the web sign-in path for unauthenticated email-bound invites", async () => {
  const markup = await renderFamilyAcceptPage();

  expect(mocks.signInButtonRendered).toBe(true);
  expect(mocks.signInButtonProps).toEqual({ bindingLabel: "email address" });
  expect(markup).toContain("Sign in to join");
  expect(markup).toContain("Sign in with the email address this invite was sent to");
  expect(markup).not.toContain("Continue in Telegram");
  expect(markup).not.toContain("Open this in Telegram");
});

test("renders the web accept path for authenticated email-bound invites", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({ authenticated: true });

  const markup = await renderFamilyAcceptPage();

  expect(mocks.webAcceptButtonProps).toEqual({ inviteCode: "CODEMAIL" });
  expect(markup).toContain("Accept invite");
  expect(markup).not.toContain("Continue in Telegram");
  expect(markup).not.toContain("Open this in Telegram");
});

async function renderFamilyAcceptPage(): Promise<string> {
  const { default: FamilyAcceptPage } = await import("../app/family/accept/[inviteCode]/page");

  return renderToStaticMarkup(
    await FamilyAcceptPage({
      params: Promise.resolve({ inviteCode: "CODEMAIL" }),
    }),
  );
}
