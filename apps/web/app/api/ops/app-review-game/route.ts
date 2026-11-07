import { readFile } from "node:fs/promises";

import { resolveRuntimeAssetPath } from "@/app/runtime-asset-files";
import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  seedHostedOpsAppReviewGame,
  type HostedOpsAppReviewGameMode,
} from "@/src/lib/hosted-ops/app-review-game";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const HOSTED_OPS_APP_REVIEW_GAME_BODY_LIMIT_BYTES = 1024;

/** Founder-only. Dry-run by default; `{ "mode": "apply" }` replaces the review account's fixture games. */
export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_OPS_APP_REVIEW_GAME_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_APP_REVIEW_GAME_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted ops App Review game request body is too large.",
  });
  if (Object.keys(body).some((key) => key !== "mode")) {
    throw hostedOnboardingError({ code: "HOSTED_OPS_APP_REVIEW_GAME_REQUEST_INVALID", httpStatus: 400,
      message: "Only mode is accepted.", retryable: false });
  }
  return jsonOk(await seedHostedOpsAppReviewGame({
    mode: readMode(body.mode),
    readPhoto: async (publicPath) => new Uint8Array(await readFile(resolveRuntimeAssetPath(`public${publicPath}`))),
  }));
});

function readMode(value: unknown): HostedOpsAppReviewGameMode {
  if (value === undefined || value === null || value === "" || value === "dry-run") return "dry-run";
  if (value === "apply") return "apply";
  throw hostedOnboardingError({
    code: "HOSTED_OPS_APP_REVIEW_GAME_MODE_INVALID",
    httpStatus: 400,
    message: "App Review game mode must be dry-run or apply.",
    retryable: false,
  });
}
