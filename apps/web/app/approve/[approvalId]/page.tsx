import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  ShieldAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { redirect } from "next/navigation";

import { ActionApprovalAuthRequiredState } from "@/src/components/sensitive-actions/action-approval-auth-required";
import { ActionApprovalCard } from "@/src/components/sensitive-actions/action-approval-card";
import {
  ACTION_APPROVAL_DENIED_DESCRIPTION,
  ACTION_APPROVAL_RECORDED_DESCRIPTION,
  ActionApprovalScreen,
} from "@/src/components/sensitive-actions/action-approval-screen";
import { HostedPrivyBoundary } from "@/src/components/hosted-onboarding/hosted-privy-boundary";
import { resolveHostedMurphContactOptions } from "@/src/components/murph/hosted-murph-contact-action";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { buttonVariants } from "@/src/components/ui/button";
import { Separator } from "@/src/components/ui/separator";
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
import { cn } from "@/src/lib/utils";

type TerminalActionApprovalView = HostedActionApprovalView & {
  status: Exclude<HostedActionApprovalStatus, "pending">;
};

const EXPIRED_APPROVAL_REPLY_BODY =
  "That approval link expired. Please send a new one.";

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
      return <ActionApprovalUnavailableState />;
    }
    throw error;
  }

  if (!isTerminalActionApproval(approval)) {
    return (
      <HostedPrivyBoundary>
        <ActionApprovalCard approval={approval} />
      </HostedPrivyBoundary>
    );
  }

  return <ActionApprovalTerminalState approval={approval} />;
}

async function ActionApprovalTerminalState({
  approval,
}: {
  approval: TerminalActionApprovalView;
}) {
  const content = terminalContent(approval.status);
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

  return (
    <ActionApprovalScreen
      badgeIcon={content.icon}
      badgeTone={approval.status === "approved" ? "primary" : "muted"}
      body={content.description}
      title={content.title}
    >
      <div className="mt-7 flex flex-col gap-6">
        <Separator />
        {contactOption ? (
          <MurphContactLink
            actionLabel={content.actionLabel}
            className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-fit")}
            option={contactOption}
          >
            {content.actionLabel}
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </MurphContactLink>
        ) : replyBody ? (
          <div>
            <p className="text-sm text-muted-foreground">
              Return to the Murph conversation where this request started and
              send:
            </p>
            <p className="mt-3 break-words rounded-lg bg-muted/40 px-4 py-3 font-mono text-sm text-foreground">
              {replyBody}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Return to the Murph conversation where this request started.
          </p>
        )}
      </div>
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
      badgeIcon={ShieldAlert}
      badgeTone="muted"
      body="It may belong to another Murph account or no longer exist. Return to Murph and request a new approval link."
      title="This link is unavailable"
    />
  );
}

interface TerminalContent {
  actionLabel: string;
  description: string;
  icon: LucideIcon;
  title: string;
}

function terminalContent(
  status: Exclude<HostedActionApprovalStatus, "pending">,
): TerminalContent {
  switch (status) {
    case "approved":
      return {
        actionLabel: "Return to Murph",
        description: ACTION_APPROVAL_RECORDED_DESCRIPTION,
        icon: CheckCircle2,
        title: "Approved",
      };
    case "denied":
      return {
        actionLabel: "Return to Murph",
        description: ACTION_APPROVAL_DENIED_DESCRIPTION,
        icon: XCircle,
        title: "Denied",
      };
    case "expired":
      return {
        actionLabel: "Request a new link",
        description:
          "Approval links expire after a short time for your security. Nothing was approved or changed.",
        icon: Clock3,
        title: "Approval link expired",
      };
  }
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
