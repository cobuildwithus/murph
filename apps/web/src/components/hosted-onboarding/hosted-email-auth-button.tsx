"use client";

import { useLoginWithEmail, usePrivy } from "@privy-io/react-auth";
import { useRef, useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { EmailIcon } from "@/src/components/homepage/email-icon";

import {
  isValidEmailAddress,
  normalizeEmailAddress,
  toErrorMessage,
} from "./hosted-auth-shared";
import { HostedInlineAuthButton } from "./hosted-inline-auth-button";
import { HostedVerificationCodeStep } from "./hosted-verification-code-step";
import { JoinInviteChangeEmailDialog } from "./join-invite-change-email-dialog";
import type { HostedPrivyAuthenticatedInput } from "./use-hosted-auth-completion";

export function HostedEmailAuthButton({
  active = false,
  disableSignup = false,
  inline = false,
  initialEmailAddress = null,
  lockedEmailAddress = null,
  onActivate = () => undefined,
  onAuthenticated,
}: {
  active?: boolean;
  disableSignup?: boolean;
  inline?: boolean;
  initialEmailAddress?: string | null;
  lockedEmailAddress?: string | null;
  onActivate?: () => void;
  onAuthenticated: (input: HostedPrivyAuthenticatedInput) => Promise<void> | void;
}) {
  const { loginWithCode, sendCode, state } = useLoginWithEmail();
  const { ready } = usePrivy();
  const lockedEmail = normalizeEmailAddress(lockedEmailAddress);
  const [changeEmailDialogOpen, setChangeEmailDialogOpen] = useState(false);
  const [code, setCode] = useState("");
  const [emailAddress, setEmailAddress] = useState(
    () => normalizeEmailAddress(initialEmailAddress) ?? "",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingEmailAddress, setPendingEmailAddress] = useState<string | null>(
    null,
  );
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  const loading =
    state.status === "sending-code" || state.status === "submitting-code";
  const disabled = !ready || loading;
  const showCodeEntry = pendingEmailAddress !== null;

  function clearCode() {
    setCode("");
    if (codeInputRef.current) {
      codeInputRef.current.value = "";
    }
  }

  function handleOpen() {
    onActivate();
    setErrorMessage(null);
  }

  async function handleSendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const nextEmailAddress =
      lockedEmail
      ?? normalizeEmailAddress(emailInputRef.current?.value ?? emailAddress);

    if (nextEmailAddress && nextEmailAddress !== emailAddress) {
      setEmailAddress(nextEmailAddress);
    }

    if (!nextEmailAddress || !isValidEmailAddress(nextEmailAddress)) {
      setErrorMessage("Enter a valid email address before we send a code.");
      return;
    }

    try {
      await sendEmailCode(nextEmailAddress);
      setPendingEmailAddress(nextEmailAddress);
      clearCode();
    } catch (error) {
      setErrorMessage(
        toErrorMessage(
          error,
          "We could not send a verification code to that email address.",
        ),
      );
    }
  }

  async function handleResendCode() {
    if (!pendingEmailAddress) {
      setErrorMessage("Enter your email address before you request a code.");
      return;
    }

    setErrorMessage(null);

    try {
      await sendEmailCode(pendingEmailAddress);
      clearCode();
    } catch (error) {
      setErrorMessage(
        toErrorMessage(
          error,
          "We could not send a verification code to that email address.",
        ),
      );
    }
  }

  async function sendEmailCode(nextEmailAddress: string) {
    try {
      await sendCode({
        email: nextEmailAddress,
        ...(disableSignup ? { disableSignup: true } : {}),
      });
    } catch (error) {
      if (!disableSignup) {
        throw error;
      }
    }
  }

  async function handleVerifyCode() {
    if (!pendingEmailAddress) {
      setErrorMessage("Request a fresh verification code before entering one.");
      return;
    }

    const submittedCode = codeInputRef.current?.value.trim() || code.trim();

    if (submittedCode !== code) {
      setCode(submittedCode);
    }

    if (!submittedCode) {
      setErrorMessage("Enter the verification code we emailed you.");
      return;
    }

    setErrorMessage(null);

    try {
      await loginWithCode({ code: submittedCode });
    } catch (error) {
      setErrorMessage(
        disableSignup
          ? "We could not verify that code."
          : toErrorMessage(
              error,
              "We could not verify that code.",
            ),
      );
      return;
    }

    await onAuthenticated({
      authMethod: "email",
    });
  }

  function handleUseAnotherEmail() {
    clearCode();
    setErrorMessage(null);
    setPendingEmailAddress(null);
  }

  const changeEmailDialog = lockedEmail ? (
    <JoinInviteChangeEmailDialog
      emailAddress={lockedEmail}
      open={changeEmailDialogOpen}
      onOpenChange={setChangeEmailDialogOpen}
    />
  ) : null;

  const codeStepSecondaryAction = lockedEmail ? (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      disabled={disabled}
      onClick={() => setChangeEmailDialogOpen(true)}
      className="w-full text-muted-foreground hover:text-foreground"
    >
      Change email
    </Button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      disabled={disabled}
      onClick={handleUseAnotherEmail}
      className="w-full text-muted-foreground hover:text-foreground"
    >
      Use another email
    </Button>
  );

  const lockedEmailField = lockedEmail ? (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <Label>Your email</Label>
        <Button
          type="button"
          onClick={() => setChangeEmailDialogOpen(true)}
          disabled={disabled}
          variant="link"
          size="xs"
          className="relative h-auto p-0 text-sm text-muted-foreground before:absolute before:-inset-x-3 before:-inset-y-2.5 before:content-['']"
        >
          Change email
        </Button>
      </div>
      <p
        data-hosted-locked-email="true"
        className="flex h-14 w-full items-center truncate rounded-2xl border border-stone-200 bg-white px-5 text-base"
      >
        {lockedEmail}
      </p>
    </div>
  ) : null;

  if (inline) {
    return (
      <div className="space-y-3">
        {showCodeEntry ? (
          <HostedVerificationCodeStep
            code={code}
            description={
              disableSignup
                ? `If an account exists for ${pendingEmailAddress}, we emailed a code there.`
                : `We emailed a code to ${pendingEmailAddress}.`
            }
            disabled={disabled}
            inputRef={codeInputRef}
            pendingAction={loading ? "verify-code" : null}
            primaryActionLabel="Verify email"
            primaryActionPendingLabel="Verifying..."
            secondaryAction={codeStepSecondaryAction}
            onCodeChange={setCode}
            onResendCode={handleResendCode}
            onSubmit={handleVerifyCode}
          />
        ) : (
          <form className="space-y-3" onSubmit={handleSendCode}>
            {lockedEmailField ?? (
              <div className="space-y-3">
                <Label htmlFor="homepage-email-address">Your email</Label>
                <Input
                  id="homepage-email-address"
                  autoComplete="off"
                  autoFocus
                  data-bwignore="true"
                  inputMode="email"
                  placeholder="you@example.com"
                  ref={emailInputRef}
                  value={emailAddress}
                  onChange={(event) => setEmailAddress(event.currentTarget.value)}
                  inputSize="xl"
                  className="w-full border-stone-200 bg-white"
                />
              </div>
            )}
            <Button
              type="submit"
              size="xl"
              disabled={disabled}
              className="w-full"
            >
              {state.status === "sending-code"
                ? "Sending..."
                : "Email me a code"}
            </Button>
          </form>
        )}

        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to continue</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
        {changeEmailDialog}
      </div>
    );
  }

  return (
    <>
      <HostedInlineAuthButton
        active={active}
        disabled={disabled}
        className="order-2"
        icon={<EmailIcon className="h-5 w-5" />}
        onClick={handleOpen}
      >
        Email
      </HostedInlineAuthButton>

      {active ? (
        <div className="order-4 space-y-3 sm:col-span-2">
          {showCodeEntry ? (
            <HostedVerificationCodeStep
              code={code}
              description={
                disableSignup
                  ? `If an account exists for ${pendingEmailAddress}, we emailed a code there.`
                  : `We emailed a code to ${pendingEmailAddress}.`
              }
              disabled={disabled}
              inputRef={codeInputRef}
              pendingAction={loading ? "verify-code" : null}
              primaryActionLabel="Verify email"
              primaryActionPendingLabel="Verifying..."
              secondaryAction={codeStepSecondaryAction}
              onCodeChange={setCode}
              onResendCode={handleResendCode}
              onSubmit={handleVerifyCode}
            />
          ) : (
            <form className="space-y-3" onSubmit={handleSendCode}>
              {lockedEmailField ?? (
                <Input
                  id="homepage-email-address"
                  autoComplete="off"
                  autoFocus
                  data-bwignore="true"
                  inputMode="email"
                  placeholder="you@example.com"
                  ref={emailInputRef}
                  value={emailAddress}
                  onChange={(event) => setEmailAddress(event.currentTarget.value)}
                  inputSize="xl"
                  className="w-full border-stone-200 bg-white"
                />
              )}
              <Button
                type="submit"
                size="xl"
                disabled={disabled}
                className="w-full"
              >
                {state.status === "sending-code"
                  ? "Sending..."
                  : "Email me a code"}
              </Button>
            </form>
          )}

          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to continue</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
          {changeEmailDialog}
        </div>
      ) : null}
    </>
  );
}
