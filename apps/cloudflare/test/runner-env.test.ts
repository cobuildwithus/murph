import { describe, expect, it } from "vitest";

import { buildHostedRunnerContainerEnv } from "../src/runner-env.js";

describe("buildHostedRunnerContainerEnv", () => {
  it("normalizes legacy AgentMail and ffmpeg aliases onto canonical keys", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_API_BASE_URL: "https://legacy-mail.example.test/v0",
      PARSER_FFMPEG_PATH: "/usr/local/bin/ffmpeg",
    })).toMatchObject({
      AGENTMAIL_BASE_URL: "https://legacy-mail.example.test/v0",
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      NODE_ENV: "production",
    });
  });
});
