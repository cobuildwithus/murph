import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

type CapturedTurn = {
  signature: string;
  turnId: string;
  turnIndex: number;
};

type CaptureIdentity = {
  artifacts: unknown[];
  assistantResponse: null | {
    precedingUserTurnId: string;
  };
  browserEndpoint: string;
  chatUrl: string;
  committedUserTurn: CapturedTurn;
  schemaVersion: number;
  targetId: string;
};

type ThreadSnapshot = {
  assistantSnapshots: Array<{
    assistantTurnId: string;
    assistantTurnIndex: number;
    precedingUserMessageSignature: string;
    precedingUserTurnId: string;
    precedingUserTurnIndex: number;
    signature: string;
    text: string;
  }>;
  userSnapshots: CapturedTurn[];
};

type ReviewGptThreadSnapshotModule = {
  completeThreadCaptureIdentity: (
    capture: CaptureIdentity,
    snapshot: ThreadSnapshot,
  ) => CaptureIdentity;
  scopeThreadSnapshotToCaptureIdentity: (
    snapshot: ThreadSnapshot,
    capture: CaptureIdentity,
  ) => ThreadSnapshot;
};

function captureDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function provisionalTurnId(role: string, turnIndex: number, signature: string): string {
  let hash = 0x811c9dc5;
  for (const character of signature) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${role}:index:${turnIndex}:hash32:${hash.toString(16).padStart(8, "0")}`;
}

async function loadReviewGptThreadSnapshotModule(): Promise<ReviewGptThreadSnapshotModule> {
  const modulePath = path.resolve(
    "node_modules/@cobuild/review-gpt/dist/chatgpt-thread-snapshot-lib.mjs",
  );
  return import(pathToFileURL(modulePath).href) as Promise<ReviewGptThreadSnapshotModule>;
}

function captureForPrompt(promptSignature: string): CaptureIdentity {
  return {
    artifacts: [],
    assistantResponse: null,
    browserEndpoint: "http://127.0.0.1:9448",
    chatUrl: "https://chatgpt.com/c/synthetic-thread",
    committedUserTurn: {
      signature: captureDigest(promptSignature),
      turnId: provisionalTurnId("user", 0, promptSignature),
      turnIndex: 0,
    },
    schemaVersion: 2,
    targetId: "synthetic-target",
  };
}

describe("ReviewGPT detached capture identity", () => {
  it("rebinds a first user turn after its provisional DOM identity becomes canonical", async () => {
    const reviewGpt = await loadReviewGptThreadSnapshotModule();
    const promptSignature = "synthetic guarded review request";
    const canonicalUserTurnId = "data-message-id:synthetic-user-turn";
    const capture = captureForPrompt(promptSignature);
    const snapshot: ThreadSnapshot = {
      assistantSnapshots: [
        {
          assistantTurnId: "data-message-id:synthetic-assistant-turn",
          assistantTurnIndex: 0,
          precedingUserMessageSignature: promptSignature,
          precedingUserTurnId: canonicalUserTurnId,
          precedingUserTurnIndex: 0,
          signature: "synthetic completed response",
          text: "Synthetic completed response.",
        },
      ],
      userSnapshots: [
        {
          signature: promptSignature,
          turnId: canonicalUserTurnId,
          turnIndex: 0,
        },
      ],
    };

    const scoped = reviewGpt.scopeThreadSnapshotToCaptureIdentity(snapshot, capture);
    expect(scoped.userSnapshots).toEqual(snapshot.userSnapshots);
    expect(scoped.assistantSnapshots).toHaveLength(1);

    const completed = reviewGpt.completeThreadCaptureIdentity(capture, snapshot);
    expect(completed.committedUserTurn.turnId).toBe(canonicalUserTurnId);
    expect(completed.assistantResponse?.precedingUserTurnId).toBe(canonicalUserTurnId);
  });

  it("still rejects a canonical turn whose prompt signature differs", async () => {
    const reviewGpt = await loadReviewGptThreadSnapshotModule();
    const capturedSignature = "captured guarded review request";
    const capture = captureForPrompt(capturedSignature);
    const snapshot: ThreadSnapshot = {
      assistantSnapshots: [],
      userSnapshots: [
        {
          signature: "different guarded review request",
          turnId: "data-message-id:different-user-turn",
          turnIndex: 0,
        },
      ],
    };

    expect(() => reviewGpt.scopeThreadSnapshotToCaptureIdentity(snapshot, capture)).toThrow(
      "Captured committed user-turn identity resolved to 0 turns",
    );
  });

  it("still rejects a matching captured turn when a later user request exists", async () => {
    const reviewGpt = await loadReviewGptThreadSnapshotModule();
    const promptSignature = "captured guarded review request";
    const capture = captureForPrompt(promptSignature);
    const snapshot: ThreadSnapshot = {
      assistantSnapshots: [],
      userSnapshots: [
        {
          signature: promptSignature,
          turnId: "data-message-id:captured-user-turn",
          turnIndex: 0,
        },
        {
          signature: "later request",
          turnId: "data-message-id:later-user-turn",
          turnIndex: 1,
        },
      ],
    };

    expect(() => reviewGpt.scopeThreadSnapshotToCaptureIdentity(snapshot, capture)).toThrow(
      "Captured committed user turn is no longer the latest request",
    );
  });

  it("still rejects ambiguous canonical candidates", async () => {
    const reviewGpt = await loadReviewGptThreadSnapshotModule();
    const promptSignature = "captured guarded review request";
    const capture = captureForPrompt(promptSignature);
    const snapshot: ThreadSnapshot = {
      assistantSnapshots: [],
      userSnapshots: [
        {
          signature: promptSignature,
          turnId: "data-message-id:first-candidate",
          turnIndex: 0,
        },
        {
          signature: promptSignature,
          turnId: "data-message-id:second-candidate",
          turnIndex: 0,
        },
      ],
    };

    expect(() => reviewGpt.scopeThreadSnapshotToCaptureIdentity(snapshot, capture)).toThrow(
      "Captured committed user-turn identity resolved to 2 turns",
    );
  });
});
