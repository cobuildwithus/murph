export interface HostedPrivyEmbeddedEthereumWallet {
  address: `0x${string}`;
  walletIndex: number | null;
}

export type HostedPrivyEmbeddedEthereumWalletSelection =
  | { status: "missing" }
  | { status: "ambiguous" }
  | { status: "ready"; wallet: HostedPrivyEmbeddedEthereumWallet };

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;

export function selectHostedPrivyEmbeddedEthereumWallet(
  input: unknown,
): HostedPrivyEmbeddedEthereumWalletSelection {
  const candidates = readLinkedAccounts(input)
    .map((account) => parseEmbeddedEthereumWallet(account))
    .filter((wallet): wallet is HostedPrivyEmbeddedEthereumWallet => wallet !== null);
  const primary = candidates.filter((wallet) => wallet.walletIndex === 0);

  if (primary.length === 1) {
    return { status: "ready", wallet: primary[0]! };
  }
  if (primary.length > 1 || candidates.length > 1) {
    return { status: "ambiguous" };
  }
  if (candidates.length === 1) {
    return { status: "ready", wallet: candidates[0]! };
  }
  return { status: "missing" };
}

export function findHostedPrivyPasskeyCredentialIds(input: unknown): string[] {
  return readLinkedAccounts(input)
    .filter((account) => account.type === "passkey")
    .map((account) => readString(account, ["credentialId", "credential_id"]))
    .filter((credentialId): credentialId is string => credentialId !== null)
    .filter((credentialId, index, values) => values.indexOf(credentialId) === index);
}

export function readHostedPrivyMfaMethodTypes(input: unknown): string[] {
  const record = readRecord(input);
  const rawMethods = record?.mfaMethods ?? record?.mfa_methods;

  if (!Array.isArray(rawMethods)) {
    return [];
  }

  return rawMethods
    .map((method) => {
      if (typeof method === "string") {
        return normalizeString(method);
      }
      return readString(readRecord(method), ["type"]);
    })
    .filter((method): method is string => method !== null)
    .filter((method, index, values) => values.indexOf(method) === index);
}

export function hasOnlyHostedPrivyPasskeyMfa(input: unknown): boolean {
  const methods = readHostedPrivyMfaMethodTypes(input);
  return methods.length === 1 && methods[0] === "passkey";
}

function parseEmbeddedEthereumWallet(
  account: Record<string, unknown>,
): HostedPrivyEmbeddedEthereumWallet | null {
  if (account.type !== "wallet") {
    return null;
  }

  const address = readString(account, ["address"]);
  const chainType = readString(account, ["chainType", "chain_type"]);
  const connectorType = readString(account, ["connectorType", "connector_type"]);
  const walletClientType = readString(account, ["walletClientType", "wallet_client_type"]);

  if (
    !address
    || !EVM_ADDRESS_PATTERN.test(address)
    || chainType !== "ethereum"
    || connectorType !== "embedded"
    || (walletClientType !== "privy" && walletClientType !== "privy-v2")
  ) {
    return null;
  }

  return {
    address: address as `0x${string}`,
    walletIndex: readInteger(account, ["walletIndex", "wallet_index"]),
  };
}

function readLinkedAccounts(input: unknown): Record<string, unknown>[] {
  const record = readRecord(input);
  const value = record?.linkedAccounts ?? record?.linked_accounts;
  return Array.isArray(value)
    ? value.map(readRecord).filter((entry): entry is Record<string, unknown> => entry !== null)
    : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string") {
      const normalized = normalizeString(value);
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
}

function readInteger(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      return value;
    }
  }
  return null;
}

function normalizeString(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}
