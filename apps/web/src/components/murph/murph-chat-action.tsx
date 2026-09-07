"use client";

import { MessageCircle } from "lucide-react";
import { cloneElement, useState, type ReactElement } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { Button, buttonVariants } from "@/src/components/ui/button";
import { MurphContactDialog } from "./murph-contact-dialog";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

type ChatTriggerProps = {
  "aria-label"?: string;
  onClick?: () => void;
  render?: ReactElement;
};

export interface MurphChatActionProps {
  options: readonly MurphContactOption[];
  authenticated: boolean;
  label?: string;
  button?: ReactElement<ChatTriggerProps>;
}

export function MurphChatActionFallback() {
  return (
    <Button size="lg" disabled aria-busy="true">
      <MessageCircle data-icon="inline-start" />
      Message Murph
    </Button>
  );
}

export function MurphChatAction({
  options,
  authenticated,
  label = "Message Murph",
  button,
}: MurphChatActionProps) {
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const option = options.length === 1 ? options[0] : null;
  const needsSettings = options.length === 0 && authenticated;
  const content = <><MessageCircle data-icon="inline-start" />{label}</>;
  const trigger = button ?? <Button size="lg">{content}</Button>;

  if (options.length > 1) {
    return <MurphContactDialog options={options} trigger={cloneElement(trigger, { "aria-label": label })} />;
  }

  if (option || needsSettings) {
    const link = (
      <a
        href={option?.href ?? "/settings"}
        target={option?.target}
        rel={option?.rel}
        aria-label={option
          ? `${label} in ${option.label}${option.target === "_blank" ? " (opens in a new tab)" : ""}`
          : `Link a contact method to ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
      />
    );
    return button
      ? cloneElement(button, { render: link })
      : cloneElement(link, { className: buttonVariants({ size: "lg" }) }, content);
  }

  return (
    <>
      {cloneElement(trigger, { onClick: () => setAuthDialogOpen(true) })}
      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        requireLaunchConsentOnCompletion
      />
    </>
  );
}
