import { getBackendURL } from "shared/api/backend";

const eventNames = [
  "timeline",
  "preference",
  "provider.change",
  "activity",
  "playing",
  "transcodeSession.update",
  "backgroundProcessingQueue",
  "status",
] as const;
export type PlexServerEvent =
  | { type: "notification"; name: (typeof eventNames)[number]; data: string }
  | {
      type: "connection";
      state: "connected" | "disconnected" | "unavailable";
      reconnected?: boolean;
    };

/** Plex SSE works through the existing HTTP proxy, including remote deployments. */
export function connectPlexServerEvents(
  token: string,
  onEvent: (event: PlexServerEvent) => void,
) {
  if (typeof EventSource === "undefined") {
    onEvent({ type: "connection", state: "unavailable" });
    return () => undefined;
  }
  const params = new URLSearchParams({
    "X-Plex-Token": token,
    filters: eventNames.join(","),
  });
  const stream = new EventSource(
    `${getBackendURL()}/dynproxy/:/eventsource/notifications?${params}`,
  );
  const handlers = eventNames.map((name) => {
    const handler = (event: MessageEvent<string>) =>
      onEvent({ type: "notification", name, data: event.data });
    stream.addEventListener(name, handler as EventListener);
    return { name, handler };
  });
  let interrupted = false;
  stream.onerror = () => {
    interrupted = true;
    onEvent({ type: "connection", state: "disconnected" });
  };
  stream.onopen = () => {
    onEvent({
      type: "connection",
      state: "connected",
      reconnected: interrupted,
    });
    interrupted = false;
  };
  return () => {
    stream.onopen = null;
    stream.onerror = null;
    handlers.forEach(({ name, handler }) =>
      stream.removeEventListener(name, handler as EventListener),
    );
    stream.close();
  };
}
