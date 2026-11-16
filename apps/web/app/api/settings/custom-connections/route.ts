import { settingsConnections } from "@/src/lib/custom-connections/settings-http";
export const GET = (request: Request) => settingsConnections(request);
export const POST = (request: Request) => settingsConnections(request);
