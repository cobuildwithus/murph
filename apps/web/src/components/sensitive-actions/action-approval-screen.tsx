import type { ReactNode } from "react";

import { LinkPageSheet } from "@/src/components/link-page/link-page-sheet";
import { LinkPageScreen } from "@/src/components/link-page/link-page-shell";

// A request can end while someone approves it, so never promise that it will run.
export const ACTION_APPROVAL_RECORDED_DESCRIPTION =
  "Murph will continue if this request is still open.";

export const ACTION_APPROVAL_DENIED_DESCRIPTION =
  "Murph will not continue with this action.";

/**
 * The file's name, from the sentence the server wrote for this request. A name
 * may itself contain a closing quote, so read to the last one: a shortened name
 * here would misstate what is being approved.
 */
export function readActionApprovalFileName(body: string): string | null {
  return /“(.+)”/su.exec(body)?.[1] ?? null;
}

export function ActionApprovalScreen({
  actions,
  body,
  children,
  title,
}: {
  actions?: ReactNode;
  body: ReactNode;
  children?: ReactNode;
  title: string;
}) {
  return (
    <LinkPageScreen actions={actions} announceDetail={false} detail={body} title={title}>
      {children}
    </LinkPageScreen>
  );
}

/** The result of a decision, wherever it is shown: right after it, or on a revisit. */
export function ActionApprovalDecisionScreen({
  action,
  decision,
  fileName,
}: {
  action?: ReactNode;
  decision: "approved" | "denied";
  fileName: string | null;
}) {
  const approved = decision === "approved";
  return (
    <ActionApprovalScreen
      actions={action}
      body={approved ? ACTION_APPROVAL_RECORDED_DESCRIPTION : ACTION_APPROVAL_DENIED_DESCRIPTION}
      title={approved ? "Approved." : "Denied."}
    >
      <LinkPageSheet name={fileName} stamp={approved ? "Approved" : "Denied"} />
      {action ? null : (
        <p className="pt-6 text-center text-base font-medium leading-[22px] text-[#FFFCF6]/60">
          Return to the Murph conversation where this request started.
        </p>
      )}
    </ActionApprovalScreen>
  );
}
