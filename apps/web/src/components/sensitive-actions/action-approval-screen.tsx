import {
  CheckCircle2,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type {
  HostedActionApprovalContinuation,
  HostedActionApprovalPresentationKind,
} from "@/src/lib/action-approvals-shared";
import { cn } from "@/src/lib/utils";

type BadgeTone = "primary" | "muted";

interface ActionApprovalScreenProps {
  badgeIcon: LucideIcon;
  badgeTone?: BadgeTone;
  body: ReactNode;
  caveat?: ReactNode;
  children?: ReactNode;
  title: string;
  titleId?: string;
  titleTabIndex?: -1;
}

export const ACTION_APPROVAL_RETURN_TO_CONTINUE =
  "Return to the Murph conversation where you requested this action, then ask Murph to continue.";

const ACTION_APPROVAL_CAVEAT =
  "If any approved detail changes, Murph will ask again.";

export function ActionApprovalPresentationBody({
  body,
  kind,
}: {
  body: string;
  kind: HostedActionApprovalPresentationKind;
}) {
  const segments = kind === "fact-rows" ? body.split(" · ") : [body];
  return (
    <div
      className={cn("break-words", kind === "fact-rows" && "space-y-2")}
      data-action-approval-presentation={kind}
    >
      {segments.map((segment, index) => (
        <p key={`${index}:${segment}`}>{segment}</p>
      ))}
    </div>
  );
}

export function ActionApprovalRequestScreen({
  body,
  children,
  title,
}: {
  body: ReactNode;
  children?: ReactNode;
  title: string;
}) {
  return (
    <ActionApprovalScreen
      badgeIcon={ShieldCheck}
      body={body}
      caveat={ACTION_APPROVAL_CAVEAT}
      title={title}
    >
      {children}
    </ActionApprovalScreen>
  );
}

export function ActionApprovalDecisionMessage({
  continuation,
  redirectTo,
  showOutcome = true,
  status,
}: {
  continuation: HostedActionApprovalContinuation;
  redirectTo: string | null;
  showOutcome?: boolean;
  status: "approved" | "denied";
}) {
  if (redirectTo !== null) {
    return (
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {status === "approved" ? "Approval saved." : "Request denied."}{" "}
        <a className="text-[#5a6e32] underline-offset-4 hover:underline" href={redirectTo}>
          Return to Murph
        </a>
      </p>
    );
  }
  if (status === "denied") {
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        {showOutcome ? "Request denied. " : null}
        Murph will not continue this action.
      </p>
    );
  }
  return (
    <p className="text-sm leading-6 text-muted-foreground">
      {showOutcome ? "Approval saved. " : null}
      {continuation === "return-to-conversation"
        ? ACTION_APPROVAL_RETURN_TO_CONTINUE
        : "Murph can continue this action."}
    </p>
  );
}

export function ActionApprovalTerminalDecisionScreen({
  announcement,
  continuation,
  redirectTo,
  status,
  titleId,
}: {
  announcement?: string;
  continuation: HostedActionApprovalContinuation;
  redirectTo: string | null;
  status: "approved" | "denied";
  titleId?: string;
}) {
  const approved = status === "approved";
  const showDecisionMessage = approved || redirectTo !== null;
  return (
    <ActionApprovalScreen
      badgeIcon={approved ? CheckCircle2 : XCircle}
      badgeTone={approved ? "primary" : "muted"}
      body={approved
        ? "You approved this action."
        : "Murph will not continue with this action."}
      title={approved ? "Approved" : "Denied"}
      {...(titleId ? { titleId, titleTabIndex: -1 } : {})}
    >
      {showDecisionMessage ? (
        <div className="mt-7 border-t border-[#c4a882]/25 pt-6">
          <ActionApprovalDecisionMessage
            continuation={continuation}
            redirectTo={redirectTo}
            showOutcome={false}
            status={status}
          />
        </div>
      ) : null}
      {announcement ? (
        <p aria-live="polite" className="sr-only" role="status">
          {announcement}
        </p>
      ) : null}
    </ActionApprovalScreen>
  );
}

export function ActionApprovalScreen({
  badgeIcon: BadgeIcon,
  badgeTone = "primary",
  body,
  caveat,
  children,
  title,
  titleId,
  titleTabIndex,
}: ActionApprovalScreenProps) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6 sm:py-14">
      <section className="mx-auto flex min-h-[78vh] max-w-xl flex-col justify-center">
        <article className="rounded-2xl border border-[#c4a882]/25 bg-[rgba(255,252,246,0.9)] p-7 sm:p-10">
          <header className="flex items-center gap-3.5">
            <span
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full border",
                badgeTone === "primary"
                  ? "border-[#7a8c6e]/30 bg-[#7a8c6e]/12"
                  : "border-[#c4a882]/40 bg-[rgba(196,168,130,0.18)]",
              )}
            >
              <BadgeIcon
                aria-hidden="true"
                className={cn(
                  "h-[18px] w-[18px]",
                  badgeTone === "primary" ? "text-[#5a6e32]" : "text-muted-foreground",
                )}
              />
            </span>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Secure approval
            </p>
          </header>

          <h1
            className="mt-7 font-serif text-[2.125rem] leading-[1.05] tracking-[-0.02em] text-foreground text-balance sm:text-[2.5rem]"
            id={titleId}
            tabIndex={titleTabIndex}
          >
            {title}
          </h1>

          <div className="mt-5 text-[15px] leading-[1.6] text-muted-foreground text-pretty">
            {body}
          </div>

          {caveat ? (
            <div className="mt-6 border-l-[3px] border-l-[#7a8c6e] py-0.5 pl-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#5a6e32]">
                Only applies to this request
              </p>
              <p className="mt-1.5 text-[13px] leading-[1.55] text-muted-foreground">
                {caveat}
              </p>
            </div>
          ) : null}

          {children}
        </article>
      </section>
    </main>
  );
}
