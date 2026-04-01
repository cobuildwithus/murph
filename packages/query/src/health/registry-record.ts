import type { FrontmatterObject } from "./shared.ts";

export interface RegistryDocumentEnvelope {
  relativePath: string;
  markdown: string;
  body: string;
  attributes: FrontmatterObject;
}

export interface RegistryQueryEntity {
  id: string;
  slug: string;
  title: string | null;
  status: string | null;
}

export interface RegistryStoredDocument<
  TEntity extends RegistryQueryEntity = RegistryQueryEntity,
> {
  entity: TEntity;
  document: RegistryDocumentEnvelope;
}

export type RegistryMarkdownRecord = RegistryStoredDocument<RegistryQueryEntity>;
