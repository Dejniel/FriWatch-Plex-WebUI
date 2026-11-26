import { Box, Chip, LinearProgress, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { durationToText } from "shared/lib/duration";
import type { BackgroundTask, PlaybackSession } from "../model/activity";

const rowSx = {
  py: 1.5,
  minWidth: 0,
  overflowWrap: "anywhere" as const,
  borderBottom: "1px solid",
  borderColor: "divider",
  "&:last-child": { borderBottom: 0 },
};
const progressSx = {
  mt: 1,
  "@media (prefers-reduced-motion: reduce)": {
    "& .MuiLinearProgress-bar": { animation: "none" },
  },
};

export function ActivityTaskRow({
  task,
  action,
}: {
  task: BackgroundTask;
  action?: ReactNode;
}) {
  const subtitle =
    task.kind === "activity"
      ? task.subtitle
      : [
          "Optimizing media",
          task.speed !== undefined && `${task.speed.toFixed(1)}× speed`,
          task.remaining !== undefined &&
            task.remaining >= 0 &&
            `${durationToText(task.remaining * 1000)} remaining`,
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <Box component="li" sx={rowSx}>
      <Box
        sx={{
          display: "flex",
          alignItems: "start",
          gap: 1,
          justifyContent: "space-between",
        }}
      >
        <Typography sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
          {task.title}
        </Typography>
        {action}
      </Box>
      {subtitle && (
        <Typography variant="body2" color="text.secondary">
          {subtitle}
        </Typography>
      )}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <LinearProgress
          aria-label={`Progress for ${task.title}`}
          variant={
            task.progress === undefined ? "indeterminate" : "determinate"
          }
          value={task.progress}
          sx={{ ...progressSx, flex: 1 }}
        />
        {task.progress !== undefined && (
          <Typography variant="caption" sx={{ mt: 1 }}>
            {Math.round(task.progress)}%
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export function ActivityPlaybackRow({
  session,
  compact = false,
}: {
  session: PlaybackSession;
  compact?: boolean;
}) {
  return (
    <Box component="li" sx={rowSx}>
      <Typography sx={{ fontWeight: 600 }}>{session.title}</Typography>
      <Typography variant="body2" color="text.secondary">
        {[session.user, session.player, session.state]
          .filter(Boolean)
          .join(" · ")}
      </Typography>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 1,
          mt: 0.75,
        }}
      >
        <Chip
          size="small"
          variant="outlined"
          label={session.mode === "Unknown" ? "Playback" : session.mode}
        />
        {session.hardware && (
          <Chip size="small" variant="outlined" label="Hardware" />
        )}
        {!compact && (
          <Typography variant="body2" color="text.secondary">
            {[session.video, session.audio, session.resolution]
              .filter(Boolean)
              .join(" · ")}
          </Typography>
        )}
      </Box>
      {!compact &&
        session.duration !== undefined &&
        session.duration > 0 &&
        session.position !== undefined && (
          <>
            <LinearProgress
              aria-label={`Playback position for ${session.title}`}
              variant="determinate"
              value={Math.max(
                0,
                Math.min(100, (session.position / session.duration) * 100),
              )}
              sx={progressSx}
            />
            <Typography variant="caption" color="text.secondary">
              {durationToText(session.position)} /{" "}
              {durationToText(session.duration)}
            </Typography>
          </>
        )}
    </Box>
  );
}

export function ActivityList({ children }: { children: ReactNode }) {
  return (
    <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
      {children}
    </Box>
  );
}
