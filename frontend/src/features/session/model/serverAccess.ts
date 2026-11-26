import { useAuthSession } from "./authSession";
import { useServerSession } from "./serverSession";

export function canManageServer(
  isUnrestrictedProfile: boolean,
  hasServerPermission: boolean,
) {
  return isUnrestrictedProfile && hasServerPermission;
}

export function useCanManageServer() {
  const isUnrestrictedProfile = useAuthSession((state) =>
    Boolean(state.activeUser && !state.activeUser.restricted),
  );
  const hasServerPermission = useServerSession(
    (state) => state.canManageServer,
  );
  return canManageServer(isUnrestrictedProfile, hasServerPermission);
}

function deletionProfile(auth: ReturnType<typeof useAuthSession.getState>) {
  return (
    auth.status === "ready" &&
    Boolean(auth.activeUser && !auth.activeUser.restricted)
  );
}
function deletionAllowed(server: ReturnType<typeof useServerSession.getState>) {
  return server.canManageServer && server.server?.allowMediaDeletion === true;
}

/** Plex's active-token permissions govern deletion; the login account's Home
 * isOwner marker does not establish ownership of the connected server. */
export function canDeleteMedia() {
  return (
    deletionProfile(useAuthSession.getState()) &&
    deletionAllowed(useServerSession.getState())
  );
}
export function useCanDeleteMedia() {
  const profile = useAuthSession(deletionProfile);
  const allowed = useServerSession(deletionAllowed);
  return profile && allowed;
}
