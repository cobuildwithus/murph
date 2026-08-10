import {
  json,
  jsonError,
  notFound,
  readOptionalJsonObject,
} from "../../json.ts";
import type {
  WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import {
  armTemporalMailboxSignalFaultForTest,
  clearTemporalMailboxSignalFaultForTest,
  consumeTemporalMailboxSignalFaultForTest,
} from "../../hosted-local-test/temporal-mailbox-signal-fault-control.ts";
import {
  requireHostedExecutionBoundUserResponse,
} from "../auth.ts";
import type {
  DeclarativeRoute,
} from "../routes.ts";
import {
  INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
  normalizeNonEmptyString,
} from "../route-utils/json-body.ts";
import {
  decodeRouteParam,
} from "../route-utils/route-params.ts";
import {
  isHostedWorkerTestEnvironment,
  requireHostedWorkerTestEnvironment,
} from "../route-utils/test-env.ts";
import {
  matchHostedLocalTestUserRoute,
} from "../route-utils/test-routes.ts";

type TemporalMailboxSignalFaultAction = "arm" | "clear" | "consume";

const routePrefix = "/__test/users/";
const routeSuffixPrefix = "/temporal-mailbox-signal-fault/";

export const testTemporalMailboxSignalFaultRoutes:
  readonly DeclarativeRoute<WorkerRouteContext>[] = [
    createTemporalMailboxSignalFaultRoute("arm"),
    createTemporalMailboxSignalFaultRoute("clear"),
    createTemporalMailboxSignalFaultRoute("consume"),
  ];

function createTemporalMailboxSignalFaultRoute(
  action: TemporalMailboxSignalFaultAction,
): DeclarativeRoute<WorkerRouteContext> {
  return {
    authorization: null,
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return await handleTemporalMailboxSignalFaultRoute(
        context,
        params.userId,
        action,
      );
    },
    match: matchHostedLocalTestUserRoute(
      routePrefix,
      `${routeSuffixPrefix}${action}`,
    ),
    methods: ["POST"],
    name: `test-temporal-mailbox-signal-fault-${action}`,
    wrongMethodResponse: "not-found",
  };
}

export async function handleTemporalMailboxSignalFaultRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
  action: TemporalMailboxSignalFaultAction,
): Promise<Response> {
  if (!isHostedWorkerTestEnvironment(context.env)) {
    return notFound();
  }

  const userId = decodeRouteParam(encodedUserId);
  const routeName = `test-temporal-mailbox-signal-fault-${action}`;
  const boundUserResponse = requireHostedExecutionBoundUserResponse(
    context.request,
    userId,
    "Hosted execution bound user does not match the Temporal mailbox signal fault user.",
    "test-temporal-mailbox-signal-fault-bound-user-mismatch",
    routeName,
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  if (action === "clear") {
    return json({
      ...clearTemporalMailboxSignalFaultForTest(userId),
      ok: true,
    });
  }

  const body = await readTemporalMailboxSignalFaultBody(context.request);
  if (body instanceof Response) {
    return body;
  }
  const mailboxItemId = normalizeNonEmptyString(body.mailboxItemId);
  if (!mailboxItemId) {
    return jsonError("mailboxItemId is required.", 400);
  }

  if (action === "arm") {
    try {
      return json(armTemporalMailboxSignalFaultForTest({
        mailboxItemId,
        userId,
      }));
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : String(error),
        409,
      );
    }
  }

  return json({
    consume: await consumeTemporalMailboxSignalFaultForTest({
      mailboxItemId,
      userId,
    }, 30_000),
  });
}

async function readTemporalMailboxSignalFaultBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  try {
    return await readOptionalJsonObject(request, {
      limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    return jsonError(
      error instanceof RangeError
        ? "Request body too large."
        : "Request body must be a JSON object.",
      error instanceof RangeError ? 413 : 400,
    );
  }
}
