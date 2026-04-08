"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface HostedSettingsSessionStateProps {
  authenticated: boolean;
  isLoadingAuthenticatedUser: boolean;
  profileLabel: string;
  ready: boolean;
  signedOutDescription: string;
}

export function HostedSettingsSessionState({
  authenticated,
  isLoadingAuthenticatedUser,
  profileLabel,
  ready,
  signedOutDescription,
}: HostedSettingsSessionStateProps) {
  if (!ready || isLoadingAuthenticatedUser) {
    return (
      <Alert className="border-stone-200 bg-stone-50">
        <AlertTitle>Loading</AlertTitle>
        <AlertDescription>
          Checking your session&hellip;
        </AlertDescription>
      </Alert>
    );
  }

  if (!authenticated) {
    return (
      <Alert className="border-amber-200 bg-amber-50 text-amber-900">
        <AlertTitle>Sign in first</AlertTitle>
        <AlertDescription>{signedOutDescription}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="border-stone-200 bg-stone-50">
      <AlertTitle>Loading</AlertTitle>
      <AlertDescription>
        Loading your account&hellip;
      </AlertDescription>
    </Alert>
  );
}
