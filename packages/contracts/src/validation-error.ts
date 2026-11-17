/** A value did not satisfy a contract. Says nothing about whose fault that is. */
export class ContractValidationError extends Error {
  override name = "ContractValidationError";
}
