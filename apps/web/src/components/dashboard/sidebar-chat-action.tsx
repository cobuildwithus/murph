import { MessageCircle } from "lucide-react";

import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/src/components/ui/sidebar";
import {
  resolvePreferredMurphChatContactOption,
} from "@/src/lib/murph-contact-routing";
import { getHostedMurphContactContext } from "@/src/lib/hosted-onboarding/hosted-contact-context";
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
  const { initialContactChannels, murphPhoneNumber } = await getHostedMurphContactContext();
  const option = resolvePreferredMurphChatContactOption({
    contactChannels: initialContactChannels,
    murphPhoneNumber,
  });

  if (!option) {
    return <SidebarChatWithMurphFallback />;
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        className={SIDEBAR_CHAT_MENU_BUTTON_CLASS}
        render={<SidebarChatWithMurphLink option={option} />}
      />
    </SidebarMenuItem>
  );
}

function SidebarChatWithMurphLink({
  option,
}: {
  option: NonNullable<ReturnType<typeof resolvePreferredMurphChatContactOption>>;
}) {
  const opensInNewTab = option.target === "_blank";

  return (
    <a
      href={option.href}
      target={option.target}
      rel={option.rel}
      aria-label={`Chat with Murph in ${option.label}${
        opensInNewTab ? " (opens in a new tab)" : ""
      }`}
    >
      <MessageCircle className="size-5 shrink-0" />
      Chat with Murph
      {opensInNewTab ? <span className="sr-only"> Opens in a new tab.</span> : null}
    </a>
  );
}
