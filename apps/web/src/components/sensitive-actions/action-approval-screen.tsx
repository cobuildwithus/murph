import type { ReactNode } from "react";

import { LinkPageScreen } from "@/src/components/link-page/link-page-shell";

// A request can end while someone approves it, so never promise that it will run.
export const ACTION_APPROVAL_RECORDED_DESCRIPTION =
  "Murph will continue if this request is still open.";

export const ACTION_APPROVAL_DENIED_DESCRIPTION =
  "Murph will not continue with this action.";

/** The file's name, from the sentence the server wrote for this request. */
export function readActionApprovalFileName(body: string): string | null {
  return /“([^”]+)”/.exec(body)?.[1] ?? null;
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
