import {
  AuthStorage,
  capturePlexSession,
  useAuthSession,
  useServerSession,
} from "features/session/model";
import { ProxiedRequest } from "shared/api/backend";
import { PlexResponseError } from "shared/api/plexResponse";
import {
  createServerActivityApi,
  readActivities,
  readActivityUpdate,
  readConversions,
  readPlaybackSessions,
  readStatusNotice,
} from "./serverActivity";

vi.mock("shared/api/backend", () => ({
  ProxiedRequest: vi.fn(),
  getBackendURL: () => "",
}));
const transport = vi.mocked(ProxiedRequest);
const raw = {
  uuid: "task-1",
  title: "Scanning films",
  subtitle: "Arrival",
  progress: 42,
  cancellable: true,
};
const task = {
  kind: "activity" as const,
  id: raw.uuid,
  title: raw.title,
  subtitle: raw.subtitle,
  progress: 42,
  cancellable: true,
};
const envelope = (key: string, rows: unknown[]) => ({
  MediaContainer: { size: rows.length, [key]: rows },
});
beforeEach(() => {
  vi.resetAllMocks();
  AuthStorage.saveActiveSession({
    profile: null,
    accountToken: "account",
    serverToken: "captured-token",
  });
  useAuthSession.setState({
    status: "ready",
    revision: 1,
    ownerUser: { id: 1 } as Plex.UserData,
    activeProfile: {
      id: 2,
      title: "Profile",
      isOwner: false,
      restricted: false,
      protected: false,
    },
  });
  useServerSession.setState({
    server: { machineIdentifier: "server" } as Plex.ServerPreferences,
  });
  transport.mockResolvedValue({
    status: 200,
    data: envelope("Activity", [raw]),
  });
});

it("reads real PMS activity envelopes and absent progress without inventing values", () => {
  expect(readActivities(envelope("Activity", [raw]))).toEqual([task]);
  expect(readActivities({ MediaContainer: { size: 0 } })).toEqual([]);
  expect(
    readActivities(envelope("Activity", [{ ...raw, progress: -1 }]))[0]
      .progress,
  ).toBeUndefined();
  expect(
    readConversions(
      envelope("TranscodeJob", [
        {
          key: "/transcode/sessions/one",
          title: "Film",
          progress: 12.5,
          speed: 2.1,
          remaining: 50,
        },
      ]),
    )[0],
  ).toMatchObject({
    kind: "conversion",
    progress: 12.5,
    speed: 2.1,
    remaining: 50,
    cancellable: false,
  });
});

it.each([
  {},
  { MediaContainer: { size: 1 } },
  envelope("Activity", [{ ...raw, uuid: "" }]),
  envelope("Activity", [{ ...raw, progress: "50" }]),
  envelope("Activity", [{ ...raw, cancellable: "yes" }]),
  { MediaContainer: { size: 2, Activity: [raw] } },
])(
  "rejects invalid snapshots instead of treating tasks as ended: %j",
  (value) => {
    expect(() => readActivities(value)).toThrow(PlexResponseError);
  },
);

it("decodes native activity start/update/end frames and rejects mismatched identities", () => {
  const frame = {
    ActivityNotification: { event: "updated", uuid: raw.uuid, Activity: raw },
  };
  expect(readActivityUpdate(JSON.stringify(frame))).toEqual({
    event: "updated",
    id: raw.uuid,
    task,
  });
  expect(
    readActivityUpdate(
      JSON.stringify({
        ActivityNotification: { event: "ended", uuid: raw.uuid },
      }),
    ),
  ).toEqual({ event: "ended", id: raw.uuid });
  expect(
    readActivityUpdate(
      JSON.stringify({
        ActivityNotification: { ...frame.ActivityNotification, uuid: "other" },
      }),
    ),
  ).toBeNull();
  expect(readActivityUpdate("bad JSON")).toBeNull();
  expect(
    readActivityUpdate(
      JSON.stringify({
        ActivityNotification: { event: "updated", uuid: raw.uuid },
      }),
    ),
  ).toBeNull();
  expect(
    readStatusNotice(
      JSON.stringify({
        StatusNotification: { title: "Scanning", description: "Films" },
      }),
    ),
  ).toEqual({ title: "Scanning", subtitle: "Films" });
});

it("separates playbacks by session ID and reads conversion decisions from the selected rendition", () => {
  const item = {
    sessionKey: "fallback",
    title: "Episode",
    grandparentTitle: "Show",
    duration: 60000,
    viewOffset: 1000,
    Session: { id: "session" },
    Player: { title: "Browser", state: "paused" },
    User: { title: "Person" },
    Media: [
      { videoCodec: "hevc" },
      {
        selected: true,
        videoCodec: "h264",
        audioCodec: "flac",
        Part: [{ decision: "transcode" }],
      },
    ],
    TranscodeSession: {
      videoDecision: "transcode",
      audioDecision: "copy",
      videoCodec: "h264",
      sourceVideoCodec: "av1",
      audioCodec: "flac",
      transcodeHwEncoding: "vaapi",
      width: 1280,
      height: 720,
    },
  };
  expect(readPlaybackSessions(envelope("Metadata", [item]))).toEqual([
    {
      id: "session",
      title: "Show · Episode",
      user: "Person",
      player: "Browser",
      state: "paused",
      mode: "Transcode",
      video: "AV1 → H264",
      audio: "FLAC",
      resolution: "1280 × 720",
      hardware: true,
      position: 1000,
      duration: 60000,
    },
  ]);
  expect(
    readPlaybackSessions(
      envelope("Metadata", [
        {
          title: "Song",
          sessionKey: 7,
          Media: [{ Part: [{ decision: "directplay" }] }],
        },
      ]),
    )[0].mode,
  ).toBe("Direct Play");
  expect(
    readPlaybackSessions(
      envelope("Metadata", [
        {
          title: "Song",
          sessionKey: 7,
          TranscodeSession: { audioDecision: "copy" },
        },
      ]),
    )[0].mode,
  ).toBe("Direct Stream");
  expect(() =>
    readPlaybackSessions(envelope("Metadata", [{ title: "Film" }])),
  ).toThrow(PlexResponseError);
});

it("rechecks cancellability and uses only its captured token for cancellation", async () => {
  const api = createServerActivityApi(capturePlexSession());
  transport.mockResolvedValueOnce({
    status: 200,
    data: envelope("Activity", [raw]),
  });
  transport.mockResolvedValueOnce({ status: 200, data: "" });
  await expect(api.cancel(task, new AbortController().signal)).resolves.toBe(
    true,
  );
  expect(transport.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    ["/activities", "GET"],
    ["/activities/task-1", "DELETE"],
  ]);
  expect(
    transport.mock.calls.every(
      (call) => call[2]?.["X-Plex-Token"] === "captured-token",
    ),
  ).toBe(true);
});

it("does not submit cancellation for an ended or no longer cancellable task", async () => {
  const api = createServerActivityApi(capturePlexSession()),
    signal = new AbortController().signal;
  transport.mockResolvedValueOnce({
    status: 200,
    data: envelope("Activity", []),
  });
  await expect(api.cancel(task, signal)).resolves.toBe(false);
  transport.mockResolvedValueOnce({
    status: 200,
    data: envelope("Activity", [{ ...raw, cancellable: false }]),
  });
  await expect(api.cancel(task, signal)).rejects.toThrow("does not allow");
  expect(transport.mock.calls.some((call) => call[1] === "DELETE")).toBe(false);
});

it("rejects a profile change during preflight before sending a write", async () => {
  const api = createServerActivityApi(capturePlexSession());
  transport.mockImplementation(async () => {
    useAuthSession.setState({ revision: 2 });
    return { status: 200, data: envelope("Activity", [raw]) };
  });
  await expect(api.cancel(task, new AbortController().signal)).rejects.toThrow(
    "session changed",
  );
  expect(transport).toHaveBeenCalledTimes(1);
});

it("does not claim cancellation when the task ends between preflight and DELETE", async () => {
  const api = createServerActivityApi(capturePlexSession());
  transport.mockResolvedValueOnce({
    status: 200,
    data: envelope("Activity", [raw]),
  });
  transport.mockResolvedValueOnce({ status: 404, data: "" });
  await expect(api.cancel(task, new AbortController().signal)).resolves.toBe(
    false,
  );
});
