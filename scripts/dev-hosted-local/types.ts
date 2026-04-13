import type { ChildProcess } from "node:child_process";

export interface HostedLocalDevConfig {
  skipPrismaMigrate: boolean;
  skipVercelPull: boolean;
  webHost: string;
  webPort: number;
  workerHost: string;
  workerPersistDir: string;
  workerPort: number;
  workerProtocol: "http" | "https";
}

export interface HostedExecutionOidcIdentity {
  environment: "development" | "preview" | "production";
  projectName: string;
  teamSlug: string;
}

export interface HostedWebDevServerLockMetadata {
  command: string;
  pid: number;
  port: number;
  startedAt: string;
}

export interface NamedChildProcess {
  child: ChildProcess;
  name: "cloudflare" | "web";
}
