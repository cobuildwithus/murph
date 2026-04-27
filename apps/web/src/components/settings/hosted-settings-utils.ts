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
