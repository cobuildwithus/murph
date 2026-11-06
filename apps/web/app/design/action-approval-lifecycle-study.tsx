import { AuthProvider } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { LinkPageSheet } from "@/src/components/link-page/link-page-sheet";
import { LinkPageSurface } from "@/src/components/link-page/link-page-shell";
import { LinkPageSignInScreen } from "@/src/components/link-page/link-page-sign-in";
import { ActionApprovalCard } from "@/src/components/sensitive-actions/action-approval-card";
import {
  ACTION_APPROVAL_DENIED_DESCRIPTION,
  ACTION_APPROVAL_RECORDED_DESCRIPTION,
  ActionApprovalScreen,
} from "@/src/components/sensitive-actions/action-approval-screen";

const STUDY_BODY = "Murph will send “report.zip” (1.2 MB) to your current iMessage chat.";

export function ActionApprovalLifecycleStudy() {
  return (
    <div
      className="grid gap-8 xl:grid-cols-3"
      data-design-section="action-approval-lifecycle"
    >
      <div className="flex min-h-[46rem] flex-col rounded-[2rem] bg-[#1C1915]" inert>
        <LinkPageSurface>
          <AuthProvider authenticated={false}>
            <LinkPageSignInScreen
              detail="It’s private to the account that received it."
              title="Sign in to review this request."
            >
              <LinkPageSheet locked />
            </LinkPageSignInScreen>
          </AuthProvider>
        </LinkPageSurface>
      </div>

      <div
        className="flex min-h-[46rem] flex-col rounded-[2rem] bg-[#1C1915]"
        data-approval-study="pending"
        inert
      >
        <LinkPageSurface>
          <AuthProvider authenticated>
            <ActionApprovalCard approval={{
              approvalId: "haa_" + "a".repeat(32),
              expiresAt: "2099-01-01T00:00:00Z",
              presentation: { title: "Send a file from your vault?", body: STUDY_BODY },
              returnContactKind: "text",
              status: "pending",
            }} />
          </AuthProvider>
        </LinkPageSurface>
      </div>

      <DecisionStudy decision="Approved" />
      <DecisionStudy decision="Denied" />
    </div>
  );
}

function DecisionStudy({ decision }: { decision: "Approved" | "Denied" }) {
  return (
    <div className="flex min-h-[46rem] flex-col rounded-[2rem] bg-[#1C1915]" inert>
      <LinkPageSurface>
        <ActionApprovalScreen
          body={decision === "Approved"
            ? ACTION_APPROVAL_RECORDED_DESCRIPTION
            : ACTION_APPROVAL_DENIED_DESCRIPTION}
          title={`${decision}.`}
        >
          <LinkPageSheet name="report.zip" stamp={decision} />
        </ActionApprovalScreen>
      </LinkPageSurface>
    </div>
  );
}
