import { describe, expect, it, vi } from "vitest";

import {
  classifyR2OnlineCopyKey,
  compareR2OnlineEligibleObjects,
  createSignedR2Request,
  parseR2BundlesOnlineCopyArgs,
  runR2BundlesOnlineCopy,
  type R2BundlesOnlineCopyOptions,
} from "../scripts/r2-bundles-online-copy.ts";
import {
  createR2MigrationMarkerKey,
  type R2BundlesMigrationCommandRunner,
  type R2ObjectInventoryEntry,
} from "../scripts/r2-bundles-migration.ts";
import { createHostedStorageNamespaceId } from "../src/storage-paths.ts";

const sourceBucket = "murph-bundles-oc";
const destinationBucket = "murph-bundles-enam";
const environment = {
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_MIGRATION_ACCESS_KEY_ID: "access",
  R2_MIGRATION_SECRET_ACCESS_KEY: "secret",
};
const activeOwners = {
  canonicalSnapshotObjectKeys: new Set<string>(),
  namespaces: new Set(["hsn_0123456789abcdef01234567"]),
};
const lifecycleOutput = (bucketName: string) => `Listing lifecycle rules for bucket '${bucketName}'...
name:     delete-hosted-email-raw-messages-after-24h
enabled:  Yes
prefix:   hosted-email/messages/
action:   Expire objects after 1 days

name:     delete-hosted-private-media-after-24h
enabled:  Yes
prefix:   hosted-private-media/images/
action:   Expire objects after 1 days

name:     delete-hosted-meal-photos-after-31d
enabled:  Yes
prefix:   hosted-meal-photos/images/
action:   Expire objects after 31 days`;
type CopyObjectInput = {
  destination: string;
  entry: R2ObjectInventoryEntry;
  source: string;
};
type MigrationCommandCall = {
  args: readonly string[];
  command: string;
};

function entry(key: string, overrides: Partial<R2ObjectInventoryEntry> = {}): R2ObjectInventoryEntry {
  return {
    etag: '"d41d8cd98f00b204e9800998ecf8427e"',
    key,
    lastModified: "2026-07-28T00:00:00.000Z",
    size: 0,
    storageClass: "STANDARD",
    ...overrides,
  };
}

function marker(): R2ObjectInventoryEntry {
  return entry(createR2MigrationMarkerKey(sourceBucket, destinationBucket));
}

function undiciConnectTimeout(): TypeError {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error("Connect Timeout Error"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    }),
  });
}

function options(overrides: Partial<R2BundlesOnlineCopyOptions> = {}): R2BundlesOnlineCopyOptions {
  return {
    apply: false,
    confirmDestination: null,
    copierExclusive: overrides.apply === true,
    copierStopped: false,
    destination: destinationBucket,
    finalConvergence: false,
    holdForSourcePutDrain: false,
    immutableKeysAudited: false,
    phase: "source_active",
    source: sourceBucket,
    sourcePutDrained: false,
    ...overrides,
  };
}

function createCommandBoundaryRunner(input: {
  destinationInventory: () => R2ObjectInventoryEntry[];
  ownerStdout?: string;
  sourceInventory: () => R2ObjectInventoryEntry[];
}): {
  calls: MigrationCommandCall[];
  runner: R2BundlesMigrationCommandRunner;
} {
  const calls: MigrationCommandCall[] = [];
  return {
    calls,
    runner: {
      async run(call) {
        calls.push({ args: call.args, command: call.command });
        if (call.command === "aws" && call.args[0] === "--version") {
          return { stderr: "aws-cli/2.24.21", stdout: "" };
        }
        if (call.command === "murph-prod-psql-ro") {
          return {
            stderr: "",
            stdout: input.ownerStdout
              ?? `${JSON.stringify({ memberId: "member_1", snapshotRef: null })}\n`,
          };
        }
        if (call.command === "pnpm" && call.args.includes("info")) {
          const bucket = String(call.args[5]);
          return {
            stderr: "",
            stdout: JSON.stringify({
              default_storage_class: "Standard",
              location: bucket === sourceBucket ? "OC" : "ENAM",
              name: bucket,
            }),
          };
        }
        if (call.command === "pnpm" && call.args.includes("lifecycle")) {
          return {
            stderr: "",
            stdout: lifecycleOutput(String(call.args[6])),
          };
        }
        if (
          call.command === "aws"
          && call.args[0] === "s3api"
          && call.args[1] === "list-objects-v2"
        ) {
          const bucket = call.args[call.args.indexOf("--bucket") + 1];
          return {
            stderr: "",
            stdout: JSON.stringify(
              bucket === sourceBucket
                ? input.sourceInventory()
                : input.destinationInventory(),
            ),
          };
        }
        throw new Error(`Unhandled online-copy test command: ${call.command} ${call.args.join(" ")}`);
      },
    },
  };
}

type ProductionCopyFixtureState = {
  destinationInventory: R2ObjectInventoryEntry[];
};

function createProductionCopyFixture(
  eligible: R2ObjectInventoryEntry,
  fetchImplementation: (
    request: RequestInfo | URL,
    init: RequestInit | undefined,
    state: ProductionCopyFixtureState,
  ) => Promise<Response>,
): {
  fetchMock: ReturnType<typeof vi.fn>;
  run: () => Promise<void>;
  state: ProductionCopyFixtureState;
} {
  const state: ProductionCopyFixtureState = {
    destinationInventory: [marker()],
  };
  const harness = createCommandBoundaryRunner({
    destinationInventory: () => state.destinationInventory,
    sourceInventory: () => [eligible],
  });
  const fetchMock = vi.fn(async (
    request: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => await fetchImplementation(request, init, state));
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    run: async () => await runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      { log: vi.fn(), runner: harness.runner },
    ),
    state,
  };
}

function exactHeadResponse(planned: R2ObjectInventoryEntry): Response {
  return new Response(null, {
    headers: {
      "content-length": String(planned.size),
      etag: planned.etag,
    },
    status: 200,
  });
}

function criticalCopyHeaders(init: RequestInit | undefined): Record<string, string | null> {
  const headers = new Headers(init?.headers);
  return {
    "cf-copy-destination-if-none-match": headers.get("cf-copy-destination-if-none-match"),
    "x-amz-copy-source": headers.get("x-amz-copy-source"),
    "x-amz-copy-source-if-match": headers.get("x-amz-copy-source-if-match"),
    "x-amz-metadata-directive": headers.get("x-amz-metadata-directive"),
    "x-amz-storage-class": headers.get("x-amz-storage-class"),
  };
}

describe("R2 online immutable copy", () => {
  it("classifies only the approved immutable user-scoped key families", () => {
    expect(classifyR2OnlineCopyKey(
      "users/hsn_0123456789abcdef01234567/artifacts/0123456789abcdef0123456789abcdef0123456789abcdef.artifact.bin",
    )).toBe("eligible_immutable");
    expect(classifyR2OnlineCopyKey(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/snapshot_1.snapshot.enc",
    )).toBe("eligible_immutable");
    expect(classifyR2OnlineCopyKey(
      "hosted-email/messages/hsn_0123456789abcdef01234567/message.eml",
    )).toBe("lifecycle_managed");
    expect(classifyR2OnlineCopyKey(
      "hosted-private-media/images/hsn_0123456789abcdef01234567/photo.image.enc",
    )).toBe("lifecycle_managed");
    expect(classifyR2OnlineCopyKey(
      "hosted-meal-photos/images/hsn_0123456789abcdef01234567/photo.jpg.enc",
    )).toBe("lifecycle_managed");
    expect(classifyR2OnlineCopyKey(
      "users/hsn_0123456789abcdef01234567/runner-secrets.json",
    )).toBe("mutable_fixed");
    expect(classifyR2OnlineCopyKey("bundles/full/legacy.bundle.json")).toBe("legacy_global");
    expect(classifyR2OnlineCopyKey("unexpected/key")).toBe("unknown");
  });

  it("rejects prune-like arguments and requires explicit final-drain acknowledgements", () => {
    expect(() => parseR2BundlesOnlineCopyArgs([
      "--source", sourceBucket,
      "--destination", destinationBucket,
      "--phase", "source_active",
      "--prune", "1",
    ])).toThrow();
    expect(() => parseR2BundlesOnlineCopyArgs([
      "--source", sourceBucket,
      "--destination", destinationBucket,
      "--phase", "destination_active",
      "--final-convergence",
      "--immutable-keys-audited",
    ])).toThrow("--copier-stopped");
  });

  it("requires an explicit single-copier assertion for apply", () => {
    expect(() => parseR2BundlesOnlineCopyArgs([
      "--source", sourceBucket,
      "--destination", destinationBucket,
      "--phase", "source_active",
      "--apply",
      "--confirm-destination", destinationBucket,
      "--immutable-keys-audited",
    ])).toThrow("--copier-exclusive");
    expect(parseR2BundlesOnlineCopyArgs([
      "--source", sourceBucket,
      "--destination", destinationBucket,
      "--phase", "source_active",
      "--apply",
      "--confirm-destination", destinationBucket,
      "--copier-exclusive",
      "--hold-for-source-put-drain",
      "--immutable-keys-audited",
    ])).toMatchObject({
      apply: true,
      copierExclusive: true,
      holdForSourcePutDrain: true,
    });
  });

  it("rejects the process-bound drain hold outside an apply invocation", () => {
    expect(() => parseR2BundlesOnlineCopyArgs([
      "--source", sourceBucket,
      "--destination", destinationBucket,
      "--phase", "source_active",
      "--hold-for-source-put-drain",
    ])).toThrow("--hold-for-source-put-drain requires --apply");
  });

  it("rejects destination-active apply before issuing any R2 request", async () => {
    const copyObject = vi.fn();
    const headObject = vi.fn();
    const inspectActiveOwners = vi.fn();
    const inspectInfrastructure = vi.fn();
    const putMarker = vi.fn();
    const readInventory = vi.fn();

    await expect(runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
        phase: "destination_active",
      }),
      environment,
      {
        client: { copyObject, headObject, putMarker },
        inspectActiveOwners,
        inspectInfrastructure,
        log: vi.fn(),
        readInventory,
      },
    )).rejects.toThrow("--apply requires --phase source_active");

    expect(inspectInfrastructure).not.toHaveBeenCalled();
    expect(inspectActiveOwners).not.toHaveBeenCalled();
    expect(readInventory).not.toHaveBeenCalled();
    expect(copyObject).not.toHaveBeenCalled();
    expect(headObject).not.toHaveBeenCalled();
    expect(putMarker).not.toHaveBeenCalled();
  });

  it("signs the R2 beta destination create-only header with the source ETag", () => {
    const signed = createSignedR2Request({
      accessKeyId: "access",
      bucket: destinationBucket,
      endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
      headers: {
        "cf-copy-destination-if-none-match": "*",
        "x-amz-copy-source": `/${sourceBucket}/users/key`,
        "x-amz-copy-source-if-match": '"etag"',
        "x-amz-metadata-directive": "COPY",
        "x-amz-storage-class": "STANDARD",
      },
      key: "users/key",
      method: "PUT",
      now: new Date("2026-07-28T12:00:00.000Z"),
      secretAccessKey: "secret",
    });

    expect(signed.headers["cf-copy-destination-if-none-match"]).toBe("*");
    expect(signed.headers["x-amz-copy-source-if-match"]).toBe('"etag"');
    expect(signed.headers.authorization).toContain("cf-copy-destination-if-none-match");
    expect(signed.headers.authorization).toContain("x-amz-copy-source-if-match");
  });

  it("exercises the production command boundary, create-only CopyObject, and owner gate", async () => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/boundary.snapshot.enc`,
      { etag: '"abababababababababababababababab"', size: 12 },
    );
    let destinationInventory = [marker()];
    const harness = createCommandBoundaryRunner({
      destinationInventory: () => destinationInventory,
      sourceInventory: () => [eligible],
    });
    const destinationExistsResponse = new Response("<Error />", { status: 412 });
    const fetchMock = vi.fn(async (
      request: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(String(request));
      if (init?.method === "PUT") {
        const headers = new Headers(init.headers);
        expect(init.redirect).toBe("error");
        expect(url.pathname).toBe(`/${destinationBucket}/${eligible.key}`);
        expect(headers.get("cf-copy-destination-if-none-match")).toBe("*");
        expect(headers.get("x-amz-copy-source")).toBe(`/${sourceBucket}/${eligible.key}`);
        expect(headers.get("x-amz-copy-source-if-match")).toBe(eligible.etag);
        expect(headers.get("x-amz-metadata-directive")).toBe("COPY");
        expect(headers.get("x-amz-storage-class")).toBe("STANDARD");
        expect(headers.get("authorization")).toContain(
          "cf-copy-destination-if-none-match",
        );
        destinationInventory = [marker(), eligible];
        return destinationExistsResponse;
      }
      if (init?.method === "HEAD") {
        expect(init.redirect).toBe("error");
        expect([
          `/${destinationBucket}/${eligible.key}`,
          `/${sourceBucket}/${eligible.key}`,
        ]).toContain(url.pathname);
        return new Response(null, {
          headers: {
            "content-length": String(eligible.size),
            etag: eligible.etag,
          },
          status: 200,
        });
      }
      throw new Error(`Unexpected online-copy fetch: ${init?.method ?? "GET"} ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        log: vi.fn(),
        runner: harness.runner,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(destinationExistsResponse.bodyUsed).toBe(true);
    expect(harness.calls.some((call) =>
      call.command === "aws" && call.args[0] === "--version"
    )).toBe(true);
    expect(harness.calls.filter((call) =>
      call.command === "pnpm" && call.args.includes("info")
    )).toHaveLength(2);
    expect(harness.calls.filter((call) =>
      call.command === "pnpm" && call.args.includes("lifecycle")
    )).toHaveLength(2);
    expect(harness.calls.filter((call) => call.command === "murph-prod-psql-ro")).toHaveLength(4);
  });

  it.each([
    {
      label: "transport failure",
      response: () => {
        throw new TypeError("ambiguous transport failure");
      },
    },
    {
      label: "rejected redirect",
      response: () => {
        throw new TypeError("fetch failed", {
          cause: new Error("unexpected redirect"),
        });
      },
    },
    {
      label: "mid-request socket failure",
      response: () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("other side closed"), {
            code: "UND_ERR_SOCKET",
          }),
        });
      },
    },
    {
      label: "lookalike direct connect-timeout code",
      response: () => {
        throw Object.assign(new Error("Connect Timeout Error"), {
          code: "UND_ERR_CONNECT_TIMEOUT",
        });
      },
    },
    {
      label: "server failure",
      response: () => new Response(null, { status: 503 }),
    },
    {
      label: "rate limit",
      response: () => new Response(null, { status: 429 }),
    },
  ])("never retries CopyObject after an ambiguous $label", async ({ response }) => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/no-retry.snapshot.enc`,
      { etag: '"cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"', size: 12 },
    );
    const harness = createCommandBoundaryRunner({
      destinationInventory: () => [marker()],
      sourceInventory: () => [eligible],
    });
    const fetchMock = vi.fn(async (
      _request: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      if (init?.method !== "PUT") {
        throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
      }
      return response();
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      { log: vi.fn(), runner: harness.runner },
    )).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops after one retry when the exact pre-connect timeout repeats", async () => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/preconnect-exhausted.snapshot.enc`,
      { etag: '"abababababababababababababababab"', size: 12 },
    );
    const harness = createCommandBoundaryRunner({
      destinationInventory: () => [marker()],
      sourceInventory: () => [eligible],
    });
    const fetchMock = vi.fn(async (
      _request: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      if (init?.method !== "PUT") {
        throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
      }
      throw undiciConnectTimeout();
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      { log: vi.fn(), runner: harness.runner },
    )).rejects.toThrow("fetch failed");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries a connect-timeout-shaped body failure after response headers", async () => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/post-response-body-failure.snapshot.enc`,
      { etag: '"cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"', size: 12 },
    );
    const harness = createCommandBoundaryRunner({
      destinationInventory: () => [marker()],
      sourceInventory: () => [eligible],
    });
    const fetchMock = vi.fn(async (
      _request: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      if (init?.method !== "PUT") {
        throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
      }
      return new Response(new ReadableStream({
        start(controller) {
          controller.error(undiciConnectTimeout());
        },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      { log: vi.fn(), runner: harness.runner },
    )).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once only for Undici's exact pre-connect timeout", async () => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/preconnect-retry.snapshot.enc`,
      { etag: '"efefefefefefefefefefefefefefefef"', size: 12 },
    );
    let destinationInventory = [marker()];
    const harness = createCommandBoundaryRunner({
      destinationInventory: () => destinationInventory,
      sourceInventory: () => [eligible],
    });
    let putAttempts = 0;
    const copySuccessResponse = new Response("<CopyObjectResult />", { status: 200 });
    const fetchMock = vi.fn(async (
      request: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(String(request));
      if (init?.method === "PUT") {
        expect(init.redirect).toBe("error");
        putAttempts += 1;
        if (putAttempts === 1) {
          throw undiciConnectTimeout();
        }
        destinationInventory = [marker(), eligible];
        return copySuccessResponse;
      }
      if (init?.method === "HEAD") {
        expect(init.redirect).toBe("error");
        expect([
          `/${destinationBucket}/${eligible.key}`,
          `/${sourceBucket}/${eligible.key}`,
        ]).toContain(url.pathname);
        return new Response(null, {
          headers: {
            "content-length": String(eligible.size),
            etag: eligible.etag,
          },
          status: 200,
        });
      }
      throw new Error(`Unexpected online-copy fetch: ${init?.method ?? "GET"} ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      { log: vi.fn(), runner: harness.runner },
    );

    expect(putAttempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(copySuccessResponse.bodyUsed).toBe(true);
  });

  it("accepts one HTTP 500 when strong HEADs prove the copy already committed", async () => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/http500-committed.snapshot.enc`,
      { etag: '"01010101010101010101010101010101"', size: 12 },
    );
    const firstResponse = new Response("<Error />", { status: 500 });
    let putAttempts = 0;
    const headPaths: string[] = [];
    const fixture = createProductionCopyFixture(
      eligible,
      async (request, init, state) => {
        const url = new URL(String(request));
        if (init?.method === "PUT") {
          putAttempts += 1;
          state.destinationInventory = [marker(), eligible];
          return firstResponse;
        }
        if (init?.method === "HEAD") {
          headPaths.push(url.pathname);
          return exactHeadResponse(eligible);
        }
        throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
      },
    );

    await fixture.run();

    expect(putAttempts).toBe(1);
    expect(firstResponse.bodyUsed).toBe(true);
    expect(headPaths).toEqual([
      `/${destinationBucket}/${eligible.key}`,
      `/${sourceBucket}/${eligible.key}`,
      `/${destinationBucket}/${eligible.key}`,
      `/${sourceBucket}/${eligible.key}`,
    ]);
  });

  it("retries one reconciled HTTP 500 once with the identical create-only request", async () => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/http500-recovery.snapshot.enc`,
      { etag: '"02020202020202020202020202020202"', size: 12 },
    );
    const firstResponse = new Response("<Error />", { status: 500 });
    const recoveryResponse = new Response("<CopyObjectResult />", { status: 200 });
    const copyHeaders: Record<string, string | null>[] = [];
    let putAttempts = 0;
    const fixture = createProductionCopyFixture(
      eligible,
      async (request, init, state) => {
        const url = new URL(String(request));
        if (init?.method === "PUT") {
          putAttempts += 1;
          copyHeaders.push(criticalCopyHeaders(init));
          if (putAttempts === 1) return firstResponse;
          state.destinationInventory = [marker(), eligible];
          return recoveryResponse;
        }
        if (init?.method === "HEAD") {
          if (
            url.pathname === `/${destinationBucket}/${eligible.key}`
            && !state.destinationInventory.includes(eligible)
          ) {
            return new Response(null, { status: 404 });
          }
          return exactHeadResponse(eligible);
        }
        throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
      },
    );

    await fixture.run();

    expect(putAttempts).toBe(2);
    expect(copyHeaders).toHaveLength(2);
    expect(copyHeaders[1]).toEqual(copyHeaders[0]);
    expect(firstResponse.bodyUsed).toBe(true);
    expect(recoveryResponse.bodyUsed).toBe(true);
  });

  it("validates a 412 from the single HTTP 500 recovery attempt", async () => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/http500-recovery-412.snapshot.enc`,
      { etag: '"03030303030303030303030303030303"', size: 12 },
    );
    const firstResponse = new Response("<Error />", { status: 500 });
    const recoveryResponse = new Response("<Error />", { status: 412 });
    const copyHeaders: Record<string, string | null>[] = [];
    let putAttempts = 0;
    const fixture = createProductionCopyFixture(
      eligible,
      async (request, init, state) => {
        const url = new URL(String(request));
        if (init?.method === "PUT") {
          putAttempts += 1;
          copyHeaders.push(criticalCopyHeaders(init));
          if (putAttempts === 1) return firstResponse;
          state.destinationInventory = [marker(), eligible];
          return recoveryResponse;
        }
        if (init?.method === "HEAD") {
          if (
            url.pathname === `/${destinationBucket}/${eligible.key}`
            && !state.destinationInventory.includes(eligible)
          ) {
            return new Response(null, { status: 404 });
          }
          return exactHeadResponse(eligible);
        }
        throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
      },
    );

    await fixture.run();

    expect(putAttempts).toBe(2);
    expect(copyHeaders[1]).toEqual(copyHeaders[0]);
    expect(firstResponse.bodyUsed).toBe(true);
    expect(recoveryResponse.bodyUsed).toBe(true);
  });

  it("fails a reconciled HTTP 500 when the destination identity conflicts", async () => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/http500-conflict.snapshot.enc`,
      { etag: '"04040404040404040404040404040404"', size: 12 },
    );
    let putAttempts = 0;
    const fixture = createProductionCopyFixture(eligible, async (_request, init) => {
      if (init?.method === "PUT") {
        putAttempts += 1;
        return new Response("<Error />", { status: 500 });
      }
      if (init?.method === "HEAD") {
        return new Response(null, {
          headers: {
            "content-length": String(eligible.size + 1),
            etag: eligible.etag,
          },
          status: 200,
        });
      }
      throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
    });

    await expect(fixture.run()).rejects.toThrow("conflicting destination identity");

    expect(putAttempts).toBe(1);
    expect(fixture.fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { destinationPresent: false, label: "absent destination" },
    { destinationPresent: true, label: "committed destination" },
  ])("fails a reconciled HTTP 500 with a missing source and $label", async ({
    destinationPresent,
  }) => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/http500-missing-source.snapshot.enc`,
      { etag: '"05050505050505050505050505050505"', size: 12 },
    );
    let putAttempts = 0;
    const fixture = createProductionCopyFixture(
      eligible,
      async (request, init, state) => {
        const url = new URL(String(request));
        if (init?.method === "PUT") {
          putAttempts += 1;
          if (destinationPresent) state.destinationInventory = [marker(), eligible];
          return new Response("<Error />", { status: 500 });
        }
        if (init?.method === "HEAD") {
          if (url.pathname === `/${sourceBucket}/${eligible.key}`) {
            return new Response(null, { status: 404 });
          }
          return destinationPresent
            ? exactHeadResponse(eligible)
            : new Response(null, { status: 404 });
        }
        throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
      },
    );

    await expect(fixture.run()).rejects.toThrow("planned source object missing");

    expect(putAttempts).toBe(1);
  });

  it("fails a reconciled HTTP 500 when the source identity changed", async () => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/http500-source-changed.snapshot.enc`,
      { etag: '"06060606060606060606060606060606"', size: 12 },
    );
    let putAttempts = 0;
    const fixture = createProductionCopyFixture(
      eligible,
      async (request, init) => {
        const url = new URL(String(request));
        if (init?.method === "PUT") {
          putAttempts += 1;
          return new Response("<Error />", { status: 500 });
        }
        if (init?.method === "HEAD") {
          if (url.pathname === `/${destinationBucket}/${eligible.key}`) {
            return new Response(null, { status: 404 });
          }
          return new Response(null, {
            headers: {
              "content-length": String(eligible.size),
              etag: '"changed"',
            },
            status: 200,
          });
        }
        throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
      },
    );

    await expect(fixture.run()).rejects.toThrow("planned source identity changed");

    expect(putAttempts).toBe(1);
  });

  it.each([
    { failedBucket: destinationBucket, label: "destination" },
    { failedBucket: sourceBucket, label: "source" },
  ])("fails a reconciled HTTP 500 when the $label HEAD fails", async ({
    failedBucket,
  }) => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/http500-head-failure.snapshot.enc`,
      { etag: '"07070707070707070707070707070707"', size: 12 },
    );
    let putAttempts = 0;
    const fixture = createProductionCopyFixture(
      eligible,
      async (request, init) => {
        const url = new URL(String(request));
        if (init?.method === "PUT") {
          putAttempts += 1;
          return new Response("<Error />", { status: 500 });
        }
        if (init?.method === "HEAD") {
          if (url.pathname === `/${failedBucket}/${eligible.key}`) {
            return new Response(null, { status: 403 });
          }
          if (url.pathname === `/${destinationBucket}/${eligible.key}`) {
            return new Response(null, { status: 404 });
          }
          return exactHeadResponse(eligible);
        }
        throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
      },
    );

    await expect(fixture.run()).rejects.toThrow("HEAD failed with HTTP 403");

    expect(putAttempts).toBe(1);
  });

  it("does not reconcile an HTTP 500 whose response body cannot be drained", async () => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/http500-body-failure.snapshot.enc`,
      { etag: '"08080808080808080808080808080808"', size: 12 },
    );
    let putAttempts = 0;
    const fixture = createProductionCopyFixture(eligible, async (_request, init) => {
      if (init?.method !== "PUT") {
        throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
      }
      putAttempts += 1;
      return new Response(new ReadableStream({
        start(controller) {
          controller.error(new TypeError("failed to read HTTP 500 body"));
        },
      }), { status: 500 });
    });

    await expect(fixture.run()).rejects.toThrow();

    expect(putAttempts).toBe(1);
    expect(fixture.fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "404", outcome: () => new Response(null, { status: 404 }) },
    { label: "500", outcome: () => new Response(null, { status: 500 }) },
    { label: "429", outcome: () => new Response(null, { status: 429 }) },
    { label: "503", outcome: () => new Response(null, { status: 503 }) },
    { label: "other 4xx", outcome: () => new Response(null, { status: 418 }) },
    { label: "other 5xx", outcome: () => new Response(null, { status: 502 }) },
    {
      label: "redirect rejection",
      outcome: () => {
        throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
      },
    },
    {
      label: "socket failure",
      outcome: () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
        });
      },
    },
    {
      label: "generic transport failure",
      outcome: () => {
        throw new TypeError("ambiguous recovery transport failure");
      },
    },
    {
      label: "response body failure",
      outcome: () => new Response(new ReadableStream({
        start(controller) {
          controller.error(new TypeError("failed to read recovery body"));
        },
      }), { status: 200 }),
    },
  ])("never makes a third CopyObject attempt after recovery $label", async ({ outcome }) => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/http500-terminal-recovery.snapshot.enc`,
      { etag: '"09090909090909090909090909090909"', size: 12 },
    );
    let putAttempts = 0;
    const fixture = createProductionCopyFixture(
      eligible,
      async (request, init) => {
        const url = new URL(String(request));
        if (init?.method === "PUT") {
          putAttempts += 1;
          if (putAttempts === 1) return new Response("<Error />", { status: 500 });
          return outcome();
        }
        if (init?.method === "HEAD") {
          if (url.pathname === `/${destinationBucket}/${eligible.key}`) {
            return new Response(null, { status: 404 });
          }
          return exactHeadResponse(eligible);
        }
        throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
      },
    );

    await expect(fixture.run()).rejects.toThrow();

    expect(putAttempts).toBe(2);
  });

  it("does not reset the CopyObject retry budget after pre-connect timeout then HTTP 500", async () => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/http500-budget-success.snapshot.enc`,
      { etag: '"10101010101010101010101010101010"', size: 12 },
    );
    let putAttempts = 0;
    const fixture = createProductionCopyFixture(
      eligible,
      async (request, init, state) => {
        const url = new URL(String(request));
        if (init?.method === "PUT") {
          putAttempts += 1;
          if (putAttempts === 1) throw undiciConnectTimeout();
          if (putAttempts === 2) return new Response("<Error />", { status: 500 });
          state.destinationInventory = [marker(), eligible];
          return new Response("<CopyObjectResult />", { status: 200 });
        }
        if (init?.method === "HEAD") {
          if (
            url.pathname === `/${destinationBucket}/${eligible.key}`
            && !state.destinationInventory.includes(eligible)
          ) {
            return new Response(null, { status: 404 });
          }
          return exactHeadResponse(eligible);
        }
        throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
      },
    );

    await fixture.run();

    expect(putAttempts).toBe(3);
  });

  it("does not retry a recovery attempt that fails with a pre-connect timeout", async () => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/http500-budget-preconnect.snapshot.enc`,
      { etag: '"11111111111111111111111111111111"', size: 12 },
    );
    let putAttempts = 0;
    const fixture = createProductionCopyFixture(
      eligible,
      async (request, init) => {
        const url = new URL(String(request));
        if (init?.method === "PUT") {
          putAttempts += 1;
          if (putAttempts === 1) return new Response("<Error />", { status: 500 });
          throw undiciConnectTimeout();
        }
        if (init?.method === "HEAD") {
          if (url.pathname === `/${destinationBucket}/${eligible.key}`) {
            return new Response(null, { status: 404 });
          }
          return exactHeadResponse(eligible);
        }
        throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
      },
    );

    await expect(fixture.run()).rejects.toThrow("fetch failed");

    expect(putAttempts).toBe(2);
  });

  it("stops after pre-connect retry, HTTP 500 reconciliation, and one recovery HTTP 500", async () => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/http500-budget-exhausted.snapshot.enc`,
      { etag: '"12121212121212121212121212121212"', size: 12 },
    );
    let putAttempts = 0;
    const fixture = createProductionCopyFixture(
      eligible,
      async (request, init) => {
        const url = new URL(String(request));
        if (init?.method === "PUT") {
          putAttempts += 1;
          if (putAttempts === 1) throw undiciConnectTimeout();
          return new Response("<Error />", { status: 500 });
        }
        if (init?.method === "HEAD") {
          if (url.pathname === `/${destinationBucket}/${eligible.key}`) {
            return new Response(null, { status: 404 });
          }
          return exactHeadResponse(eligible);
        }
        throw new Error(`Unexpected online-copy fetch method: ${init?.method ?? "GET"}`);
      },
    );

    await expect(fixture.run()).rejects.toThrow("recovery failed with HTTP 500");

    expect(putAttempts).toBe(3);
  });

  it("rejects malformed production owner rows before inventory or R2 requests", async () => {
    const harness = createCommandBoundaryRunner({
      destinationInventory: () => [marker()],
      ownerStdout: `${JSON.stringify({ memberId: null, snapshotRef: null })}\n`,
      sourceInventory: () => [],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(runR2BundlesOnlineCopy(
      options(),
      environment,
      { log: vi.fn(), runner: harness.runner },
    )).rejects.toThrow("owner query omitted memberId");

    expect(harness.calls.filter((call) => call.command === "murph-prod-psql-ro")).toHaveLength(1);
    expect(harness.calls.some((call) =>
      call.command === "aws" && call.args[1] === "list-objects-v2"
    )).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows ENAM-native objects only after destination_active", () => {
    const copied = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/source.snapshot.enc",
    );
    const enamNative = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/destination.snapshot.enc",
    );
    const comparison = compareR2OnlineEligibleObjects([copied], [copied, enamNative]);

    expect(comparison).toEqual({
      destinationOnlyEligibleCount: 1,
      mismatchedEligibleKeys: [],
      sourceOnlyEligibleKeys: [],
    });
  });

  it("copies an eligible object, excludes lifecycle keys, and exposes no delete dependency", async () => {
    const eligible = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/snapshot_1.snapshot.enc",
      { etag: '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"', size: 12 },
    );
    const lifecycle = entry(
      "hosted-email/messages/hsn_0123456789abcdef01234567/message.eml",
      { etag: '"multipart-etag-2"', size: 6_000_000_000 },
    );
    const privateMedia = entry(
      "hosted-private-media/images/hsn_0123456789abcdef01234567/photo.image.enc",
      { etag: '"multipart-etag-3"', size: 6_000_000_000 },
    );
    let destinationInventory = [marker()];
    const copyObject = vi.fn(async (_input: CopyObjectInput) => {
      destinationInventory = [marker(), eligible];
      return "copied" as const;
    });
    const headObject = vi.fn(async (bucket: string, key: string) => {
      const found = (bucket === sourceBucket ? [eligible] : destinationInventory)
        .find((candidate) => candidate.key === key);
      return found ? { etag: found.etag, size: found.size } : null;
    });

    await runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject,
          headObject,
          putMarker: vi.fn(async () => "created" as const),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket
          ? [eligible, lifecycle, privateMedia]
          : destinationInventory,
      },
    );

    expect(copyObject).toHaveBeenCalledTimes(1);
    const copyInput = copyObject.mock.calls[0]?.[0];
    if (!copyInput) {
      throw new Error("expected a copyObject call");
    }
    expect(copyInput.entry.key).toBe(eligible.key);
  });

  it("treats an identical create-only destination precondition as convergence", async () => {
    const eligible = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/already.snapshot.enc",
      { etag: '"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"', size: 7 },
    );
    const destinationInventory = [marker(), eligible];
    const copyObject = vi.fn(async () => "destination_exists" as const);

    await runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject,
          headObject: vi.fn(async () => ({ etag: eligible.etag, size: eligible.size })),
          putMarker: vi.fn(async () => "created" as const),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket
          ? [eligible]
          : (copyObject.mock.calls.length === 0 ? [marker()] : destinationInventory),
      },
    );

    expect(copyObject).toHaveBeenCalledTimes(1);
  });

  it("accepts CopyObject 404 only when a source HEAD proves live deletion", async () => {
    const boundaryNamespace = createHostedStorageNamespaceId("member_1");
    const eligible = entry(
      `users/${boundaryNamespace}/workspace-snapshots/deleted-before-copy.snapshot.enc`,
      { etag: '"12121212121212121212121212121212"', size: 12 },
    );
    let sourceDeleted = false;
    const harness = createCommandBoundaryRunner({
      destinationInventory: () => [marker()],
      sourceInventory: () => sourceDeleted ? [] : [eligible],
    });
    const fetchMock = vi.fn(async (
      request: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(String(request));
      if (init?.method === "PUT") {
        sourceDeleted = true;
        return new Response(null, { status: 404 });
      }
      if (init?.method === "HEAD") {
        expect(url.pathname).toBe(`/${sourceBucket}/${eligible.key}`);
        return new Response(null, { status: 404 });
      }
      throw new Error(`Unexpected online-copy fetch: ${init?.method ?? "GET"} ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.fn();

    await runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      { log, runner: harness.runner },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Copied or confirmed 0 destination immutable object\(s\); observed 1 planned source object\(s\) /u,
      ),
    );
  });

  it("rejects CopyObject 404 while the planned source object still exists", async () => {
    const eligible = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/ambiguous-404.snapshot.enc",
      { etag: '"34343434343434343434343434343434"', size: 9 },
    );

    await expect(runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject: vi.fn(async () => "source_missing" as const),
          headObject: vi.fn(async () => ({ etag: eligible.etag, size: eligible.size })),
          putMarker: vi.fn(async () => "created" as const),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket ? [eligible] : [marker()],
      },
    )).rejects.toThrow("planned source object still exists");
  });

  it("accepts an initially listed immutable object deleted after copy verification", async () => {
    const eligible = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/deleted-after-copy.snapshot.enc",
      { etag: '"56565656565656565656565656565656"', size: 11 },
    );
    let sourceInventoryReads = 0;
    let destinationInventory = [marker()];
    const log = vi.fn();

    await runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject: vi.fn(async () => {
            destinationInventory = [marker(), eligible];
            return "copied" as const;
          }),
          headObject: vi.fn(async () => ({ etag: eligible.etag, size: eligible.size })),
          putMarker: vi.fn(async () => "created" as const),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log,
        readInventory: async (bucket) => {
          if (bucket === destinationBucket) return destinationInventory;
          sourceInventoryReads += 1;
          return sourceInventoryReads === 1 ? [eligible] : [];
        },
      },
    );

    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Copied or confirmed 1 destination immutable object\(s\); observed 0 planned source object\(s\) .* 1 observed source object\(s\) absent/u,
      ),
    );
  });

  it("converges live source churn within one acknowledged invocation", async () => {
    const first = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/first-cycle.snapshot.enc",
      { etag: '"11111111111111111111111111111111"', size: 11 },
    );
    const second = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/second-cycle.snapshot.enc",
      { etag: '"22222222222222222222222222222222"', size: 12 },
    );
    let destinationInventory = [marker()];
    let sourceInventoryReads = 0;
    const inspectActiveOwners = vi.fn(async () => activeOwners);
    const copyObject = vi.fn(async ({ entry: planned }: CopyObjectInput) => {
      destinationInventory = [...destinationInventory, planned];
      return "copied" as const;
    });
    const log = vi.fn();

    await runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject,
          headObject: vi.fn(async (_bucket: string, key: string) => {
            const found = [first, second].find((candidate) => candidate.key === key);
            return found ? { etag: found.etag, size: found.size } : null;
          }),
          putMarker: vi.fn(async () => "created" as const),
        },
        inspectActiveOwners,
        inspectInfrastructure: async () => undefined,
        log,
        readInventory: async (bucket) => {
          if (bucket === destinationBucket) return destinationInventory;
          sourceInventoryReads += 1;
          return sourceInventoryReads === 1 ? [first] : [second];
        },
      },
    );

    expect(copyObject.mock.calls.map(([input]) => input.entry.key)).toEqual([
      first.key,
      second.key,
    ]);
    expect(inspectActiveOwners).toHaveBeenCalledTimes(6);
    expect(log).toHaveBeenCalledWith(
      "Online copy cycle 1 observed 1 new immutable source object(s); "
      + "continuing in the same acknowledged invocation.",
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Copied or confirmed 2 destination immutable object\(s\); .* 1 observed source object\(s\) absent/u,
      ),
    );
  });

  it("holds process provenance through a delayed OC PUT drain", async () => {
    const first = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/before-drain.snapshot.enc",
      { etag: '"44444444444444444444444444444444"', size: 14 },
    );
    const delayed = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/delayed-put.snapshot.enc",
      { etag: '"55555555555555555555555555555555"', size: 15 },
    );
    let destinationInventory = [marker()];
    let sourceInventory = [first];
    const copyObject = vi.fn(async ({ entry: planned }: CopyObjectInput) => {
      destinationInventory = [...destinationInventory, planned];
      if (planned.key === first.key) sourceInventory = [];
      return "copied" as const;
    });
    const waitForSourcePutDrain = vi.fn(async () => {
      sourceInventory = [delayed];
    });
    const log = vi.fn();

    await runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        holdForSourcePutDrain: true,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject,
          headObject: vi.fn(async (_bucket: string, key: string) => {
            const found = [first, delayed].find((candidate) => candidate.key === key);
            return found ? { etag: found.etag, size: found.size } : null;
          }),
          putMarker: vi.fn(async () => "created" as const),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log,
        readInventory: async (bucket) => bucket === sourceBucket
          ? sourceInventory
          : destinationInventory,
        waitForSourcePutDrain,
      },
    );

    expect(waitForSourcePutDrain).toHaveBeenCalledTimes(1);
    expect(copyObject.mock.calls.map(([input]) => input.entry.key)).toEqual([
      first.key,
      delayed.key,
    ]);
    expect(log).toHaveBeenCalledWith(
      "Online copy reached temporary convergence; retaining source provenance "
      + "until the operator confirms the OC PUT drain.",
    );
    expect(log).toHaveBeenCalledWith(
      "OC PUT drain confirmed; revalidating source and destination before exit.",
    );
  });

  it("retries inventories when canonical ownership changes during the read", async () => {
    const canonical = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/current.snapshot.enc",
      { etag: '"66666666666666666666666666666666"', size: 16 },
    );
    const canonicalOwners = {
      canonicalSnapshotObjectKeys: new Set([canonical.key]),
      namespaces: activeOwners.namespaces,
    };
    const ownerReads = [
      activeOwners,
      canonicalOwners,
      canonicalOwners,
      canonicalOwners,
    ];
    const inspectActiveOwners = vi.fn(async () => ownerReads.shift() ?? canonicalOwners);
    const readInventory = vi.fn(async (bucket: string) => bucket === sourceBucket
      ? [canonical]
      : [marker(), canonical]);
    const log = vi.fn();

    await runR2BundlesOnlineCopy(
      options(),
      environment,
      {
        client: {
          copyObject: vi.fn(),
          headObject: vi.fn(),
          putMarker: vi.fn(),
        },
        inspectActiveOwners,
        inspectInfrastructure: async () => undefined,
        log,
        readInventory,
      },
    );

    expect(inspectActiveOwners).toHaveBeenCalledTimes(4);
    expect(readInventory).toHaveBeenCalledTimes(4);
    expect(log).toHaveBeenCalledWith(
      "Hosted ownership changed during online-copy inventory read 1; "
      + "retrying the coherent read in the same invocation.",
    );
  });

  it("rejects reuse when destination-only provenance was lost with the prior process", async () => {
    const destinationOnly = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/prior-process.snapshot.enc",
      { etag: '"33333333333333333333333333333333"', size: 13 },
    );
    const copyObject = vi.fn();

    await expect(runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject,
          headObject: vi.fn(),
          putMarker: vi.fn(),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket
          ? []
          : [marker(), destinationOnly],
      },
    )).rejects.toThrow("destination contains 1 eligible object(s) absent from OC");

    expect(copyObject).not.toHaveBeenCalled();
  });

  it.each([
    { phase: "source_active", result: "copied" },
    { phase: "source_active", result: "destination_exists" },
  ] as const)(
    "rejects ambiguous $result completion followed by source deletion in $phase",
    async ({ phase, result }) => {
      const eligible = entry(
        "users/hsn_0123456789abcdef01234567/workspace-snapshots/ambiguous-order.snapshot.enc",
        { etag: '"67676767676767676767676767676767"', size: 12 },
      );
      const destinationInventory = [marker(), eligible];
      let headCalls = 0;
      const log = vi.fn();

      await expect(runR2BundlesOnlineCopy(
        options({
          apply: true,
          confirmDestination: destinationBucket,
          immutableKeysAudited: true,
          phase,
        }),
        environment,
        {
          client: {
            copyObject: vi.fn(async () => result),
            headObject: vi.fn(async () => {
              headCalls += 1;
              return headCalls === 1
                ? { etag: eligible.etag, size: eligible.size }
                : null;
            }),
            putMarker: vi.fn(async () => "created" as const),
          },
          inspectActiveOwners: async () => activeOwners,
          inspectInfrastructure: async () => undefined,
          log,
          readInventory: async (bucket) => bucket === sourceBucket
            ? [eligible]
            : (headCalls === 0 ? [marker()] : destinationInventory),
        },
      )).rejects.toThrow("copy/delete ordering is ambiguous");

      expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/^Copied or confirmed/u));
    },
  );

  it("rejects a 404-skipped key created by an overlapping copier", async () => {
    const eligible = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/overlap.snapshot.enc",
      { etag: '"68686868686868686868686868686868"', size: 12 },
    );
    let sourceInventoryReads = 0;
    let destinationInventoryReads = 0;

    await expect(runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject: vi.fn(async () => "source_missing" as const),
          headObject: vi.fn(async () => null),
          putMarker: vi.fn(async () => "created" as const),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => {
          if (bucket === sourceBucket) {
            sourceInventoryReads += 1;
            return sourceInventoryReads === 1 ? [eligible] : [];
          }
          destinationInventoryReads += 1;
          return destinationInventoryReads === 1 ? [marker()] : [marker(), eligible];
        },
      },
    )).rejects.toThrow("skipped after confirmed source deletion later appeared");
  });

  it("rejects a destination-only object absent from both source inventories", async () => {
    const eligible = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/copied.snapshot.enc",
      { etag: '"78787878787878787878787878787878"', size: 13 },
    );
    const unexpected = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/unexpected.snapshot.enc",
      { etag: '"90909090909090909090909090909090"', size: 14 },
    );
    let destinationInventory = [marker()];

    await expect(runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject: vi.fn(async () => {
            destinationInventory = [marker(), eligible, unexpected];
            return "copied" as const;
          }),
          headObject: vi.fn(async () => ({ etag: eligible.etag, size: eligible.size })),
          putMarker: vi.fn(async () => "created" as const),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket
          ? [eligible]
          : destinationInventory,
      },
    )).rejects.toThrow("never observed in OC by this invocation");
  });

  it("fails closed when an immutable source identity changes after CopyObject", async () => {
    const eligible = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/raced.snapshot.enc",
      { etag: '"cccccccccccccccccccccccccccccccc"', size: 9 },
    );
    let destinationInventory = [marker()];
    const copyObject = vi.fn(async () => {
      destinationInventory = [marker(), eligible];
      return "copied" as const;
    });

    await expect(runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject,
          headObject: vi.fn(async (bucket: string) => bucket === destinationBucket
            ? { etag: eligible.etag, size: eligible.size }
            : { etag: '"dddddddddddddddddddddddddddddddd"', size: eligible.size }),
          putMarker: vi.fn(async () => "created" as const),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket ? [eligible] : destinationInventory,
      },
    )).rejects.toThrow("source changed after a create-only copy committed");
  });

  it("final convergence accepts ENAM-only production writes and is strictly read-only", async () => {
    const copied = entry(
      "users/hsn_0123456789abcdef01234567/artifacts/0123456789abcdef0123456789abcdef0123456789abcdef.artifact.bin",
    );
    const enamNative = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/new.snapshot.enc",
    );
    const copyObject = vi.fn();
    const putMarker = vi.fn();

    await runR2BundlesOnlineCopy(
      options({
        copierStopped: true,
        finalConvergence: true,
        immutableKeysAudited: true,
        phase: "destination_active",
        sourcePutDrained: true,
      }),
      environment,
      {
        client: {
          copyObject,
          headObject: vi.fn(),
          putMarker,
        },
        inspectActiveOwners: async () => ({
          canonicalSnapshotObjectKeys: new Set([enamNative.key]),
          namespaces: activeOwners.namespaces,
        }),
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket
          ? [copied]
          : [marker(), copied, enamNative],
      },
    );

    expect(copyObject).not.toHaveBeenCalled();
    expect(putMarker).not.toHaveBeenCalled();
  });

  it("reads source and destination twice in order and rejects source drift", async () => {
    const copied = entry(
      "users/hsn_0123456789abcdef01234567/artifacts/0123456789abcdef0123456789abcdef0123456789abcdef.artifact.bin",
    );
    const changed = { ...copied, etag: '"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"' };
    const readInventory = vi.fn(async (bucket: string) => {
      const callIndex = readInventory.mock.calls.length;
      if (callIndex === 1) return [copied];
      if (callIndex === 2) return [marker(), copied];
      if (callIndex === 3) return [changed];
      return [marker(), copied];
    });
    const copyObject = vi.fn();
    const putMarker = vi.fn();

    await expect(runR2BundlesOnlineCopy(
      options({
        copierStopped: true,
        finalConvergence: true,
        immutableKeysAudited: true,
        phase: "destination_active",
        sourcePutDrained: true,
      }),
      environment,
      {
        client: {
          copyObject,
          headObject: vi.fn(),
          putMarker,
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory,
      },
    )).rejects.toThrow("inventory changed between the final convergence reads");

    expect(readInventory.mock.calls.map(([bucket]) => bucket)).toEqual([
      sourceBucket,
      destinationBucket,
      sourceBucket,
      destinationBucket,
    ]);
    expect(copyObject).not.toHaveBeenCalled();
    expect(putMarker).not.toHaveBeenCalled();
  });

  it("blocks objects outside the current hosted-member ownership set", async () => {
    const unowned = entry(
      "users/hsn_ffffffffffffffffffffffff/workspace-snapshots/orphan.snapshot.enc",
    );
    await expect(runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject: vi.fn(),
          headObject: vi.fn(),
          putMarker: vi.fn(),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket ? [unowned] : [marker()],
      },
    )).rejects.toThrow("outside current hosted-member ownership");
  });

  it("blocks lifecycle-managed private media outside the current hosted-member ownership set", async () => {
    const unowned = entry(
      "hosted-private-media/images/hsn_ffffffffffffffffffffffff/photo.image.enc",
    );
    await expect(runR2BundlesOnlineCopy(
      options(),
      environment,
      {
        client: {
          copyObject: vi.fn(),
          headObject: vi.fn(),
          putMarker: vi.fn(),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket ? [unowned] : [marker()],
      },
    )).rejects.toThrow("outside current hosted-member ownership");
  });

  it("blocks when a canonical v2 checkpoint is absent from OC", async () => {
    const canonicalKey =
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/canonical.snapshot.enc";
    await expect(runR2BundlesOnlineCopy(
      options(),
      environment,
      {
        client: {
          copyObject: vi.fn(),
          headObject: vi.fn(),
          putMarker: vi.fn(),
        },
        inspectActiveOwners: async () => ({
          canonicalSnapshotObjectKeys: new Set([canonicalKey]),
          namespaces: activeOwners.namespaces,
        }),
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket ? [] : [marker()],
      },
    )).rejects.toThrow("canonical v2 workspace snapshot");
  });

  it("blocks mutable, unknown, and legacy-global source objects before any copy", async () => {
    const copyObject = vi.fn();
    for (const blockedKey of [
      "users/hsn_0123456789abcdef01234567/runner-secrets.json",
      "bundles/full/legacy.bundle.json",
      "unknown/object",
    ]) {
      await expect(runR2BundlesOnlineCopy(
        options({
          apply: true,
          confirmDestination: destinationBucket,
          immutableKeysAudited: true,
        }),
        environment,
        {
          client: {
            copyObject,
            headObject: vi.fn(),
            putMarker: vi.fn(),
          },
          inspectActiveOwners: async () => activeOwners,
          inspectInfrastructure: async () => undefined,
          log: vi.fn(),
          readInventory: async (bucket) => bucket === sourceBucket
            ? [entry(blockedKey)]
            : [marker()],
        },
      )).rejects.toThrow("mutable, unknown, or legacy-global");
    }
    expect(copyObject).not.toHaveBeenCalled();
  });
});
