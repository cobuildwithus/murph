import { buildRevnetPayIntent } from "@cobuild/wire";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { hostedOnboardingError } from "./errors";
import { getHostedOnboardingEnvironment } from "./runtime";
import { normalizeNullableString } from "./shared";

export interface HostedRevnetConfig {
  chainId: number;
  projectId: bigint;
  rpcUrl: string;
  stripeCurrency: string;
  terminalAddress: Address;
  treasuryPrivateKey: Hex;
  waitConfirmations: number;
  weiPerStripeMinorUnit: bigint;
}

export function isHostedOnboardingRevnetEnabled(): boolean {
  const environment = getHostedOnboardingEnvironment();

  return Boolean(
    environment.revnetChainId &&
      environment.revnetProjectId &&
      environment.revnetRpcUrl &&
      environment.revnetTerminalAddress &&
      environment.revnetStripeCurrency &&
      environment.revnetTreasuryPrivateKey &&
      environment.revnetWeiPerStripeMinorUnit,
  );
}

export function coerceHostedWalletAddress(value: string | null | undefined): Address | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  try {
    return getAddress(normalized);
  } catch {
    return null;
  }
}

export function normalizeHostedWalletAddress(value: string | null | undefined): string | null {
  const address = coerceHostedWalletAddress(value);
  return address ? address.toLowerCase() : null;
}

export function convertStripeMinorAmountToRevnetPaymentAmount(
  amountMinor: number,
  weiPerStripeMinorUnit: bigint,
): bigint {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError("Stripe payment amounts must be expressed as a non-negative integer minor-unit amount.");
  }

  if (weiPerStripeMinorUnit < 1n) {
    throw new RangeError("Hosted RevNet wei-per-minor-unit pricing must be a positive integer.");
  }

  return BigInt(amountMinor) * weiPerStripeMinorUnit;
}

export async function submitHostedRevnetPayment(input: {
  amountMinor: number;
  beneficiaryAddress: Address;
  memo: string;
}): Promise<{ payTxHash: Hex; paymentAmount: bigint }> {
  const config = requireHostedRevnetConfig();
  const account = privateKeyToAccount(config.treasuryPrivateKey);
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({
    transport,
  });
  const walletClient = createWalletClient({
    account,
    transport,
  });
  const paymentAmount = convertStripeMinorAmountToRevnetPaymentAmount(
    input.amountMinor,
    config.weiPerStripeMinorUnit,
  );

  const writeRequestWithNonceRetry = async (
    request: Parameters<typeof walletClient.writeContract>[0],
  ): Promise<Hex> => {
    let nonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await walletClient.writeContract({
          ...request,
          nonce,
        });
      } catch (error) {
        if (!isRetriableNonceError(error) || attempt === 3) {
          throw error;
        }

        nonce = await publicClient.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        });
      }
    }

    throw new Error("Hosted RevNet transaction could not be submitted after retrying nonce conflicts.");
  };

  const paySimulation = await publicClient.simulateContract({
    account,
    ...buildRevnetPayIntent({
      amount: paymentAmount,
      beneficiary: input.beneficiaryAddress,
      memo: sanitizeMemo(input.memo),
      projectId: config.projectId,
      terminalAddress: config.terminalAddress,
    }),
  });

  const payTxHash = await writeRequestWithNonceRetry(
    paySimulation.request as Parameters<typeof walletClient.writeContract>[0],
  );

  return {
    payTxHash,
    paymentAmount,
  };
}

export async function waitForHostedRevnetPaymentConfirmation(input: { txHash: Hex }): Promise<void> {
  const config = requireHostedRevnetConfig();

  if (config.waitConfirmations < 1) {
    return;
  }

  const publicClient = createPublicClient({
    transport: http(config.rpcUrl),
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    confirmations: config.waitConfirmations,
    hash: input.txHash,
  });

  if (receipt.status !== "success") {
    throw hostedOnboardingError({
      code: "REVNET_PAYMENT_REVERTED",
      message: `Hosted RevNet payment reverted onchain for transaction ${input.txHash}.`,
      httpStatus: 502,
      retryable: true,
    });
  }
}

export function requireHostedRevnetConfig(): HostedRevnetConfig {
  const environment = getHostedOnboardingEnvironment();

  if (!isHostedOnboardingRevnetEnabled()) {
    throw hostedOnboardingError({
      code: "REVNET_CONFIG_REQUIRED",
      message: "Hosted RevNet issuance is not configured for this environment.",
      httpStatus: 500,
    });
  }

  const projectId = parseUnsignedBigInt(
    environment.revnetProjectId,
    "HOSTED_ONBOARDING_REVNET_PROJECT_ID",
  );
  const terminalAddress = parseAddress(
    environment.revnetTerminalAddress,
    "HOSTED_ONBOARDING_REVNET_TERMINAL_ADDRESS",
  );

  if (!environment.revnetChainId) {
    throw hostedOnboardingError({
      code: "REVNET_CHAIN_ID_REQUIRED",
      message: "HOSTED_ONBOARDING_REVNET_CHAIN_ID must be configured for Hosted RevNet issuance.",
      httpStatus: 500,
    });
  }

  if (!environment.revnetRpcUrl) {
    throw hostedOnboardingError({
      code: "REVNET_RPC_URL_REQUIRED",
      message: "HOSTED_ONBOARDING_REVNET_RPC_URL must be configured for Hosted RevNet issuance.",
      httpStatus: 500,
    });
  }

  if (!environment.revnetTreasuryPrivateKey) {
    throw hostedOnboardingError({
      code: "REVNET_PRIVATE_KEY_REQUIRED",
      message: "HOSTED_ONBOARDING_REVNET_TREASURY_PRIVATE_KEY must be configured for Hosted RevNet issuance.",
      httpStatus: 500,
    });
  }

  if (!environment.revnetStripeCurrency) {
    throw hostedOnboardingError({
      code: "REVNET_STRIPE_CURRENCY_REQUIRED",
      message: "HOSTED_ONBOARDING_REVNET_STRIPE_CURRENCY must be configured for Hosted RevNet issuance.",
      httpStatus: 500,
    });
  }

  if (!environment.revnetWeiPerStripeMinorUnit) {
    throw hostedOnboardingError({
      code: "REVNET_WEI_RATE_REQUIRED",
      message: "HOSTED_ONBOARDING_REVNET_WEI_PER_STRIPE_MINOR_UNIT must be configured for Hosted RevNet issuance.",
      httpStatus: 500,
    });
  }

  const weiPerStripeMinorUnit = parseUnsignedBigInt(
    environment.revnetWeiPerStripeMinorUnit,
    "HOSTED_ONBOARDING_REVNET_WEI_PER_STRIPE_MINOR_UNIT",
  );

  if (weiPerStripeMinorUnit < 1n) {
    throw hostedOnboardingError({
      code: "REVNET_WEI_RATE_INVALID",
      message: "HOSTED_ONBOARDING_REVNET_WEI_PER_STRIPE_MINOR_UNIT must be a positive integer.",
      httpStatus: 500,
    });
  }

  return {
    chainId: environment.revnetChainId,
    projectId,
    rpcUrl: environment.revnetRpcUrl,
    stripeCurrency: environment.revnetStripeCurrency,
    terminalAddress,
    treasuryPrivateKey: parsePrivateKey(environment.revnetTreasuryPrivateKey),
    waitConfirmations: environment.revnetWaitConfirmations,
    weiPerStripeMinorUnit,
  };
}

function parseAddress(value: string | null, label: string): Address {
  if (!value) {
    throw hostedOnboardingError({
      code: `${label}_REQUIRED`,
      message: `${label} must be configured for Hosted RevNet issuance.`,
      httpStatus: 500,
    });
  }

  try {
    return getAddress(value);
  } catch {
    throw hostedOnboardingError({
      code: `${label}_INVALID`,
      message: `${label} must be a valid EVM address.`,
      httpStatus: 500,
    });
  }
}

function parsePrivateKey(value: string): Hex {
  const normalized = value.trim();

  if (!/^0x[0-9a-fA-F]{64}$/u.test(normalized)) {
    throw hostedOnboardingError({
      code: "REVNET_PRIVATE_KEY_INVALID",
      message: "HOSTED_ONBOARDING_REVNET_TREASURY_PRIVATE_KEY must be a 32-byte hex private key.",
      httpStatus: 500,
    });
  }

  return normalized as Hex;
}

function parseUnsignedBigInt(value: string | null, label: string): bigint {
  if (!value || !/^\d+$/u.test(value)) {
    throw hostedOnboardingError({
      code: `${label}_INVALID`,
      message: `${label} must be an unsigned integer string.`,
      httpStatus: 500,
    });
  }

  return BigInt(value);
}

function sanitizeMemo(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 200 ? trimmed : trimmed.slice(0, 200);
}

function isRetriableNonceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("nonce too low") ||
    message.includes("replacement transaction underpriced") ||
    message.includes("already known")
  );
}
