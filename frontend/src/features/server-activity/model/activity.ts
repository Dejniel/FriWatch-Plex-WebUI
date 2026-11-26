export interface ActivityTask {
  kind: "activity";
  id: string;
  title: string;
  subtitle?: string;
  progress?: number;
  cancellable: boolean;
}
export interface ConversionTask {
  kind: "conversion";
  id: string;
  title: string;
  progress?: number;
  speed?: number;
  remaining?: number;
  cancellable: false;
}
export type BackgroundTask = ActivityTask | ConversionTask;
export interface PlaybackSession {
  id: string;
  title: string;
  user?: string;
  player?: string;
  state?: string;
  mode: "Direct Play" | "Direct Stream" | "Transcode" | "Unknown";
  video?: string;
  audio?: string;
  resolution?: string;
  hardware: boolean;
  position?: number;
  duration?: number;
}
export type ActivityUpdate = {
  event: "started" | "updated" | "ended";
  id: string;
  task?: ActivityTask;
};

export function applyActivityUpdate(
  tasks: ActivityTask[],
  update: ActivityUpdate,
) {
  if (update.event === "ended")
    return tasks.filter((task) => task.id !== update.id);
  if (!update.task) return tasks;
  return tasks.some((task) => task.id === update.id)
    ? tasks.map((task) => (task.id === update.id ? update.task! : task))
    : [...tasks, update.task];
}
export const taskIdentity = (task: BackgroundTask) => `${task.kind}:${task.id}`;
