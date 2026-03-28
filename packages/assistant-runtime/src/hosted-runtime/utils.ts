export function assertNever(value: never): never {
  throw new Error(`Unexpected hosted execution event: ${JSON.stringify(value)}`);
}
