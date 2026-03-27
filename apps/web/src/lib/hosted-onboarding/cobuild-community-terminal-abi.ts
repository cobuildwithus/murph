import type { Abi, Address } from "viem";

// Exact pay surface reviewed from `v1-core/src/juicebox/CobuildCommunityTerminal.sol`.
export const cobuildCommunityTerminalAbi = [
  {
    inputs: [
      {
        internalType: "uint256",
        name: "projectId",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "beneficiary",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "minReturnedTokens",
        type: "uint256",
      },
      {
        internalType: "string",
        name: "memo",
        type: "string",
      },
      {
        internalType: "bytes",
        name: "metadata",
        type: "bytes",
      },
    ],
    name: "pay",
    outputs: [
      {
        internalType: "uint256",
        name: "beneficiaryTokenCount",
        type: "uint256",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
] as const satisfies Abi;

// Matches Bananapus `JBConstants.NATIVE_TOKEN`, which the shared terminal expects for native ETH pays.
export const JBX_NATIVE_TOKEN_ADDRESS = "0x000000000000000000000000000000000000EEEe" as Address;
