import { jsonError, methodNotAllowed, unauthorized } from "../json.ts";
import {
  requireRunnerRuntimeWriteFenceWrite,
  RunnerRuntimeWriteFenceError,
} from "./write-fence.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "./shared.ts";

export async function handleRunnerGeneratedImageUploadRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}): Promise<Response> {
  if (input.request.method !== "POST") {
    return methodNotAllowed();
  }

  try {
    await requireRunnerRuntimeWriteFenceWrite({
      env: input.env,
      request: input.request,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof RunnerRuntimeWriteFenceError) {
      return unauthorized();
    }
    throw error;
  }

  // Compatibility tombstone for warm runners from the public-URL generation
  // era. New runners never call this route. Returning 410 makes old runners
  // degrade to text without creating another publicly retrievable object.
  return jsonError(
    "Generated-image URL upload is disabled; use private provider attachments.",
    410,
  );
}
