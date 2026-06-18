export const HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE = "ethereum" as const;
export const HOSTED_PRIVY_WALLET_CHAIN_APPEARANCE = `${HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE}-only` as const;
export const HOSTED_PRIVY_EMBEDDED_WALLET_CREATE_ON_LOGIN = "off" as const;
export const HOSTED_PRIVY_SHOW_WALLET_UIS = false as const;

export interface HostedPrivyPhoneAccount {
  number: string;
  verifiedAt: number;
}

export interface HostedPrivyEmailAccount {
  address: string;
  verifiedAt: number | null;
}

export interface HostedPrivyTelegramAccount {
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  telegramUserId: string;
  username: string | null;
}

export interface HostedPrivyTelegramAccountSelection {
  account: HostedPrivyTelegramAccount | null;
  ambiguous: boolean;
}

export interface HostedPrivyLinkedAccountContainer {
  linkedAccounts?: unknown;
  linked_accounts?: unknown;
  telegram?: unknown;
}

export interface HostedPrivyLinkedAccountState {
  linkedAccounts: PrivyLinkedAccountLike[];
  phone: HostedPrivyPhoneAccount | null;
}

export interface PrivyLinkedAccountLike extends Record<string, unknown> {
  type?: unknown;
}
