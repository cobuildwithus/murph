import { mkdtemp, mkdir, stat, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeFeedbackRequest, parseFeedbackCommand, prepareFeedbackProfile,
} from "../scripts/ops-feedback";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local feedback diagnostic client", () => {
  it("pins target and origin, carries stable task identity, and disables redirects/retries", async () => {
    const command = parseFeedbackCommand(["request", "--feedback-id", "feedback_synthetic",
      "--question", "Which schema rejects the synthetic request?", "--idempotency-key", "repro-one"]);
    if (!("url" in command)) throw new Error("Expected request command");
    const dispose = vi.fn();
    const fetch = vi.fn().mockResolvedValue({ status: () => 200, ok: () => true,
      body: async () => Buffer.from('{"id":"opt_synthetic","status":"queued"}'), dispose });
    await expect(executeFeedbackRequest({ fetch }, command)).resolves.toEqual({ id: "opt_synthetic", status: "queued" });
    expect(fetch).toHaveBeenCalledWith("https://www.withmurph.ai/api/ops/feedback", {
      method: "POST", data: { feedbackId: "feedback_synthetic", question: "Which schema rejects the synthetic request?", idempotencyKey: "repro-one" },
      headers: { Origin: "https://www.withmurph.ai", Accept: "application/json" },
      maxRedirects: 0, maxRetries: 0, timeout: 30_000, failOnStatusCode: false,
    });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it.each([
    ["request", "--feedback-id", "f", "--question", "q"],
    ["request", "--feedback-id", "f", "--question", "q", "--idempotency-key", "k", "--member-id", "other"],
    ["list", "--base-url", "https://untrusted.example.test"],
    ["list", "--question", "q"], ["results"], ["login", "--after", "cursor"],
    ["request", "--feedback-id", "f", "--question", "x".repeat(1201), "--idempotency-key", "k"],
  ])("rejects invalid or authority-expanding options %# before opening a browser", (...args) => {
    expect(() => parseFeedbackCommand(args)).toThrow();
  });

  it("encodes pagination and feedback ids as values, never endpoint syntax", () => {
    const command = parseFeedbackCommand(["results", "--feedback-id", "f&memberId=other", "--after", "cursor/?"]);
    expect(command).toEqual({ command: "results", url: "https://www.withmurph.ai/api/ops/feedback?feedbackId=f%26memberId%3Dother&after=cursor%2F%3F" });
  });

  it.each([401, 403, 404, 409, 302, 500])("rejects HTTP %s without exposing response text", async (status) => {
    const body = vi.fn().mockResolvedValue(Buffer.from("private server text"));
    const dispose = vi.fn();
    const fetch = vi.fn().mockResolvedValue({ status: () => status, ok: () => false, body, dispose });
    await expect(executeFeedbackRequest({ fetch }, { command: "list", url: "https://www.withmurph.ai/api/ops/feedback" })).rejects.toThrow(/Sign in|Ops access|HTTP/);
    expect(body).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("rejects other origins before issuing an authenticated request", async () => {
    const fetch = vi.fn();
    await expect(executeFeedbackRequest({ fetch }, { command: "list", url: "https://untrusted.example.test/api/ops/feedback" })).rejects.toThrow("canonical Ops endpoint");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the browser profile private and refuses a symlink profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "ops-feedback-test-"));
    temporaryRoots.push(root);
    const directory = join(root, "profile");
    await mkdir(directory, { mode: 0o755 });
    await prepareFeedbackProfile(directory);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    const alias = join(root, "alias");
    await symlink(directory, alias);
    await expect(prepareFeedbackProfile(alias)).rejects.toThrow();
  });

});
