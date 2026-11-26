import {
  focusManager,
  QueryObserver,
  type QueryObserverResult,
} from "@tanstack/react-query";
import type {
  CapturedPlexSession,
  PlexServerEvent,
} from "features/session/model";
import { PlexRequestError } from "shared/api/PlexClient";
import { serverQueryClient } from "shared/api/queryClient";
import {
  activityError,
  createServerActivityApi,
  readActivityUpdate,
  readStatusNotice,
} from "../api/serverActivity";
import {
  applyActivityUpdate,
  taskIdentity,
  type ActivityTask,
  type ActivityUpdate,
  type BackgroundTask,
} from "./activity";
import {
  activityContext,
  activityKeys,
  rememberActivity,
  useActivityState,
} from "./activityState";

/** Owns the scoped Query subscriptions, notification reconciliation and recovery reads. */
export function startServerActivityMonitor(session: CapturedPlexSession) {
  const context = activityContext(session),
    keys = activityKeys(context);
  const api = createServerActivityApi(session);
  let active = true;
  const current = () => active && session.isCurrent();
  useActivityState.setState({ context, connection: "connecting", history: [] });
  const reads = new Set<Map<string, ActivityUpdate>>();
  async function activities(signal: AbortSignal) {
    // Full SSE records arriving during a snapshot are replayed over that snapshot.
    // These temporary journals exist only for in-flight reads, never as another cache.
    const updates = new Map<string, ActivityUpdate>();
    reads.add(updates);
    try {
      let tasks = await api.activities(signal);
      for (const update of updates.values())
        tasks = applyActivityUpdate(tasks, update);
      return tasks;
    } finally {
      reads.delete(updates);
    }
  }
  function trackEndings() {
    let previous = new Map<string, BackgroundTask>();
    return (tasks: BackgroundTask[]) => {
      const present = new Map(tasks.map((task) => [taskIdentity(task), task]));
      for (const [id, task] of previous)
        if (!present.has(id))
          rememberActivity(context, {
            id: `${id}:ended`,
            title: task.title,
            subtitle:
              task.kind === "activity" ? task.subtitle : "Media conversion",
            outcome: "ended",
          });
      previous = present;
    };
  }
  function observe<T>(
    kind: "activities" | "conversions" | "sessions",
    read: (signal: AbortSignal) => Promise<T[]>,
    onData?: (data: T[]) => void,
  ) {
    const observer = new QueryObserver(serverQueryClient, {
      queryKey: keys[kind],
      queryFn: ({ signal }) => read(signal),
      staleTime: 10_000,
      refetchOnWindowFocus: "always",
      refetchOnReconnect: true,
      refetchInterval: (query) => {
        const error = query.state.error;
        if (
          error instanceof PlexRequestError &&
          [401, 403, 404].includes(error.status)
        )
          return false;
        return useActivityState.getState().connection === "connected"
          ? query.state.data?.length
            ? 15_000
            : 60_000
          : 5_000;
      },
    });
    let previousData: T[] | undefined, lastError: unknown;
    const unsubscribe = observer.subscribe(
      (result: QueryObserverResult<T[]>) => {
        if (!current()) return;
        if (result.isError && result.error !== lastError) {
          lastError = result.error;
          rememberActivity(context, {
            id: `error:${kind}:${activityError(result.error)}`,
            title: `Could not refresh ${kind}`,
            subtitle: activityError(result.error),
            outcome: "error",
          });
        }
        if (!result.isSuccess || result.data === previousData) return;
        previousData = result.data;
        onData?.(result.data);
      },
    );
    return {
      observer,
      unsubscribe,
      connectionChanged: () => observer.setOptions({ ...observer.options }),
    };
  }
  const resources = {
    activities: observe("activities", activities, trackEndings()),
    conversions: observe("conversions", api.conversions, trackEndings()),
    sessions: observe("sessions", api.sessions),
  };
  const scheduled = new Map<
    keyof typeof resources,
    ReturnType<typeof setTimeout>
  >();
  function refresh(kind: keyof typeof resources) {
    if (!current() || scheduled.has(kind)) return;
    scheduled.set(
      kind,
      setTimeout(() => {
        scheduled.delete(kind);
        if (current() && focusManager.isFocused())
          void resources[kind].observer.refetch({ cancelRefetch: false });
      }, 750),
    );
  }
  return {
    receive(event: PlexServerEvent) {
      if (!current()) return;
      if (event.type === "connection") {
        useActivityState.setState({ connection: event.state });
        // Re-evaluate fallback intervals as soon as the connection changes.
        Object.values(resources).forEach((resource) =>
          resource.connectionChanged(),
        );
        if (event.state === "connected" && event.reconnected)
          Object.keys(resources).forEach((kind) =>
            refresh(kind as keyof typeof resources),
          );
        return;
      }
      if (event.name === "activity") {
        const update = readActivityUpdate(event.data);
        if (!update) {
          refresh("activities");
          return;
        }
        const task =
          update.task ??
          serverQueryClient
            .getQueryData<ActivityTask[]>(keys.activities)
            ?.find((task) => task.id === update.id) ??
          [...reads]
            .map((journal) => journal.get(update.id)?.task)
            .find(Boolean);
        if (update.event === "ended" && task)
          rememberActivity(context, {
            id: `${taskIdentity(task)}:ended`,
            title: task.title,
            subtitle: task.subtitle,
            outcome: "ended",
          });
        reads.forEach((journal) => journal.set(update.id, update));
        serverQueryClient.setQueryData<ActivityTask[]>(
          keys.activities,
          (tasks) => (tasks ? applyActivityUpdate(tasks, update) : undefined),
        );
      } else if (event.name === "playing") refresh("sessions");
      else if (event.name === "transcodeSession.update") {
        refresh("sessions");
        refresh("conversions");
      } else if (event.name === "backgroundProcessingQueue")
        refresh("conversions");
      else if (event.name === "status") {
        const notice = readStatusNotice(event.data);
        if (notice)
          rememberActivity(context, {
            ...notice,
            id: `notice:${notice.title}:${notice.subtitle ?? ""}`,
            outcome: "notice",
          });
      }
    },
    dispose() {
      active = false;
      scheduled.forEach(clearTimeout);
      Object.values(resources).forEach(({ observer, unsubscribe }) => {
        unsubscribe();
        observer.destroy();
      });
      void serverQueryClient.cancelQueries({ queryKey: keys.all });
      if (useActivityState.getState().context === context)
        useActivityState.setState({
          context: null,
          connection: "connecting",
          history: [],
        });
    },
  };
}
