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
  weiPerStripeMinorUnit: bigint;
}

const treasurySubmissionLocks = new Map<string, Promise<void>>();

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
  beneficiaryAddress: Address;
  chainId?: number;
  memo: string;
  paymentAmount?: bigint;
  amountMinor?: number;
  projectId?: bigint;
  terminalAddress?: Address;
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
  const chainId = input.chainId ?? config.chainId;
  const projectId = input.projectId ?? config.projectId;
  const terminalAddress = input.terminalAddress ?? config.terminalAddress;
  const paymentAmount = resolveHostedRevnetPaymentAmount(input, config.weiPerStripeMinorUnit);

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

  const payTxHash = await withTreasurySubmissionLock(
    `${chainId}:${account.address.toLowerCase()}`,
    async () => {
      await assertHostedRevnetRpcChain({
        chainId,
        publicClient,
        rpcUrl: config.rpcUrl,
      });
      const paySimulation = await publicClient.simulateContract({
        account,
        ...buildRevnetPayIntent({
          amount: paymentAmount,
          beneficiary: input.beneficiaryAddress,
          memo: sanitizeMemo(input.memo),
          projectId,
          terminalAddress,
        }),
      });

      return writeRequestWithNonceRetry(
        paySimulation.request as Parameters<typeof walletClient.writeContract>[0],
      );
    },
  );

  return {
    payTxHash,
    paymentAmount,
  };
}

export async function readHostedRevnetPaymentReceipt(input: {
  chainId?: number;
  payTxHash: Hex;
}): Promise<{ status: "reverted" | "success" } | null> {
  const config = requireHostedRevnetConfig();
  const publicClient = createPublicClient({
    transport: http(config.rpcUrl),
  });
  const chainId = input.chainId ?? config.chainId;

  await assertHostedRevnetRpcChain({
    chainId,
    publicClient,
    rpcUrl: config.rpcUrl,
  });

  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: input.payTxHash,
    });

    return {
      status: receipt.status === "success" ? "success" : "reverted",
    };
  } catch (error) {
    if (String(error instanceof Error ? error.message : error).toLowerCase().includes("not found")) {
      return null;
    }

    throw error;
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

function resolveHostedRevnetPaymentAmount(
  input: Pick<Parameters<typeof submitHostedRevnetPayment>[0], "amountMinor" | "paymentAmount">,
  weiPerStripeMinorUnit: bigint,
): bigint {
  if (typeof input.paymentAmount === "bigint") {
    if (input.paymentAmount < 0n) {
      throw new RangeError("Hosted RevNet payment amounts must be non-negative.");
    }

    return input.paymentAmount;
  }

  if (typeof input.amountMinor !== "number") {
    throw new TypeError("Hosted RevNet submissions require either paymentAmount or amountMinor.");
  }

  return convertStripeMinorAmountToRevnetPaymentAmount(input.amountMinor, weiPerStripeMinorUnit);
}

function sanitizeMemo(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 200 ? trimmed : trimmed.slice(0, 200);
}

export function isHostedRevnetBroadcastStatusUnknownError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("already known") ||
    message.includes("known transaction") ||
    message.includes("already imported")
  );
}

async function assertHostedRevnetRpcChain(input: {
  chainId: number;
  publicClient: Pick<ReturnType<typeof createPublicClient>, "getChainId">;
  rpcUrl: string;
}): Promise<void> {
  const actualChainId = await input.publicClient.getChainId();

  if (actualChainId !== input.chainId) {
    throw hostedOnboardingError({
      code: "REVNET_RPC_CHAIN_MISMATCH",
      message: `Hosted RevNet RPC ${input.rpcUrl} reported chain ${actualChainId}, expected ${input.chainId}.`,
      httpStatus: 502,
    });
  }
}

async function withTreasurySubmissionLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const prior = treasurySubmissionLocks.get(key) ?? Promise.resolve();
  let releaseCurrent = () => {};
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = prior.catch(() => undefined).then(() => current);
  treasurySubmissionLocks.set(key, tail);
  await prior.catch(() => undefined);

  try {
    return await operation();
  } finally {
    releaseCurrent();

    if (treasurySubmissionLocks.get(key) === tail) {
      treasurySubmissionLocks.delete(key);
    }
  }
}

function isRetriableNonceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("nonce too low") ||
    message.includes("replacement transaction underpriced")
  );
}
