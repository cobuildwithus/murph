import type {
  ParsedMarkdownDocumentEnvelope,
  StoredMarkdownDocument,
} from "@murphai/contracts";

import type { FrontmatterObject } from "./shared.ts";

export type RegistryDocumentEnvelope = ParsedMarkdownDocumentEnvelope<FrontmatterObject>;

export interface RegistryQueryEntity {
  id: string;
  slug: string;
  title: string | null;
  status: string | null;
}

export type RegistryStoredDocument<
  TEntity extends RegistryQueryEntity = RegistryQueryEntity,
> = StoredMarkdownDocument<TEntity, RegistryDocumentEnvelope>;

export type RegistryMarkdownRecord = RegistryStoredDocument<RegistryQueryEntity>;
