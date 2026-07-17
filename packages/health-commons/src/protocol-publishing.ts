export function isRunnableProtocolStatus(
  status: string | null | undefined,
): boolean {
  return status !== "draft" && status !== "deprecated";
}
