"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { useRouter } from "next/navigation";
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { useSensitiveActionAuthorization } from "./use-sensitive-action-authorization";

export function useApprovalPasskeyEnrollment() {
  const { openAuthDialog } = useAuth();
  const router = useRouter();
  const inFlight = useRef(false);
  const authorization = useSensitiveActionAuthorization();
  const [pending, setPending] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enroll() {
    if (inFlight.current) return;
    if (!authorization.setup.clientAuthenticated) {
      openAuthDialog();
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const proof = await authorization.authorize("approval.passkey.enroll");
      const options = await requestHostedOnboardingJson<PublicKeyCredentialCreationOptionsJSON>({
        method: "POST", payload: { authorization: proof }, url: "/api/settings/approval-passkeys/options",
      });
      const response = await startRegistration({ optionsJSON: options });
      try {
        await requestHostedOnboardingJson({
          method: "POST", payload: { authorization: proof, response }, url: "/api/settings/approval-passkeys/register",
        });
      } finally {
        // A lost response may follow a committed registration. Re-read the
        // server's credential status before presenting the next setup action.
        router.refresh();
      }
      setRegistered(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your passkey could not be saved. Please try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { enroll, error, pending, registered };
}
