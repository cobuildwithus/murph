import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";

export const BROWSER_VAULT_UNAVAILABLE_FALLBACK_MESSAGE =
  "Your dashboard data is not available right now.";

/** Shown when a signed-in member's browser vault could not be loaded. */
export function BrowserVaultUnavailableAlert({
  message,
}: {
  message?: string | null;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Could not load your dashboard</AlertTitle>
      <AlertDescription>
        {message ?? BROWSER_VAULT_UNAVAILABLE_FALLBACK_MESSAGE}
      </AlertDescription>
    </Alert>
  );
}
