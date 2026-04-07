export interface CloudflareHostedUserEnvStatus {
  configuredUserEnvKeys: string[];
  userId: string;
}

export interface CloudflareHostedUserEnvUpdate {
  env: Record<string, string | null>;
  mode: "merge" | "replace";
}

export interface CloudflareHostedManagedUserCryptoStatus {
  recipientKinds: string[];
  rootKeyId: string;
  userId: string;
}
