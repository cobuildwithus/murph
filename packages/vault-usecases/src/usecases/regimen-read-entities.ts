import type {
  ReadEntity,
  SavedEntitySnapshot,
} from "@murphai/operator-config/vault-cli-contracts"

import {
  buildEntityLinks,
  firstRawString,
  readRegistryRecordDocument,
  readRegistryRecordEntity,
  toListEntity,
} from "./shared.js"

const SUPPLEMENT_ENTITY_OMIT_KEYS = new Set([
  "id",
  "regimenId",
  "slug",
  "title",
  "markdown",
  "body",
  "relativePath",
  "path",
  "attributes",
])

const REGIMEN_ENTITY_OMIT_KEYS = new Set([
  "id",
  "regimenId",
  "slug",
  "title",
  "markdown",
  "body",
  "relativePath",
  "path",
  "attributes",
])

function toSupplementEntityData(record: object) {
  const rawRecord = readRegistryRecordEntity(record)

  return Object.fromEntries(
    Object.entries(rawRecord).filter(
      ([key, value]) =>
        !SUPPLEMENT_ENTITY_OMIT_KEYS.has(key) && value !== undefined,
    ),
  )
}

function toRegimenEntityData(record: object) {
  const rawRecord = readRegistryRecordEntity(record)
  const data = Object.fromEntries(
    Object.entries(rawRecord).filter(
      ([key, value]) =>
        !REGIMEN_ENTITY_OMIT_KEYS.has(key) && value !== undefined,
    ),
  )
  const regimenId = firstRawString(rawRecord, ["regimenId", "id"])
  if (regimenId) {
    data.regimenId = regimenId
  }
  return data
}

function toRegimenFamilyReadEntity(
  record: object,
  kind: "regimen" | "supplement",
  data: Record<string, unknown>,
): ReadEntity {
  const rawRecord = readRegistryRecordEntity(record)
  const rawDocument = readRegistryRecordDocument(record)
  const id =
    firstRawString(rawRecord, ["id"]) ??
    firstRawString(rawRecord, ["regimenId"]) ??
    ""

  return {
    id,
    kind,
    title: firstRawString(rawRecord, ["title"]),
    occurredAt: null,
    path: firstRawString(rawDocument, ["relativePath", "path"]),
    markdown: firstRawString(rawDocument, ["markdown", "body"]),
    data,
    links: buildEntityLinks({
      data,
    }),
  }
}

export function toSupplementReadEntity(record: object): ReadEntity {
  return toRegimenFamilyReadEntity(record, "supplement", toSupplementEntityData(record))
}

export function toSupplementListEntity(record: object) {
  return toListEntity(toSupplementReadEntity(record))
}

export function toRegimenReadEntity(record: object): ReadEntity {
  return toRegimenFamilyReadEntity(record, "regimen", toRegimenEntityData(record))
}

export function toRegimenListEntity(record: object) {
  return toListEntity(toRegimenReadEntity(record))
}

export function toSavedEntitySnapshot(entity: ReadEntity): SavedEntitySnapshot {
  const { markdown, ...snapshot } = entity
  void markdown
  return snapshot
}
