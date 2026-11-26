import type { CapturedPlexSession } from "features/session/model";
import { ConfirmDialog } from "shared/ui";
import type { ActivityTask } from "../model/activity";
import { useCancelActivity } from "../model/useCancelActivity";

export function CancelActivityDialog({
  task,
  session,
  onClose,
}: {
  task: ActivityTask;
  session: CapturedPlexSession;
  onClose: () => void;
}) {
  const action = useCancelActivity(task, session, onClose);
  return (
    <ConfirmDialog
      open
      title="Cancel task"
      message={`Ask Plex to cancel “${task.title}”?`}
      onClose={onClose}
      onConfirm={action.confirm}
      busy={action.busy}
      error={action.error}
      confirmLabel={action.error ? "Retry cancellation" : "Cancel task"}
      busyLabel="Cancelling…"
      confirmColor="error"
    />
  );
}
