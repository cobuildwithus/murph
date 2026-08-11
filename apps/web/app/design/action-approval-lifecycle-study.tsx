import { ShieldCheck } from "lucide-react";

import {
  ActionApprovalDecisionFallback,
  ActionApprovalScreen,
} from "@/src/components/sensitive-actions/action-approval-screen";
import { Button } from "@/src/components/ui/button";

export function ActionApprovalLifecycleStudy() {
  return (
    <div
      className="grid gap-8 xl:grid-cols-3 [&_main]:min-h-0 [&_main]:min-w-0 [&_main]:bg-transparent [&_main]:p-0 [&_section]:min-h-0 [&_section]:min-w-0"
      data-design-section="action-approval-lifecycle"
    >
      <div inert>
        <ActionApprovalScreen
          badgeIcon={ShieldCheck}
          body={<p>Send generated report.zip to this conversation.</p>}
          title="Send this file?"
        >
          <div className="mt-7 border-t border-[#c4a882]/25 pt-6">
            <div className="flex flex-col gap-3">
              <Button size="lg">Approve with passkey</Button>
              <Button size="lg" variant="ghost">Deny</Button>
            </div>
          </div>
        </ActionApprovalScreen>
      </div>

      <div inert>
        <DecisionFallbackStudy decision="approved" />
      </div>

      <div inert>
        <DecisionFallbackStudy decision="denied" />
      </div>
    </div>
  );
}

function DecisionFallbackStudy({
  decision,
}: {
  decision: "approved" | "denied";
}) {
  return (
    <ActionApprovalScreen
      badgeIcon={ShieldCheck}
      body={<p>Send generated report.zip to this conversation.</p>}
      title="Send this file?"
    >
      <div className="mt-7 border-t border-[#c4a882]/25 pt-6">
        <div className="flex flex-col gap-3">
          <Button disabled size="lg">Approve with passkey</Button>
          <Button disabled size="lg" variant="ghost">Deny</Button>
        </div>
        <ActionApprovalDecisionFallback decision={decision} />
      </div>
    </ActionApprovalScreen>
  );
}
