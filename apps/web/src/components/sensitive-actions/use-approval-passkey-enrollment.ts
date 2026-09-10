"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { useRouter } from "next/navigation";
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { HostedOnboardingApiError, requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { useSensitiveActionAuthorization } from "./use-sensitive-action-authorization";

export function useApprovalPasskeyEnrollment() {
  const { authenticated, openAuthDialog } = useAuth();
  const router = useRouter();
  const inFlight = useRef(false);
  const authorization = useSensitiveActionAuthorization();
  const [pending, setPending] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enroll() {
    if (inFlight.current) return;
    if (!authenticated) {
      openAuthDialog();
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const status = await requestHostedOnboardingJson<{ initialEnrollmentAllowed: boolean }>({ url: "/api/settings/approval-passkeys" });
      let options: PublicKeyCredentialCreationOptionsJSON;
      let proof: Record<string, unknown>;
      if (status.initialEnrollmentAllowed === true) {
        const initial = await requestHostedOnboardingJson<{ options: PublicKeyCredentialCreationOptionsJSON; token: string }>({
          method: "POST", payload: {}, url: "/api/settings/approval-passkeys/initial-options",
        });
        options = initial.options;
        proof = { initialToken: initial.token };
      } else {
        const authorizationProof = await authorization.authorize("approval.passkey.enroll");
        options = await requestHostedOnboardingJson<PublicKeyCredentialCreationOptionsJSON>({
          method: "POST", payload: { authorization: authorizationProof }, url: "/api/settings/approval-passkeys/options",
        });
        proof = { authorization: authorizationProof };
      }
      const response = await startRegistration({ optionsJSON: options });
      try {
        await requestHostedOnboardingJson({
          method: "POST", payload: { ...proof, response }, url: "/api/settings/approval-passkeys/register",
        });
      } finally {
        // A lost response may follow a committed registration. Re-read the
        // server's credential status before presenting the next setup action.
        router.refresh();
      }
      setRegistered(true);
    } catch (caught) {
      if (caught instanceof HostedOnboardingApiError && caught.code === "SENSITIVE_ACTION_FRESH_LOGIN_REQUIRED") openAuthDialog();
      setError(caught instanceof Error ? caught.message : "Your passkey could not be saved. Please try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { enroll, error, pending, registered };
}
