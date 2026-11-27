"use client";

import { normalizePortalDiscoveryFragment } from "@murphai/clinical-records/portal-discovery-link";
import { useSyncExternalStore } from "react";
import { ConnectLinkView } from "./connect-link-view";

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export function MedicalRecordsConnectLinkView(props: Parameters<typeof ConnectLinkView>[0]) {
  const fragment = useSyncExternalStore(subscribe, () => normalizePortalDiscoveryFragment(window.location.hash), () => "");
  return <ConnectLinkView {...props} appUrl={props.appUrl + fragment} linkUrl={props.linkUrl + fragment} />;
}
