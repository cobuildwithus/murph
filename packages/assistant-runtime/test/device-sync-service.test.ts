import assert from "node:assert/strict";

import { beforeEach, expect, test, vi } from "vitest";
import { isDeviceSyncError } from "@murphai/device-syncd/errors";
import type { CreateDeviceSyncServiceInput } from "@murphai/device-syncd/service";
import type { DeviceSyncImporterPort } from "@murphai/device-syncd/types";
import {
  HostedRuntimeArtifactReadError,
  HostedRuntimeCanonicalCheckpointError,
} from "../src/hosted-runtime/platform.ts";

const mocks = vi.hoisted(() => ({
  closeStore: vi.fn(),
  createDefaultImporterPort: vi.fn(),
  createDeviceSyncService: vi.fn(),
  SqliteDeviceSyncStore: vi.fn(),
}));

vi.mock("@murphai/device-syncd/service", () => ({
  createDefaultImporterPort: mocks.createDefaultImporterPort,
  createDeviceSyncService: mocks.createDeviceSyncService,
  SqliteDeviceSyncStore: mocks.SqliteDeviceSyncStore,
}));

import { createHostedRuntimeDeviceSyncService } from "../src/device-sync-service.ts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createDefaultImporterPort.mockReturnValue({
    importDeviceProviderSnapshot: vi.fn(),
  });
  mocks.SqliteDeviceSyncStore.mockImplementation(function MockSqliteDeviceSyncStore() {
    return {
      close: mocks.closeStore,
    };
  });
});

test("hosted runtime device-sync helper closes the store when service creation throws", () => {
  const expectedError = new Error("service init failed");
  mocks.createDeviceSyncService.mockImplementation(() => {
    throw expectedError;
  });

  expect(() =>
    createHostedRuntimeDeviceSyncService({
      secret: "secret-for-tests",
      config: {
        publicBaseUrl: "https://sync.example.test/device-sync",
        vaultRoot: "/tmp/vault-root",
      },
      providers: [],
    })
  ).toThrow(expectedError);

  assert.equal(mocks.closeStore.mock.calls.length, 1);
});

test.each([
  {
    code: "HOSTED_DEVICE_SYNC_ARTIFACT_READ_FAILED",
    error: new HostedRuntimeArtifactReadError({
      cause: new DOMException("Synthetic artifact timeout.", "TimeoutError"),
      retryable: true,
    }),
    httpStatus: 503,
    retryable: true,
  },
  {
    code: "HOSTED_DEVICE_SYNC_CANONICAL_CHECKPOINT_FAILED",
    error: new HostedRuntimeCanonicalCheckpointError({
      cause: new DOMException("Synthetic checkpoint timeout.", "TimeoutError"),
    }),
    httpStatus: 503,
    retryable: true,
  },
  {
    code: "HOSTED_DEVICE_SYNC_ARTIFACT_READ_FAILED",
    error: new HostedRuntimeArtifactReadError({
      cause: new Error("Synthetic artifact integrity failure."),
      retryable: false,
    }),
    httpStatus: 500,
    retryable: false,
  },
])("hosted runtime device-sync translates $code retryable=$retryable into the existing job policy", async ({
  code,
  error,
  httpStatus,
  retryable,
}) => {
  const importer = captureHostedDeviceSyncImporter({
    async importDeviceProviderSnapshot() {
      throw error;
    },
  });

  let rejected: unknown = null;
  try {
    await importer.importDeviceProviderSnapshot({
      provider: "demo",
      snapshot: {},
      vaultRoot: "/tmp/vault-root",
    });
  } catch (caught) {
    rejected = caught;
  }

  expect(isDeviceSyncError(rejected)).toBe(true);
  if (!isDeviceSyncError(rejected)) {
    throw new Error("Expected a device-sync error.");
  }
  expect(rejected).toMatchObject({
    code,
    httpStatus,
    retryable,
  });
});

function captureHostedDeviceSyncImporter(
  importer: DeviceSyncImporterPort,
): DeviceSyncImporterPort {
  let captured: DeviceSyncImporterPort | null = null;
  mocks.createDeviceSyncService.mockImplementation((input: CreateDeviceSyncServiceInput) => {
    captured = input.importer ?? null;
    return {};
  });

  createHostedRuntimeDeviceSyncService({
    secret: "secret-for-tests",
    config: {
      publicBaseUrl: "https://sync.example.test/device-sync",
      vaultRoot: "/tmp/vault-root",
    },
    importer,
    providers: [],
  });

  if (!captured) {
    throw new Error("Expected the hosted device-sync importer wrapper.");
  }
  return captured;
}
