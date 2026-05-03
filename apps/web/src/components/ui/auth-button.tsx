"use client";

import {
  type ComponentProps,
  type ReactNode,
} from "react";

import { useAuthDialog } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { Button } from "@/src/components/ui/button";

type ButtonComponentProps = ComponentProps<typeof Button>;
type ButtonClickEvent = Parameters<NonNullable<ButtonComponentProps["onClick"]>>[0];

interface AuthButtonProps extends Omit<ButtonComponentProps, "onClick"> {
  onClick?: ButtonComponentProps["onClick"];
  onConnect?: () => void;
  connectLabel?: ReactNode;
}

function AuthButton({
  children,
  connectLabel,
  disabled,
  nativeButton,
  onClick,
  onConnect,
  type = "button",
  ...props
}: AuthButtonProps) {
  const { authenticated, openAuthDialog } = useAuthDialog();

  function handleButtonClick(event: ButtonClickEvent) {
    if (!authenticated) {
      openAuthDialog();
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
