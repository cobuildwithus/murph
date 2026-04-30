import { MessageCircle } from "lucide-react";

import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/src/components/ui/sidebar";
import { resolveHostedMurphContactOption } from "@/src/components/murph/hosted-murph-contact-action";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { cn } from "@/src/lib/utils";

const SIDEBAR_CHAT_MENU_BUTTON_CLASS =
  "rounded-lg px-4 py-3.5 text-[15px] text-white/70 hover:bg-white/5 hover:text-white/80 active:bg-white/5 active:text-white/80 data-active:bg-white/10 data-active:text-white";

export function SidebarChatWithMurphFallback() {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        className={cn(SIDEBAR_CHAT_MENU_BUTTON_CLASS, "opacity-70")}
        disabled
        aria-busy="true"
      >
        <MessageCircle className="size-5 shrink-0" />
        Chat with Murph
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export async function SidebarChatWithMurphAction() {
  const option = await resolveHostedMurphContactOption();

  if (!option) {
    return <SidebarChatWithMurphFallback />;
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        className={SIDEBAR_CHAT_MENU_BUTTON_CLASS}
        render={
          <MurphContactLink
            actionLabel="Chat with Murph"
            option={option}
          >
            <MessageCircle className="size-5 shrink-0" />
            Chat with Murph
          </MurphContactLink>
        }
      />
    </SidebarMenuItem>
  );
}
