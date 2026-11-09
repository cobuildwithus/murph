import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { hostedGameToolRequestSchema, type HostedGameToolRequest, type HostedGameToolResponse } from "@murphai/hosted-execution/runtime-control";
import { getPrisma } from "@/src/lib/prisma";
import { devSettleNow, readGame, readGameChatState, readHome, runGameChatUpdate, runGameCommand } from "@/src/lib/game/service";
import { addDays, gameLocalDate } from "@/src/lib/game/time";
import { cleanupGameFixtures } from "./support/game-fixture-cleanup";

// Only delivery is replaced. Every game mutation, projection and score uses
// the canonical service and an isolated migrated PostgreSQL database.
vi.mock("@/src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: vi.fn() }));
vi.mock("@/src/lib/game/chat-lifecycle", () => ({ deliverGameChatLifecycle: vi.fn() }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Self-play requires an isolated loopback test database.");
}
const members: string[] = [];

describe.skipIf(!enabled)("canonical game self-play", () => {
  afterAll(async () => {
    await cleanupGameFixtures(getPrisma(), members);
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: members } } });
  });

  it("plays both seats through chat edits, corrections and settlement", async () => {
    const db = getPrisma();
    const players = [randomUUID(), randomUUID()];
    const room = randomUUID(), gameId = randomUUID();
    members.push(...players, room);
    await db.hostedMember.createMany({ data: members.map(id => ({ id })) });
    for (const [seat, actorMemberId] of players.entries()) {
      expect(await runGameCommand({ actorMemberId, command: { type: "setProfile", firstName: seat === 0 ? "Maya" : "Sam", timeZone: "UTC" } })).toMatchObject({ ok: true });
    }
    const created = await runGameCommand({ actorMemberId: players[0], command: {
      type: "createGame", gameId, inviteeFirstName: "Sam", terms: {
        tasks: [{ seat: 0, text: "Read a chapter" }, { seat: 1, text: "Take a walk" }],
        schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize", item: "Choose the film" }], lengthDays: 7,
      },
    } });
    if (!created.ok || !created.game?.inviteToken) throw new Error("Synthetic invitation failed");
    expect(await runGameCommand({ actorMemberId: players[1], command: { type: "join", token: created.game.inviteToken, termsVersion: 1, timeZone: "UTC" } })).toMatchObject({ ok: true });
    const today = gameLocalDate(new Date(), "UTC"), yesterday = addDays(today, -1);
    await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
    await db.gamePlayer.updateMany({ where: { gameId }, data: { dayOne: new Date(`${yesterday}T00:00:00Z`) } });
    for (const actorMemberId of players) {
      expect(await runGameCommand({ actorMemberId, now: new Date(`${yesterday}T12:00:00Z`), command: {
        type: "post", gameId, entryId: randomUUID(), kind: "words", text: "Finished today's task.", mediaKeys: [],
      } })).toMatchObject({ ok: true });
    }
    const snapshots: Record<string, unknown> = {};
    async function snapshot(label: string) {
      snapshots[label] = await Promise.all(players.map(member => readHome(member)));
    }
    await snapshot("posted");
    const calls: { seat: number; request: HostedGameToolRequest }[] = [];
    async function tool(seat: number, request: HostedGameToolRequest): Promise<HostedGameToolResponse> {
      if (seat !== 0 && seat !== 1) throw new Error("Unknown synthetic seat");
      calls.push({ seat, request });
      if (request.action !== "read_game" && request.action !== "update_game") throw new Error("Unsupported self-play tool");
      let dayOutcome;
      if (request.action === "update_game") {
        const result = await runGameChatUpdate({ actorMemberId: players[seat], chatContainerMemberId: room,
          chatPlayerMemberIds: players, beforeMutationTx: async () => {}, update: request.update });
        if (!result.ok) return { action: request.action, result: { status: "rejected", error: `${result.error.code}: ${result.error.message}` } };
        dayOutcome = result.dayOutcome;
        await snapshot(`mutation-${calls.filter(call => call.request.action === "update_game").length}`);
      }
      return { action: request.action, result: { status: "ok", state: await readGameChatState(room, players, players[seat], false), ...(dayOutcome ? { dayOutcome } : {}) } };
    }
    if (process.env.MURPH_SELFPLAY_REAL_MODEL === "1") {
      const server = createServer(async (req, res) => {
        try {
          res.setHeader("content-type", "application/json");
          if (req.method === "GET" && req.url === "/context") {
            res.end(JSON.stringify({ today, instant: new Date().toISOString(), yesterday, gameId }));
            return;
          }
          const seat = req.url === "/tool/0" ? 0 : req.url === "/tool/1" ? 1 : -1;
          if (req.method !== "POST" || seat < 0) { res.writeHead(404).end(); return; }
          let body = "";
          for await (const chunk of req) {
            body += String(chunk);
            if (body.length > 65536) throw new Error("Oversized synthetic request");
          }
          res.end(JSON.stringify(await tool(seat, hostedGameToolRequestSchema.parse(JSON.parse(body)))));
        } catch { res.writeHead(500).end(JSON.stringify({ error: "Synthetic bridge failed" })); }
      });
      await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing loopback listener");
        const code = await new Promise<number | null>((done, fail) => {
          const child = spawn("pnpm", ["test:assistant:live", "--", "--test", "game selfplay shares canonical state across both players", "--model", "gpt-6.1-sol"], {
            cwd: resolve(import.meta.dirname, "../../.."), stdio: "inherit",
            env: { ...process.env, MURPH_SELFPLAY_BRIDGE_URL: `http://127.0.0.1:${address.port}` },
          });
          child.once("error", fail); child.once("exit", done);
        });
        expect(code).toBe(0);
      } finally { await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); }
    } else {
      const origin = { kind: "accepted_input" as const, assistantInputId: `ain_${"a".repeat(32)}` };
      const proposalId = randomUUID();
      for (const [seat, update] of [
        [0, { operation: "propose", gameId, proposalId, expectedTermsVersion: 1, change: { kind: "edit", stakes: [{ kind: "prize", item: "Breakfast in bed" }], stakesApplyToWholeGame: true } }],
        [1, { operation: "approve", gameId, proposalId }],
        [0, { operation: "mark_incomplete", gameId, date: yesterday }],
        [0, { operation: "restore_day", gameId, date: yesterday }],
      ] as const) {
        const request = hostedGameToolRequestSchema.parse({ action: "update_game", origin, update });
        expect((await tool(seat, request)).result.status).toBe("ok");
      }
    }
    const final = await readGame(gameId, players[0]);
    expect(final?.terms.n).toBe(2);
    expect(final?.terms.stakes[0].item.toLowerCase()).toBe("breakfast in bed");
    expect(final?.players.map(player => player.score)).toEqual([1, 1]);
    expect(await db.gameEvent.count({ where: { gameId, type: "change_applied" } })).toBe(1);
    expect(await db.gameEvent.count({ where: { gameId, type: "day_marked_incomplete" } })).toBe(1);
    expect(await db.gameEvent.count({ where: { gameId, type: "day_restored" } })).toBe(1);
    expect(calls.filter(call => call.request.action === "update_game")).toHaveLength(4);
    await snapshot("restored");
    await devSettleNow(gameId, players[0]);
    await snapshot("settled");
    expect((await readGame(gameId, players[0]))?.status).toBe("settled");
    const output = process.env.MURPH_SELFPLAY_SNAPSHOTS;
    if (output) {
      await mkdir(output, { recursive: true });
      await writeFile(resolve(output, "game-selfplay.json"), JSON.stringify(snapshots, null, 2) + "\n");
    }
  }, 600_000);
});
