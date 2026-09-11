import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { assertSafeId, assertSha, isRecord, sleep } from "./native-ios-hosted-e2e-support.mjs";

const PUBLIC_REPOSITORY = "cobuildwithus/murph";
const PRIVATE_REPOSITORY = "cobuildwithus/murph-cloud";
const WORKFLOW = "junction-wearable-canary.yml";
const WORKFLOW_NAME = "Private Junction Garmin Canary";
const WORKFLOW_PATH = `.github/workflows/${WORKFLOW}`;
const TIMEOUT_MS = 54 * 60_000;

export function wearableCanaryProofDigest({ privateSha, publicSha, requestId }) {
  assertSha(privateSha, "private canary revision");
  assertSha(publicSha, "public canary revision");
  assertSafeId(requestId, "canary request id", 120);
  return createHash("sha256").update(`1\n${publicSha}\n${privateSha}\n${requestId}\n`).digest("hex");
}

export function inspectWearableCanaryRun(raw, { privateSha, runId, workflowId }) {
  if (!isRecord(raw)
    || raw.id !== runId
    || raw.workflow_id !== workflowId
    || raw.name !== WORKFLOW_NAME
    || ![WORKFLOW_PATH, `${WORKFLOW_PATH}@main`].includes(raw.path)
    || raw.event !== "workflow_dispatch"
    || raw.head_branch !== "main"
    || raw.head_sha !== privateSha
    || raw.run_attempt !== 1
    || raw.repository?.full_name !== PRIVATE_REPOSITORY
    || raw.head_repository?.full_name !== PRIVATE_REPOSITORY) {
    throw new Error("Wearable canary run identity is invalid.");
  }
  return { complete: raw.status === "completed", success: raw.conclusion === "success" };
}

export function inspectWearableCanaryProof(raw, { digest, dispatchedAt, now, privateSha, runId }) {
  if (!isRecord(raw) || !Array.isArray(raw.jobs)
    || raw.total_count !== raw.jobs.length || raw.jobs.length < 1 || raw.jobs.length > 100) {
    throw new Error("Wearable canary job inventory is incomplete.");
  }
  const matches = raw.jobs.filter((job) => isRecord(job)
    && job.name === `Junction wearable canary proof / ${digest}`);
  if (matches.length !== 1) throw new Error("Wearable canary lacks one exact completed outcome receipt.");
  const proof = matches[0];
  const startedAt = Date.parse(proof.started_at);
  const completedAt = Date.parse(proof.completed_at);
  if (proof.run_id !== runId || proof.head_sha !== privateSha
    || proof.status !== "completed" || proof.conclusion !== "success"
    || !Number.isFinite(startedAt) || !Number.isFinite(completedAt)
    || startedAt < dispatchedAt - 60_000 || completedAt < startedAt
    || completedAt > now + 60_000) {
    throw new Error("Wearable canary outcome receipt is invalid or stale.");
  }
  return { completedAt: new Date(completedAt).toISOString(), journeyExecuted: true, outcome: "passed" };
}

export async function runWearableCanary(env = process.env, {
  fetchImpl = fetch,
  now = Date.now,
  sleepImpl = sleep,
} = {}) {
  const { publicSha, requestId, privateToken, publicToken } = readCanaryRequest(env);
  const request = (repository, endpoint, token, body) => requestGithub({
    body, endpoint, fetchImpl, repository, token,
  });
  const readMain = async (repository, token) => {
    const ref = await request(repository, "git/ref/heads/main", token);
    if (!isRecord(ref?.object) || ref.object.type !== "commit") {
      throw new Error("Wearable canary main revision is unavailable.");
    }
    assertSha(ref.object.sha, "canary main revision");
    return ref.object.sha;
  };
  if (await readMain(PUBLIC_REPOSITORY, publicToken) !== publicSha) {
    throw new Error("Wearable canary public main changed before dispatch.");
  }
  const privateSha = await readMain(PRIVATE_REPOSITORY, privateToken);
  const workflow = await request(PRIVATE_REPOSITORY, `actions/workflows/${WORKFLOW}`, privateToken);
  if (!isRecord(workflow) || !Number.isSafeInteger(workflow.id) || workflow.id < 1
    || workflow.path !== WORKFLOW_PATH || workflow.name !== WORKFLOW_NAME || workflow.state !== "active") {
    throw new Error("Wearable canary private workflow is unavailable or invalid.");
  }
  const digest = wearableCanaryProofDigest({ privateSha, publicSha, requestId });
  const dispatchedAt = now();
  const receipt = await request(PRIVATE_REPOSITORY, `actions/workflows/${WORKFLOW}/dispatches`, privateToken, {
    inputs: { contract_version: "1", public_sha: publicSha, request_id: requestId },
    ref: "main",
    return_run_details: true,
  });
  const runId = receipt?.workflow_run_id;
  if (!Number.isSafeInteger(runId) || runId < 1) {
    throw new Error("Wearable canary dispatch did not return an exact run receipt; no retry was made.");
  }
  while (now() < dispatchedAt + TIMEOUT_MS) {
    const run = inspectWearableCanaryRun(
      await request(PRIVATE_REPOSITORY, `actions/runs/${runId}`, privateToken),
      { privateSha, runId, workflowId: workflow.id },
    );
    if (run.complete) {
      if (!run.success) throw new Error("Wearable canary private journey did not succeed.");
      const proof = inspectWearableCanaryProof(
        await request(PRIVATE_REPOSITORY, `actions/runs/${runId}/jobs?filter=latest&per_page=100&page=1`, privateToken),
        { digest, dispatchedAt, now: now(), privateSha, runId },
      );
      if (await readMain(PRIVATE_REPOSITORY, privateToken) !== privateSha) {
        throw new Error("Wearable canary private main changed during execution.");
      }
      return { ...proof, privateSha, publicSha };
    }
    await sleepImpl(15_000);
  }
  throw new Error("Wearable canary proof timed out; private execution was not cancelled.");
}

function readCanaryRequest(env) {
  const publicSha = env.GITHUB_SHA;
  const requestId = `wearable-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  assertSha(publicSha, "public canary revision");
  assertSafeId(requestId, "canary request id", 120);
  if (env.GITHUB_REPOSITORY !== PUBLIC_REPOSITORY || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REF_PROTECTED !== "true"
    || !["push", "schedule", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)
    || !/^\d+$/u.test(env.GITHUB_RUN_ID ?? "") || !/^[1-9]\d*$/u.test(env.GITHUB_RUN_ATTEMPT ?? "")) {
    throw new Error("Wearable canary requires an exact protected-main controller.");
  }
  const privateToken = requiredToken(env.WEARABLE_CANARY_PRIVATE_GITHUB_TOKEN);
  const publicToken = requiredToken(env.GITHUB_TOKEN);
  return { publicSha, requestId, privateToken, publicToken };
}

function requiredToken(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Wearable canary controller credentials are unavailable.");
  }
  return value;
}

async function requestGithub({ body, endpoint, fetchImpl, repository, token }) {
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/${endpoint}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": "2026-03-10",
      },
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("request-failed");
    }
    return await response.json();
  } catch {
    throw new Error("Wearable canary GitHub request failed; no private response was exposed.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWearableCanary().then(({ completedAt, publicSha }) => {
    console.log(`::notice::wearable-canary result=passed journey_executed=true public_sha=${publicSha} completed_at=${completedAt}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "Wearable canary failed.");
    process.exitCode = 1;
  });
}
