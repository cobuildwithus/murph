import { normalizeTextValue } from "../../shared.ts";

export interface InferDirectEmailThreadParticipantsInput {
  accountAddress?: string | null;
  bcc?: ReadonlyArray<string | null | undefined> | null;
  cc?: ReadonlyArray<string | null | undefined> | null;
  from?: string | null;
  selfAddresses?: ReadonlyArray<string | null | undefined> | null;
  to?: ReadonlyArray<string | null | undefined> | null;
}

export function inferDirectEmailThreadFromParticipants(
  input: InferDirectEmailThreadParticipantsInput,
): boolean {
  const selfAddresses = resolveEmailParticipantSet([
    input.accountAddress,
    ...(input.selfAddresses ?? []),
  ]);
  const allParticipants = new Set<string>();
  const otherParticipants = new Set<string>();

  const appendParticipant = (value: string | null | undefined) => {
    const normalized = resolveEmailAddress(value ?? null);
    if (!normalized) {
      return;
    }

    const normalizedLower = normalized.toLowerCase();
    allParticipants.add(normalizedLower);

    if (selfAddresses.has(normalizedLower)) {
      return;
    }

    otherParticipants.add(normalizedLower);
  };

  appendParticipant(input.from ?? null);
  for (const value of input.to ?? []) {
    appendParticipant(value);
  }
  for (const value of input.cc ?? []) {
    appendParticipant(value);
  }
  for (const value of input.bcc ?? []) {
    appendParticipant(value);
  }

  if (selfAddresses.size > 0 && otherParticipants.size > 0) {
    return otherParticipants.size <= 1;
  }

  if (selfAddresses.size === 0 && allParticipants.size > 0) {
    return allParticipants.size <= 2;
  }

  const recipientCount = [
    ...(input.to ?? []),
    ...(input.cc ?? []),
    ...(input.bcc ?? []),
  ]
    .map((value) => normalizeTextValue(value ?? null))
    .filter((value): value is string => value !== null).length;

  return recipientCount <= 1;
}

export function resolveEmailAddress(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeTextValue(value ?? null);
  if (!normalized) {
    return null;
  }

  const angleMatch = normalized.match(/<([^>]+)>/u);
  const candidate = angleMatch?.[1] ?? normalized;
  const trimmed = candidate.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveEmailParticipantSet(
  values: ReadonlyArray<string | null | undefined>,
): Set<string> {
  const participants = new Set<string>();

  for (const value of values) {
    const normalized = resolveEmailAddress(value ?? null);
    if (!normalized) {
      continue;
    }

    participants.add(normalized.toLowerCase());
  }

  return participants;
}
