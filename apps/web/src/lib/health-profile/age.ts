import type { ProfileDb } from "./access";

/** S1 supplies only the publishable pair of values and a dependency revision. */
export interface ProfileAgeReader {
  read(memberId: string): Promise<{ value: number; gap: number; revision: string } | null>;
  current(tx: ProfileDb, memberId: string, revision: string): Promise<boolean>;
}

// No age candidate is offered until the engine and its publication fence are present.
export const profileAge: ProfileAgeReader = { read: async () => null, current: async () => false };
