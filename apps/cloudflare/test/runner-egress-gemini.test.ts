import { describe, expect, it } from "vitest";
import {
  HOSTED_GEMINI_VIDEO_ANALYSIS_PREVIOUS_MODEL,
  HOSTED_GEMINI_VIDEO_ANALYSIS_SYSTEM_INSTRUCTION,
} from "@murphai/hosted-execution/assistant-capabilities";

import {
  HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_BODY_BYTES,
  HOSTED_GEMINI_VIDEO_ANALYSIS_PATH,
  HOSTED_GEMINI_VIDEO_ANALYSIS_PREVIOUS_MODEL_PATH,
  isAllowedHostedGeminiVideoAnalysisRequest,
  parseHostedGeminiVideoAnalysisRequestBody,
  readHostedGeminiVideoAnalysisRequestModel,
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
      thinkingConfig: { thinkingLevel: "medium" },
    },
    systemInstruction: {
      parts: [{ text: HOSTED_GEMINI_VIDEO_ANALYSIS_SYSTEM_INSTRUCTION }],
    },
    ...overrides,
  };
}

function createLegacyRequestBody() {
  const request = createRequestBody();
  return {
    ...request,
    generationConfig: {
      maxOutputTokens: 1_800,
      thinkingConfig: { thinkingLevel: "low" },
    },
  };
}

describe("hosted Gemini video egress contract", () => {
  it("pins the current and rollout model paths to POST", () => {
    expect(isAllowedHostedGeminiVideoAnalysisRequest(
      "POST",
      HOSTED_GEMINI_VIDEO_ANALYSIS_PATH,
    )).toBe(true);
    expect(readHostedGeminiVideoAnalysisRequestModel(
      "POST",
      HOSTED_GEMINI_VIDEO_ANALYSIS_PATH,
    )).toBe("gemini-3.8-flash");
    expect(isAllowedHostedGeminiVideoAnalysisRequest(
      "POST",
      HOSTED_GEMINI_VIDEO_ANALYSIS_PREVIOUS_MODEL_PATH,
    )).toBe(true);
    expect(readHostedGeminiVideoAnalysisRequestModel(
      "POST",
      HOSTED_GEMINI_VIDEO_ANALYSIS_PREVIOUS_MODEL_PATH,
    )).toBe(HOSTED_GEMINI_VIDEO_ANALYSIS_PREVIOUS_MODEL);
    expect(isAllowedHostedGeminiVideoAnalysisRequest(
      "GET",
      HOSTED_GEMINI_VIDEO_ANALYSIS_PATH,
    )).toBe(false);
    expect(isAllowedHostedGeminiVideoAnalysisRequest(
      "POST",
      "/v1beta/models/gemini-other:generateContent",
    )).toBe(false);
  });

  it("accepts the exact standard and detailed-motion request profiles", () => {
    expect(parseHostedGeminiVideoAnalysisRequestBody(createRequestBody()))
      .toEqual(createRequestBody());
    const detailedMotion = createRequestBody();
    detailedMotion.contents[0]!.parts[0]!.videoMetadata!.fps = 5;
    expect(parseHostedGeminiVideoAnalysisRequestBody(detailedMotion))
      .toEqual(detailedMotion);
    const quicktime = createRequestBody();
    quicktime.contents[0]!.parts[0]!.inlineData!.mimeType = "video/quicktime";
    expect(parseHostedGeminiVideoAnalysisRequestBody(quicktime)).toEqual(quicktime);
    expect(HOSTED_GEMINI_VIDEO_ANALYSIS_MAX_BODY_BYTES).toBe(20 * 1024 * 1024);
  });

  it("accepts only the exact deployed legacy profile during rollout", () => {
    expect(parseHostedGeminiVideoAnalysisRequestBody(
      createLegacyRequestBody(),
      HOSTED_GEMINI_VIDEO_ANALYSIS_PREVIOUS_MODEL,
    ))
      .toEqual(createLegacyRequestBody());
    expect(() => parseHostedGeminiVideoAnalysisRequestBody(
      createLegacyRequestBody(),
    )).toThrow();

    const legacyAtDetailedFps = createLegacyRequestBody();
    legacyAtDetailedFps.contents[0]!.parts[0]!.videoMetadata!.fps = 5;
    const mediumWithLegacyCap = createLegacyRequestBody();
    mediumWithLegacyCap.generationConfig.thinkingConfig.thinkingLevel = "medium";
    const lowWithoutLegacyCap = createRequestBody();
    lowWithoutLegacyCap.generationConfig.thinkingConfig.thinkingLevel = "low";

    for (const candidate of [
      legacyAtDetailedFps,
      mediumWithLegacyCap,
      lowWithoutLegacyCap,
    ]) {
      expect(() => parseHostedGeminiVideoAnalysisRequestBody(
        candidate,
        HOSTED_GEMINI_VIDEO_ANALYSIS_PREVIOUS_MODEL,
      )).toThrow();
    }
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
              videoMetadata: { fps: 2 },
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
