import { expect } from "vitest";

export function findStoredObjectKey(
  bucket: { objects: Map<string, string> },
  predicate: (key: string) => boolean,
): string {
  const objectKey = [...bucket.objects.keys()].find(predicate);

  if (!objectKey) {
    throw new Error("Expected to find a stored object key.");
  }

  return objectKey;
}

export function expectOpaqueStrings(
  values: Iterable<string>,
  forbiddenTokens: readonly string[],
): void {
  for (const value of values) {
    for (const token of forbiddenTokens) {
      expect(value).not.toContain(token);
    }
  }
}
