import { CheckCircle2, Clock3, ShieldAlert, XCircle, type LucideIcon } from "lucide-react";

import { ActionApprovalAuthRequiredState } from "@/src/components/sensitive-actions/action-approval-auth-required";
import { ActionApprovalCard } from "@/src/components/sensitive-actions/action-approval-card";
import { ActionApprovalScreen } from "@/src/components/sensitive-actions/action-approval-screen";
import { HostedPrivyBoundary } from "@/src/components/hosted-onboarding/hosted-privy-boundary";
import { resolveHostedMurphContactOptions } from "@/src/components/murph/hosted-murph-contact-action";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { buttonVariants } from "@/src/components/ui/button";
import {
  readHostedActionApproval,
  requireHostedActionApprovalId,
} from "@/src/lib/action-approvals";
import type { HostedActionApprovalStatus } from "@/src/lib/action-approvals-shared";
import { requireActiveHostedAppSession } from "@/src/lib/hosted-onboarding/app-session";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { getPrisma } from "@/src/lib/prisma";
import { cn } from "@/src/lib/utils";

export default async function ActionApprovalPage({
  params,
}: {
  params: Promise<{ approvalId: string }>;
}) {
  const session = await readApprovalSessionOrAuthState();
  if (!session) {
    return <ActionApprovalAuthRequiredState />;
  }

  try {
    const { approvalId: rawApprovalId } = await params;
    const approval = await readHostedActionApproval({
      approvalId: requireHostedActionApprovalId(rawApprovalId),
      memberId: session.member.id,
      prisma: getPrisma(),
    });

    if (approval.status === "pending") {
      return (
        <HostedPrivyBoundary>
          <ActionApprovalCard approval={approval} />
        </HostedPrivyBoundary>
      );
    }

    return <ActionApprovalTerminalState status={approval.status} />;
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "ACTION_APPROVAL_NOT_FOUND"
    ) {
      return <ActionApprovalUnavailableState />;
    }
    throw error;
  }
}

async function ActionApprovalTerminalState({
  status,
}: {
  status: Exclude<HostedActionApprovalStatus, "pending">;
}) {
  const content = terminalContent(status);
  const contactOptions = await resolveHostedMurphContactOptions({
    message: { body: content.replyBody },
  });

  return (
    <ActionApprovalScreen
      badgeIcon={content.icon}
      badgeTone={status === "approved" ? "primary" : "muted"}
      body={content.description}
      title={content.title}
    >
      {contactOptions.length > 0 ? (
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {contactOptions.map((option) => (
            <MurphContactLink
              actionLabel="Return to Murph"
              className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
              key={`${option.kind}:${option.href}`}
              option={option}
            >
              Return in {option.label}
            </MurphContactLink>
          ))}
        </div>
      ) : (
        <div className="mt-7">
          <p className="text-sm text-muted-foreground">
            Return to your Murph thread and reply with:
          </p>
          <p className="mt-3 break-words rounded-lg bg-muted/40 px-4 py-3 font-mono text-sm text-foreground">
            {content.replyBody}
          </p>
        </div>
      )}
    </ActionApprovalScreen>
  );
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
  description: string;
  icon: LucideIcon;
  replyBody: string;
  title: string;
}

function terminalContent(
  status: Exclude<HostedActionApprovalStatus, "pending">,
): TerminalContent {
  switch (status) {
    case "approved":
      return {
        description: "The exact action is approved. Return to Murph to continue.",
        icon: CheckCircle2,
        replyBody: "I approved the secure request.",
        title: "Approved",
      };
    case "denied":
      return {
        description: "Murph will not continue with this action.",
        icon: XCircle,
        replyBody: "I denied the secure request.",
        title: "Denied",
      };
    case "expired":
      return {
        description: "Murph cannot continue from this link. Request a new secure approval.",
        icon: Clock3,
        replyBody: "The secure approval request expired. Please send a new one.",
        title: "This request expired",
      };
  }
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
