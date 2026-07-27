export function isRunnableProtocolStatus(
  status: string | null | undefined,
): boolean {
  return status === "field-testing"
    || status === "reviewed"
    || status === "community";
}
