import Link from "next/link";
import { MessageCircle } from "lucide-react";

import { resolveHostedMurphContactOption } from "@/src/components/murph/hosted-murph-contact-action";
import { MurphContactAuthButton } from "@/src/components/murph/murph-contact-auth-button";
import { AuthButton } from "@/src/components/ui/auth-button";
import { Button, buttonVariants } from "@/src/components/ui/button";

interface LabBiomarkerChatActionProps {
  authenticated: boolean;
  displayName: string;
}

export function LabBiomarkerChatActionFallback() {
  return (
    <Button aria-busy="true" disabled size="lg" variant="outline">
      <MessageCircle aria-hidden="true" />
      Chat with Murph
    </Button>
  );
}

export async function LabBiomarkerChatAction({
  authenticated,
  displayName,
}: LabBiomarkerChatActionProps) {
  const option = await resolveHostedMurphContactOption({
    message: {
      body: `Let's chat about my ${displayName}.`,
      subject: `My ${displayName} result`,
    },
  });

  if (!option) {
    if (authenticated) {
      return (
        <Button
          aria-label="Link a contact method to chat with Murph"
          nativeButton={false}
          render={<Link href="/settings" />}
          size="lg"
          variant="outline"
        >
          <MessageCircle aria-hidden="true" />
          Chat with Murph
        </Button>
      );
    }

    return (
      <AuthButton aria-label="Sign in to chat with Murph" size="lg" variant="outline">
        <MessageCircle aria-hidden="true" />
        Chat with Murph
      </AuthButton>
    );
  }

  return (
    <MurphContactAuthButton
      actionLabel={`Chat with Murph about ${displayName}`}
      className={buttonVariants({ size: "lg", variant: "outline" })}
      option={option}
    >
      <MessageCircle aria-hidden="true" />
      Chat with Murph
    </MurphContactAuthButton>
  );
}
