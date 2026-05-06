"use client";

import { useLinkWithPasskey } from "@privy-io/react-auth";
import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { HostedPrivyProvider } from "@/src/components/hosted-onboarding/privy-provider";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";

import { ConnectedAccountCard, SettingsStatusLine } from "./connected-account-card";

export function HostedPasskeySettings({ authenticated }: { authenticated: boolean }) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!authenticated) {
    return null;
  }

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || null;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">Passkey</h2>
      </div>
      <ConnectedAccountCard
        value="Sign in faster with biometrics"
        variant="empty"
        action={
          <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
            Create passkey
          </Button>
        }
      />
      <SettingsStatusLine message={null} tone="neutral" />
      {dialogOpen && appId ? (
        <HostedPrivyProvider appId={appId} clientId={clientId}>
          <CreatePasskeyDialog onOpenChange={setDialogOpen} />
        </HostedPrivyProvider>
      ) : null}
    </div>
  );
}

function CreatePasskeyDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { linkWithPasskey, state } = useLinkWithPasskey();
  const [status, setStatus] = useState<"idle" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isLinking =
    state.status === "generating-challenge" ||
    state.status === "awaiting-passkey" ||
    state.status === "submitting-response";

  async function handleCreate() {
    setErrorMessage(null);
    try {
      await linkWithPasskey();
      setStatus("done");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not create passkey. Try again or use a different device.",
      );
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-6 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7">
        <DialogHeader className="flex flex-col items-center gap-4 pr-0 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-[#7a8c6e]/15">
            <KeyRound className="size-7 text-[#7a8c6e]" strokeWidth={1.75} />
          </div>
          <div className="flex flex-col gap-1.5">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
              Create a passkey
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#736a58]">
              Use your face, fingerprint, or screen lock to sign in.
            </DialogDescription>
          </div>
        </DialogHeader>

        {status === "done" ? (
          <div className="rounded-lg border border-[#7a8c6e]/25 bg-[#7a8c6e]/5 p-4 text-center text-sm text-[#2d3436]">
            Passkey created. You can use it to sign in next time.
          </div>
        ) : null}

        {errorMessage ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {errorMessage}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          {status === "done" ? (
            <Button
              type="button"
              size="xl"
              onClick={() => {
                onOpenChange(false);
                router.refresh();
              }}
              className="w-full"
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                size="xl"
                onClick={() => void handleCreate()}
                disabled={isLinking}
                className="w-full"
              >
                {isLinking ? "Creating passkey..." : "Create passkey"}
              </Button>
              <Button
                type="button"
                size="xl"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isLinking}
                className="w-full"
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
