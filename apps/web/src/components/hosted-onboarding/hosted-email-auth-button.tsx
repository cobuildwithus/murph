"use client";

import {
  useCreateWallet,
  useLoginWithEmail,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { useRef, useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmailIcon } from "@/src/components/homepage/email-icon";

import { completeHostedPrivyAuth } from "./hosted-auth-completion";
import {
  isValidEmailAddress,
  normalizeEmailAddress,
  type HostedAuthIntent,
  toErrorMessage,
} from "./hosted-auth-shared";
import { HostedInlineAuthButton } from "./hosted-inline-auth-button";
import { HostedVerificationCodeStep } from "./hosted-verification-code-step";

export function HostedEmailAuthButton({
  active = false,
  intent,
  onActivate,
}: {
  active?: boolean;
  intent: HostedAuthIntent;
  onActivate: () => void;
}) {
  const { createWallet } = useCreateWallet();
  const { loginWithCode, sendCode, state } = useLoginWithEmail();
  const { ready } = usePrivy();
  const { refreshUser, user } = useUser();
  const [code, setCode] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingEmailAddress, setPendingEmailAddress] = useState<string | null>(
    null,
  );
  const [redirectPending, setRedirectPending] = useState(false);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  const loading =
    state.status === "sending-code" ||
    state.status === "submitting-code" ||
    redirectPending;
  const disabled = !ready || loading;
  const showCodeEntry = pendingEmailAddress !== null;

  function handleOpen() {
    onActivate();
    setErrorMessage(null);
  }

  async function handleSendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const nextEmailAddress = normalizeEmailAddress(
      emailInputRef.current?.value ?? emailAddress,
    );

    if (nextEmailAddress && nextEmailAddress !== emailAddress) {
      setEmailAddress(nextEmailAddress);
    }

    if (!nextEmailAddress || !isValidEmailAddress(nextEmailAddress)) {
      setErrorMessage("Enter a valid email address before we send a code.");
      return;
    }

    try {
      await sendCode({ email: nextEmailAddress });
      setPendingEmailAddress(nextEmailAddress);
      setCode("");
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
      await sendCode({ email: pendingEmailAddress });
    } catch (error) {
      setErrorMessage(
        toErrorMessage(
          error,
          "We could not send a verification code to that email address.",
        ),
      );
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
    setRedirectPending(true);

    try {
      await loginWithCode({ code: submittedCode });
      const result = await completeHostedPrivyAuth({
        createWallet,
        intent,
        refreshUser,
        user,
      });
      window.location.assign(result.redirectUrl);
    } catch (error) {
      setErrorMessage(
        toErrorMessage(
          error,
          intent === "signin"
            ? "We could not sign you in with that code."
            : "We could not verify that code.",
        ),
      );
      setRedirectPending(false);
    }
  }

  function handleUseAnotherEmail() {
    setCode("");
    setErrorMessage(null);
    setPendingEmailAddress(null);
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
              description={`We emailed the latest code to ${pendingEmailAddress}.`}
              disabled={disabled}
              inputRef={codeInputRef}
              pendingAction={loading ? "verify-code" : null}
              primaryActionLabel={intent === "signin" ? "Sign in" : "Verify email"}
              primaryActionPendingLabel={
                intent === "signin" ? "Signing in..." : "Verifying..."
              }
              secondaryAction={
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={disabled}
                  onClick={handleUseAnotherEmail}
                >
                  Use another email
                </Button>
              }
              onCodeChange={setCode}
              onResendCode={handleResendCode}
              onSubmit={handleVerifyCode}
            />
          ) : (
            <form className="space-y-3" onSubmit={handleSendCode}>
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
                className="w-full border-stone-200 bg-white px-4 text-base md:text-sm"
              />
              <Button
                type="submit"
                size="lg"
                disabled={disabled}
                className="w-full"
              >
                {state.status === "sending-code"
                  ? "Sending..."
                  : intent === "signin"
                    ? "Email me a sign-in code"
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
        </div>
      ) : null}
    </>
  );
}
