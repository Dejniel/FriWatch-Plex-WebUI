import { useEffect } from "react";
import {
  AuthStorage,
  capturePlexSession,
  connectPlexServerEvents,
  mediaChangeFromServer,
  parsePlexServerChanges,
  useServerSession,
} from "features/session/model";
import {
  publishMediaChange,
  subscribeToMediaChanges,
} from "entities/media/model";
import { useUserSettings } from "features/settings/model";
import { startBrowseSynchronization } from "./browseSynchronization";
import { startServerActivityMonitor } from "features/server-activity/model";

export function usePlexSynchronization(sessionRevision: number) {
  const profileKey = useUserSettings((state) => state.profileKey);
  const serverId = useServerSession((state) => state.server?.machineIdentifier);
  useEffect(() => {
    const token = AuthStorage.getServerToken();
    if (!token || !profileKey || !serverId) return;
    const session = capturePlexSession();
    if (
      !session.scope ||
      !session.isCurrent() ||
      session.scope.serverId !== serverId ||
      session.scope.profileKey !== profileKey
    )
      return;
    let active = true;
    const isCurrent = () =>
      active &&
      session.isCurrent() &&
      AuthStorage.getServerToken() === token &&
      useUserSettings.getState().profileKey === profileKey &&
      useServerSession.getState().server?.machineIdentifier === serverId;
    const scope = { serverId, profileKey };
    const sync = startBrowseSynchronization(scope, isCurrent);
    const activity = startServerActivityMonitor(session);
    const unsubscribe = subscribeToMediaChanges((change) =>
      sync.enqueue(change),
    );
    const disconnect = connectPlexServerEvents(token, (event) => {
      if (!isCurrent()) return;
      activity.receive(event);
      if (event.type === "notification")
        parsePlexServerChanges(event.name, event.data).forEach((change) =>
          publishMediaChange(mediaChangeFromServer(change, scope)),
        );
      else if (event.state === "connected" && event.reconnected)
        publishMediaChange(
          mediaChangeFromServer({ kind: "server", reason: "reconnect" }, scope),
        );
    });
    return () => {
      active = false;
      sync.dispose();
      unsubscribe();
      disconnect();
      activity.dispose();
    };
  }, [profileKey, serverId, sessionRevision]);
}
