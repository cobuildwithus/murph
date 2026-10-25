import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { readGame, readHome, readInvitePreview, runGameCommand } from "@/src/lib/game/service";
import { firstScheduledDate, parseStoredTerms } from "@/src/lib/game/rules";
import { acceptanceStartDate, addDays, gameLocalDate } from "@/src/lib/game/time";
import type { GameCommand } from "@/src/lib/game/contract";
vi.mock("@/src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: vi.fn(async () => {}) }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Negotiation proof requires an isolated local test database.");
const members: string[] = [];
const roomPlayers = new Map<string, readonly string[]>();
const fence = async () => {};
const tasks = [{ seat: 0, text: "Read a chapter" }, { seat: 1, text: "Stretch for ten minutes" }];
async function run(actorMemberId: string, command: GameCommand, room?: string, now?: Date) {
  return runGameCommand({ actorMemberId, command, ...(room ? { chatContainerMemberId: room, chatPlayerMemberIds: roomPlayers.get(room), beforeMutationTx: fence } : {}), ...(now ? { now } : {}) });
}
async function setup() {
  const a = randomUUID(), b = randomUUID(), c = randomUUID(), room = randomUUID();
  members.push(a, b, c, room);
  await getPrisma().hostedMember.createMany({ data: [a, b, c, room].map((id) => ({ id, billingStatus: "not_started" })) });
  for (const [id, firstName] of [[a,"Ava"],[b,"Sam"],[c,"Maya"]]) await run(id, { type:"setProfile", firstName, timeZone:"America/New_York" });
  const gameId = randomUUID();
  const created = await run(a, { type:"createGame", gameId, inviteeFirstName:"Sam", terms:{ tasks, schedule:{days:[0,1,2,3,4,5,6]}, stakes:[{kind:"dare",item:"Sing karaoke"}], lengthDays:10 } });
  if (!created.ok || !created.game?.inviteToken) throw new Error("Create fixture failed");
  await getPrisma().game.update({ where:{id:gameId}, data:{chatContainerMemberId:room} });
  roomPlayers.set(room, [a,b]);
  return {a,b,c,room,gameId,token:created.game.inviteToken};
}
function negotiate(token: string, proposalId = randomUUID()): Extract<GameCommand,{type:"negotiate"}> {
  return { type:"negotiate",token,proposalId,termsVersion:1,timeZone:"America/New_York",change:{kind:"edit",tasks:[tasks[0],{seat:1,text:"Practice guitar"}],schedule:{days:[4,0]},stakes:[{kind:"prize",item:"Choose the film"}]} };
}

describe.skipIf(!enabled)("game negotiation persistence", () => {
  afterAll(async () => { await getPrisma().hostedMember.deleteMany({where:{id:{in:members}}}); });
  it("keeps a delayed fixed start date when negotiation approval arrives after the default cutoff", async () => {
    const {a,b,room,gameId,token}=await setup();
    const db=getPrisma();
    await db.gameProfile.updateMany({where:{memberId:{in:[a,b]}},data:{timeZone:"UTC"}});
    const proposedDate=addDays(gameLocalDate(new Date(),"UTC"),1);
    const proposal={...negotiate(token),timeZone:"UTC",change:{kind:"edit" as const,startsOn:proposedDate}};
    expect(await run(b,proposal)).toMatchObject({ok:true});
    const approvedAt=new Date(`${proposedDate}T21:00:00Z`);
    expect(await run(a,{type:"respondChange",gameId,proposalId:proposal.proposalId,decision:"approve"},room,approvedAt)).toMatchObject({ok:true});
    const row=await db.game.findUniqueOrThrow({where:{id:gameId},include:{players:true}});
    expect(row.players.map(player=>player.dayOne?.toISOString().slice(0,10))).toEqual([proposedDate,proposedDate]);
    expect(row.startsOn?.toISOString().slice(0,10)).toBe(proposedDate);
    expect(parseStoredTerms(row.terms).versions).toMatchObject([{n:2,fromDay:0}]);
    expect(await db.gameEvent.count({where:{gameId,type:"change_applied"}})).toBe(1);
  });
  it("lets the challenger cancel an invited game once without creating a chat", async () => {
    const {a,b,c,gameId,token} = await setup();
    const db = getPrisma();
    await db.game.update({where:{id:gameId},data:{chatContainerMemberId:null}});
    const command = {type:"cancelInvite" as const,gameId};
    expect(await run(c,command)).toMatchObject({ok:false,error:{code:"NOT_A_PLAYER"}});
    expect(await run(b,command)).toMatchObject({ok:false,error:{code:"NOT_A_PLAYER"}});
    const results = await Promise.all([run(a,command),run(a,command)]);
    expect(results).toEqual(results.map(() => expect.objectContaining({ok:true,game:expect.objectContaining({status:"void",pendingChange:null})})));
    expect(await db.gameEvent.findMany({where:{gameId,type:"cancelled"},select:{actor:true}})).toEqual([{actor:a}]);
    expect(await db.hostedLinqDelivery.count({where:{source:"game_lifecycle",sourceRef:gameId,template:"game_cancelled"}})).toBe(0);
    expect(await readInvitePreview(token)).toEqual({status:"expired",reason:"cancelled",inviterFirstName:"Ava"});
    for (const actor of [a,b]) expect((await readHome(actor)).games.some((game) => game.id === gameId)).toBe(false);
    expect(await run(c,command)).toMatchObject({ok:false,error:{code:"NOT_A_PLAYER"}});
  });
  it("lets the invitee cancel negotiation, clears the pending change and frees the pair immediately", async () => {
    const {a,b,gameId,token} = await setup();
    const db = getPrisma();
    await run(b,negotiate(token));
    expect(await db.game.findUniqueOrThrow({where:{id:gameId}})).toMatchObject({liveRosterKey:expect.any(String),pendingChange:expect.any(Object)});
    expect(await run(b,{type:"cancelInvite",gameId})).toMatchObject({ok:true,game:{status:"void",pendingChange:null}});
    expect(await run(a,{type:"cancelInvite",gameId})).toMatchObject({ok:true,game:{status:"void",pendingChange:null}});
    expect(await db.game.findUniqueOrThrow({where:{id:gameId},select:{liveRosterKey:true,pendingChange:true}})).toEqual({liveRosterKey:null,pendingChange:null});
    expect(await db.gameEvent.findMany({where:{gameId,type:"cancelled"},select:{actor:true}})).toEqual([{actor:b}]);
    expect(await readInvitePreview(token)).toEqual({status:"expired",reason:"cancelled"});
    expect(await db.hostedLinqDelivery.findMany({where:{source:"game_lifecycle",sourceRef:gameId,template:"game_cancelled"},select:{status:true}})).toEqual([{status:"awaiting_generation"}]);
    for (const actor of [a,b]) expect((await readHome(actor)).games.some((game) => game.id === gameId)).toBe(false);
    // Even after the old deadline passes, cancellation must never reappear as expiry.
    await db.game.update({where:{id:gameId},data:{inviteExpiresAt:new Date(Date.now()-1000)}});
    for (const actor of [a,b]) expect((await readHome(actor)).games.some((game) => game.id === gameId)).toBe(false);
    const nextId = randomUUID();
    const created = await run(a,{type:"createGame",gameId:nextId,previousGameId:gameId,inviteeFirstName:"Sam",terms:{tasks,schedule:{days:[0,1,2,3,4,5,6]},stakes:[{kind:"prize",item:"Pick a film"}],lengthDays:7}});
    expect(created).toMatchObject({ok:true,game:{status:"invited"}});
    if (!created.ok || !created.game?.inviteToken) throw new Error("Replacement invite failed");
    expect(await run(b,negotiate(created.game.inviteToken))).toMatchObject({ok:true,game:{status:"negotiating"}});
  });
  it("refuses cancellation after kickoff or settlement and leaves ordinary expiry visible", async () => {
    const {a,b,gameId,token} = await setup();
    await run(b,{type:"join",token,termsVersion:1,timeZone:"America/New_York"});
    expect(await run(a,{type:"cancelInvite",gameId})).toMatchObject({ok:false,error:{code:"INVITE_USED"}});
    await getPrisma().game.update({where:{id:gameId},data:{status:"settled",liveRosterKey:null}});
    expect(await run(b,{type:"cancelInvite",gameId})).toMatchObject({ok:false,error:{code:"INVITE_USED"}});
    const expired = await setup();
    await run(expired.b,negotiate(expired.token));
    await getPrisma().game.update({where:{id:expired.gameId},data:{inviteExpiresAt:new Date(Date.now()-1000)}});
    expect(await readInvitePreview(expired.token)).toEqual({status:"used"});
    expect(await readGame(expired.gameId,expired.a)).toMatchObject({status:"void"});
    expect(await run(expired.b,{type:"cancelInvite",gameId:expired.gameId})).toMatchObject({ok:true,game:{status:"void"}});
    for (const actor of [expired.a,expired.b]) expect((await readHome(actor)).games).toContainEqual(expect.objectContaining({id:expired.gameId,status:"void"}));
    expect(await getPrisma().gameEvent.count({where:{gameId:expired.gameId,type:"cancelled"}})).toBe(0);
    expect(await readInvitePreview(expired.token)).toEqual({status:"expired"});
  });
  it("omits cancellation fields for an invite past its deadline before and after settlement", async () => {
    const { a, gameId, token } = await setup();
    await getPrisma().game.update({ where: { id: gameId }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    expect(await readInvitePreview(token)).toEqual({ status: "expired" });
    await readGame(gameId, a);
    expect(await readInvitePreview(token)).toEqual({ status: "expired" });
  });
  it("claims a seat without agreement, seals pending words, and activates exactly once on later approval", async () => {
    const {a,b,room,gameId,token} = await setup();
    expect(await readInvitePreview(token)).toMatchObject({status:"open",supportsNegotiation:true,lengthDays:10});
    const command = negotiate(token);
    const normalizedChange = {...command.change,schedule:{days:[0,4]}};
    expect(await run(b,command)).toMatchObject({ok:true,game:{status:"negotiating",startedAt:null,days:[],terms:{n:1,tasks},pendingChange:{change:normalizedChange}}});
    expect(await run(b,command)).toMatchObject({ok:true,game:{status:"negotiating"}});
    const row = (await getPrisma().game.findUnique({where:{id:gameId},include:{players:true}}))!;
    expect(row.players.every((player) => player.dayOne === null)).toBe(true);
    const intents = await getPrisma().hostedLinqDelivery.findMany({ where: { source: "game_lifecycle", sourceRef: gameId }, select: { template: true, status: true } });
    expect(intents).toEqual([{ template: "game_proposal", status: "awaiting_generation" }]);
    expect(await run(b,{type:"post",gameId,entryId:randomUUID(),kind:"photo",mediaKeys:[]})).toMatchObject({ok:false,error:{code:"GAME_NOT_LIVE"}});
    expect(JSON.stringify(row.pendingChange)).not.toContain("Practice guitar");
    expect(JSON.stringify(row.pendingChange)).not.toContain("Choose the film");
    expect(row.pendingChange).toMatchObject({change:{schedule:{days:[0,4]}}});
    expect(JSON.stringify((await readGame(gameId,a))?.pendingChange)).not.toContain("termsWordsEncrypted");
    expect((await readHome(a)).games.find((game) => game.id === gameId)?.status).toBe("negotiating");
    const approve = {type:"respondChange" as const,gameId,proposalId:command.proposalId,decision:"approve" as const};
    expect(await run(b,approve,room)).toMatchObject({ok:false,error:{code:"NOT_A_PLAYER"}});
    const later = new Date(Date.now() + 2 * 86_400_000);
    const results = await Promise.all([run(a,approve,room,later),run(a,approve,room,later)]);
    expect(results.every((result) => result.ok)).toBe(true);
    const view = (await readGame(gameId,a))!;
    expect(view).toMatchObject({status:"live",pendingChange:null,terms:{n:2,tasks:command.change.kind === "edit" ? command.change.tasks : [],stakes:[{kind:"prize",item:"Choose the film"}]}});
    const players = await getPrisma().gamePlayer.findMany({where:{gameId}});
    expect(players.map((player) => player.dayOne?.toISOString().slice(0,10))).toEqual([1,2].map(() => firstScheduledDate(acceptanceStartDate(later,"America/New_York"), {days:[0,4]})));
    expect(await getPrisma().gameEvent.count({where:{gameId,type:"started"}})).toBe(1);
    expect(await getPrisma().hostedLinqDelivery.count({ where: { source: "game_lifecycle", sourceRef: gameId, template: "game_started" } })).toBe(1);
    expect(await getPrisma().gameEvent.count({where:{gameId,type:"change_applied"}})).toBe(1);
  });
  it("declining never accepts original terms and a different invite claimant cannot take the seat", async () => {
    const {a,b,c,room,gameId,token} = await setup(); const command = negotiate(token);
    expect(await run(b,command)).toMatchObject({ok:true});
    expect(await run(c,negotiate(token))).toMatchObject({ok:false,error:{code:"INVITE_USED"}});
    expect(await run(b,{type:"join",token,termsVersion:1,timeZone:"America/New_York"})).toMatchObject({ok:false,error:{code:"INVITE_USED"}});
    expect(await run(a,{type:"respondChange",gameId,proposalId:command.proposalId,decision:"decline"},room)).toMatchObject({ok:true});
    expect(await readGame(gameId,a)).toMatchObject({status:"negotiating",startedAt:null,pendingChange:null,days:[]});
    const next = randomUUID();
    expect(await run(a,{type:"proposeChange",gameId,proposalId:next,expectedTermsVersion:1,change:{kind:"edit",lengthDays:12}})).toMatchObject({ok:true});
    expect(await run(b,{type:"respondChange",gameId,proposalId:next,decision:"approve"},room)).toMatchObject({ok:true});
    expect(await readGame(gameId,a)).toMatchObject({status:"live",lengthDays:12,terms:{tasks}});
  });
  it.each(["cancel", "decline"] as const)("accepts current terms after %s without reclaiming the seat", async (decision) => {
    const {a,b,c,room,gameId,token} = await setup();
    const proposal = negotiate(token);
    expect(await run(b,proposal)).toMatchObject({ok:true});
    expect(await run(decision === "cancel" ? b : a,{type:"respondChange",gameId,proposalId:proposal.proposalId,decision},decision === "decline" ? room : undefined)).toMatchObject({ok:true});
    const accept = {type:"join" as const,token,termsVersion:1,timeZone:"America/New_York"};
    expect(await readGame(gameId,b)).toMatchObject({status:"negotiating",pendingChange:null,inviteToken:token,players:expect.arrayContaining([expect.objectContaining({seat:1,isMe:true})])});
    for (const actor of [a,c]) expect(await run(actor,accept)).toMatchObject({ok:false,error:{code:"INVITE_USED"}});
    expect(await run(b,{...accept,termsVersion:2})).toMatchObject({ok:false,error:{code:"TERMS_CHANGED"}});
    const later = new Date(Date.now() + 86_400_000);
    const results = await Promise.all([run(b,accept,undefined,later),run(b,accept,undefined,later)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await readGame(gameId,b)).toMatchObject({status:"live",pendingChange:null,lengthDays:10,terms:{n:1,tasks,stakes:[{kind:"dare",item:"Sing karaoke"}]}});
    const players = await getPrisma().gamePlayer.findMany({where:{gameId}});
    expect(players).toHaveLength(2);
    expect(players.every((player) => player.dayOne?.toISOString().slice(0,10) === acceptanceStartDate(later,"America/New_York"))).toBe(true);
    expect(await getPrisma().gameEvent.count({where:{gameId,type:"started"}})).toBe(1);
    expect(await getPrisma().hostedLinqDelivery.count({where:{source:"game_lifecycle",sourceRef:gameId,template:"game_started"}})).toBe(1);
  });
  it("keeps challenger proposals and waiting available after cancellation", async () => {
    const {a,b,room,gameId,token} = await setup();
    const proposal = negotiate(token);
    await run(b,proposal);
    expect(await run(b,{type:"respondChange",gameId,proposalId:proposal.proposalId,decision:"cancel"})).toMatchObject({ok:true});
    expect(await readGame(gameId,a)).toMatchObject({status:"negotiating",startedAt:null,pendingChange:null,changeControls:{canEdit:true}});
    const next = randomUUID();
    expect(await run(a,{type:"proposeChange",gameId,proposalId:next,expectedTermsVersion:1,change:{kind:"edit",lengthDays:12}})).toMatchObject({ok:true});
    expect(await run(b,{type:"join",token,termsVersion:1,timeZone:"America/New_York"})).toMatchObject({ok:false,error:{code:"INVITE_USED"}});
    expect(await run(a,{type:"respondChange",gameId,proposalId:next,decision:"cancel"})).toMatchObject({ok:true});
    const final = randomUUID();
    expect(await run(b,{type:"proposeChange",gameId,proposalId:final,expectedTermsVersion:1,change:{kind:"edit",lengthDays:14}})).toMatchObject({ok:true});
    expect(await run(a,{type:"respondChange",gameId,proposalId:final,decision:"decline"},room)).toMatchObject({ok:true});
    expect(await readGame(gameId,a)).toMatchObject({status:"negotiating",startedAt:null,pendingChange:null,lengthDays:10});
  });
  it("keeps the original invite deadline after cancellation and releases the pair on expiry", async () => {
    const {b,gameId,token} = await setup();
    const proposal = negotiate(token);
    await run(b,proposal);
    await run(b,{type:"respondChange",gameId,proposalId:proposal.proposalId,decision:"cancel"});
    const {inviteExpiresAt} = await getPrisma().game.findUniqueOrThrow({where:{id:gameId}});
    expect(await run(b,{type:"join",token,termsVersion:1,timeZone:"America/New_York"},undefined,inviteExpiresAt!)).toMatchObject({ok:false,error:{code:"INVITE_EXPIRED"}});
    await getPrisma().game.update({where:{id:gameId},data:{inviteExpiresAt:new Date(Date.now()-1000)}});
    expect(await readGame(gameId,b)).toMatchObject({status:"void",pendingChange:null});
    expect(await getPrisma().game.findUniqueOrThrow({where:{id:gameId},select:{liveRosterKey:true}})).toEqual({liveRosterKey:null});
  });
  it("serializes competing invite claims without accepting either original wager", async () => {
    const {b,c,gameId,token} = await setup();
    const results = await Promise.all([run(b,negotiate(token)),run(c,negotiate(token))]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ok:false,error:{code:"INVITE_USED"}});
    const row = (await getPrisma().game.findUnique({where:{id:gameId},include:{players:true}}))!;
    expect(row.status).toBe("negotiating"); expect(row.players).toHaveLength(2);
    expect(row.startedAt).toBeNull();
  });
  it("expires abandoned negotiation without scores or tickets and releases the pair reservation", async () => {
    const {a,b,gameId,token} = await setup(); await run(b,negotiate(token));
    await getPrisma().game.update({where:{id:gameId},data:{inviteExpiresAt:new Date(Date.now()-1000)}});
    expect(await readGame(gameId,a)).toMatchObject({status:"void",pendingChange:null,result:null,tickets:[]});
    expect(await getPrisma().game.findUnique({where:{id:gameId},select:{liveRosterKey:true}})).toEqual({liveRosterKey:null});
  });
  it.each([false,true])("preserves a later start unless explicitly reset (reset: %s)", async (reset) => {
    const {a,b,room,gameId,token} = await setup();
    const selected = addDays(gameLocalDate(new Date(),"America/New_York"),10);
    await getPrisma().game.update({where:{id:gameId},data:{startsOn:new Date(`${selected}T00:00:00Z`)}});
    const command = negotiate(token); command.change = reset ? {kind:"edit",startsOn:null} : {kind:"edit",lengthDays:12,schedule:{days:[4,0]}};
    expect(await run(b,command)).toMatchObject({ok:true});
    const later = new Date(Date.now()+86_400_000);
    expect(await run(a,{type:"respondChange",gameId,proposalId:command.proposalId,decision:"approve"},room,later)).toMatchObject({ok:true});
    const row = (await getPrisma().game.findUnique({where:{id:gameId},include:{players:true}}))!;
    expect(row.startsOn?.toISOString().slice(0,10) ?? null).toBe(reset ? null : selected);
    if (!reset) expect(parseStoredTerms(row.terms).versions[0].schedule).toEqual({days:[0,4]});
    // Day 1 lands on the first scheduled day from the agreed date.
    expect(row.players[0].dayOne?.toISOString().slice(0,10)).toBe(reset
      ? firstScheduledDate(acceptanceStartDate(later,"America/New_York"), parseStoredTerms(row.terms).versions[0].schedule)
      : firstScheduledDate(selected, {days:[0,4]}));
  });
  it.each([1, 3, 10])("refuses live task/stake edits without changing agreed terms on day %s", async (day) => {
    const {a,b,room,gameId,token} = await setup();
    expect(await run(b,{type:"join",token,termsVersion:1,timeZone:"America/New_York"})).toMatchObject({ok:true});
    const dayOne = addDays(gameLocalDate(new Date(),"America/New_York"),1-day);
    await getPrisma().gamePlayer.updateMany({where:{gameId},data:{dayOne:new Date(`${dayOne}T00:00:00Z`)}});
    const before = await getPrisma().game.findUniqueOrThrow({where:{id:gameId}});
    for (const change of [
      {kind:"edit" as const, tasks:[{seat:0,text:"Read poetry"},tasks[1]]},
      {kind:"edit" as const, stakes:[{kind:"prize" as const,item:"Breakfast"}],stakesApplyToWholeGame:true as const},
    ]) {
      expect(await run(a,{type:"proposeChange",gameId,proposalId:randomUUID(),expectedTermsVersion:1,change},room)).toMatchObject({ok:false,error:{code:"INVALID_REQUEST"}});
    }
    const after = await getPrisma().game.findUniqueOrThrow({where:{id:gameId}});
    expect(after.terms).toEqual(before.terms);
    expect(after.termsWordsEncrypted).toBe(before.termsWordsEncrypted);
    expect(after.pendingChange).toBeNull();
  });
});
