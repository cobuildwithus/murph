import { Check, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";

import { HostedGroupStartFrame } from "@/src/components/hosted-groups/group-start-frame";
import { Button } from "@/src/components/ui/button";

export function GroupStartStudy() {
  return (
    <div
      id="linq-unknown-group-recovery"
      data-design-section="linq-unknown-group-recovery"
      className="grid gap-6 lg:grid-cols-3"
      inert
    >
      <StudyCard>
        <HostedGroupStartFrame
          icon={<MessageCircle className="size-8" />}
          title="Set up Murph for this group"
          body="Create or open your Murph account. When setup is finished, return to the group and message Murph again."
        >
          <Button type="button" size="xl" className="w-full">
            Continue
          </Button>
        </HostedGroupStartFrame>
      </StudyCard>

      <StudyCard>
        <HostedGroupStartFrame
          icon={<MessageCircle className="size-8" />}
          title="Finish setting up Murph"
          body="Complete setup, then return to the group and message Murph again."
        >
          <Button type="button" size="xl" className="w-full">
            Finish setup
          </Button>
        </HostedGroupStartFrame>
      </StudyCard>

      <StudyCard>
        <HostedGroupStartFrame
          icon={<Check className="size-8" />}
          title="Go back to the group"
          body="Message Murph in that group again. Your next message will connect the chat and Murph will reply there."
        />
      </StudyCard>
    </div>
  );
}

function StudyCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-border bg-background p-6 shadow-sm">
      {children}
    </div>
  );
}
