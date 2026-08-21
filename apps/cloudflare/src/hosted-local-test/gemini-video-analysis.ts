export const HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_503_MARKER =
  "HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_503";
export const HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_API_KEY =
  "gemini-hosted-local-test-token";
export const HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_OBSERVATION =
  "The synthetic test video contains a blue square centered in the frame.";

export const hostedLocalGeminiVideoAnalysisFetch: typeof fetch = async (input) => {
  const request = input instanceof Request ? input : new Request(input);
  if (request.method !== "POST") {
    return new Response("Unexpected hosted-local Gemini request.", { status: 502 });
  }
  if (
    request.headers.get("x-goog-api-key")
      !== HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_API_KEY
  ) {
    return new Response("Unexpected hosted-local Gemini credential.", { status: 502 });
  }

  let question = "";
  try {
    const body = await request.clone().json() as {
      contents?: Array<{ parts?: Array<{ text?: unknown }> }>;
    };
    const parts = body.contents?.[0]?.parts ?? [];
    question = parts
      .map((part) => typeof part.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n");
  } catch {
    return new Response("Invalid hosted-local Gemini request.", { status: 400 });
  }

  if (question.includes(HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_503_MARKER)) {
    return new Response("Hosted-local Gemini unavailable.", { status: 503 });
  }

  return Response.json({
    candidates: [{
      content: {
        parts: [{ text: HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_OBSERVATION }],
        role: "model",
      },
      finishReason: "STOP",
    }],
    usageMetadata: {
      cachedContentTokenCount: 4,
      candidatesTokenCount: 18,
      promptTokenCount: 320,
      thoughtsTokenCount: 7,
      totalTokenCount: 345,
    },
  }, {
    headers: { "x-goog-request-id": "gemini-hosted-local-request" },
  });
};
