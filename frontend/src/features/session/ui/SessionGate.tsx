import { Alert, Box, Button, CircularProgress } from "@mui/material";
import { ReactNode, useEffect } from "react";
import { useAuthSession } from "../model/authSession";
import { useSessionBootstrap } from "../model/useSessionBootstrap";
import { PLEX_SESSION_INVALID_EVENT } from "../model/sessionEvents";
import LoginScreen from "./LoginScreen";
import ProfilePickerScreen from "./ProfilePickerScreen";

function LoadingScreen() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
      }}
    >
      <CircularProgress aria-label="Loading session" />
    </Box>
  );
}

function SessionFailure({
  message,
  retry,
  signOut,
}: {
  message: string;
  retry: () => void;
  signOut: () => void;
}) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        bgcolor: "background.default",
        px: 2,
      }}
    >
      <Alert severity="error">{message}</Alert>
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button variant="contained" onClick={retry}>
          Retry
        </Button>
        <Button variant="text" onClick={signOut}>
          Sign out
        </Button>
      </Box>
    </Box>
  );
}

export default function SessionGate({ children }: { children: ReactNode }) {
  const { status, error, initialize, signOut } = useAuthSession();
  const bootstrap = useSessionBootstrap();

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    const revalidate = () => {
      if (useAuthSession.getState().status !== "initializing")
        void initialize();
    };
    window.addEventListener(PLEX_SESSION_INVALID_EVENT, revalidate);
    return () =>
      window.removeEventListener(PLEX_SESSION_INVALID_EVENT, revalidate);
  }, [initialize]);

  if (status === "ready" && bootstrap.serverFailed && bootstrap.serverProblem)
    return (
      <SessionFailure
        message={bootstrap.serverProblem.message}
        retry={bootstrap.retryServer}
        signOut={signOut}
      />
    );
  if (status === "initializing" || (status === "ready" && bootstrap.pending))
    return <LoadingScreen />;
  if (status === "signedOut") return <LoginScreen />;
  if (status === "selectingProfile" || status === "unlocking")
    return <ProfilePickerScreen />;

  if (status === "error")
    return (
      <SessionFailure
        message={error || "Authentication failed."}
        retry={() => void initialize()}
        signOut={signOut}
      />
    );

  return (
    <>
      {(bootstrap.error || bootstrap.serverProblem) && (
        <Box
          sx={{
            position: "fixed",
            top: 72,
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: "calc(100% - 32px)",
            zIndex: 1500,
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          {bootstrap.error && (
            <Alert
              severity="warning"
              action={
                <Button color="inherit" size="small" onClick={bootstrap.retry}>
                  Retry
                </Button>
              }
            >
              {bootstrap.error}
            </Alert>
          )}
          {bootstrap.serverProblem && (
            <Alert
              severity="warning"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={bootstrap.retryServer}
                >
                  Retry
                </Button>
              }
            >
              {bootstrap.serverProblem.message}
            </Alert>
          )}
        </Box>
      )}
      {children}
    </>
  );
}
