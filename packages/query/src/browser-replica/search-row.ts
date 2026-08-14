import type {
  BrowserVaultEntity,
  BrowserVaultSearchRow,
} from "./shared.ts";

export function projectBrowserVaultSearchRow(entity: BrowserVaultEntity): BrowserVaultSearchRow {
  return {
    date: entity.date,
    entityId: entity.id,
    family: entity.family,
    id: entity.id,
    kind: entity.kind,
    occurredAt: entity.occurredAt,
    tags: entity.tags.slice(),
    text: [entity.title, entity.bodyPreview, entity.kind, entity.status, entity.stream, entity.tags.join(" ")]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join("\n"),
    title: entity.title,
  };
}
