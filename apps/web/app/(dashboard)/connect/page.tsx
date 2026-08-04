import ConnectPageContent, {
  type ConnectPageSearchParams,
  metadata,
} from "./connect-page-content";

export { metadata };

export default function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<ConnectPageSearchParams>;
}) {
  return ConnectPageContent({ searchParams });
}
