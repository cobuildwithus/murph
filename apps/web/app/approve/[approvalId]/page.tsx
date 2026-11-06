import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ActionApprovalAuthRequiredState } from "@/src/components/sensitive-actions/action-approval-auth-required";
import { ActionApprovalCard } from "@/src/components/sensitive-actions/action-approval-card";
import {
  ActionApprovalDecisionScreen,
  ActionApprovalScreen,
  readActionApprovalFileName,
} from "@/src/components/sensitive-actions/action-approval-screen";
import { LINK_PAGE_PILL_CLASS, LinkPageFrame } from "@/src/components/link-page/link-page-shell";
import { resolveHostedMurphContactOptions } from "@/src/components/murph/hosted-murph-contact-action";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import {
  readHostedActionApproval,
  requireHostedActionApprovalId,
} from "@/src/lib/action-approvals";
import type {
  HostedActionApprovalStatus,
  HostedActionApprovalView,
} from "@/src/lib/action-approvals-shared";
import { requireActiveHostedAppSession } from "@/src/lib/hosted-onboarding/app-session";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { getPrisma } from "@/src/lib/prisma";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { APPROVE_OG_ALT } from "./approve-share-card";

type TerminalActionApprovalView = HostedActionApprovalView & {
  status: Exclude<HostedActionApprovalStatus, "pending">;
};

const EXPIRED_APPROVAL_REPLY_BODY =
  "That approval link expired. Please send a new one.";

const APPROVAL_METADATA_DESCRIPTION =
  "Review the request, then approve or deny it. Approval links expire after a short time.";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ approvalId: string }>;
}): Promise<Metadata> {
  const { approvalId } = await params;
  const ogImage = {
    alt: APPROVE_OG_ALT,
    height: 630,
    type: "image/png",
    url: `/approve/${encodeURIComponent(approvalId)}/opengraph-image`,
    width: 1200,
  } as const;

  return createMurphPageMetadata({
    title: "Murph needs your OK",
    description: APPROVAL_METADATA_DESCRIPTION,
    openGraph: { images: [ogImage] },
    twitter: { images: [ogImage] },
  });
}

export default async function ActionApprovalPage({
  params,
}: {
  params: Promise<{ approvalId: string }>;
}) {
  const session = await readApprovalSessionOrAuthState();
  if (!session) {
    return <ActionApprovalAuthRequiredState />;
  }

  const { approvalId: rawApprovalId } = await params;
  let approval: HostedActionApprovalView;
  try {
    approval = await readHostedActionApproval({
      approvalId: requireHostedActionApprovalId(rawApprovalId),
      memberId: session.member.id,
      prisma: getPrisma(),
    });
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "ACTION_APPROVAL_NOT_FOUND"
    ) {
      return (
        <LinkPageFrame>
          <ActionApprovalUnavailableState />
        </LinkPageFrame>
      );
    }
    throw error;
  }

  return (
    <LinkPageFrame>
      {isTerminalActionApproval(approval) ? (
        <ActionApprovalTerminalState approval={approval} />
      ) : (
        <ActionApprovalCard approval={approval} />
      )}
    </LinkPageFrame>
  );
}

async function ActionApprovalTerminalState({
  approval,
}: {
  approval: TerminalActionApprovalView;
}) {
  const replyBody = approval.returnContactKind === null
    ? null
    : terminalReplyBody(approval.status);
  const contactOptions = approval.returnContactKind === null
    ? []
    : await resolveHostedMurphContactOptions({
        ...(replyBody
          ? { message: { body: replyBody } }
          : {}),
        preferredKind: approval.returnContactKind,
      }).catch(() => []);

  // Approved revisits return to the originating conversation. The durable
  // system wake asks the runtime to resume only if it still owns the action;
  // no foreground confirmation message is required.
  // Denied/expired stay on-screen so the member can read what happened first.
  if (approval.status === "approved" && contactOptions[0]?.href) {
    redirect(contactOptions[0].href);
  }

  const contactOption = contactOptions[0] ?? null;
  const actionLabel = approval.status === "expired" ? "Request a new link" : "Return to Murph";
  const contactLink = contactOption ? (
    <MurphContactLink
      actionLabel={actionLabel}
      className={LINK_PAGE_PILL_CLASS}
      option={contactOption}
    >
      {actionLabel}
    </MurphContactLink>
  ) : undefined;

  if (approval.status !== "expired") {
    return (
      <ActionApprovalDecisionScreen
        action={contactLink}
        decision={approval.status}
        fileName={readActionApprovalFileName(approval.presentation.body)}
      />
    );
  }

  return (
    <ActionApprovalScreen
      actions={contactLink}
      body="Nothing was approved or changed."
      title="This link expired."
    >
      {!contactOption && replyBody ? (
        <div className="flex flex-col gap-2">
          <p className="text-base font-medium leading-[22px] text-[#FFFCF6]/60">
            Return to the Murph conversation where this request started and send:
          </p>
          <p className="break-words rounded-[18px] bg-[#2A2622] px-4 py-3 text-base font-semibold leading-[22px]">
            {replyBody}
          </p>
        </div>
      ) : null}
      {!contactOption && !replyBody ? (
        <p className="text-center text-base font-medium leading-[22px] text-[#FFFCF6]/60">
          Return to the Murph conversation where this request started.
        </p>
      ) : null}
    </ActionApprovalScreen>
  );
}

function terminalReplyBody(
  status: Exclude<HostedActionApprovalStatus, "pending">,
): string | null {
  switch (status) {
    case "approved":
      return null;
    case "expired":
      return EXPIRED_APPROVAL_REPLY_BODY;
    case "denied":
      return null;
  }
}

function ActionApprovalUnavailableState() {
  return (
    <ActionApprovalScreen
      body="It may belong to another Murph account or no longer exist. Return to Murph and request a new approval link."
      title="This link isn’t available."
    />
  );
}

function isTerminalActionApproval(
  approval: HostedActionApprovalView,
): approval is TerminalActionApprovalView {
  return approval.status !== "pending";
}

async function readApprovalSessionOrAuthState() {
  try {
    return await requireActiveHostedAppSession();
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "AUTH_REQUIRED"
      && error.httpStatus === 401
    ) {
      return null;
    }
    throw error;
  }
}
