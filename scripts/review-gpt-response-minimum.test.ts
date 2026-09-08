import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const review = require("../node_modules/@cobuild/review-gpt/src/prepare-chatgpt-draft.js");
const roots: string[] = [];
const responseText = "MODEL_CONFIRMATION: gpt-6-pro\nSynthetic review proof.\nREVIEW_COMPLETE";
const committedUserTurn = { turnId: "user-synthetic", turnIndex: 0, signature: "synthetic-request" };
const snapshot = {
  text: responseText,
  modelConfirmationText: "MODEL_CONFIRMATION: gpt-6-pro",
  modelSlug: "gpt-6-pro",
  assistantTurnId: "assistant-synthetic",
  assistantTurnIndex: 1,
  precedingUserTurnId: committedUserTurn.turnId,
  precedingUserTurnIndex: 0,
  precedingUserMessageSignature: committedUserTurn.signature,
  signature: "synthetic-response",
};

function temporaryRoot(): string {
  const sharedRoot = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!sharedRoot) throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
  const root = mkdtempSync(path.join(sharedRoot, "review-duration-"));
  roots.push(root);
  return root;
}

function durationFailure(responseElapsedMs: number, hasConcreteModelEvidence: boolean) {
  return review.markedResponseDurationFailure({
    targetModel: "gpt-6-pro", responseMarker: "REVIEW_COMPLETE",
    minimumResponseMs: 270_000, responseElapsedMs, hasConcreteModelEvidence,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("installed ReviewGPT marked-response minimum", () => {
  it.each([false, true])("enforces elapsed time with model evidence=%s", (evidence) => {
    for (const elapsed of [0, 245_650, 269_999, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(durationFailure(elapsed, evidence)).toContain("response is untrusted");
    }
    expect(durationFailure(270_000, evidence)).toBe("");
    expect(durationFailure(270_001, evidence)).toBe("");
  });

  it("preserves unmarked and current-selection behavior", () => {
    const options = { responseElapsedMs: 0, minimumResponseMs: 270_000 };
    expect(review.markedResponseDurationFailure({ ...options,
      targetModel: "gpt-6-pro", responseMarker: "" })).toBe("");
    expect(review.markedResponseDurationFailure({ ...options,
      targetModel: "current", responseMarker: "REVIEW_COMPLETE" })).toBe("");
  });

  it("rejects a fast verified response with diagnostic bytes only", () => {
    const root = temporaryRoot();
    const responseFile = path.join(root, "response.md");
    const attestation = review.modelAttestationForSnapshot(
      "gpt-6-pro", snapshot, true, committedUserTurn.signature,
    );
    expect(attestation.failure).toBe("");
    expect(attestation.evidence.responseModelSlug).toBe("gpt-6-pro");
    const failure = durationFailure(269_999, Boolean(attestation.evidence));
    expect(failure).not.toBe("");
    expect(() => review.assertMarkedResponseDurationTrusted({
      status: "response-too-fast", responseText, responseDurationFailure: failure,
    }, responseFile)).toThrow("response is untrusted");
    expect(readFileSync(responseFile, "utf8")).toBe(`${responseText}\n`);
    expect(readdirSync(root)).toEqual(["response.md"]);
  });

  it("keeps model, exact-turn and capture-digest enforcement after the floor", () => {
    expect(durationFailure(270_000, true)).toBe("");
    const attestation = review.modelAttestationForSnapshot(
      "gpt-6-pro", snapshot, true, committedUserTurn.signature,
    );
    expect(attestation.failure).toBe("");
    expect(review.modelAttestationForSnapshot("gpt-6-pro", {
      ...snapshot, modelSlug: "gpt-6-mini",
    }, true, committedUserTurn.signature).failure).toContain("expected gpt-6-pro");
    expect(review.modelAttestationForSnapshot("gpt-6-pro", snapshot, true,
      "another-request").failure).toContain("committed user turn");

    const captureInput = {
      assistantSnapshot: snapshot, committedUserTurn,
      browserEndpoint: "http://127.0.0.1:9222",
      chatUrl: "https://chatgpt.com/c/11111111-1111-4111-8111-111111111111",
      targetId: "synthetic-target",
    };
    expect(() => review.buildThreadCaptureIdentity({ ...captureInput,
      assistantSnapshot: { ...snapshot, precedingUserTurnId: "another-user" },
    })).toThrow("exact committed user turn");
    const capture = review.buildThreadCaptureIdentity(captureInput);
    const root = temporaryRoot();
    const responseFile = path.join(root, "response.md");
    const captureFile = path.join(root, "capture.json");
    expect(() => review.writeCompletedResponseArtifacts(responseFile,
      "Different synthetic bytes", attestation.evidence, capture, captureFile,
    )).toThrow("digest did not match");
    expect(readdirSync(root)).toEqual([]);
    review.writeCompletedResponseArtifacts(responseFile, responseText,
      attestation.evidence, capture, captureFile);
    const expectedHash = createHash("sha256").update(`${responseText}\n`).digest("hex");
    expect(JSON.parse(readFileSync(captureFile, "utf8")).assistantResponse.responseSha256)
      .toBe(expectedHash);
    expect(JSON.parse(readFileSync(`${responseFile}.model-verification.json`, "utf8")))
      .toMatchObject({ requestedModel: "gpt-6-pro", responseModelSlug: "gpt-6-pro",
        responseSha256: expectedHash });
  });
});
