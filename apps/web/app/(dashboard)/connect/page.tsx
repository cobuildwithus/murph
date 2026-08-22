import ConnectPageContent, {
  type ConnectPageSearchParams,
} from "./connect-page-content";

export { metadata } from "./connect-page-metadata";

export default function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<ConnectPageSearchParams>;
}) {
  return ConnectPageContent({ searchParams });
}
