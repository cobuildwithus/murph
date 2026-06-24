export type DeviceSyncCompletionContactKind = "imessage" | "telegram";

export interface DeviceSyncCompletionContactAction {
  ariaLabel?: string;
  href: string;
  kind: DeviceSyncCompletionContactKind;
  label: string;
  rel?: string;
  target?: string;
}

// `kind` chooses the dialog header icon: "device-sync" → watch+check (the
// wearable connect flow), "connected-app" → connect-link (Composio-backed
// integrations like Gmail). The model shape itself is shared because the
// caller-visible fields (title, detail, retry, contact action) are identical.
export type CompletionDialogKind = "device-sync" | "connected-app";

export interface DeviceSyncCompletionDialogModel {
  contactAction: DeviceSyncCompletionContactAction | null;
  detail: string;
  failed: boolean;
  kind: CompletionDialogKind;
  retryHref: string | null;
  title: string;
}
