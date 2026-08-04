import assert from "node:assert/strict";

import { beforeEach, expect, test, vi } from "vitest";

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
