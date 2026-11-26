export interface PlexServerSetup {
  serverId: string;
  serverUrl: string;
  webUrl?: string;
  state: "unclaimed" | "pending" | "claimed" | "verified";
  accountId?: string;
}

export function readPlexServerSetup(value: unknown): PlexServerSetup;
