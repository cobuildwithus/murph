export type DeviceSyncCompletionContactKind = "imessage" | "telegram";

export interface DeviceSyncCompletionContactAction {
  ariaLabel?: string;
  href: string;
  kind: DeviceSyncCompletionContactKind;
  label: string;
  rel?: string;
  target?: string;
}

export interface DeviceSyncCompletionDialogModel {
  contactAction: DeviceSyncCompletionContactAction | null;
  detail: string;
  failed: boolean;
  retryHref: string | null;
  title: string;
}
