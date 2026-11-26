import { type CapturedPlexSession } from "features/session/model";
import { PlexClient, PlexRequestError } from "shared/api/PlexClient";
import {
  plexArray,
  plexBoolean,
  plexContainer,
  plexInteger,
  plexObject,
  PlexResponseError,
} from "shared/api/plexResponse";
import type {
  ActivityTask,
  ActivityUpdate,
  ConversionTask,
  PlaybackSession,
} from "../model/activity";

const resource = "server activity";
const object = (value: unknown) => plexObject(value, resource);
const optionalObject = (value: unknown) =>
  value === undefined ? {} : object(value);
const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;
function identity(value: unknown) {
  const id =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : text(value);
  if (!id?.trim()) throw new PlexResponseError(resource);
  return id;
}
function number(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new PlexResponseError(resource);
  return value;
}
function progress(value: unknown) {
  const parsed = number(value);
  return parsed === undefined || parsed < 0 ? undefined : Math.min(100, parsed);
}
function readActivity(value: unknown): ActivityTask {
  const row = object(value);
  return {
    kind: "activity",
    id: identity(row.uuid),
    title: identity(row.title),
    subtitle: text(row.subtitle),
    progress: progress(row.progress),
    cancellable:
      row.cancellable === undefined
        ? false
        : plexBoolean(row.cancellable, resource),
  };
}
function rows(value: unknown, field: string) {
  const container = plexContainer(value, resource);
  const entries = plexArray(container[field], resource);
  if (
    (container[field] === undefined && container.size !== 0) ||
    (container.size !== undefined &&
      plexInteger(container.size, resource) !== entries.length)
  )
    throw new PlexResponseError(resource);
  return entries;
}
export const readActivities = (value: unknown) =>
  rows(value, "Activity").map(readActivity);
export function readConversions(value: unknown): ConversionTask[] {
  return rows(value, "TranscodeJob").map((value) => {
    const row = object(value);
    return {
      kind: "conversion",
      id: identity(row.key),
      title: identity(row.title),
      progress: progress(row.progress),
      speed: number(row.speed),
      remaining: number(row.remaining),
      cancellable: false,
    };
  });
}
export function readPlaybackSessions(value: unknown): PlaybackSession[] {
  return rows(value, "Metadata").map((value) => {
    const row = object(value);
    const session = optionalObject(row.Session),
      player = optionalObject(row.Player),
      user = optionalObject(row.User);
    const transcode = optionalObject(row.TranscodeSession);
    const versions = plexArray(row.Media, resource).map(object);
    const media =
      versions.find((item) => item.selected === true || item.selected === 1) ??
      versions[0] ??
      {};
    const parts = plexArray(media.Part, resource).map(object);
    const part =
      parts.find((item) => item.selected === true || item.selected === 1) ??
      parts[0] ??
      {};
    const decisions = [
      transcode.videoDecision,
      transcode.audioDecision,
      part.decision,
    ];
    const mode = decisions.includes("transcode")
      ? "Transcode"
      : decisions.includes("copy") || decisions.includes("directstream")
        ? "Direct Stream"
        : decisions.includes("directplay")
          ? "Direct Play"
          : "Unknown";
    const codec = (source: unknown, target: unknown) => {
      const from = text(source)?.toUpperCase(),
        to = text(target)?.toUpperCase();
      return from && to && from !== to ? `${from} → ${to}` : to || from;
    };
    const width = number(transcode.width ?? media.width),
      height = number(transcode.height ?? media.height);
    return {
      id: identity(session.id ?? row.sessionKey),
      title: [text(row.grandparentTitle), identity(row.title)]
        .filter(Boolean)
        .join(" · "),
      user: text(user.title),
      player: text(player.title) || text(player.product),
      state: text(player.state),
      mode,
      video: codec(
        transcode.sourceVideoCodec ?? media.videoCodec,
        transcode.videoCodec,
      ),
      audio: codec(
        transcode.sourceAudioCodec ?? media.audioCodec,
        transcode.audioCodec,
      ),
      resolution: width && height ? `${width} × ${height}` : undefined,
      hardware: Boolean(
        text(transcode.transcodeHwEncoding) ||
        text(transcode.transcodeHwDecoding),
      ),
      position: number(row.viewOffset),
      duration: number(row.duration),
    };
  });
}
/** SSE activities carry complete task records; an end may contain only its UUID. */
export function readActivityUpdate(data: string): ActivityUpdate | null {
  try {
    const row = object(object(JSON.parse(data)).ActivityNotification);
    if (!["started", "updated", "ended"].includes(String(row.event)))
      return null;
    const id = identity(row.uuid);
    const task =
      row.Activity === undefined ? undefined : readActivity(row.Activity);
    if ((task && task.id !== id) || (row.event !== "ended" && !task))
      return null;
    return { event: row.event as ActivityUpdate["event"], id, task };
  } catch {
    return null;
  }
}
export function readStatusNotice(data: string) {
  try {
    const row = object(object(JSON.parse(data)).StatusNotification);
    return { title: identity(row.title), subtitle: text(row.description) };
  } catch {
    return null;
  }
}
export function activityError(error: unknown) {
  if (error instanceof PlexRequestError) {
    if (error.status === 401 || error.status === 403)
      return "Your Plex account cannot access this activity.";
    if (error.status === 404)
      return "This activity is no longer available in Plex.";
    return `Plex could not load or update this activity (HTTP ${error.status}).`;
  }
  return error instanceof Error
    ? error.message
    : "Plex could not load or update this activity.";
}
export function createServerActivityApi(session: CapturedPlexSession) {
  const client = new PlexClient(() => session.token);
  async function read<T>(
    path: string,
    decode: (value: unknown) => T,
    signal: AbortSignal,
  ) {
    session.assertCurrent(signal);
    const response = await client.get(path, signal);
    session.assertCurrent(signal);
    return decode(response);
  }
  const activities = (signal: AbortSignal) =>
    read("/activities", readActivities, signal);
  return {
    activities,
    conversions: (signal: AbortSignal) =>
      read("/status/sessions/background", readConversions, signal),
    sessions: (signal: AbortSignal) =>
      read("/status/sessions", readPlaybackSessions, signal),
    async cancel(task: ActivityTask, signal: AbortSignal) {
      const current = (await activities(signal)).find(
        (item) => item.id === task.id,
      );
      if (!current) return false;
      if (!current.cancellable)
        throw new Error("Plex does not allow this task to be cancelled.");
      session.assertCurrent(signal);
      try {
        await client.delete(
          `/activities/${encodeURIComponent(task.id)}`,
          signal,
        );
      } catch (error) {
        if (error instanceof PlexRequestError && error.status === 404) {
          session.assertCurrent(signal);
          return false;
        }
        throw error;
      }
      session.assertCurrent(signal);
      return true;
    },
  };
}
