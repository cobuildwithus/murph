export interface AssistantModelTextPart {
  type: 'text'
  text: string
}

export type AssistantModelImageDetail = 'high' | 'original'

export interface AssistantModelImagePart {
  type: 'image'
  detail?: AssistantModelImageDetail
  image: string | Uint8Array | Buffer | ArrayBuffer | URL
  mediaType?: string
  mimeType?: string
}

export interface AssistantModelFilePart {
  type: 'file'
  data: string | Uint8Array | Buffer | ArrayBuffer | URL
  mediaType: string
  filename?: string
}

export type AssistantModelContentPart =
  | AssistantModelTextPart
  | AssistantModelImagePart
  | AssistantModelFilePart
  | Record<string, unknown>

export type AssistantUserMessageContentPart =
  | AssistantModelTextPart
  | AssistantModelImagePart
  | AssistantModelFilePart

export interface AssistantModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | AssistantModelContentPart[]
}
