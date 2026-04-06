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
const HOSTED_ONBOARDING_REVNET_ISSUANCE_ENABLED = false as const;

export function isHostedOnboardingRevnetEnabled(): boolean {
  return HOSTED_ONBOARDING_REVNET_ISSUANCE_ENABLED;
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
  if (!isHostedOnboardingRevnetEnabled()) {
    throw hostedOnboardingError({
      code: "REVNET_CONFIG_REQUIRED",
      message: "Hosted RevNet issuance is currently disabled.",
      httpStatus: 500,
    });
  }
  throw new Error("Hosted RevNet issuance cannot be configured while it is disabled.");
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
