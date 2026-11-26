import { useQuery } from "@tanstack/react-query";
import {
  capturePlexSession,
  useActiveServerScope,
  useAuthSession,
} from "features/session/model";
import { serverQueryClient } from "shared/api/queryClient";
import { activityError } from "../api/serverActivity";
import type { ActivityTask, ConversionTask, PlaybackSession } from "./activity";
import {
  activityContext,
  activityKeys,
  useActivityState,
} from "./activityState";

/** Read-only observers share the runtime's queries and do not start another poller. */
export function useServerActivity() {
  const scope = useActiveServerScope();
  const revision = useAuthSession((state) => state.revision);
  const session = capturePlexSession();
  const context = activityContext({ scope, revision }),
    keys = activityKeys(context);
  const activities = useQuery<ActivityTask[]>(
    { queryKey: keys.activities, enabled: false },
    serverQueryClient,
  );
  const conversions = useQuery<ConversionTask[]>(
    { queryKey: keys.conversions, enabled: false },
    serverQueryClient,
  );
  const sessions = useQuery<PlaybackSession[]>(
    { queryKey: keys.sessions, enabled: false },
    serverQueryClient,
  );
  const state = useActivityState();
  const resources = [
    { name: "Background tasks", query: activities },
    { name: "Conversions", query: conversions },
    { name: "Playback", query: sessions },
  ];
  return {
    session,
    context,
    tasks: [...(activities.data ?? []), ...(conversions.data ?? [])],
    sessions: sessions.data ?? [],
    connection: state.context === context ? state.connection : "connecting",
    history: state.context === context ? state.history : [],
    loading: resources.some(({ query }) => query.isPending),
    tasksLoading: activities.isPending || conversions.isPending,
    playbackLoading: sessions.isPending,
    errors: resources
      .filter(({ query }) => query.isError)
      .map(({ name, query }) => ({
        name,
        message: activityError(query.error),
        retry: () => void query.refetch({ cancelRefetch: false }),
      })),
  };
}
