import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { hostedOnboardingError } from "./errors";
import { getHostedOnboardingEnvironment } from "./runtime";
import { normalizeNullableString } from "./shared";

const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const jbMultiTerminalAbi = parseAbi([
  "function pay(uint256 projectId, address token, uint256 amount, address beneficiary, uint256 minReturnedTokens, string memo, bytes metadata) external payable returns (uint256 beneficiaryTokenCount)",
]);

const MAX_UINT256 = (1n << 256n) - 1n;
const STRIPE_MINOR_UNIT_DECIMALS = 2;

export interface HostedRevnetConfig {
  chainId: number;
  paymentCurrency: string;
  paymentTokenAddress: Address;
  paymentTokenDecimals: number;
  projectId: bigint;
  rpcUrl: string;
  terminalAddress: Address;
  treasuryPrivateKey: Hex;
  waitConfirmations: number;
}

export function isHostedOnboardingRevnetEnabled(): boolean {
  const environment = getHostedOnboardingEnvironment();

  return Boolean(
    environment.revnetChainId &&
      environment.revnetProjectId &&
      environment.revnetRpcUrl &&
      environment.revnetTerminalAddress &&
      environment.revnetPaymentTokenAddress &&
      environment.revnetPaymentTokenDecimals !== null &&
      environment.revnetPaymentCurrency &&
      environment.revnetTreasuryPrivateKey,
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

export function convertStripeMinorAmountToRevnetTokenAmount(
  amountMinor: number,
  tokenDecimals: number,
): bigint {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError("Stripe payment amounts must be expressed as a non-negative integer minor-unit amount.");
  }

  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0) {
    throw new RangeError("RevNet payment token decimals must be a non-negative integer.");
  }

  const amount = BigInt(amountMinor);
  const decimalDelta = tokenDecimals - STRIPE_MINOR_UNIT_DECIMALS;

  if (decimalDelta >= 0) {
    return amount * 10n ** BigInt(decimalDelta);
  }

  const divisor = 10n ** BigInt(Math.abs(decimalDelta));

  if (amount % divisor !== 0n) {
    throw new RangeError("Stripe amount cannot be represented exactly in the configured RevNet payment token decimals.");
  }

  return amount / divisor;
}

export async function submitHostedRevnetPayment(input: {
  amountMinor: number;
  beneficiaryAddress: Address;
  memo: string;
}): Promise<{ approvalTxHash: Hex | null; payTxHash: Hex; terminalTokenAmount: bigint }> {
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
  const terminalTokenAmount = convertStripeMinorAmountToRevnetTokenAmount(
    input.amountMinor,
    config.paymentTokenDecimals,
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

  const currentAllowance = await publicClient.readContract({
    abi: erc20Abi,
    address: config.paymentTokenAddress,
    args: [account.address, config.terminalAddress],
    functionName: "allowance",
  }) as bigint;

  let approvalTxHash: Hex | null = null;

  if (currentAllowance < terminalTokenAmount) {
    const approvalSimulation = await publicClient.simulateContract({
      abi: erc20Abi,
      account,
      address: config.paymentTokenAddress,
      args: [config.terminalAddress, MAX_UINT256],
      functionName: "approve",
    });

    approvalTxHash = await writeRequestWithNonceRetry(
      approvalSimulation.request as Parameters<typeof walletClient.writeContract>[0],
    );
    await publicClient.waitForTransactionReceipt({
      confirmations: 1,
      hash: approvalTxHash,
    });
  }

  const paySimulation = await publicClient.simulateContract({
    abi: jbMultiTerminalAbi,
    account,
    address: config.terminalAddress,
    args: [
      config.projectId,
      config.paymentTokenAddress,
      terminalTokenAmount,
      input.beneficiaryAddress,
      0n,
      sanitizeMemo(input.memo),
      "0x" as Hex,
    ],
    functionName: "pay",
  });

  const payTxHash = await writeRequestWithNonceRetry(
    paySimulation.request as Parameters<typeof walletClient.writeContract>[0],
  );

  return {
    approvalTxHash,
    payTxHash,
    terminalTokenAmount,
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
  const paymentTokenAddress = parseAddress(
    environment.revnetPaymentTokenAddress,
    "HOSTED_ONBOARDING_REVNET_PAYMENT_TOKEN_ADDRESS",
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

  if (!environment.revnetPaymentCurrency) {
    throw hostedOnboardingError({
      code: "REVNET_PAYMENT_CURRENCY_REQUIRED",
      message: "HOSTED_ONBOARDING_REVNET_PAYMENT_CURRENCY must be configured for Hosted RevNet issuance.",
      httpStatus: 500,
    });
  }

  if (environment.revnetPaymentTokenDecimals === null) {
    throw hostedOnboardingError({
      code: "REVNET_PAYMENT_TOKEN_DECIMALS_REQUIRED",
      message: "HOSTED_ONBOARDING_REVNET_PAYMENT_TOKEN_DECIMALS must be configured for Hosted RevNet issuance.",
      httpStatus: 500,
    });
  }

  return {
    chainId: environment.revnetChainId,
    paymentCurrency: environment.revnetPaymentCurrency,
    paymentTokenAddress,
    paymentTokenDecimals: environment.revnetPaymentTokenDecimals,
    projectId,
    rpcUrl: environment.revnetRpcUrl,
    terminalAddress,
    treasuryPrivateKey: parsePrivateKey(environment.revnetTreasuryPrivateKey),
    waitConfirmations: environment.revnetWaitConfirmations,
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
