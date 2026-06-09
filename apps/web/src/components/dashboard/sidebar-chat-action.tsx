import { MessageCircle } from "lucide-react";

import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/src/components/ui/sidebar";
import { resolveHostedMurphContactOptions } from "@/src/components/murph/hosted-murph-contact-action";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { cn } from "@/src/lib/utils";
import {
  SIDEBAR_NAV_ICON_CLASS,
  SIDEBAR_NAV_ITEM_CLASS,
} from "./sidebar-nav-classes";
import {
  SidebarChatWithMurphAuthGate,
  SidebarChatWithMurphSettingsGate,
} from "./sidebar-chat-auth-gate";
import { SidebarChatWithMurphContactDialog } from "./sidebar-chat-contact-dialog";

export function SidebarChatWithMurphFallback() {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        className={cn(SIDEBAR_NAV_ITEM_CLASS, "opacity-70")}
        disabled
        aria-busy="true"
      >
        <MessageCircle className={SIDEBAR_NAV_ICON_CLASS} />
        Chat with Murph
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export async function SidebarChatWithMurphAction() {
  const options = await resolveHostedMurphContactOptions();

  if (options.length === 0) {
    const auth = await getHostedPageAuthSnapshot();
    return auth.authenticated
      ? <SidebarChatWithMurphSettingsGate />
      : <SidebarChatWithMurphAuthGate />;
  }

  if (options.length > 1) {
    return <SidebarChatWithMurphContactDialog options={options} />;
  }

  const option = options[0];
  const opensInNewTab = option.target === "_blank";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        className={SIDEBAR_NAV_ITEM_CLASS}
        render={
          <a
            href={option.href}
            target={option.target}
            rel={option.rel}
            aria-label={`Chat with Murph in ${option.label}${
              opensInNewTab ? " (opens in a new tab)" : ""
            }`}
          >
            <MessageCircle className={SIDEBAR_NAV_ICON_CLASS} />
            Chat with Murph
          </a>
        }
      />
    </SidebarMenuItem>
  );
}
