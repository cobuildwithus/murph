"use client";

import { usePrivy } from "@privy-io/react-auth";
import {
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { HostedAuthPanel } from "@/src/components/hosted-onboarding/hosted-auth-panel";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";

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
  const { authenticated, ready } = usePrivy();
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const isAuthenticated = ready && authenticated;

  function handleButtonClick(event: ButtonClickEvent) {
    if (!isAuthenticated) {
      event.preventDefault();

      if (ready) {
        setAuthDialogOpen(true);
        onConnect?.();
      }

      return;
    }

    onClick?.(event);
  }

  const content = !isAuthenticated && connectLabel ? connectLabel : children;

  return (
    <>
      <Button
        data-slot="auth-button"
        nativeButton={nativeButton}
        type={nativeButton === false ? undefined : type}
        aria-busy={!ready}
        disabled={!ready || (isAuthenticated ? disabled : false)}
        onClick={handleButtonClick}
        {...props}
      >
        {content}
      </Button>
      <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
        <DialogContent className="max-w-md p-6 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-bold tracking-tight text-stone-900">
              Log in or sign up
            </DialogTitle>
            <DialogDescription>
              Discover what actually makes you healthier.
            </DialogDescription>
          </DialogHeader>
          {authDialogOpen ? (
            <HostedAuthPanel
              methods={["phone", "telegram", "email"]}
              requireLaunchConsentOnCompletion
              size="compact"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export { AuthButton };
export type { AuthButtonProps };
