export function compareHostedIsoTimestampsAscending(
  left: string,
  right: string,
): number {
  if (left === right) {
    return 0;
  }

  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  const leftValid = Number.isFinite(leftMs);
  const rightValid = Number.isFinite(rightMs);

  if (leftValid && rightValid) {
    if (leftMs === rightMs) {
      return 0;
    }
    return leftMs < rightMs ? -1 : 1;
  }

  if (leftValid !== rightValid) {
    return leftValid ? -1 : 1;
  }

  return left.localeCompare(right);
}
