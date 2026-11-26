import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { CONTENT_COLUMN_WIDTH, PAGE_GUTTER } from "shared/ui/layout";
import { taskIdentity, type ActivityTask } from "../model/activity";
import type { HistoryOutcome } from "../model/activityState";
import { useServerActivity } from "../model/useServerActivity";
import {
  ActivityList,
  ActivityPlaybackRow,
  ActivityTaskRow,
} from "./ActivityItems";
import { CancelActivityDialog } from "./CancelActivityDialog";

const outcomes: Record<HistoryOutcome, string> = {
  ended: "Ended",
  "cancel-requested": "Cancellation requested",
  notice: "Notice",
  error: "Error",
};
const panelSx = { p: { xs: 2, sm: 3 }, mb: 3 };

export function ServerActivityScreen() {
  const model = useServerActivity();
  const [selection, setSelection] = useState<{
    task: ActivityTask;
    context: string;
    session: typeof model.session;
  } | null>(null);
  useEffect(() => setSelection(null), [model.context]);
  return (
    <Box
      sx={{
        pt: { xs: 11, md: 13 },
        pb: 4,
        px: PAGE_GUTTER,
        maxWidth: CONTENT_COLUMN_WIDTH,
        mx: "auto",
      }}
    >
      <Typography variant="h4" component="h1" sx={{ mb: 1 }}>
        Activity
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Server tasks and current playback
      </Typography>
      {model.loading && (
        <LinearProgress aria-label="Loading activity" sx={{ mb: 2 }} />
      )}
      {(model.connection === "disconnected" ||
        model.connection === "unavailable") && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Live updates are unavailable. Activity is being checked periodically.
        </Alert>
      )}
      {model.errors.map((error) => (
        <Alert
          key={error.name}
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" onClick={error.retry}>
              Retry
            </Button>
          }
        >
          {error.name}: {error.message}
        </Alert>
      ))}
      <Paper
        component="section"
        aria-label="Background tasks"
        variant="outlined"
        sx={panelSx}
      >
        <Typography variant="h6" component="h2">
          Background tasks ({model.tasks.length})
        </Typography>
        <ActivityList>
          {model.tasks.map((task) => {
            const requested = model.history.some(
              (entry) => entry.id === `${taskIdentity(task)}:cancel-requested`,
            );
            return (
              <ActivityTaskRow
                key={taskIdentity(task)}
                task={task}
                action={
                  task.kind === "activity" && task.cancellable ? (
                    <Button
                      size="small"
                      sx={{ whiteSpace: "nowrap", flexShrink: 0 }}
                      disabled={requested}
                      onClick={() =>
                        setSelection({
                          task,
                          context: model.context,
                          session: model.session,
                        })
                      }
                    >
                      {requested ? "Cancellation requested" : "Cancel task"}
                    </Button>
                  ) : undefined
                }
              />
            );
          })}
        </ActivityList>
        {!model.tasks.length && (
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            {model.tasksLoading
              ? "Loading tasks…"
              : model.errors.some((error) => error.name !== "Playback")
                ? "Task information is unavailable."
                : "No active background tasks."}
          </Typography>
        )}
      </Paper>
      <Paper
        component="section"
        aria-label="Now playing"
        variant="outlined"
        sx={panelSx}
      >
        <Typography variant="h6" component="h2">
          Now playing ({model.sessions.length})
        </Typography>
        <ActivityList>
          {model.sessions.map((session) => (
            <ActivityPlaybackRow key={session.id} session={session} />
          ))}
        </ActivityList>
        {!model.sessions.length && (
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            {model.playbackLoading
              ? "Loading playback…"
              : model.errors.some((error) => error.name === "Playback")
                ? "Playback information is unavailable."
                : "Nothing is playing."}
          </Typography>
        )}
      </Paper>
      <Paper
        component="section"
        aria-label="Recent activity"
        variant="outlined"
        sx={panelSx}
      >
        <Typography variant="h6" component="h2">
          Recent activity
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Events observed in this session, until you reload or switch profiles.
          Ended tasks may not report their result.
        </Typography>
        <ActivityList>
          {model.history.map((entry) => (
            <Box
              key={entry.id}
              component="li"
              sx={{
                py: 1.5,
                borderBottom: "1px solid",
                borderColor: "divider",
                "&:last-child": { borderBottom: 0 },
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 1,
                  alignItems: "center",
                }}
              >
                <Chip
                  size="small"
                  variant="outlined"
                  label={outcomes[entry.outcome]}
                  color={entry.outcome === "error" ? "error" : "default"}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="time"
                  dateTime={new Date(entry.at).toISOString()}
                >
                  {new Date(entry.at).toLocaleTimeString()}
                </Typography>
              </Box>
              <Typography
                sx={{ mt: 0.75, fontWeight: 600, overflowWrap: "anywhere" }}
              >
                {entry.title}
              </Typography>
              {entry.subtitle && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ overflowWrap: "anywhere" }}
                >
                  {entry.subtitle}
                </Typography>
              )}
            </Box>
          ))}
        </ActivityList>
        {!model.history.length && (
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            No recent activity.
          </Typography>
        )}
      </Paper>
      {selection && selection.context === model.context && (
        <CancelActivityDialog
          task={selection.task}
          session={selection.session}
          onClose={() => setSelection(null)}
        />
      )}
    </Box>
  );
}
