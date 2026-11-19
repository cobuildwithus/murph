import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ find: vi.fn(), claim: vi.fn(), finish: vi.fn(), create: vi.fn(), consume: vi.fn(), post: vi.fn(),
  measure: vi.fn(), open: vi.fn(), transaction: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/prisma', () => ({ getPrisma: () => ({ gamePlaceArt: { findUnique: mocks.find }, gameProgressMeasure: { findUnique: mocks.measure },
  $transaction: mocks.transaction }) }));
vi.mock('../src/lib/better-auth/rate-limit', () => ({ hostedAuthRateLimitStorage: () => ({ consume: mocks.consume }) }));
vi.mock('../src/lib/game/progress/place-art', async original => ({ ...await original<typeof import('../src/lib/game/progress/place-art')>(),
  claimArt: mocks.claim, finishArt: mocks.finish }));
vi.mock('../src/lib/game/progress/crypto', () => ({ progressLookup: () => 'lookup', openProgress: mocks.open }));
import { cleanStory, readPlaceStory, readTownStory, shown, storyKey } from '../src/lib/game/progress/place-story';
import { pickedPlace, placeFixQuestion, memberPlaceFixer } from '../src/lib/game/progress/place-fix';
import { storySchema } from '../src/lib/game/progress/contract';
import type OpenAI from 'openai';

const place = { id: 'dplace-mid', label: 'Middle, Delaware, United States' };
const story = { title: 'River mills town', facts: ['It sits on a river.', 'Mills once ran here.', 'A college is nearby.'] };
const client = (output: unknown, status = 'completed') => ({ responses: { create: mocks.create.mockResolvedValue({ status, output_text: JSON.stringify(output) }) },
  post: mocks.post }) as unknown as OpenAI;
const row = (status: string, ageMs: number, attempts = 1, bytes: Uint8Array | null = null) =>
  ({ status, bytes, attempts, startedAt: new Date(Date.now() - ageMs) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.consume.mockResolvedValue({ allowed: true }); mocks.claim.mockResolvedValue(1); mocks.finish.mockResolvedValue(true);
});

describe('Progress postcard stories', () => {
  it('writes a story once, keeps it, and shows it', async () => {
    mocks.find.mockResolvedValue(null);
    const admit = vi.fn(async () => true);
    expect(await readPlaceStory(place, { client: client(story), admit })).toEqual({ state: 'ready', ...story });
    expect(mocks.claim).toHaveBeenCalledWith(storyKey('dplace-mid'), 'story', expect.any(Date), { deadlineMs: 12_000, retryAfterMs: 60_000, budgeted: false });
    expect(mocks.finish).toHaveBeenCalledWith('story:v1:dplace-mid', 1, { bytes: Buffer.from(JSON.stringify(story)) });
    const request = mocks.create.mock.calls[0]![0];
    expect(request).toMatchObject({ model: 'gpt-6-luna', store: false, reasoning: { effort: 'none' }, input: JSON.stringify({ place: place.label }) });
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it('reads a saved story with no write, no claim and no allowance', async () => {
    mocks.find.mockResolvedValue(row('ready', 60_000, 1, Buffer.from(JSON.stringify(story))));
    const admit = vi.fn(async () => true);
    expect(await readPlaceStory(place, { client: client(story), admit })).toEqual({ state: 'ready', ...story });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled(); expect(admit).not.toHaveBeenCalled();
  });

  it("shows another reader's write as making, and reads again after a lost claim", async () => {
    mocks.find.mockResolvedValue(row('making', 2_000));
    expect(await readPlaceStory(place, { client: client(story) })).toEqual({ state: 'making', typicalSeconds: 3 });
    mocks.find.mockResolvedValueOnce(null).mockResolvedValueOnce(row('making', 0));
    mocks.claim.mockResolvedValue(null);
    expect(await readPlaceStory(place, { client: client(story) })).toEqual({ state: 'making', typicalSeconds: 3 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('records a refused write and says it failed', async () => {
    mocks.find.mockResolvedValue(null);
    expect(await readPlaceStory(place, { client: client({ title: '', facts: ['a', 'b', 'c'] }) })).toEqual({ state: 'failed' });
    expect(mocks.finish).toHaveBeenCalledWith('story:v1:dplace-mid', 1, { failure: 'refused' });
    const down = client(story);
    mocks.create.mockRejectedValue(new Error('provider down'));
    expect(await readPlaceStory(place, { client: down })).toEqual({ state: 'failed' });
    expect(mocks.finish).toHaveBeenLastCalledWith('story:v1:dplace-mid', 1, { failure: 'generation_failed' });
  });

  it("claims nothing past the member's allowance", async () => {
    mocks.find.mockResolvedValue(null);
    expect(await readPlaceStory(place, { client: client(story), admit: async () => false })).toEqual({ state: 'failed' });
    expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a fresh write', row('making', 5_000), { state: 'making', typicalSeconds: 3 }],
    ['a dead write with tries left', row('making', 13_000), null],
    ['a dead last try', row('making', 13_000, 3), { state: 'failed' }],
    ['a failure waiting to retry', row('failed', 30_000), { state: 'failed' }],
    ['a failure due a retry', row('failed', 61_000, 2), null],
    ['an exhausted failure', row('failed', 86_400_000, 3), { state: 'failed' }],
    ['unreadable saved bytes', row('ready', 0, 1, Buffer.from('not json')), { state: 'failed' }],
  ])('reads %s the way the claim does', (_, value, expected) => {
    expect(shown(value)).toEqual(expected);
  });

  it('tidies dashes and quotes, and refuses empty or overlong words', () => {
    expect(cleanStory({ title: '"Mill town"', facts: ['It sits on a river — a wide one.', 'Two', 'Three'] }))
      .toEqual({ title: 'Mill town', facts: ['It sits on a river, a wide one.', 'Two', 'Three'] });
    expect(cleanStory({ title: 'x'.repeat(41), facts: ['a', 'b', 'c'] })).toBeNull();
    expect(cleanStory({ title: 'Fine', facts: ['a', 'b'] })).toBeNull();
    expect(cleanStory({ title: 'Fine', facts: ['123', 'b', 'c'] })).toBeNull();
    for (const view of [{ state: 'ready', ...story }, { state: 'making', typicalSeconds: 3 }, { state: 'failed' }]) expect(storySchema.safeParse(view).success).toBe(true);
  });

  it("starts stories only for towns on the member's own current leg", async () => {
    mocks.measure.mockResolvedValue({ stateEncrypted: 'sealed' });
    mocks.open.mockResolvedValue({ legs: [{ towns: [{ name: 'Old', atM: 0, place: { id: 'dplace-old', label: 'Old, Ohio, United States' } }] },
      { towns: [{ name: 'Middle', atM: 0, place }, { name: 'Field', atM: 10, place: null }] }] });
    mocks.find.mockResolvedValue(row('ready', 0, 1, Buffer.from(JSON.stringify(story))));
    const beforeWrite = vi.fn();
    mocks.transaction.mockImplementation(async (job: (tx: unknown) => unknown) => job('tx'));
    expect(await readTownStory('member', { measure: 'steps', town: 0 }, beforeWrite)).toEqual({ state: 'ready', ...story });
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'story:v1:dplace-mid' } }));
    expect(beforeWrite).toHaveBeenCalledWith('tx');
    for (const town of [1, 2]) await expect(readTownStory('member', { measure: 'steps', town }, beforeWrite)).rejects.toMatchObject({ httpStatus: 404 });
    mocks.measure.mockResolvedValue(null);
    await expect(readTownStory('member', { measure: 'walk.meters', town: 0 }, beforeWrite)).rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe('Progress place fix choice', () => {
  const candidates = [{ at: [-9.14, 38.72] as [number, number], id: 'dplace-lis', name: 'Lisbon', label: 'Lisbon, Lisbon, Portugal' },
    { at: [-97.68, 46.44] as [number, number], id: 'dplace-nd', name: 'Lisbon', label: 'Lisbon, North Dakota, United States' }];
  const answer = (probabilities: { value: string; probability: number }[]) => ({ answers: [{ type: 'choice', name: 'place', probabilities }] });

  it("asks one choice over Mapbox's places and none", () => {
    const question = placeFixQuestion('Lisbn', candidates);
    expect(question.model).toBe('gpt-6-luna');
    expect(question.questions).toHaveLength(1);
    expect(question.questions[0]!.choices.map(choice => choice.value)).toEqual(['p0', 'p1', 'none']);
    expect(question.questions[0]!.choices[1]!.description).toBe('Lisbon, North Dakota, United States');
  });

  it.each([
    ['a sure pick', [{ value: 'p0', probability: 0.9 }, { value: 'none', probability: 0.1 }], 'dplace-lis'],
    ['a pick at the bar', [{ value: 'p1', probability: 0.6 }, { value: 'none', probability: 0.4 }], 'dplace-nd'],
    ['an unsure pick', [{ value: 'p0', probability: 0.55 }, { value: 'none', probability: 0.45 }], null],
    ['none', [{ value: 'none', probability: 0.8 }, { value: 'p0', probability: 0.2 }], null],
    ['a place Mapbox never offered', [{ value: 'p4', probability: 0.9 }], null],
  ])('reads %s', (_, probabilities, id) => {
    expect(pickedPlace(answer(probabilities), candidates)?.id ?? null).toBe(id);
  });

  it('reads a malformed answer as none', () => {
    expect(pickedPlace({ answers: [] }, candidates)).toBeNull();
    expect(pickedPlace('nonsense', candidates)).toBeNull();
  });

  it("asks Luna only inside the member's allowance, and treats its failure as none", async () => {
    const luna = client(story);
    mocks.consume.mockResolvedValue({ allowed: false });
    expect(await memberPlaceFixer('member', { client: luna })('Lisbn', candidates)).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.consume).toHaveBeenCalledWith('progress-place-fix:member:member', { max: 30, window: 86_400 });
    mocks.consume.mockResolvedValue({ allowed: true });
    mocks.post.mockResolvedValue(answer([{ value: 'p0', probability: 0.9 }]));
    expect((await memberPlaceFixer('member', { client: luna })('Lisbn', candidates))?.id).toBe('dplace-lis');
    expect(mocks.post).toHaveBeenCalledWith('/decisions', expect.objectContaining({ timeout: 4_000, maxRetries: 0 }));
    mocks.post.mockRejectedValue(new Error('timeout'));
    expect(await memberPlaceFixer('member', { client: luna })('Lisbn', candidates)).toBeNull();
  });
});
