import { describe, expect, it } from "vitest";
import {
  HOSTED_GEMINI_VIDEO_ANALYSIS_SYSTEM_INSTRUCTION,
} from "@murphai/hosted-execution/assistant-capabilities";

import {
  HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_BODY_BYTES,
  HOSTED_GEMINI_VIDEO_ANALYSIS_PATH,
  isAllowedHostedGeminiVideoAnalysisRequest,
  parseHostedGeminiVideoAnalysisRequestBody,
  readHostedGeminiVideoAnalysisUsageMetadata,
} from "../src/runner-egress-gemini.ts";

function createRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    contents: [{
      parts: [
        {
          inlineData: {
            data: Buffer.from("video").toString("base64"),
            mimeType: "video/mp4",
          },
          videoMetadata: { fps: 1 },
        },
        { text: "Describe visible movement." },
      ],
      role: "user",
    }],
    generationConfig: {
      maxOutputTokens: 1_800,
      thinkingConfig: { thinkingLevel: "low" },
    },
    systemInstruction: {
      parts: [{ text: HOSTED_GEMINI_VIDEO_ANALYSIS_SYSTEM_INSTRUCTION }],
    },
    ...overrides,
  };
}

describe("hosted Gemini video egress contract", () => {
  it("pins the only admitted method and model path", () => {
    expect(isAllowedHostedGeminiVideoAnalysisRequest(
      "POST",
      HOSTED_GEMINI_VIDEO_ANALYSIS_PATH,
    )).toBe(true);
    expect(isAllowedHostedGeminiVideoAnalysisRequest(
      "GET",
      HOSTED_GEMINI_VIDEO_ANALYSIS_PATH,
    )).toBe(false);
    expect(isAllowedHostedGeminiVideoAnalysisRequest(
      "POST",
      "/v1beta/models/gemini-other:generateContent",
    )).toBe(false);
  });

  it("accepts the exact 1 FPS inline-video request", () => {
    expect(parseHostedGeminiVideoAnalysisRequestBody(createRequestBody()))
      .toEqual(createRequestBody());
    const quicktime = createRequestBody();
    quicktime.contents[0]!.parts[0]!.inlineData!.mimeType = "video/quicktime";
    expect(parseHostedGeminiVideoAnalysisRequestBody(quicktime)).toEqual(quicktime);
    expect(HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_BODY_BYTES).toBe(20 * 1024 * 1024);
  });

  it("rejects added fields, sampling drift, media drift, and generation drift", () => {
    const valid = createRequestBody();
    const validContents = valid.contents;
    const validGenerationConfig = valid.generationConfig;
    const cases = [
      createRequestBody({ model: "gemini-other" }),
      createRequestBody({
        contents: [{
          parts: [
            {
              inlineData: {
                data: Buffer.from("video").toString("base64"),
                mimeType: "video/mp4",
              },
              videoMetadata: { fps: 5 },
            },
            { text: "Describe movement." },
          ],
          role: "user",
        }],
      }),
      createRequestBody({
        contents: [{
          parts: [
            {
              inlineData: {
                data: Buffer.from("video").toString("base64"),
                mimeType: "application/octet-stream",
              },
              videoMetadata: { fps: 1 },
            },
            { text: "Describe movement." },
          ],
          role: "user",
        }],
      }),
      createRequestBody({
        generationConfig: {
          ...validGenerationConfig,
          temperature: 0.2,
        },
      }),
      createRequestBody({
        contents: validContents,
        systemInstruction: {
          parts: [{ text: "okay", extra: true }],
        },
      }),
    ];

    for (const candidate of cases) {
      expect(() => parseHostedGeminiVideoAnalysisRequestBody(candidate)).toThrow();
    }
  });

  it("extracts only bounded non-negative token counters", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      usageMetadata: {
        cachedContentTokenCount: 4,
        candidatesTokenCount: 18,
        promptTokenCount: 320,
        thoughtsTokenCount: 7,
        totalTokenCount: 345,
        trafficType: "ON_DEMAND",
      },
    }));
    expect(readHostedGeminiVideoAnalysisUsageMetadata(bytes)).toEqual({
      cachedContentTokenCount: 4,
      candidatesTokenCount: 18,
      promptTokenCount: 320,
      thoughtsTokenCount: 7,
      totalTokenCount: 345,
    });
  });
});
