import {
  getBankEntityRegistryProjectionMetadata,
  getHealthEntityRegistryProjectionMetadata,
  type BankEntityKind,
  type BankEntityRegistryProjectionContext as BankEntityRegistryProjectionContext,
  type BankEntityRegistryProjectionHelpers as BankEntityRegistryProjectionHelpers,
  type BankEntityRegistryProjectionMetadata as BankRegistryQueryMetadata,
  type BankEntityRegistryProjectionSortBehavior as BankEntitySortBehavior,
  type HealthEntityRegistryKind,
} from "@murphai/contracts";

export type {
  BankEntityRegistryProjectionContext,
  BankEntityRegistryProjectionHelpers,
  BankEntitySortBehavior,
  BankRegistryQueryMetadata,
};

export type HealthRegistryProjectionKind = HealthEntityRegistryKind;

export function getBankRegistryQueryMetadata(
  kind: BankEntityKind,
): BankRegistryQueryMetadata {
  return getBankEntityRegistryProjectionMetadata(kind);
}

export function getHealthRegistryQueryMetadata(
  kind: HealthRegistryProjectionKind,
): BankRegistryQueryMetadata {
  return getHealthEntityRegistryProjectionMetadata(kind);
}
