import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

export async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

export function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export function readUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

export function createDeviceSyncEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DEVICE_SYNC_VAULT_ROOT: "/tmp/murph-vault",
    DEVICE_SYNC_PUBLIC_BASE_URL: "https://sync.example.test/device-sync",
    DEVICE_SYNC_SECRET: "secret-for-tests",
    DEVICE_SYNC_CONTROL_TOKEN: "control-token-for-tests",
    ...overrides,
  };
}
