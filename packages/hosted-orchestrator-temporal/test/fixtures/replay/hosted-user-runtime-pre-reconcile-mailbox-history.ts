import { Buffer } from "node:buffer";

import {
  defaultPayloadConverter,
  type Payload,
} from "@temporalio/common";

import {
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
} from "../../../src/index.js";

const workflowRunId = "11111111-1111-4111-8111-111111111111";
const workflowId = "hosted-user-runtime:member_replay_fixture";
const eventBaseTime = "2026-06-12T18:04:00Z";

export interface HostedUserRuntimeReplayHistoryFixture {
  history: unknown;
  workflowId: string;
}

export function createPreReconcileMailboxReplayHistoryFixture():
  HostedUserRuntimeReplayHistoryFixture {
  return {
    history: {
      events: [
        {
          eventId: "1",
          eventTime: eventBaseTime,
          eventType: "WorkflowExecutionStarted",
          workflowExecutionStartedEventAttributes: {
            attempt: 1,
            firstExecutionRunId: workflowRunId,
            identity: "replay-fixture",
            input: payloads({
              options: {
                continueAsNewAfterHistoryEvents: 750,
                continueAsNewAfterIterations: 500,
              },
              userId: "member_replay_fixture",
            }),
            originalExecutionRunId: workflowRunId,
            taskQueue: taskQueue(),
            workflowId,
            workflowTaskTimeout: "10s",
            workflowType: {
              name: HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
            },
          },
        },
        {
          eventId: "2",
          eventTime: eventBaseTime,
          eventType: "WorkflowTaskScheduled",
          workflowTaskScheduledEventAttributes: {
            attempt: 1,
            startToCloseTimeout: "10s",
            taskQueue: taskQueue(),
          },
        },
        {
          eventId: "3",
          eventTime: eventBaseTime,
          eventType: "WorkflowExecutionSignaled",
          workflowExecutionSignaledEventAttributes: {
            identity: "replay-fixture",
            input: payloads({
              kind: "mailbox_appended",
              lane: "conversation",
              laneSeq: "1",
              mailboxItemId: "mailbox_item_replay_fixture",
            }),
            signalName: HOSTED_USER_RUNTIME_SIGNAL_NAME,
          },
        },
        {
          eventId: "4",
          eventTime: eventBaseTime,
          eventType: "WorkflowTaskStarted",
          workflowTaskStartedEventAttributes: {
            identity: "replay-worker",
            requestId: "22222222-2222-4222-8222-222222222222",
            scheduledEventId: "2",
          },
        },
        {
          eventId: "5",
          eventTime: eventBaseTime,
          eventType: "WorkflowTaskCompleted",
          workflowTaskCompletedEventAttributes: {
            identity: "replay-worker",
            scheduledEventId: "2",
            startedEventId: "4",
          },
        },
        {
          eventId: "6",
          eventTime: eventBaseTime,
          eventType: "ActivityTaskScheduled",
          activityTaskScheduledEventAttributes: {
            activityId: "1",
            activityType: {
              name: "ensureRuntimeProcessing",
            },
            input: payloads({
              orchestrationAttemptId:
                "33333333-3333-4333-8333-333333333333",
              userId: "member_replay_fixture",
            }),
            retryPolicy: {
              initialInterval: "2s",
              maximumAttempts: 6,
              maximumInterval: "60s",
            },
            startToCloseTimeout: "15s",
            taskQueue: taskQueue(),
            workflowTaskCompletedEventId: "5",
          },
        },
      ],
    },
    workflowId,
  };
}

function taskQueue(): { kind: string; name: string } {
  return {
    kind: "Normal",
    name: HOSTED_USER_RUNTIME_TASK_QUEUE,
  };
}

function payloads(...values: readonly unknown[]): {
  payloads: ReturnType<typeof payloadToJson>[];
} {
  return {
    payloads: values.map((value) =>
      payloadToJson(defaultPayloadConverter.toPayload(value)),
    ),
  };
}

function payloadToJson(payload: Payload): {
  data?: string;
  metadata?: Record<string, string>;
} {
  return {
    ...(payload.data ? { data: Buffer.from(payload.data).toString("base64") } : {}),
    ...(payload.metadata
      ? {
          metadata: Object.fromEntries(
            Object.entries(payload.metadata).map(([key, value]) => [
              key,
              Buffer.from(value).toString("base64"),
            ]),
          ),
        }
      : {}),
  };
}
