export function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return fallback;
}

export function formatMaskedPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");

  if (digits.length === 0) {
    return phoneNumber;
  }

  const last4 = digits.slice(-4).padStart(4, "•");
  return `•••• ${last4}`;
}

// Deep links like ?voice=true and ?addEmail=true open a dialog once; drop the
// param so refresh and back navigation do not reopen it.
export function stripSettingsQueryParam(queryKey: string): void {
  stripSettingsQueryParams([queryKey]);
}

export function stripSettingsQueryParams(queryKeys: readonly string[]): void {
  if (typeof window === "undefined" || typeof window.location.href !== "string") {
    return;
  }

  const url = new URL(window.location.href);
  for (const queryKey of queryKeys) {
    url.searchParams.delete(queryKey);
  }
  window.history?.replaceState?.({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function formatContactPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");

  if (/^1\d{10}$/u.test(digits)) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }

  return phoneNumber;
}
