"use client";

import {
  type ComponentProps,
  type ReactNode,
} from "react";

import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { Button } from "@/src/components/ui/button";

type ButtonComponentProps = ComponentProps<typeof Button>;
type ButtonClickEvent = Parameters<NonNullable<ButtonComponentProps["onClick"]>>[0];

interface AuthButtonProps extends Omit<ButtonComponentProps, "onClick"> {
  authSatisfied?: boolean;
  onClick?: ButtonComponentProps["onClick"];
  onConnect?: () => void;
  onAuthRequired?: () => void;
  connectLabel?: ReactNode;
}

function AuthButton({
  authSatisfied,
  children,
  connectLabel,
  disabled,
  nativeButton,
  onClick,
  onConnect,
  onAuthRequired,
  type = "button",
  ...props
}: AuthButtonProps) {
  const { authenticated, openAuthDialog } = useAuth();
  const effectiveAuthenticated = authSatisfied ?? authenticated;

  function handleButtonClick(event: ButtonClickEvent) {
    if (!effectiveAuthenticated) {
      if (onAuthRequired) {
        onAuthRequired();
      } else {
        openAuthDialog();
      }
      return;
    }
    onConnect?.();
    onClick?.(event);
  }

  const content = children ?? connectLabel;

  return (
    <Button
      data-slot="auth-button"
      nativeButton={nativeButton}
      type={nativeButton === false ? undefined : type}
      disabled={disabled}
      onClick={handleButtonClick}
      {...props}
    >
      {content}
    </Button>
  );
}

export { AuthButton };
export type { AuthButtonProps };
