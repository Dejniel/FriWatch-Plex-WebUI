import { PlexClient } from "shared/api/PlexClient";
import { PlexResponseError } from "shared/api/plexResponse";

export async function getServerSessionContext(
  token: string,
  signal?: AbortSignal,
) {
  const client = new PlexClient(() => token);
  const [root, providers] = await Promise.all([
    client.get<{ MediaContainer?: Plex.ServerPreferences }>("/", signal),
    client.get("/media/providers", signal).catch(() => null),
  ]);
  signal?.throwIfAborted();
  if (
    typeof root?.MediaContainer?.machineIdentifier !== "string" ||
    !root.MediaContainer.machineIdentifier.trim()
  )
    throw new PlexResponseError("server details", ["machineIdentifier"]);
  return {
    server: root.MediaContainer,
    providers,
  };
}
