import { PlexClient, PlexRequestError } from "shared/api/PlexClient";
import { PlexResponseError } from "shared/api/plexResponse";

export async function getServerSessionContext(
  token: string,
  signal?: AbortSignal,
) {
  const client = new PlexClient(() => token);
  const capabilities = new AbortController();
  const cancel = () => capabilities.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  // Optional capabilities must finish before the server bootstrap's own deadline.
  const timeout = setTimeout(() => capabilities.abort(), 5_000);
  try {
    const [root, providerRead] = await Promise.all([
      client.get<{ MediaContainer?: Plex.ServerPreferences }>("/", signal),
      client
        .get("/media/providers", capabilities.signal)
        .then((data) => ({ data, unavailable: false }))
        .catch((error: unknown) => ({
          data: null,
          // Denied/unsupported capabilities are a known lack of admin access.
          unavailable: !(
            error instanceof PlexRequestError &&
            [401, 403, 404].includes(error.status)
          ),
        })),
    ]);
    signal?.throwIfAborted();
    if (
      typeof root?.MediaContainer?.machineIdentifier !== "string" ||
      !root.MediaContainer.machineIdentifier.trim()
    )
      throw new PlexResponseError("server details", ["machineIdentifier"]);
    return {
      server: root.MediaContainer,
      providers: providerRead.data,
      ...(providerRead.unavailable && {
        capabilitiesUnavailable: true as const,
      }),
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    capabilities.abort();
  }
}
