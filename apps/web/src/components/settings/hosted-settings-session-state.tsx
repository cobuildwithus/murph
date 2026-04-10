import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface HostedSettingsSessionStateProps {
  authenticated: boolean;
  signedOutDescription: string;
}

export function HostedSettingsSessionState({
  authenticated,
  signedOutDescription,
}: HostedSettingsSessionStateProps) {
  if (!authenticated) {
    return (
      <Alert className="border-amber-200 bg-amber-50 text-amber-900">
        <AlertTitle>Sign in first</AlertTitle>
        <AlertDescription>{signedOutDescription}</AlertDescription>
      </Alert>
    );
  }

  return null;
}
