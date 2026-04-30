"use client";

import type { ReactNode } from "react";

import type { AuthButtonProps } from "@/src/components/ui/auth-button";
import { AuthButton } from "@/src/components/ui/auth-button";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import { MurphContactLink } from "./murph-contact-link";

interface MurphContactAuthButtonProps
  extends Omit<AuthButtonProps, "children" | "nativeButton" | "render"> {
  actionLabel: string;
  children: ReactNode;
  option: MurphContactOption | null;
}

export function MurphContactAuthButton({
  actionLabel,
  children,
  disabled,
  option,
  ...props
}: MurphContactAuthButtonProps) {
  if (!option) {
    return (
      <AuthButton
        {...props}
        aria-label={actionLabel}
        disabled={disabled ?? true}
        size="unstyled"
        variant="unstyled"
      >
        {children}
      </AuthButton>
    );
  }

  return (
    <AuthButton
      {...props}
      disabled={disabled}
      nativeButton={false}
      render={(
        <MurphContactLink
          actionLabel={actionLabel}
          option={option}
        />
      )}
      size="unstyled"
      variant="unstyled"
    >
      {children}
    </AuthButton>
  );
}
