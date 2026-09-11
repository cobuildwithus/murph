import { PrivyClient } from "@privy-io/node";

/** Read the real dedicated test principal; never manufacture its provider identity. */
export async function readHostedBrowserAuthPrincipalForTest(input: {
  appId: string;
  appSecret: string;
  email: string;
  otp: string;
  verificationKey: string;
}): Promise<string> {
  try {
    const client = new PrivyClient({ appId: input.appId, appSecret: input.appSecret });
    const options = { maxRetries: 0, timeout: 10_000 };
    const [app, testAccounts] = await Promise.all([
      client.apps().get(input.appId, options),
      client.apps().getTestCredentials(input.appId, options),
    ]);
    if (!app.email_auth || app.id !== input.appId
      || normalizeKey(app.verification_key) !== normalizeKey(input.verificationKey)
      || !testAccounts.data.some((account) => account.email === input.email && account.otp_code === input.otp)) {
      throw new Error("The configured identity is not a current provider-issued test account.");
    }
    const user = await client.users().getByEmailAddress({ address: input.email }, { maxRetries: 0, timeout: 10_000 });
    const emailMatches = user.linked_accounts.some((account) => account.type === "email"
      && account.address.toLowerCase() === input.email.toLowerCase());
    if (!user.id.startsWith("did:privy:") || !emailMatches) throw new Error("Invalid test identity.");
    return user.id;
  } catch {
    throw new Error("Dedicated Privy test principal lookup failed. Initialize the dashboard test account in the development app; provider details are withheld.");
  }
}

function normalizeKey(value: string): string {
  return value.replace(/\\n/gu, "\n").trim();
}
