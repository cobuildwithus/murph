import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";

export const BROWSER_VAULT_UNAVAILABLE_FALLBACK_MESSAGE =
  "Your dashboard data is not available right now.";

/**
 * Shown when a signed-in member's browser vault could not be loaded. Retry is
 * the only useful action, so this stays presentational and the caller owns what
 * retrying does. A signed-out visitor must never reach this state; the
 * dashboard layout leaves their vault load disabled instead.
 */
export function BrowserVaultUnavailableAlert({
  message,
  onRetry,
}: {
  message?: string | null;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Could not load your dashboard</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>{message ?? BROWSER_VAULT_UNAVAILABLE_FALLBACK_MESSAGE}</span>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
