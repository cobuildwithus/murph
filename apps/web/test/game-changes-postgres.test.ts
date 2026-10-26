import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { toPrismaJsonObject } from "@/src/lib/device-sync/prisma-store/prisma-json";
import { getPrisma } from "@/src/lib/prisma";
import { readGame, readGameChatState, runGameCommand } from "@/src/lib/game/service";
import { addDays, gameLocalDate, weekdayOf } from "@/src/lib/game/time";
import { parseStoredTerms, scorePlayer, settleDueAt, type RuleState } from "@/src/lib/game/rules";
import type { GameCommand, GameSchedule, Weekday } from "@/src/lib/game/contract";
const delivery = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: delivery }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Game changes proof needs an isolated local test database.");
const members: string[] = [];
const roomPlayers = new Map<string, readonly string[]>();
async function run(actorMemberId: string, command: GameCommand, options: { chatContainerMemberId?: string; chatPlayerMemberIds?: readonly string[]; now?: Date; beforeMutationTx?: () => Promise<void> } = {}) {
  return runGameCommand({ actorMemberId, command, chatPlayerMemberIds: options.chatContainerMemberId ? roomPlayers.get(options.chatContainerMemberId) : undefined, ...options });
}
async function setup(schedule: GameSchedule = { days: [0,1,2,3,4] }, startsOn?: string) {
  const a = `game_a_${randomUUID()}`, b = `game_b_${randomUUID()}`, room = `game_room_${randomUUID()}`;
  members.push(a,b,room);
  await getPrisma().hostedMember.createMany({ data: [a,b,room].map((id) => ({ id, billingStatus: "not_started" })) });
  await run(a,{type:"setProfile", firstName:"Riley", timeZone:"America/New_York"});
  await run(b,{type:"setProfile", firstName:"Jordan", timeZone:"America/New_York"});
  const gameId = randomUUID();
  const created = await run(a,{type:"createGame",gameId,inviteeFirstName:"Private nickname",terms:{startsOn,tasks:[{seat:0,text:"Read"},{seat:1,text:"Walk"}],schedule,stakes:[{kind:"prize",item:"Breakfast"}]}});
  if (!created.ok || !created.game?.inviteToken) throw new Error("Fixture create failed");
  const joined = await run(b,{type:"join",token:created.game.inviteToken,termsVersion:1,timeZone:"America/New_York"});
  if (!joined.ok) throw new Error("Fixture join failed");
  await getPrisma().game.update({where:{id:gameId},data:{chatContainerMemberId:room}});
  roomPlayers.set(room, [a,b]);
  return {a,b,room,gameId};
}
const fence = async () => {};

describe.skipIf(!enabled)("weekly game change serialization against PostgreSQL", () => {
  afterAll(async () => { await getPrisma().hostedMember.deleteMany({where:{id:{in:members}}}); });
  it("reserves acceptance and app proposals once, but never a second chat announcement", async () => {
    const { a,b,room,gameId } = await setup();
    const db = getPrisma();
    const kickoffKey = createHostedLinqDeliveryIdempotencyLookupKey(`game-started:${gameId}`)!;
    const kickoff = await db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: kickoffKey } });
    expect(kickoff).toMatchObject({ source: "game_lifecycle", sourceRef: gameId, template: "game_started", status: "awaiting_generation", payloadCiphertext: null, acceptedAt: null });
    const proposalId = randomUUID();
    const command = { type: "proposeChange" as const, gameId, proposalId, expectedTermsVersion: 1, change: { kind: "edit" as const, lengthDays: 10 } };
    expect((await run(a, command)).ok).toBe(true);
    expect((await run(a, command)).ok).toBe(true);
    const key = createHostedLinqDeliveryIdempotencyLookupKey(`game-change:${gameId}:${proposalId}`)!;
    expect(await db.hostedLinqDelivery.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(await db.hostedLinqDelivery.findUnique({ where: { idempotencyKey: key } })).toMatchObject({ template: "game_proposal", status: "awaiting_generation", payloadCiphertext: null });
    expect((await run(a, { type: "respondChange", gameId, proposalId, decision: "cancel" })).ok).toBe(true);
    delivery.mockClear();
    const chatProposalId = randomUUID();
    const chat = await run(b, { ...command, proposalId: chatProposalId }, { chatContainerMemberId: room, beforeMutationTx: fence });
    expect(chat).toEqual({ ok: true, game: null });
    expect((await readGame(gameId,b))?.pendingChange).toMatchObject({ origin: "chat", deliveryStatus: "conversation", deliveryRetryable: false });
    expect(delivery).not.toHaveBeenCalled();
    expect(await db.hostedLinqDelivery.count({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(`game-change:${gameId}:${chatProposalId}`)! } })).toBe(0);
  });
  it("allows a host-proven same-pair alternate room without moving the primary destination", async () => {
    const { a,b,room,gameId } = await setup(); const proposalId = randomUUID();
    expect((await run(a, { type: "proposeChange", gameId, proposalId, expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 10 } })).ok).toBe(true);
    expect(await run(b, { type: "respondChange", gameId, proposalId, decision: "approve" }, { chatContainerMemberId: "alternate-room", chatPlayerMemberIds: [a,b], beforeMutationTx: fence })).toMatchObject({ ok: true });
    expect((await readGame(gameId,b))?.lengthDays).toBe(10);
    expect(await getPrisma().game.findUnique({ where: { id: gameId }, select: { chatContainerMemberId: true } })).toEqual({ chatContainerMemberId: room });
    expect((await readGameChatState("alternate-room", [a,b])).games.map((game) => game.id)).toContain(gameId);
  });
  it("needs the other player in the bound chat and applies once across retries", async () => {
    const {a,b,room,gameId}=await setup(); const proposalId=randomUUID();
    const proposed=await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",schedule:{days:[5,6]},lengthDays:14}});
    expect(proposed.ok).toBe(true);
    expect((await readGame(gameId,a))?.terms.schedule).toEqual({days:[0,1,2,3,4]});
    const command={type:"respondChange" as const,gameId,proposalId,decision:"approve" as const};
    expect(await run(a,command,{chatContainerMemberId:room,beforeMutationTx:fence})).toMatchObject({ok:false,error:{code:"NOT_A_PLAYER"}});
    expect(await run(b,command)).toMatchObject({ok:false,error:{code:"NOT_A_PLAYER"}});
    expect(await run(b,command,{chatContainerMemberId:"wrong_room",beforeMutationTx:fence})).toMatchObject({ok:false,error:{code:"NOT_A_PLAYER"}});
    const results=await Promise.all([1,2].map(()=>run(b,command,{chatContainerMemberId:room,beforeMutationTx:fence})));
    expect(results.every((r)=>r.ok)).toBe(true);
    const view=await readGame(gameId,a); expect(view?.pendingChange).toBeNull(); expect(view?.terms.n).toBe(2); expect(view?.lengthDays).toBe(14); expect(view?.terms.schedule).toEqual({days:[5,6]});
    expect(await getPrisma().gameEvent.count({where:{gameId,type:"change_applied"}})).toBe(1);
    // Replaying the original request cannot revive the resolved proposal.
    await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:14}});
    expect((await readGame(gameId,a))?.pendingChange).toBeNull();
    const shared=await readGameChatState(room,[a,b]); expect(JSON.stringify(shared)).not.toContain("Private nickname");
    expect(shared.games[0].players.map((p)=>p.firstName).sort()).toEqual(["Jordan","Riley"]);
    expect(JSON.stringify(shared)).not.toContain("inviteToken"); expect(JSON.stringify(shared)).not.toContain("avatarUrl");
  });
  it.each([
    { name: "weekdays", schedule: { days: [0,1,2,3,4] } as GameSchedule },
    { name: "custom days", schedule: { days: [0,3,6] } as GameSchedule },
  ].flatMap((schedule) => [false, true].flatMap((started) => [4,14].map((lengthDays) => ({ ...schedule, started, lengthDays })))))
  ("preserves $name when duration becomes $lengthDays days (started: $started)", async ({ schedule, started, lengthDays }) => {
    const { a,b,room,gameId } = await setup(schedule);
    const now = new Date();
    const dayOne = addDays(gameLocalDate(now, "America/New_York"), started ? -2 : 1);
    await getPrisma().gamePlayer.updateMany({ where: { gameId }, data: { dayOne: new Date(`${dayOne}T00:00:00Z`) } });
    if (started) await getPrisma().gameEntry.create({ data: {
      id: randomUUID(), gameId, memberId: a, dayIndex: 0, attempt: 1, kind: "photo", receivedAt: now,
    } });
    const before = (await readGame(gameId, a))!;
    const entries = await getPrisma().gameEntry.findMany({ where: { gameId } });
    const proposalId = randomUUID();
    // Mid-game, a length that leaves no scheduled day after today is refused (which days those are depends on today).
    if (!("days" in schedule)) throw new Error("Fixture requires weekdays");
    const rest = Array.from({ length: Math.max(0, lengthDays - 3) }, (_, offset) => weekdayOf(addDays(dayOne, 3 + offset)));
    if (started && !rest.some((weekday) => schedule.days.includes(weekday))) {
      expect(await run(a, { type: "proposeChange", gameId, proposalId, expectedTermsVersion: 1, change: { kind: "edit", lengthDays } }))
        .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: expect.stringContaining("at least one scheduled day") } });
      return;
    }
    expect(await run(a, { type: "proposeChange", gameId, proposalId, expectedTermsVersion: 1, change: { kind: "edit", lengthDays } }))
      .toMatchObject({ ok: true, game: { lengthDays: 7, terms: { schedule } } });
    expect(await run(b, { type: "respondChange", gameId, proposalId, decision: "approve" }, { chatContainerMemberId: room, beforeMutationTx: fence }))
      .toMatchObject({ ok: true });
    const view = (await readGame(gameId, a))!;
    expect(view.lengthDays).toBe(lengthDays);
    expect(view.terms.schedule).toEqual(schedule);
    expect(view.days).toHaveLength(lengthDays);
    expect(view.days.at(-1)?.localDate).toBe(addDays(dayOne, lengthDays - 1));
    if (!("days" in schedule)) throw new Error("Fixture requires weekdays");
    expect(view.days.map((day) => day.off)).toEqual(Array.from({ length: lengthDays }, (_, day) => !schedule.days.includes(weekdayOf(addDays(dayOne, day)))));
    expect(view.days.slice(0, started ? 3 : 0)).toEqual(before.days.slice(0, started ? 3 : 0));
    expect(await getPrisma().gameEntry.findMany({ where: { gameId } })).toEqual(entries);
    const row = (await getPrisma().game.findUnique({ where: { id: gameId } }))!;
    const terms = parseStoredTerms(row.terms);
    expect(terms.versions.map(({ n, fromDay, schedule }) => ({ n, fromDay, schedule }))).toEqual(started
      ? [{ n: 1, fromDay: 0, schedule }, { n: 2, fromDay: 3, schedule }]
      : [{ n: 2, fromDay: 0, schedule }]);
    const players = [a,b].map((memberId, seat) => ({ memberId, seat, dayOne, timeZone: "America/New_York" }));
    const state: RuleState = { game: { ...row, terms, seats: 2, status: "live", startsOn: null }, players,
      entries: entries.map((entry) => ({ ...entry, kind: "photo" })) };
    const requiredDays = view.days.filter((day) => !day.off).length;
    expect(scorePlayer(state, players[0])).toMatchObject({ score: started && !view.days[0].off ? 1 : 0,
      misses: requiredDays - (started && !view.days[0].off ? 1 : 0) });
    expect(scorePlayer(state, players[1])).toMatchObject({ score: 0, misses: requiredDays });
    expect(gameLocalDate(settleDueAt(state), "America/New_York")).toBe(addDays(dayOne, lengthDays));
  });

  it("starts both players on the agreed date only after the other approves", async () => {
    const {a,b,room,gameId}=await setup({days:[0,1,2,3,4,5,6]},addDays(gameLocalDate(new Date(),"America/New_York"),2)); const proposalId=randomUUID();
    expect(await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"start_now"}})).toMatchObject({ok:true});
    const pending=(await readGame(gameId,a))!.pendingChange!;
    expect(pending.startsOn).toBe(gameLocalDate(new Date(),"America/New_York"));
    expect((await getPrisma().gamePlayer.findMany({where:{gameId}})).every((p)=>p.dayOne!.toISOString().slice(0,10)!==pending.startsOn)).toBe(true);
    const result=await run(b,{type:"respondChange",gameId,proposalId,decision:"approve"},{chatContainerMemberId:room,beforeMutationTx:fence});
    expect(result).toEqual({ok:true,game:null});
    expect((await getPrisma().gamePlayer.findMany({where:{gameId}})).map((p)=>p.dayOne!.toISOString().slice(0,10))).toEqual([pending.startsOn,pending.startsOn]);
  });
  it("serializes competing proposals, supports decline, and rechecks the runtime fence", async () => {
    const {a,b,room,gameId}=await setup();
    const attempts=await Promise.all([a,b].map((actor)=>run(actor,{type:"proposeChange",gameId,proposalId:randomUUID(),expectedTermsVersion:1,change:{kind:"edit",lengthDays:10}})));
    expect(attempts.filter((r)=>r.ok)).toHaveLength(1); expect(attempts.find((r)=>!r.ok)).toMatchObject({ok:false,error:{code:"CHANGE_PENDING"}});
    const pending=(await readGame(gameId,a))!.pendingChange!; const other=pending.proposedByMemberId===a?b:a;
    const command={type:"respondChange" as const,gameId,proposalId:pending.id,decision:"decline" as const};
    await expect(run(other,command,{chatContainerMemberId:room,beforeMutationTx:async()=>{throw new Error("revoked");}})).rejects.toThrow("revoked");
    expect((await readGame(gameId,a))?.pendingChange?.id).toBe(pending.id);
    expect(await run(other,command,{chatContainerMemberId:room,beforeMutationTx:fence})).toMatchObject({ok:true});
    expect((await readGame(gameId,a))?.pendingChange).toBeNull();
  });
  it("projects terminal delivery honestly and lets only the proposer cancel from the app", async () => {
    const {a,b,room,gameId}=await setup(); const proposalId=randomUUID();
    await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:14}});
    const receipt = await getPrisma().hostedLinqDelivery.update({where:{idempotencyKey:createHostedLinqDeliveryIdempotencyLookupKey(`game-change:${gameId}:${proposalId}`)!},data:{source:"game_test",status:"failed",attemptedAt:new Date()}});
    const deliveryId=receipt.id;
    try {
      expect((await readGame(gameId,a))?.pendingChange).toMatchObject({deliveryStatus:"failed",deliveryRetryable:false});
      const command={type:"respondChange" as const,gameId,proposalId,decision:"cancel" as const};
      expect(await run(b,command)).toMatchObject({ok:false,error:{code:"NOT_A_PLAYER"}});
      expect(await run(a,command)).toMatchObject({ok:true});
      expect(await run(a,command)).toMatchObject({ok:true});
      expect((await readGame(gameId,a))?.lengthDays).toBe(7);
      expect((await readGame(gameId,a))?.pendingChange).toBeNull();
      expect((await readGameChatState(room,[a,"unrelated_player"])).games).toEqual([]);
    } finally { await getPrisma().hostedLinqDelivery.delete({where:{id:deliveryId}}); }
  });
  it("does not report an unrelated legacy chat receipt as delivery of the pending proposal", async () => {
    const {a,gameId}=await setup(); const proposalId=randomUUID();
    await getPrisma().game.update({where:{id:gameId},data:{chatContainerMemberId:null}});
    delivery.mockRejectedValueOnce(new Error("binding unavailable"));
    await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:14}});
    const deliveryId=randomUUID();
    await getPrisma().hostedLinqDelivery.create({data:{id:deliveryId,idempotencyKey:createHostedLinqDeliveryIdempotencyLookupKey(`game-chat:${gameId}`),source:"game_test",status:"accepted",attemptedAt:new Date()}});
    try {
      expect((await readGame(gameId,a))?.pendingChange).toMatchObject({deliveryStatus:"failed",deliveryRetryable:true});
    } finally { await getPrisma().hostedLinqDelivery.delete({where:{id:deliveryId}}); }
  });
  it("keeps delayed approval open across reads and applies from the next unstarted day", async () => {
    const {a,b,room,gameId}=await setup(); const proposalId=randomUUID();
    const dayOne = addDays(gameLocalDate(new Date(), "America/New_York"), -1);
    await getPrisma().gamePlayer.updateMany({where:{gameId},data:{dayOne:new Date(`${dayOne}T00:00:00Z`)}});
    await getPrisma().gameEntry.create({data:{id:randomUUID(),gameId,memberId:a,dayIndex:0,attempt:1,kind:"photo",receivedAt:new Date()}});
    const entries = await getPrisma().gameEntry.findMany({where:{gameId}});
    delivery.mockRejectedValueOnce(new Error("provider unavailable"));
    const proposed=await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:14,schedule:{days:[5,6]}}});
    expect(proposed).toMatchObject({ok:true,game:{pendingChange:{deliveryStatus:"failed"}}});
    // Either player can retry, without replacing the proposal or approving it.
    await run(b,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:20}});
    expect((await readGame(gameId,a))?.pendingChange).toMatchObject({proposedByMemberId:a,change:{kind:"edit",lengthDays:14}});
    const before = (await readGame(gameId,a))!;
    const original = before.pendingChange!.effectiveFromDay;
    await getPrisma().game.update({ where: { id: gameId }, data: { devClockOffsetMs: BigInt(3*86400000) } });
    const delayed = (await readGame(gameId,a))!;
    expect(delayed.pendingChange?.id).toBe(proposalId);
    expect(delayed.pendingChange!.effectiveFromDay).toBeGreaterThan(original);
    expect((await readGameChatState(room,[a,b])).games[0].pendingChange?.effectiveFromDay).toBe(delayed.pendingChange!.effectiveFromDay);
    const result=await run(b,{type:"respondChange",gameId,proposalId,decision:"approve"},{chatContainerMemberId:room,beforeMutationTx:fence});
    expect(result).toMatchObject({ok:true});
    const view=(await readGame(gameId,a))!;
    expect(view.terms.n).toBe(2); expect(view.lengthDays).toBe(14); expect(view.pendingChange).toBeNull();
    expect(view.terms.fromDay).toBe(delayed.pendingChange!.effectiveFromDay);
    expect(view.days.slice(0,view.terms.fromDay)).toEqual(delayed.days.slice(0,view.terms.fromDay));
    expect(await getPrisma().gameEntry.findMany({where:{gameId}})).toEqual(entries);
    const row = await getPrisma().game.findUniqueOrThrow({where:{id:gameId}});
    const terms = parseStoredTerms(row.terms);
    expect(terms.versions.map(({fromDay})=>fromDay)).toEqual([0,view.terms.fromDay]);
    const players = [a,b].map((memberId,seat)=>({memberId,seat,dayOne,timeZone:"America/New_York"}));
    const state: RuleState = {game:{...row,terms,seats:2,status:"live",startsOn:null},players,entries:entries.map(entry=>({...entry,kind:"photo"}))};
    const scheduled = view.days.filter(day=>!day.off).length;
    expect(scorePlayer(state,players[0])).toMatchObject({score:view.days[0].off ? 0 : 1,misses:scheduled-(view.days[0].off ? 0 : 1)});
    expect(scorePlayer(state,players[1])).toMatchObject({score:0,misses:scheduled});
    expect((await readGameChatState(room,[a,b])).games[0].pendingChange).toBeNull();
    const event = await getPrisma().gameEvent.findFirstOrThrow({where:{gameId,type:"change_applied"}});
    expect(event.payload).toMatchObject({effectiveFromDay:view.terms.fromDay});
  });
  it("resets the default start date using the acceptance clock after a delay", async () => {
    const today=gameLocalDate(new Date(),"America/New_York");
    const {a,b,room,gameId}=await setup({days:[0,1,2,3,4]},addDays(today,5)); const proposalId=randomUUID();
    await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",startsOn:null}});
    await getPrisma().game.update({where:{id:gameId},data:{devClockOffsetMs:BigInt(2*86400000)}});
    expect(await run(b,{type:"respondChange",gameId,proposalId,decision:"approve"},{chatContainerMemberId:room,beforeMutationTx:fence})).toMatchObject({ok:true});
    const view=(await readGame(gameId,a))!;
    expect(view.pendingChange).toBeNull();
    expect(view.days[0].localDate >= addDays(today,2)).toBe(true);
    expect(view.days[0].localDate < addDays(today,5)).toBe(true);
  });
  it.each(["date", "length", "unbound"] as const)("clears an impossible %s at read time and reserves one notice if bound", async (kind) => {
    const today = gameLocalDate(new Date(), "America/New_York");
    const {a,b,room,gameId} = await setup({days:[0,1,2,3,4]}, addDays(today, 5));
    const db = getPrisma(); const proposalId = randomUUID();
    const change = kind === "date" ? {kind:"edit" as const, startsOn:addDays(today,1)} : {kind:"edit" as const,lengthDays:3};
    expect(await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change})).toMatchObject({ok:true});
    if (kind === "unbound") await db.game.update({where:{id:gameId},data:{chatContainerMemberId:null}});
    // Day 1 is at most seven days out (a Saturday start snaps to Monday), so nine days on
    // the proposed date has passed and Day 3 has begun on every weekday the suite runs.
    await db.game.update({where:{id:gameId},data:{devClockOffsetMs:BigInt(9*86400000)}});
    // The first read expires it: both players see it gone and can edit again.
    for (const viewer of [a, b]) expect(await readGame(gameId,viewer)).toMatchObject({pendingChange:null,lengthDays:7,terms:{n:1},changeControls:{canEdit:true}});
    const event = await db.gameEvent.findUniqueOrThrow({where:{commandKey:`game-change-resolved:${gameId}:${proposalId}`}});
    expect(event).toMatchObject({type:"change_expired",payload:{proposalId,reason:expect.stringContaining(kind === "date" ? "start date has passed" : "day already started")}});
    const approve = {type:"respondChange" as const,gameId,proposalId,decision:"approve" as const};
    expect(await run(b,approve,{chatContainerMemberId:room,beforeMutationTx:fence})).toMatchObject({ok:false,error:{code:"CHANGE_EXPIRED"}});
    await run(b,approve,{chatContainerMemberId:room,beforeMutationTx:fence});
    expect(await db.hostedLinqDelivery.findMany({where:{sourceRef:`${gameId}:${proposalId}`},select:{template:true,status:true}}))
      .toEqual(kind === "unbound" ? [] : [{template:"game_change_expired",status:"awaiting_generation"}]);
  });
  it.each(["decline", "cancel"] as const)("keeps delayed %s behavior unchanged", async (decision) => {
    const {a,b,room,gameId} = await setup(); const proposalId = randomUUID();
    await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:14}});
    await getPrisma().game.update({where:{id:gameId},data:{devClockOffsetMs:BigInt(2*86400000)}});
    expect((await readGame(gameId,a))?.pendingChange?.id).toBe(proposalId);
    const actor = decision === "cancel" ? a : b;
    const command = {type:"respondChange" as const,gameId,proposalId,decision};
    for (let i=0;i<2;i++) expect(await run(actor,command,{chatContainerMemberId:room,beforeMutationTx:fence})).toMatchObject({ok:true});
    expect(await readGame(gameId,a)).toMatchObject({pendingChange:null,lengthDays:7,terms:{n:1}});
    expect(await getPrisma().gameEvent.count({where:{gameId,type:decision === "cancel" ? "change_cancelled" : "change_declined"}})).toBe(1);
  });
  it("applies at once when the decliner proposes the other player's declined change in chat", async () => {
    const {a,b,room,gameId} = await setup(); const db = getPrisma(); const chat = {chatContainerMemberId:room,beforeMutationTx:fence};
    const asked = randomUUID(); const change = {kind:"edit" as const,lengthDays:10};
    await run(a,{type:"proposeChange",gameId,proposalId:asked,expectedTermsVersion:1,change},chat);
    expect(await run(b,{type:"respondChange",gameId,proposalId:asked,decision:"decline"},chat)).toMatchObject({ok:true});
    const agreed = {type:"proposeChange" as const,gameId,proposalId:randomUUID(),expectedTermsVersion:1,change:{lengthDays:10,kind:"edit" as const}};
    for (let i=0;i<2;i++) expect(await run(b,agreed,chat)).toMatchObject({ok:true});
    expect(await readGame(gameId,a)).toMatchObject({pendingChange:null,lengthDays:10,terms:{n:2}});
    expect(await db.gameEvent.findUniqueOrThrow({where:{commandKey:`game-change-resolved:${gameId}:${agreed.proposalId}`}})).toMatchObject({type:"change_applied",actor:b});
    expect(await db.gameEvent.count({where:{gameId,type:"change_applied"}})).toBe(1);
  });
  it("judges the decliner's matching proposal as an approval, so a proposed start date can arrive", async () => {
    const today = gameLocalDate(new Date(), "America/New_York"); const every: Weekday[] = [0,1,2,3,4,5,6];
    const {a,b,room,gameId} = await setup({days:every}, addDays(today, 5)); const chat = {chatContainerMemberId:room,beforeMutationTx:fence};
    const asked = randomUUID(); const startsOn = addDays(today, 2);
    await run(a,{type:"proposeChange",gameId,proposalId:asked,expectedTermsVersion:1,change:{kind:"edit",startsOn,schedule:{days:every}}},chat);
    await run(b,{type:"respondChange",gameId,proposalId:asked,decision:"decline"},chat);
    // On the proposed date itself a fresh proposal would need tomorrow or later; approval keeps the date.
    await getPrisma().game.update({where:{id:gameId},data:{devClockOffsetMs:BigInt(2*86400000)}});
    expect(await run(b,{type:"proposeChange",gameId,proposalId:randomUUID(),expectedTermsVersion:1,change:{kind:"edit",schedule:{days:[...every].reverse()},startsOn}},chat)).toMatchObject({ok:true});
    expect(await readGame(gameId,a)).toMatchObject({pendingChange:null,terms:{n:2}});
    const players = await getPrisma().gamePlayer.findMany({where:{gameId},select:{dayOne:true}});
    expect(players.map((player) => player.dayOne?.toISOString().slice(0,10))).toEqual([startsOn, startsOn]);
  });
  it.each(["app", "different", "superseded", "proposer"] as const)("still asks the other player when the re-proposal is %s", async (variant) => {
    const {a,b,room,gameId} = await setup(); const chat = {chatContainerMemberId:room,beforeMutationTx:fence};
    const asked = randomUUID(); const change = {kind:"edit" as const,lengthDays:10};
    await run(a,{type:"proposeChange",gameId,proposalId:asked,expectedTermsVersion:1,change},chat);
    await run(b,{type:"respondChange",gameId,proposalId:asked,decision:"decline"},chat);
    if (variant === "superseded") {
      const other = randomUUID();
      await run(a,{type:"proposeChange",gameId,proposalId:other,expectedTermsVersion:1,change:{kind:"edit",lengthDays:12}},chat);
      await run(a,{type:"respondChange",gameId,proposalId:other,decision:"cancel"},chat);
    }
    const proposalId = randomUUID();
    const result = await run(variant === "proposer" ? a : b,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,
      change:variant === "different" ? {kind:"edit",lengthDays:9} : change},variant === "app" ? {} : chat);
    expect(result).toMatchObject({ok:true});
    expect(await readGame(gameId,a)).toMatchObject({pendingChange:{id:proposalId},lengthDays:7,terms:{n:1}});
  });
  it("shows an app proposal posted to a group chat as sent", async () => {
    const {a,b,gameId} = await setup(); const proposalId = randomUUID(); const db = getPrisma();
    await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:21}});
    // Runtime group sends carry no provider receipt; acceptance is the final status.
    await db.hostedLinqDelivery.update({where:{idempotencyKey:createHostedLinqDeliveryIdempotencyLookupKey(`game-change:${gameId}:${proposalId}`)!},data:{status:"sent_no_receipt_expected"}});
    for (const viewer of [a,b]) expect((await readGame(gameId,viewer))?.pendingChange).toMatchObject({id:proposalId,deliveryStatus:"sent",deliveryRetryable:true});
  });
  it("announces an approval refusal once: Murph's reply in the bound chat, else a notice", async () => {
    const today = gameLocalDate(new Date(), "America/New_York");
    for (const answeredIn of ["bound", "alternate"] as const) {
      const {a,b,room,gameId} = await setup({days:[0,1,2,3,4]}, addDays(today, 5));
      const db = getPrisma(); const proposalId = randomUUID();
      expect(await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:3}})).toMatchObject({ok:true});
      await db.game.update({where:{id:gameId},data:{devClockOffsetMs:BigInt(9*86400000)}});
      const alternate = `game_room_${randomUUID()}`; members.push(alternate);
      await db.hostedMember.create({data:{id:alternate,billingStatus:"not_started"}}); roomPlayers.set(alternate,[a,b]);
      expect(await run(b,{type:"respondChange",gameId,proposalId,decision:"approve"},{chatContainerMemberId:answeredIn === "bound" ? room : alternate,beforeMutationTx:fence}))
        .toMatchObject({ok:false,error:{code:"CHANGE_EXPIRED",message:expect.stringContaining("day already started")}});
      expect(await db.gameEvent.count({where:{gameId,type:"change_expired"}})).toBe(1);
      expect(await db.hostedLinqDelivery.findMany({where:{sourceRef:`${gameId}:${proposalId}`},select:{template:true}}))
        .toEqual(answeredIn === "bound" ? [] : [{template:"game_change_expired"}]);
    }
  });
  it("lets the bound chat's reply be the only word when an app request is cancelled there", async () => {
    for (const cancelledIn of ["chat", "app"] as const) {
      const {a,room,gameId} = await setup(); const proposalId = randomUUID(); const db = getPrisma();
      await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:18}});
      await db.$executeRaw`UPDATE game SET pending_change = jsonb_set(pending_change, '{deliveryStatus}', '"sent"'::jsonb) WHERE id = ${gameId}`;
      const command = {type:"respondChange" as const,gameId,proposalId,decision:"cancel" as const};
      expect(await run(a,command,cancelledIn === "chat" ? {chatContainerMemberId:room,beforeMutationTx:fence} : {})).toMatchObject({ok:true});
      expect(await db.hostedLinqDelivery.count({where:{template:"game_change_cancelled",sourceRef:`${gameId}:${proposalId}`}})).toBe(cancelledIn === "chat" ? 0 : 1);
    }
  });
  it("cancels a negotiating game from chat with the one lifecycle notice that keeps the room deliverable, and refuses a live one", async () => {
    for (const cancelledIn of ["chat", "app"] as const) {
      const {a,b,room,gameId} = await setup(); const db = getPrisma();
      await db.game.update({where:{id:gameId},data:{status:"negotiating"}});
      expect(await run(b,{type:"cancelInvite",gameId},cancelledIn === "chat" ? {chatContainerMemberId:room,beforeMutationTx:fence} : {})).toMatchObject({ok:true});
      expect((await readGame(gameId,a))?.status).toBe("void");
      expect(await db.hostedLinqDelivery.count({where:{template:"game_cancelled",sourceRef:gameId,status:"awaiting_generation"}})).toBe(1);
    }
    const {b,room,gameId} = await setup();
    expect(await run(b,{type:"cancelInvite",gameId},{chatContainerMemberId:room,beforeMutationTx:fence}))
      .toMatchObject({ok:false,error:{code:"INVITE_USED",message:"This game has already started."}});
  });
  it("clears a proposal on a terms-version move", async () => {
    const {a,gameId} = await setup(); const proposalId = randomUUID(); const db=getPrisma();
    await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:14}});
    const row=await db.game.findUniqueOrThrow({where:{id:gameId}}); const terms=parseStoredTerms(row.terms);
    terms.versions[0].n=2;
    await db.game.update({where:{id:gameId},data:{terms:toPrismaJsonObject(terms)}});
    expect((await readGame(gameId,a))?.pendingChange).toBeNull();
    expect(await db.gameEvent.count({where:{gameId,type:"change_expired"}})).toBe(1);
  });

});
