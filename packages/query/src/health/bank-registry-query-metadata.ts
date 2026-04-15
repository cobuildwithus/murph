import {
  getBankEntityRegistryProjectionMetadata,
  type BankEntityKind,
  type BankEntityRegistryProjectionContext as BankEntityRegistryProjectionContext,
  type BankEntityRegistryProjectionHelpers as BankEntityRegistryProjectionHelpers,
  type BankEntityRegistryProjectionMetadata as BankRegistryQueryMetadata,
  type BankEntityRegistryProjectionSortBehavior as BankEntitySortBehavior,
} from "@murphai/contracts";

export type {
  BankEntityRegistryProjectionContext,
  BankEntityRegistryProjectionHelpers,
  BankEntitySortBehavior,
  BankRegistryQueryMetadata,
};

export function getBankRegistryQueryMetadata(
  kind: BankEntityKind,
): BankRegistryQueryMetadata {
  return getBankEntityRegistryProjectionMetadata(kind);
}
