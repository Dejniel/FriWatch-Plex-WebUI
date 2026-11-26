import { useAuthSession } from "./authSession";
import { useServerSession } from "./serverSession";
import { canManageServer, canDeleteMedia } from "./serverAccess";

it("allows server management only to an unrestricted profile with the Plex manage capability", () => {
  expect(canManageServer(true, true)).toBe(true);
  expect(canManageServer(true, false)).toBe(false);
  expect(canManageServer(false, true)).toBe(false);
  expect(canManageServer(false, false)).toBe(false);
});

it("uses active Plex permissions rather than the login account's Home owner marker", () => {
  const previousAuth = useAuthSession.getState();
  const previousServer = useServerSession.getState();
  try {
    useAuthSession.setState({ status: "ready", activeUser: { id: 1, restricted: false } as Plex.UserData,
      activeProfile: { id: 1, title: "Owner", isOwner: true, restricted: false, protected: false },
    });
    useServerSession.setState({ canManageServer: true, server: { allowMediaDeletion: true } as Plex.ServerPreferences });
    expect(canDeleteMedia()).toBe(true);
    useAuthSession.setState({ activeProfile: { ...useAuthSession.getState().activeProfile!, isOwner: false } });
    expect(canDeleteMedia()).toBe(true);
    useAuthSession.setState({ activeProfile: { ...useAuthSession.getState().activeProfile!, isOwner: true } });
    useServerSession.setState({ server: { allowMediaDeletion: false } as Plex.ServerPreferences });
    expect(canDeleteMedia()).toBe(false);
    useServerSession.setState({ server: { allowMediaDeletion: true } as Plex.ServerPreferences, canManageServer: false });
    expect(canDeleteMedia()).toBe(false);
    useServerSession.setState({ canManageServer: true });
    useAuthSession.setState({ activeUser: { id: 2, restricted: true } as Plex.UserData });
    expect(canDeleteMedia()).toBe(false);
  } finally { useAuthSession.setState(previousAuth, true); useServerSession.setState(previousServer, true); }
});
