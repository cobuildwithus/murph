const LINK_PAGE_VEIL_ID = "link-page-veil";

// A link can share its URL with a dashboard page, and a URL fragment never
// reaches the server, so the dashboard frame streams first. This runs before
// that frame paints and keeps it hidden until the link page takes over. It
// lifts on its own, so a page that fails can never stay blank.
const LINK_PAGE_VEIL_SCRIPT = String.raw`(function(){var l=location;if((l.pathname==="/connect"&&/(?:^#|&)deviceConnectIntent=dc_[\w-]{32}(?:&|$)/.test(l.hash))||((l.pathname==="/settings"||l.pathname==="/home")&&/[?&](?:deviceSyncCompletion|connectedAppCompletion)=1(?:&|$)/.test(l.search))){var s=document.createElement("style");s.id="${LINK_PAGE_VEIL_ID}";s.textContent="html,body{background:#1C1915}body>*{visibility:hidden}";document.head.appendChild(s);setTimeout(function(){s.remove()},5000)}})()`;

export function LinkPageVeil() {
  return <script dangerouslySetInnerHTML={{ __html: LINK_PAGE_VEIL_SCRIPT }} />;
}

export function releaseLinkPageVeil() {
  document.getElementById(LINK_PAGE_VEIL_ID)?.remove();
}
