import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ prisma: null as PrismaClient | null }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => fixture.prisma! }));
vi.mock("../src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: async () => false }));
vi.mock("../src/lib/game/chat-lifecycle", () => ({ deliverGameChatLifecycle: async () => false }));
import { sealGameText, labelTarget } from "../src/lib/game/crypto";
import { readGame } from "../src/lib/game/service";
import { buildGameView, type GameViewInput } from "../src/lib/game/views";
import type { RuleState, StoredResult, TermWords } from "../src/lib/game/rules";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const url = process.env.DATABASE_URL ?? "";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(url)) throw new Error("Game migration proof needs an isolated loopback test database.");
const migrationId = "20261102230000_game_seat_storage";
const migrations = new URL("../prisma/migrations/", import.meta.url);
const at = new Date("2030-01-01T12:00:00Z");
const members = ["synthetic_migration_starter", "synthetic_migration_peer"];
const words: TermWords = { v: 1, versions: [{ n: 1, tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Read" }], stakes: [{ key: "prize", item: "Lunch" }] }] };
const terms = { v: 1 as const, versions: [{ n: 1, fromDay: 0, schedule: { count: 3 }, stakes: [{ key: "prize", kind: "prize" as const }] }] };
const result: StoredResult = { v: 1, termsVersion: 1, scores: members.map((memberId, seat) => ({ memberId, seat, score: seat === 0 ? 3 : 2, misses: seat === 0 ? 0 : 1 })) };

/** Apply the actual history, not db push or a hand-built approximation. */
async function previousSchema(databaseUrl: URL) {
  const directories = (await readdir(migrations, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name < migrationId).map(entry => entry.name).sort();
  const sql = await Promise.all(directories.map(directory => readFile(new URL(`${directory}/migration.sql`, migrations), "utf8")));
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1"], { input: sql.join("\n"), stdio: ["pipe", "ignore", "pipe"],
    env: { ...process.env, PGHOST: databaseUrl.hostname, PGPORT: databaseUrl.port, PGUSER: databaseUrl.username,
      PGPASSWORD: databaseUrl.password, PGDATABASE: databaseUrl.pathname.slice(1) } });
}

async function seed(client: pg.Client) {
  await fixture.prisma!.hostedMember.createMany({ data: members.map(id => ({ id, billingStatus: "active" })) });
  for (const [seat, memberId] of members.entries()) {
    const name = await sealGameText({ table: "game_profile", field: "first_name", rowId: memberId, memberId }, seat === 0 ? "Alex" : "Sam");
    await client.query("INSERT INTO game_profile(member_id, first_name_encrypted, time_zone, updated_at) VALUES ($1,$2,'UTC',$3)", [memberId, name, at]);
  }
  const label = { nameEncrypted: await sealGameText(labelTarget(members[0], "name"), "Teammate"), relationshipEncrypted: null, photoKey: null };
  await client.query("INSERT INTO game_contact_label(owner_member_id,subject_member_id,name_encrypted,updated_at) VALUES ($1,$2,$3,$4)", [...members, label.nameEncrypted, at]);
  for (const id of ["settled", "live", "waiting"]) {
    const sealed = await sealGameText({ table: "game", field: "terms_words", rowId: id, memberId: members[0] }, JSON.stringify(words));
    await client.query(`INSERT INTO game(id,created_by,previous_game_id,round,status,terms,terms_words_encrypted,invitee_member_id,pending_label,length_days,started_at,settled_at,result,updated_at,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,7,$10,$11,$12,$13,$13)`,
    [id, members[0], id === "settled" ? null : "settled", id === "settled" ? 1 : 2, id === "waiting" ? "invited" : id, JSON.stringify(terms), sealed, id === "settled" ? null : members[1], JSON.stringify(label), id === "waiting" ? null : at, id === "settled" ? at : null, id === "settled" ? JSON.stringify(result) : null, at]);
    for (const [seat, memberId] of members.entries()) {
      if (id === "waiting" && seat === 1) continue;
      await client.query("INSERT INTO game_player(game_id,member_id,seat,time_zone,day_one,joined_at) VALUES ($1,$2,$3,'UTC',$4,$5)", [id, memberId, seat, id === "waiting" ? null : "2030-01-01", at]);
      if (id !== "waiting") for (let day = 0; day < 3; day += 1) await client.query(`INSERT INTO game_entry(id,game_id,member_id,day_index,attempt,kind,received_at) VALUES ($1,$2,$3,$4,1,'photo',$5)`, [`${id}-${seat}-${day}`, id, memberId, day, at]);
    }
  }
  await client.query("INSERT INTO game_ticket(id,game_id,stake_key,owed_by,owed_to,created_at) VALUES ('ticket','settled','prize',$1,$2,$3)", [members[1], members[0], at]);
  return label;
}

function expectedPair(id: string, viewerId: string) {
  const players = members.slice(0, id === "waiting" ? 1 : 2).map((memberId, seat) => ({ memberId, seat, timeZone: "UTC", dayOne: id === "waiting" ? null : "2030-01-01" }));
  const state: RuleState = { game: { id, createdBy: members[0], status: id === "waiting" ? "invited" : id === "live" ? "live" : "settled", lengthDays: 7, seats: 2, terms, inviteExpiresAt: null, startsOn: null }, players,
    entries: id === "waiting" ? [] : players.flatMap(player => Array.from({ length: 3 }, (_, dayIndex) => ({ id: `${id}-${player.seat}-${dayIndex}`, memberId: player.memberId, dayIndex, attempt: 1, kind: "photo" as const, mediaKeys: [], receivedAt: at, withdrawnAt: null, blurHash: null }))) };
  const input: GameViewInput = { state, viewerId, now: new Date(), round: id === "settled" ? 1 : 2, previousGameId: id === "settled" ? null : "settled", startedAt: id === "waiting" ? null : at,
    words, names: new Map([[members[0], "Alex"], [members[1], viewerId === members[0] ? "Teammate" : "Sam"]]), avatarKeys: new Map(), relationships: new Map(),
    invitee: id === "waiting" ? { memberId: members[1], name: viewerId === members[0] ? "Teammate" : "Sam", photoKey: null, relationship: null } : null,
    inviteToken: null, inviteExpiresAt: null, entryWords: new Map(), result: id === "settled" ? result : null, recap: null,
    // Both players posted days 0 to 2, so the live game's other-player posts take a reply.
    entryReplies: new Map(), replyEligibleEntryIds: new Set(id === "live" ? state.entries.filter(entry => entry.memberId !== viewerId).map(entry => entry.id) : []),
    tickets: id === "settled" ? [{ id: "ticket", gameId: id, stakeKey: "prize", owedBySeats: [1], owedToSeats: [0], players, status: "open", createdAt: at, redeemedAt: null }] : [] };
  return buildGameView(input);
}

describe.skipIf(!enabled)("canonical game storage migration PostgreSQL proof", () => {
  it("rejects unclassifiable data atomically, converts the old schema, preserves FKs and exact pair views", async () => {
    const dbName = `murph_test_game_migration_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const migratedUrl = new URL(url); migratedUrl.pathname = `/${dbName}`;
    const client = new pg.Client({ connectionString: migratedUrl.toString() });
    try {
      await client.connect();
      await previousSchema(migratedUrl);
      fixture.prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: migratedUrl.toString() }) });
      const label = await seed(client);
      await fixture.prisma.hostedMember.create({ data: { id: "synthetic_migration_unseated", billingStatus: "active" } });
      await client.query("INSERT INTO game_profile(member_id, first_name_encrypted, time_zone, updated_at) VALUES ('synthetic_migration_unseated','unused','UTC',$1)", [at]);
      const sql = await readFile(new URL(`${migrationId}/migration.sql`, migrations), "utf8");
      for (const invalid of [
        { apply: "UPDATE game SET departed_player = '{\"seat\":1}' WHERE id = 'live'", repair: "UPDATE game SET departed_player = NULL", reason: "legacy departure" },
        { apply: "UPDATE game_ticket SET owed_by = 'synthetic_migration_unseated'", repair: "UPDATE game_ticket SET owed_by = 'synthetic_migration_peer'", reason: "ticket party" },
        { apply: "UPDATE game_ticket SET owed_by = NULL", repair: "UPDATE game_ticket SET owed_by = 'synthetic_migration_peer'", reason: "ticket party" },
        { apply: "UPDATE game SET created_by = NULL WHERE id = 'waiting'", repair: "UPDATE game SET created_by = 'synthetic_migration_starter' WHERE id = 'waiting'", reason: "ciphertext owner" },
      ]) {
        await client.query(invalid.apply);
        await expect(client.query(sql)).rejects.toThrow(invalid.reason);
        await client.query("ROLLBACK");
        expect((await client.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'game' AND column_name = 'words_owner_member_id'")).rows[0].n).toBe(0);
        await client.query(invalid.repair);
      }
      const before = new Map(["live", "settled", "waiting"].flatMap(id => members.map(viewer => [`${id}:${viewer}`, expectedPair(id, viewer)] as const)));
      await client.query(sql);
      expect((await client.query("SELECT max_players, audience_key, words_owner_member_id FROM game WHERE id = 'live'")).rows).toEqual([{ max_players: 2, audience_key: null, words_owner_member_id: members[0] }]);
      expect((await client.query("SELECT seat, member_id, recipient_lookup_key, pending_label FROM game_invitee WHERE game_id = 'live'")).rows).toEqual([{ seat: 1, member_id: members[1], recipient_lookup_key: null, pending_label: label }]);
      expect((await client.query("SELECT owed_by_seats, owed_to_seats FROM game_ticket")).rows).toEqual([{ owed_by_seats: [1], owed_to_seats: [0] }]);
      expect((await client.query("SELECT count(*)::int AS n FROM game_entry")).rows[0].n).toBe(12);
      // Today's readers need the later, additive migrations too.
      const later = (await readdir(migrations, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name > migrationId).map(entry => entry.name).sort();
      for (const directory of later) await client.query(await readFile(new URL(`${directory}/migration.sql`, migrations), "utf8"));
      for (const id of ["live", "settled", "waiting"]) for (const viewer of members) expect(await readGame(id, viewer)).toEqual(before.get(`${id}:${viewer}`));
      await expect(client.query("UPDATE game SET max_players = 3 WHERE id = 'live'")).rejects.toMatchObject({ code: "23514" });
      await expect(client.query("UPDATE game_player SET member_id = NULL WHERE game_id = 'live' AND seat = 1")).rejects.toMatchObject({ code: "23514" });
      for (const invalid of ["ARRAY[0]", "ARRAY[]::int[]", "ARRAY[NULL]::int[]", "ARRAY[-1]", "ARRAY[19]", "array_fill(1, ARRAY[11])"]) {
        await expect(client.query(`UPDATE game_ticket SET owed_by_seats = ${invalid}`)).rejects.toMatchObject({ code: "23514" });
      }
      await expect(client.query("UPDATE game_player SET joined_at = NULL WHERE game_id = 'live' AND seat = 1")).rejects.toMatchObject({ code: "23514" });
      await expect(client.query("UPDATE game_player SET time_zone = NULL WHERE game_id = 'live' AND seat = 1")).rejects.toMatchObject({ code: "23514" });
      await expect(client.query("UPDATE game_invitee SET seat = 10 WHERE game_id = 'live'")).rejects.toMatchObject({ code: "23514" });
      await expect(client.query("UPDATE game_player SET seat = 19 WHERE game_id = 'live' AND seat = 1")).rejects.toMatchObject({ code: "23514" });
      await expect(client.query("DELETE FROM game_profile WHERE member_id = $1", [members[0]])).rejects.toMatchObject({ constraint: "game_words_owner_member_id_fkey" });
      await client.query("DELETE FROM game_entry WHERE game_id = 'live' AND member_id = $1", [members[1]]);
      await client.query("UPDATE game_player SET member_id = NULL, left_at = now() WHERE game_id = 'live' AND seat = 1");
      await expect(client.query("INSERT INTO game_entry(id,game_id,member_id,day_index,attempt,kind,received_at) VALUES ('orphan','live',$1,3,1,'photo',now())", [members[1]])).rejects.toMatchObject({ code: "23503" });
      expect((await client.query("SELECT seat FROM game_player WHERE game_id = 'live' AND member_id IS NULL")).rows).toEqual([{ seat: 1 }]);
    } finally {
      await fixture.prisma?.$disconnect(); fixture.prisma = null;
      await client.end();
      await admin.query(`DROP DATABASE "${dbName}"`);
      await admin.end();
    }
  }, 120_000);
});
