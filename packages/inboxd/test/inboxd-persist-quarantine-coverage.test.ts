import assert from "node:assert/strict";
import type { BigIntStats, PathLike, StatOptions, Stats } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test, vi } from "vitest";

import { initializeVault } from "@murphai/core";

import type { InboundCapture } from "../src/contracts/capture.ts";
import { findStoredCaptureEnvelope } from "../src/indexing/persist.ts";
import { createDeterministicInboxCaptureId } from "../src/shared.ts";
import {
  persistCanonicalInboxCapture,
  persistRawCapture,
} from "../src/index.ts";

function createCapture(overrides: Partial<InboundCapture> = {}): InboundCapture {
  return {
    source: "email",
    externalId: "msg-persist-quarantine",
    accountId: "acct",
    thread: {
      id: "thread-1",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T12:30:00.000Z",
    receivedAt: "2026-03-13T12:30:05.000Z",
    text: "Persist edge coverage",
    attachments: [],
    raw: {},
    ...overrides,
  };
}

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function importPersistWithMockedFsPromises(
  createOverrides: (
    actualFs: typeof import("node:fs/promises"),
  ) => Partial<typeof import("node:fs/promises")>,
): Promise<typeof import("../src/indexing/persist.ts")> {
  const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

  vi.resetModules();
  vi.doMock("node:fs/promises", () => ({
    ...actualFs,
    ...createOverrides(actualFs),
  }));

  return await import("../src/indexing/persist.ts");
}

async function writeUnsafeEnvelope(vaultRoot: string, input: InboundCapture): Promise<string> {
  const captureId = createDeterministicInboxCaptureId(input);
  const { absolutePath, relativeDirectory, relativePath } = buildEnvelopePaths(vaultRoot, input, captureId);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(
    absolutePath,
    `${JSON.stringify(
      {
        schema: "murph.inbox-envelope.v1",
        captureId: "../../escape",
        eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VA99",
        storedAt: "2026-03-13T12:31:00.000Z",
        input,
        stored: {
          captureId: "../../escape",
          eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VA99",
          storedAt: "2026-03-13T12:31:00.000Z",
          sourceDirectory: relativeDirectory,
          envelopePath: relativePath,
          attachments: [],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return captureId;
}

function buildEnvelopePaths(
  vaultRoot: string,
  input: InboundCapture,
  directoryCaptureId: string,
): {
  absolutePath: string;
  relativeDirectory: string;
  relativePath: string;
} {
  const relativeDirectory = path.posix.join(
    "raw",
    "inbox",
    input.source,
    input.accountId ?? "default",
    input.occurredAt.slice(0, 4),
    input.occurredAt.slice(5, 7),
    directoryCaptureId,
  );
  const relativePath = path.posix.join(relativeDirectory, "envelope.json");
  const absolutePath = path.join(vaultRoot, ...relativePath.split("/"));
  return {
    absolutePath,
    relativeDirectory,
    relativePath,
  };
}

async function writeEnvelopeFixture(input: {
  vaultRoot: string;
  inbound: InboundCapture;
  directoryCaptureId?: string;
  envelopeCaptureId?: string;
  eventId?: string;
  storedAt?: string;
  mutate?: (envelope: Record<string, unknown>) => void;
}): Promise<string> {
  const directoryCaptureId = input.directoryCaptureId ?? createDeterministicInboxCaptureId(input.inbound);
  const envelopeCaptureId = input.envelopeCaptureId ?? directoryCaptureId;
  const eventId = input.eventId ?? "evt_01HQW7K0M9N8P7Q6R5S4T3VA98";
  const storedAt = input.storedAt ?? "2026-03-13T12:31:00.000Z";
  const { absolutePath, relativeDirectory, relativePath } = buildEnvelopePaths(
    input.vaultRoot,
    input.inbound,
    directoryCaptureId,
  );
  const envelope = {
    schema: "murph.inbox-envelope.v1",
    captureId: envelopeCaptureId,
    eventId,
    storedAt,
    input: structuredClone(input.inbound),
    stored: {
      captureId: envelopeCaptureId,
      eventId,
      storedAt,
      sourceDirectory: relativeDirectory,
      envelopePath: relativePath,
      attachments: [],
    },
  } satisfies Record<string, unknown>;

  input.mutate?.(envelope);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  return directoryCaptureId;
}

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
});

test("findStoredCaptureEnvelope tolerates unsafe-envelope quarantine races when the source file is already gone", async () => {
  const renameMock = vi.fn(async () => {
    const error = new Error("missing") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  });

  const { findStoredCaptureEnvelope } = await importPersistWithMockedFsPromises(() => ({
    rename: renameMock,
  }));
  const vaultRoot = await makeTempDirectory("murph-inbox-quarantine-race");
  const input = createCapture();
  const captureId = await writeUnsafeEnvelope(vaultRoot, input);
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const envelope = await findStoredCaptureEnvelope({
    vaultRoot,
    inbound: input,
    captureId,
  });

  assert.equal(envelope, null);
  assert.ok(renameMock.mock.calls.length >= 1);
});

test("findStoredCaptureEnvelope surfaces quarantine exhaustion when every suffix is already occupied", async () => {
  const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  let statCalls = 0;

  function statOverride(_targetPath: PathLike, options?: StatOptions & { bigint?: false }): Promise<Stats>;
  function statOverride(_targetPath: PathLike, options: StatOptions & { bigint: true }): Promise<BigIntStats>;
  function statOverride(_targetPath: PathLike, options?: StatOptions): Promise<Stats | BigIntStats>;
  function statOverride(_targetPath: PathLike, options?: StatOptions): Promise<Stats | BigIntStats> {
    statCalls += 1;
    return actualFs.stat(os.tmpdir(), options as never);
  }

  const { findStoredCaptureEnvelope } = await importPersistWithMockedFsPromises(() => ({
    stat: statOverride,
  }));
  const vaultRoot = await makeTempDirectory("murph-inbox-quarantine-exhaustion");
  const input = createCapture();
  const captureId = await writeUnsafeEnvelope(vaultRoot, input);
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await assert.rejects(
    findStoredCaptureEnvelope({
      vaultRoot,
      inbound: input,
      captureId,
    }),
    /Unable to quarantine stored inbox envelope/u,
  );
  assert.equal(statCalls, 1000);
});

test("findStoredCaptureEnvelope returns null when the source account directory does not exist", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-missing-account-root");
  const input = createCapture({
    source: "telegram",
    accountId: "telegram-bot",
  });
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const envelope = await findStoredCaptureEnvelope({
    vaultRoot,
    inbound: input,
  });

  assert.equal(envelope, null);
});

test("persistRawCapture keeps unresolved attachments unstored instead of failing the capture", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-unstored-attachments");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const stored = await persistRawCapture({
    vaultRoot,
    captureId: createDeterministicInboxCaptureId(createCapture({
      externalId: "msg-unstored-attachments",
    })),
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VB01",
    input: createCapture({
      externalId: "msg-unstored-attachments",
      attachments: [
        {
          externalId: "att-empty",
          kind: "document",
          mime: "text/plain",
        },
        {
          externalId: "att-missing-path",
          kind: "document",
          mime: "text/plain",
          originalPath: path.join(vaultRoot, "missing.txt"),
          fileName: "missing.txt",
        },
      ],
    }),
    storedAt: "2026-03-13T12:45:00.000Z",
  });

  assert.equal(stored.attachments.length, 2);
  for (const attachment of stored.attachments) {
    assert.equal(attachment.storedPath, null);
    assert.equal(attachment.sha256, null);
    assert.equal(attachment.originalPath, null);
  }
});

test("findStoredCaptureEnvelope rejects malformed stored envelopes with canonical validation errors", async () => {
  const cases: Array<{
    name: string;
    mutate: (envelope: Record<string, unknown>) => void;
    expected: RegExp;
  }> = [
    {
      name: "missing stored payload",
      mutate(envelope) {
        delete envelope.stored;
      },
      expected: /Missing canonical "stored" payload/u,
    },
    {
      name: "missing input payload",
      mutate(envelope) {
        delete envelope.input;
      },
      expected: /Missing canonical "input" payload/u,
    },
    {
      name: "missing input source",
      mutate(envelope) {
        delete (envelope.input as Record<string, unknown>).source;
      },
      expected: /Missing canonical "input.source"/u,
    },
    {
      name: "missing input externalId",
      mutate(envelope) {
        delete (envelope.input as Record<string, unknown>).externalId;
      },
      expected: /Missing canonical "input.externalId"/u,
    },
    {
      name: "missing stored attachments",
      mutate(envelope) {
        delete (envelope.stored as Record<string, unknown>).attachments;
      },
      expected: /Missing canonical "stored.attachments" array/u,
    },
    {
      name: "blank capture id",
      mutate(envelope) {
        envelope.captureId = "   ";
        (envelope.stored as Record<string, unknown>).captureId = "   ";
      },
      expected: /Missing canonical "captureId"/u,
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const vaultRoot = await makeTempDirectory(`murph-inbox-malformed-envelope-${index}`);
    const input = createCapture({
      externalId: `msg-malformed-envelope-${index}`,
    });
    await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
    await writeEnvelopeFixture({
      vaultRoot,
      inbound: input,
      mutate: testCase.mutate,
    });

    await assert.rejects(
      findStoredCaptureEnvelope({
        vaultRoot,
        inbound: input,
      }),
      testCase.expected,
      testCase.name,
    );
  }
});

test("findStoredCaptureEnvelope surfaces unexpected quarantine rename failures", async () => {
  const { findStoredCaptureEnvelope } = await importPersistWithMockedFsPromises(() => ({
    rename: vi.fn(async () => {
      const error = new Error("permission denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      throw error;
    }),
  }));
  const vaultRoot = await makeTempDirectory("murph-inbox-quarantine-rename-failure");
  const input = createCapture({
    externalId: "msg-quarantine-rename-failure",
  });
  const captureId = await writeUnsafeEnvelope(vaultRoot, input);
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await assert.rejects(
    findStoredCaptureEnvelope({
      vaultRoot,
      inbound: input,
      captureId,
    }),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "EACCES",
  );
});

test("findStoredCaptureEnvelope surfaces unexpected quarantine stat failures", async () => {
  function statOverride(
    actualFs: typeof import("node:fs/promises"),
  ) {
    function stat(targetPath: PathLike, options?: StatOptions & { bigint?: false }): Promise<Stats>;
    function stat(targetPath: PathLike, options: StatOptions & { bigint: true }): Promise<BigIntStats>;
    function stat(targetPath: PathLike, options?: StatOptions): Promise<Stats | BigIntStats>;
    function stat(targetPath: PathLike, options?: StatOptions): Promise<Stats | BigIntStats> {
      const target = String(targetPath);
      if (target.includes("quarantined-invalid-capture-id")) {
        const error = new Error("permission denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }

      return actualFs.stat(targetPath, options as never);
    }

    return stat;
  }

  const { findStoredCaptureEnvelope } = await importPersistWithMockedFsPromises((actualFs) => ({
    stat: statOverride(actualFs),
  }));
  const vaultRoot = await makeTempDirectory("murph-inbox-quarantine-stat-failure");
  const input = createCapture({
    externalId: "msg-quarantine-stat-failure",
  });
  const captureId = await writeUnsafeEnvelope(vaultRoot, input);
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await assert.rejects(
    findStoredCaptureEnvelope({
      vaultRoot,
      inbound: input,
      captureId,
    }),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "EACCES",
  );
});

test("findStoredCaptureEnvelope scans other canonical ledgers when the expected month has no record", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-canonical-ledger-scan");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const archivedCapture = createCapture({
    externalId: "msg-canonical-ledger-scan",
    occurredAt: "2026-02-13T12:30:00.000Z",
  });
  const requestedCapture = createCapture({
    externalId: "msg-canonical-ledger-scan",
    occurredAt: "2026-03-13T12:30:00.000Z",
  });
  const requestedCaptureId = createDeterministicInboxCaptureId(requestedCapture);

  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_canonical_late",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VB02",
    input: archivedCapture,
    storedAt: "2026-02-13T12:32:00.000Z",
  });
  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_canonical_early",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VB03",
    input: archivedCapture,
    storedAt: "2026-02-13T12:31:00.000Z",
  });

  const envelope = await findStoredCaptureEnvelope({
    vaultRoot,
    inbound: requestedCapture,
    captureId: requestedCaptureId,
  });

  assert.ok(envelope);
  assert.equal(envelope.captureId, "cap_canonical_early");
  assert.equal(envelope.eventId, "evt_01HQW7K0M9N8P7Q6R5S4T3VB03");
});

test("findStoredCaptureEnvelope prefers the earliest stored raw envelope before comparing raw envelope paths", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-raw-envelope-order");
  const input = createCapture({
    externalId: "msg-raw-envelope-order",
  });
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await writeEnvelopeFixture({
    vaultRoot,
    inbound: input,
    directoryCaptureId: "cap_legacy_late",
    envelopeCaptureId: "cap_legacy_late",
    storedAt: "2026-03-13T12:33:00.000Z",
  });
  await writeEnvelopeFixture({
    vaultRoot,
    inbound: input,
    directoryCaptureId: "cap_legacy_z",
    envelopeCaptureId: "cap_legacy_z",
    storedAt: "2026-03-13T12:32:00.000Z",
  });
  await writeEnvelopeFixture({
    vaultRoot,
    inbound: input,
    directoryCaptureId: "cap_legacy_a",
    envelopeCaptureId: "cap_legacy_a",
    storedAt: "2026-03-13T12:32:00.000Z",
  });

  const envelope = await findStoredCaptureEnvelope({
    vaultRoot,
    inbound: input,
  });

  assert.ok(envelope);
  assert.equal(envelope.captureId, createDeterministicInboxCaptureId(input));
  assert.equal(envelope.stored.storedAt, "2026-03-13T12:32:00.000Z");
  assert.match(envelope.stored.sourceDirectory, /cap_legacy_a$/u);
});
