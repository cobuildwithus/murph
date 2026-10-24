import "server-only";

import type { Game } from "@prisma/client";
import { generateHostedRandomPrefixedId } from "../primitives";
import type { GameChange, GamePendingChange } from "./contract";
import { parsePendingGameChange, type StoredGamePendingChange } from "./changes";
import { openGameTexts, sealGameText } from "./crypto";
import { parseTermWords } from "./rules";
import { gameWordsMemberId } from "./account-deletion";

type WordsOwner = Pick<Game, "id" | "createdBy" | "departedPlayer" | "termsWordsEncrypted">;
const target = (row: Pick<Game, "id" | "createdBy" | "departedPlayer">) => ({ table: "game" as const, field: "terms_words", memberId: gameWordsMemberId(row), rowId: row.id });

export interface PreparedGameChangeWords {
  /** Compared under the game lock before publishing the prepared version. */
  baseWordsEncrypted?: string;
  termsWordsEncrypted?: string;
  tasksChanged?: true;
  stakes?: StoredGamePendingChange["stakes"];
}

/** All KMS work happens before acquiring the game lock. */
export async function prepareGameChangeWords(row: WordsOwner, change: GameChange, expectedVersion: number): Promise<PreparedGameChangeWords> {
  if (change.kind !== "edit" || (!change.tasks && !change.stakes)) return {};
  const [plain] = await openGameTexts([{ ...target(row), value: row.termsWordsEncrypted }]);
  const words = parseTermWords(plain ?? "");
  const previous = [...words.versions].reverse().find((version) => version.n <= expectedVersion);
  if (!previous) throw new Error("Game terms words are missing.");
  const stakes = change.stakes?.map((stake) => ({ key: generateHostedRandomPrefixedId("gsk"), kind: stake.kind, item: stake.item }));
  const nextWords = { n: expectedVersion + 1, tasks: change.tasks ?? previous.tasks,
    stakes: stakes?.map(({ key, item }) => ({ key, item })) ?? previous.stakes };
  const encrypted = await sealGameText(target(row), JSON.stringify({ v: 1, versions: [...words.versions, nextWords] }));
  if (!encrypted) throw new Error("Game encryption returned nothing.");
  return { baseWordsEncrypted: row.termsWordsEncrypted, termsWordsEncrypted: encrypted,
    ...(change.tasks ? { tasksChanged: true } : {}),
    ...(stakes ? { stakes: stakes.map(({ key, kind }) => ({ key, kind })) } : {}) };
}

/** Public views contain proposed words, never their stored envelopes or keys. */
export async function readPendingGameChanges(rows: readonly Pick<Game, "id" | "createdBy" | "departedPlayer" | "pendingChange">[]): Promise<Map<string, GamePendingChange>> {
  const pending = rows.flatMap((row) => {
    const proposal = parsePendingGameChange(row.pendingChange);
    return proposal ? [{ row, proposal }] : [];
  });
  const sealed = pending.filter((item) => item.proposal.termsWordsEncrypted);
  const plain = await openGameTexts(sealed.map(({ row, proposal }) => ({ ...target(row), value: proposal.termsWordsEncrypted })));
  const wordsByGame = new Map(sealed.map(({ row }, index) => [row.id, parseTermWords(plain[index] ?? "")]));
  return new Map(pending.map(({ row, proposal }) => {
    const { termsWordsEncrypted, tasksChanged, stakes, ...view } = proposal;
    if (!termsWordsEncrypted) return [row.id, view];
    const words = wordsByGame.get(row.id)?.versions.find((version) => version.n === proposal.expectedTermsVersion + 1);
    if (!words || view.change.kind !== "edit") throw new Error("Proposed game terms words are missing.");
    return [row.id, { ...view, change: { ...view.change,
      ...(tasksChanged ? { tasks: words.tasks } : {}),
      ...(stakes ? { stakes: stakes.map((stake) => {
        const item = words.stakes.find((word) => word.key === stake.key)?.item;
        if (!item) throw new Error("Proposed stake words are missing.");
        return { kind: stake.kind, item };
      }) } : {}) } }];
  }));
}

export async function readPendingGameChange(row: Pick<Game, "id" | "createdBy" | "departedPlayer" | "pendingChange">): Promise<GamePendingChange | null> {
  return (await readPendingGameChanges([row])).get(row.id) ?? null;
}
