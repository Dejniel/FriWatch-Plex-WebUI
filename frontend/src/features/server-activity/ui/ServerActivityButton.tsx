import { keyframes } from "@emotion/react";
import { GraphicEqRounded } from "@mui/icons-material";
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  LinearProgress,
  Popover,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { taskIdentity } from "../model/activity";
import { useServerActivity } from "../model/useServerActivity";
import {
  ActivityList,
  ActivityPlaybackRow,
  ActivityTaskRow,
} from "./ActivityItems";

const turn = keyframes`to { transform: rotate(360deg); }`;

export function ServerActivityButton() {
  const model = useServerActivity();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const id = useId(),
    location = useLocation();
  useEffect(() => setAnchor(null), [location, model.context]);
  const taskCount = model.tasks.length,
    playbackCount = model.sessions.length;
  const tasks = model.tasks.slice(0, 4),
    sessions = model.sessions.slice(0, 5 - tasks.length);
  const counts = `Tasks: ${taskCount} · Playing: ${playbackCount}`;
  return (
    <>
      <Tooltip title={counts}>
        <IconButton
          aria-label="Open activity"
          aria-expanded={Boolean(anchor)}
          aria-controls={anchor ? id : undefined}
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <Badge
            badgeContent={taskCount + playbackCount}
            color="primary"
            max={99}
          >
            <Box
              sx={{
                position: "relative",
                display: "flex",
                color: taskCount || playbackCount ? "primary.main" : "inherit",
              }}
            >
              <GraphicEqRounded />
              {taskCount > 0 && (
                <Box
                  data-testid="activity-busy"
                  aria-hidden
                  sx={{
                    position: "absolute",
                    inset: -5,
                    border: "2px solid transparent",
                    borderTopColor: "primary.main",
                    borderRightColor: "primary.main",
                    borderRadius: "50%",
                    animation: `${turn} 1.8s linear infinite`,
                    "@media (prefers-reduced-motion: reduce)": {
                      animation: "none",
                    },
                  }}
                />
              )}
            </Box>
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        id={id}
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            role: "region",
            "aria-label": "Current activity",
            sx: {
              width: "25rem",
              maxWidth: "calc(100vw - 24px)",
              maxHeight: "75dvh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              p: 2,
            },
          },
        }}
      >
        <Typography variant="h6" component="h2">
          Activity
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {counts}
        </Typography>
        <Box sx={{ minHeight: 0, overflowY: "auto" }}>
          {model.loading && (
            <LinearProgress aria-label="Loading activity" sx={{ mt: 1 }} />
          )}
          {(model.errors.length > 0 || model.connection === "disconnected") && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              Activity may be out of date. See the full activity page for
              details.
            </Alert>
          )}
          {tasks.length > 0 && (
            <>
              <Typography variant="subtitle2" sx={{ mt: 2 }}>
                Background tasks
              </Typography>
              <ActivityList>
                {tasks.map((task) => (
                  <ActivityTaskRow key={taskIdentity(task)} task={task} />
                ))}
              </ActivityList>
            </>
          )}
          {sessions.length > 0 && (
            <>
              <Typography variant="subtitle2" sx={{ mt: 2 }}>
                Now playing
              </Typography>
              <ActivityList>
                {sessions.map((session) => (
                  <ActivityPlaybackRow
                    key={session.id}
                    session={session}
                    compact
                  />
                ))}
              </ActivityList>
            </>
          )}
          {!model.loading &&
            !taskCount &&
            !playbackCount &&
            !model.errors.length && (
              <Typography color="text.secondary" sx={{ py: 3 }}>
                No current activity.
              </Typography>
            )}
        </Box>
        <Divider sx={{ mt: 1, mb: 1.5 }} />
        <Button
          component={Link}
          to="/activity"
          fullWidth
          sx={{ flexShrink: 0 }}
          onClick={() => setAnchor(null)}
        >
          View activity
        </Button>
      </Popover>
    </>
  );
}
