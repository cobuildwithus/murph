export function isLocalLoopbackProxyProtocol(value: string): boolean {
  return value === "http:" || value === "https:";
}
