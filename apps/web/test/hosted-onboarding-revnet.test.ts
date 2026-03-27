import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildRevnetPayIntent: vi.fn((input: Record<string, unknown>) => ({
    abi: [],
    address: input.terminalAddress,
    args: [input.projectId, input.beneficiary, input.amount, input.memo],
    functionName: "pay",
  })),
  createPublicClient: vi.fn(),
  createWalletClient: vi.fn(),
  privateKeyToAccount: vi.fn(),
}));

const environment = {
  revnetChainId: 8453,
  revnetProjectId: "1",
  revnetRpcUrl: "https://rpc.example.test/base",
  revnetStripeCurrency: "usd",
  revnetTerminalAddress: "0x0000000000000000000000000000000000000001",
  revnetTreasuryPrivateKey: `0x${"11".repeat(32)}`,
  revnetWeiPerStripeMinorUnit: "2000000000000",
};

vi.mock("@cobuild/wire", () => ({
  buildRevnetPayIntent: mocks.buildRevnetPayIntent,
}));

vi.mock("viem", () => ({
  createPublicClient: mocks.createPublicClient,
  createWalletClient: mocks.createWalletClient,
  getAddress: (value: string) => value,
  http: (url: string) => ({ url }),
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: mocks.privateKeyToAccount,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => environment,
}));

import {
  submitHostedRevnetPayment,
} from "@/src/lib/hosted-onboarding/revnet";

describe("hosted RevNet client safeguards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.privateKeyToAccount.mockReturnValue({
      address: "0x00000000000000000000000000000000000000aa",
    });
  });

  it("rejects an RPC endpoint whose chain id does not match the configured chain", async () => {
    mocks.createPublicClient.mockReturnValue({
      getChainId: vi.fn().mockResolvedValue(1),
      getTransactionCount: vi.fn(),
      simulateContract: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
    });
    mocks.createWalletClient.mockReturnValue({
      writeContract: vi.fn(),
    });

    await expect(
      submitHostedRevnetPayment({
        beneficiaryAddress: "0x00000000000000000000000000000000000000bb",
        chainId: 8453,
        memo: "issuance:hbrv_123",
        paymentAmount: 42n,
        projectId: 1n,
        terminalAddress: "0x0000000000000000000000000000000000000001",
      }),
    ).rejects.toMatchObject({
      code: "REVNET_RPC_CHAIN_MISMATCH",
    });
  });

  it("serializes treasury submissions that share the same signer", async () => {
    const firstSimulation = createDeferred<{ request: { to: string } }>();
    const publicClient = {
      getChainId: vi.fn().mockResolvedValue(8453),
      getTransactionCount: vi.fn().mockResolvedValue(7),
      simulateContract: vi.fn()
        .mockImplementationOnce(() => firstSimulation.promise)
        .mockResolvedValueOnce({ request: { to: "0x0000000000000000000000000000000000000001" } }),
      waitForTransactionReceipt: vi.fn(),
    };
    const walletClient = {
      writeContract: vi.fn()
        .mockResolvedValueOnce("0xaaa")
        .mockResolvedValueOnce("0xbbb"),
    };

    mocks.createPublicClient.mockReturnValue(publicClient);
    mocks.createWalletClient.mockReturnValue(walletClient);

    const first = submitHostedRevnetPayment({
      beneficiaryAddress: "0x00000000000000000000000000000000000000bb",
      chainId: 8453,
      memo: "issuance:first",
      paymentAmount: 42n,
      projectId: 1n,
      terminalAddress: "0x0000000000000000000000000000000000000001",
    });
    const second = submitHostedRevnetPayment({
      beneficiaryAddress: "0x00000000000000000000000000000000000000cc",
      chainId: 8453,
      memo: "issuance:second",
      paymentAmount: 84n,
      projectId: 1n,
      terminalAddress: "0x0000000000000000000000000000000000000001",
    });

    await vi.waitFor(() => {
      expect(publicClient.simulateContract).toHaveBeenCalledTimes(1);
    });

    firstSimulation.resolve({
      request: {
        to: "0x0000000000000000000000000000000000000001",
      },
    });

    await expect(first).resolves.toMatchObject({
      payTxHash: "0xaaa",
      paymentAmount: 42n,
    });
    await expect(second).resolves.toMatchObject({
      payTxHash: "0xbbb",
      paymentAmount: 84n,
    });

    await vi.waitFor(() => {
      expect(publicClient.simulateContract).toHaveBeenCalledTimes(2);
    });
    expect(walletClient.writeContract).toHaveBeenCalledTimes(2);
  });

});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    reject,
    resolve,
  };
}
