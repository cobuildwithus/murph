import { CheckCircle2, ShieldCheck } from "lucide-react";

import {
  ACTION_APPROVAL_PENDING_CAVEAT,
  ACTION_APPROVAL_RECORDED_DESCRIPTION,
  ActionApprovalScreen,
} from "@/src/components/sensitive-actions/action-approval-screen";
import { Button } from "@/src/components/ui/button";
import { Separator } from "@/src/components/ui/separator";

export function ActionApprovalLifecycleStudy() {
  return (
    <div
      className="grid gap-8 lg:grid-cols-2 [&_main]:min-h-0 [&_main]:bg-transparent [&_main]:p-0 [&_section]:min-h-0"
      data-design-section="action-approval-lifecycle"
    >
      <div inert>
        <ActionApprovalScreen
          badgeIcon={ShieldCheck}
          body={<p>Send generated report.zip to this conversation.</p>}
          caveat={ACTION_APPROVAL_PENDING_CAVEAT}
          title="Send this file?"
        >
          <div className="mt-7 border-t border-[#c4a882]/25 pt-6">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg">Approve with passkey</Button>
              <Button size="lg" variant="ghost">Deny</Button>
            </div>
          </div>
        </ActionApprovalScreen>
      </div>

      <div inert>
        <ActionApprovalScreen
          badgeIcon={CheckCircle2}
          body={ACTION_APPROVAL_RECORDED_DESCRIPTION}
          title="Approved"
        >
          <div className="mt-7 flex flex-col gap-6">
            <Separator />
            <Button className="w-full sm:w-fit" size="lg">
              Return to Murph
            </Button>
          </div>
        </ActionApprovalScreen>
      </div>
    </div>
  );
}
