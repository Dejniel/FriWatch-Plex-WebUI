import { create } from "zustand";
import type { CapturedPlexSession } from "features/session/model";

export type HistoryOutcome = "ended" | "cancel-requested" | "notice" | "error";
export interface ActivityHistoryEntry {
  id: string;
  title: string;
  subtitle?: string;
  outcome: HistoryOutcome;
  at: number;
}
export type ActivityConnection =
  "connecting" | "connected" | "disconnected" | "unavailable";
export const activityContext = (
  session: Pick<CapturedPlexSession, "scope" | "revision">,
) =>
  JSON.stringify([
    session.scope?.serverId,
    session.scope?.profileKey,
    session.revision,
  ]);
export const activityKeys = (context: string) => ({
  all: ["server-activity", context] as const,
  activities: ["server-activity", context, "activities"] as const,
  conversions: ["server-activity", context, "conversions"] as const,
  sessions: ["server-activity", context, "sessions"] as const,
});

/** Only connection state and observed history live here; Query owns current server data. */
export const useActivityState = create<{
  context: string | null;
  connection: ActivityConnection;
  history: ActivityHistoryEntry[];
}>(() => ({ context: null, connection: "connecting", history: [] }));

export function rememberActivity(
  context: string,
  entry: Omit<ActivityHistoryEntry, "at">,
) {
  useActivityState.setState((state) =>
    state.context !== context ||
    state.history.some((item) => item.id === entry.id)
      ? state
      : {
          history: [{ ...entry, at: Date.now() }, ...state.history].slice(
            0,
            100,
          ),
        },
  );
}
