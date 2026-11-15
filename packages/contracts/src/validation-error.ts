/** A value did not satisfy a contract. Says nothing about whose fault that is. */
export class ContractValidationError extends TypeError {}

// Temporary, for the 2026-11-14-explicit-request-rejection plan: until its last
// stage this must be indistinguishable from the TypeError it replaces, also to
// code that reads the constructor's or the prototype's name. Remove with the
// TypeError base.
Object.defineProperty(ContractValidationError, "name", { value: "TypeError" });
Object.defineProperty(ContractValidationError.prototype, "name", {
  configurable: true,
  value: "TypeError",
  writable: true,
});

/** Semantic diagnostic name, independent of the temporary built-in name device. */
export function getErrorName(error: Error): string {
  return error instanceof ContractValidationError ? "ContractValidationError" : error.name;
}
