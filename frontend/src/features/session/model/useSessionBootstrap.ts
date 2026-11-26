import { useEffect, useState } from "react";
import { useUserSettings } from "features/settings/model";
import { useAuthSession } from "./authSession";
import { plexProfileKey } from "./profileIdentity";
import { useServerSession } from "./serverSession";

export function useSessionBootstrap() {
  const profileKey = useAuthSession((state) =>
    state.status === "ready"
      ? plexProfileKey(state.ownerUser, state.activeProfile)
      : null,
  );
  const revision = useAuthSession((state) => state.revision);
  const status = useUserSettings((state) => state.status);
  const loadedProfileKey = useUserSettings((state) => state.profileKey);
  const error = useUserSettings((state) => state.error);
  const initialize = useUserSettings((state) => state.initialize);
  const serverStatus = useServerSession((state) => state.status);
  const serverProblem = useServerSession((state) => state.error);
  const [startedBootstrap, setStartedBootstrap] = useState<string | null>(null);
  const bootstrapKey = profileKey ? `${revision}:${profileKey}` : null;

  useEffect(() => {
    useUserSettings.getState().reset();
    useServerSession.getState().reset();
    setStartedBootstrap(bootstrapKey);
    if (profileKey) {
      void initialize(profileKey);
      void useServerSession.getState().refresh();
    }
    return () => {
      useUserSettings.getState().reset();
      useServerSession.getState().reset();
    };
  }, [bootstrapKey, initialize, profileKey]);

  const pending =
    !profileKey ||
    startedBootstrap !== bootstrapKey ||
    loadedProfileKey !== profileKey ||
    status === "idle" ||
    status === "loading" ||
    serverStatus === "idle" ||
    serverStatus === "loading";

  return {
    pending,
    error: !pending && status === "error" ? error : null,
    serverProblem:
      bootstrapKey && startedBootstrap === bootstrapKey ? serverProblem : null,
    serverFailed: serverStatus === "error",
    retryServer: () => {
      if (serverProblem?.recovery === "session")
        void useAuthSession.getState().initialize();
      else void useServerSession.getState().refresh();
    },
    retry: () => {
      if (profileKey) void initialize(profileKey);
    },
  };
}
