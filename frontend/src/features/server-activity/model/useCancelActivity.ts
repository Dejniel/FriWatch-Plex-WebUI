import { useEffect, useMemo, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import type { CapturedPlexSession } from "features/session/model";
import { serverQueryClient } from "shared/api/queryClient";
import { activityError, createServerActivityApi } from "../api/serverActivity";
import { taskIdentity, type ActivityTask } from "./activity";
import {
  activityContext,
  activityKeys,
  rememberActivity,
} from "./activityState";

export function useCancelActivity(
  task: ActivityTask,
  session: CapturedPlexSession,
  onClose: () => void,
) {
  const api = useMemo(() => createServerActivityApi(session), [session]);
  const context = activityContext(session);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const mutation = useMutation(
    {
      mutationKey: [...activityKeys(context).all, "cancel", task.id],
      retry: false,
      gcTime: 0,
      mutationFn: async (signal: AbortSignal) => {
        try {
          session.assertCurrent(signal);
          const submitted = await api.cancel(task, signal);
          rememberActivity(context, {
            id: `${taskIdentity(task)}:${submitted ? "cancel-requested" : "ended"}`,
            title: task.title,
            subtitle: task.subtitle,
            outcome: submitted ? "cancel-requested" : "ended",
          });
        } finally {
          // A submitted request can outlive its dialog; reconcile its captured scope.
          void serverQueryClient.invalidateQueries(
            { queryKey: activityKeys(context).activities },
            { cancelRefetch: false },
          );
          if (request.current?.signal === signal) request.current = null;
        }
        if (session.isCurrent() && !signal.aborted) onClose();
      },
    },
    serverQueryClient,
  );
  return {
    busy: mutation.isPending,
    error: mutation.error ? activityError(mutation.error) : null,
    confirm: () => {
      if (request.current) return;
      const operation = new AbortController();
      request.current = operation;
      mutation.mutate(operation.signal);
    },
  };
}
