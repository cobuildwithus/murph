import { describe, expect, it } from "vitest";

import {
  parseHostedAssistantRuntimeConfig,
  parseHostedAssistantRuntimeJobInput,
  parseHostedAssistantRuntimeJobRequest,
} from "../src/hosted-runtime/parsers.ts";

describe("hosted runtime parser coverage", () => {
  it("parses nullable commit and resume branches without injecting optional runtime state", () => {
    const parsed = parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: null,
        commit: null,
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_123",
          },
          eventId: "evt_123",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        resume: null,
      },
    });

    expect(parsed).toEqual({
      request: {
        bundle: null,
        commit: null,
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_123",
          },
          eventId: "evt_123",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        resume: null,
      },
    });
  });

  it("parses nullable runtime config fields and forwarded env records", () => {
    expect(
      parseHostedAssistantRuntimeConfig({
        commitTimeoutMs: null,
        forwardedEnv: {
          PATH: "/usr/bin",
        },
        userEnv: {
          OPENAI_API_KEY: "secret",
        },
      }),
    ).toEqual({
      commitTimeoutMs: null,
      forwardedEnv: {
        PATH: "/usr/bin",
      },
      userEnv: {
        OPENAI_API_KEY: "secret",
      },
    });
  });

  it("rejects non-object job inputs for both null and array values", () => {
    expect(() => parseHostedAssistantRuntimeJobInput(null)).toThrow(
      /Hosted assistant runtime job input must be an object/u,
    );
    expect(() => parseHostedAssistantRuntimeJobInput([])).toThrow(
      /Hosted assistant runtime job input must be an object/u,
    );
  });

  it("rejects invalid runner summaries and runtime numeric fields", () => {
    expect(() => parseHostedAssistantRuntimeJobRequest({
      bundle: null,
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_invalid_summary",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      resume: {
        committedResult: {
          result: {
            eventsHandled: Number.POSITIVE_INFINITY,
            summary: "",
          },
          sideEffects: [],
        },
      },
    })).toThrow(/eventsHandled must be a finite number/u);

    expect(() => parseHostedAssistantRuntimeConfig({
      commitTimeoutMs: Number.NaN,
    })).toThrow(/commitTimeoutMs must be a finite number/u);
  });

  it("rejects invalid non-null next wake timestamps and empty summaries", () => {
    expect(() => parseHostedAssistantRuntimeJobRequest({
      bundle: null,
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_invalid_next_wake",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      resume: {
        committedResult: {
          result: {
            eventsHandled: 1,
            nextWakeAt: false,
            summary: "completed",
          },
          sideEffects: [],
        },
      },
    })).toThrow(/nextWakeAt must be a non-empty string/u);

    expect(() => parseHostedAssistantRuntimeJobRequest({
      bundle: null,
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_empty_summary",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      resume: {
        committedResult: {
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "",
          },
          sideEffects: [],
        },
      },
    })).toThrow(/summary must be a non-empty string/u);
  });

  it("rejects the remaining removed runtime callback override fields", () => {
    for (const field of [
      "artifactsBaseUrl",
      "commitBaseUrl",
      "emailBaseUrl",
      "resultsBaseUrl",
      "sideEffectsBaseUrl",
    ]) {
      expect(() => parseHostedAssistantRuntimeConfig({
        [field]: "https://murph.example.test",
      })).toThrow(new RegExp(`${field} is no longer supported`, "u"));
    }
  });
});
