const HOSTED_TELEGRAM_OAUTH_DIALOG_INTENT_KEY =
  "murph:telegram-oauth-dialog-intent:v1";

export function markHostedTelegramOAuthDialogIntent(): void {
  try {
    window.sessionStorage.setItem(
      HOSTED_TELEGRAM_OAUTH_DIALOG_INTENT_KEY,
      "1",
    );
  } catch {
    // OAuth can still proceed when browser storage is unavailable.
  }
}

export function clearHostedTelegramOAuthDialogIntent(): void {
  try {
    window.sessionStorage.removeItem(HOSTED_TELEGRAM_OAUTH_DIALOG_INTENT_KEY);
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}

export function consumeHostedTelegramOAuthDialogIntent(): boolean {
  try {
    if (
      window.sessionStorage.getItem(HOSTED_TELEGRAM_OAUTH_DIALOG_INTENT_KEY)
      !== "1"
    ) {
      return false;
    }

    window.sessionStorage.removeItem(HOSTED_TELEGRAM_OAUTH_DIALOG_INTENT_KEY);
    return true;
  } catch {
    return false;
  }
}
