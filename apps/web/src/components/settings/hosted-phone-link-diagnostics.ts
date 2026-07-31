"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { reportHostedPhoneLinkDiagnostic } from "@/src/components/hosted-onboarding/hosted-phone-auth-support";
import type {
  HostedPhoneLinkDiagnosticClientState,
  HostedPhoneLinkDiagnosticDetailCode,
  HostedPhoneLinkDiagnosticEvent,
  HostedPhoneLinkDiagnosticOperation,
  HostedPhoneLinkDiagnosticSurface,
} from "@/src/lib/hosted-onboarding/phone-link-diagnostic-contract";

interface HostedPhoneLinkDiagnosticState {
  appAuthenticated: boolean;
  clientUserMatchesExpected: boolean;
  clientUserPresent: boolean;
  expectedUserPresent: boolean;
  operation: HostedPhoneLinkDiagnosticOperation;
  privyAuthenticated: boolean;
  privyReady: boolean;
  serverSessionMatches: boolean;
  showLinkForm: boolean;
  surface: HostedPhoneLinkDiagnosticSurface;
}

interface HostedPhoneLinkDiagnosticDetails {
  detailCode?: HostedPhoneLinkDiagnosticDetailCode;
}

export type HostedPhoneLinkDiagnosticReporter = (
  event: HostedPhoneLinkDiagnosticEvent,
  details?: HostedPhoneLinkDiagnosticDetails,
) => void;

export type HostedPhoneLinkDiagnosticReporterFactory = (
  operation: HostedPhoneLinkDiagnosticOperation,
) => HostedPhoneLinkDiagnosticReporter;

export function useHostedPhoneLinkDiagnostics(input: HostedPhoneLinkDiagnosticState) {
  const [surfaceObservationId] = useState(() => globalThis.crypto.randomUUID());
  const blockedStateReportedRef = useRef(false);
  const surfaceReportedRef = useRef(false);
  const clientState = resolveClientState(input);
  const report = useCallback((
    attemptId: string,
    event: HostedPhoneLinkDiagnosticEvent,
    operation: HostedPhoneLinkDiagnosticOperation,
    details: HostedPhoneLinkDiagnosticDetails = {},
  ) => {
    void reportHostedPhoneLinkDiagnostic({
      attemptId,
      clientState,
      ...details,
      event,
      operation,
      surface: input.surface,
    });
  }, [clientState, input.surface]);
  const createAttemptReporter: HostedPhoneLinkDiagnosticReporterFactory = useCallback((
    operation,
  ) => {
    const attemptId = globalThis.crypto.randomUUID();
    return (event, details = {}) => {
      report(attemptId, event, operation, details);
    };
  }, [report]);

  useEffect(() => {
    if (!input.showLinkForm || !input.appAuthenticated || surfaceReportedRef.current) {
      return;
    }

    surfaceReportedRef.current = true;
    report(surfaceObservationId, "surface_loaded", input.operation);
  }, [
    input.appAuthenticated,
    input.operation,
    input.showLinkForm,
    report,
    surfaceObservationId,
  ]);

  useEffect(() => {
    if (
      !input.showLinkForm
      || !input.appAuthenticated
      || !input.privyReady
      || clientState === "eligible"
      || blockedStateReportedRef.current
    ) {
      return;
    }

    blockedStateReportedRef.current = true;
    report(surfaceObservationId, "surface_blocked", input.operation);
  }, [
    clientState,
    input.appAuthenticated,
    input.operation,
    input.privyReady,
    input.showLinkForm,
    report,
    surfaceObservationId,
  ]);

  return createAttemptReporter;
}

export function toPhoneLinkProviderDetailCode(
  error: unknown,
): HostedPhoneLinkDiagnosticDetailCode {
  switch (error) {
    case "account_transfer_required":
    case "exited_link_flow":
    case "exited_update_flow":
    case "linked_to_another_user":
      return error;
    default:
      return "other";
  }
}

function resolveClientState(
  input: HostedPhoneLinkDiagnosticState,
): HostedPhoneLinkDiagnosticClientState {
  if (!input.privyReady) {
    return "loading";
  }
  if (!input.privyAuthenticated) {
    return "privy_unauthenticated";
  }
  if (!input.serverSessionMatches) {
    return "server_session_mismatch";
  }
  if (!input.expectedUserPresent) {
    return "expected_user_missing";
  }
  if (!input.clientUserPresent) {
    return "client_user_missing";
  }
  return input.clientUserMatchesExpected ? "eligible" : "provider_user_mismatch";
}
