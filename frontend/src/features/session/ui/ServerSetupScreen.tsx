import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useAuthSession } from "../model/authSession";
import { useServerSetup } from "../model/useServerSetup";

export default function ServerSetupScreen() {
  const { ownerUser, signOut } = useAuthSession();
  const model = useServerSetup();
  const { setup } = model;
  const account =
    ownerUser?.username ||
    ownerUser?.email ||
    ownerUser?.title ||
    "your Plex account";
  const fullAccount = ownerUser && !ownerUser.restricted;
  const verified = setup?.state === "verified";

  return (
    <Box
      component="main"
      sx={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        p: { xs: 2, sm: 4 },
      }}
    >
      <Stack spacing={3} sx={{ width: "100%", maxWidth: "40rem", minWidth: 0 }}>
        <Box>
          <Typography variant="h4" component="h1">
            Link your Plex server
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Connect this server to your Plex account. You can then add libraries
            and manage server settings in FriWatch.
          </Typography>
        </Box>
        <Box>
          <Typography variant="overline">Plex account</Typography>
          <Typography sx={{ overflowWrap: "anywhere" }}>{account}</Typography>
          {ownerUser?.email && ownerUser.email !== account && (
            <Typography color="text.secondary">{ownerUser.email}</Typography>
          )}
          {setup && (
            <>
              <Typography variant="overline" sx={{ display: "block", mt: 2 }}>
                Configured server
              </Typography>
              <Typography sx={{ overflowWrap: "anywhere" }}>
                {setup.serverUrl}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ overflowWrap: "anywhere" }}
              >
                {setup.serverId}
              </Typography>
            </>
          )}
        </Box>
        {model.loading && (
          <CircularProgress size={24} aria-label="Checking server setup" />
        )}
        {model.error && <Alert severity="error">{model.error}</Alert>}
        {!fullAccount && (
          <Alert severity="warning">
            Sign in to a full Plex account to link the server.
          </Alert>
        )}
        {setup &&
          fullAccount &&
          (verified ? (
            <Alert severity="success">
              This server is linked to {account}. Its owner has been verified.
            </Alert>
          ) : model.checkOnly ? (
            <Alert severity="info">
              {setup.state === "claimed"
                ? "The server is already linked. Check its owner to continue."
                : "The linking result has not been confirmed yet. Check status; the linking request will not be repeated."}
            </Alert>
          ) : (
            <Box
              component="form"
              onSubmit={(event) => {
                event.preventDefault();
                void model.claim();
              }}
            >
              <Stack spacing={2}>
                <TextField
                  label="FriWatch setup code"
                  value={model.code}
                  onChange={(event) => model.setCode(event.target.value)}
                  autoComplete="off"
                  fullWidth
                  disabled={model.pending}
                  type="password"
                  helperText="Open the FriWatch container logs or backend console and copy the [Plex setup] code. It confirms you manage this installation."
                />
                <Button
                  type="submit"
                  variant="contained"
                  disabled={
                    !model.code.trim() || model.pending || model.loading
                  }
                >
                  {model.pending
                    ? "Linking server…"
                    : `Link server to ${account}`}
                </Button>
              </Stack>
            </Box>
          ))}
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          {verified ? (
            <Button variant="contained" onClick={() => void model.continue()}>
              Continue to FriWatch
            </Button>
          ) : setup && fullAccount ? (
            <Button
              onClick={() => void model.check()}
              disabled={model.pending || model.loading}
            >
              Check status
            </Button>
          ) : (
            !setup && (
              <Button
                onClick={() => void model.reload()}
                disabled={model.loading}
              >
                Retry
              </Button>
            )
          )}
          <Button onClick={signOut}>Sign out</Button>
        </Stack>
        <Accordion disableGutters elevation={0}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            Setup help and Plex Web
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              <Typography>
                In Docker, open this FriWatch container’s Logs tab. For a local
                backend, use its terminal output. The setup code appears when
                this screen checks an unlinked server, and changes after
                restarting FriWatch.
              </Typography>
              <Typography>
                Plex accepts linking requests from the server itself or its
                local network. FriWatch must reach Plex through that network; a
                public address can cause Plex to refuse the request.
              </Typography>
              <Typography>
                You can also open Plex Web on the Plex server’s published
                address (usually port 32400), sign in as {account}, then open
                Settings → Server → General → Claim Server. Return here and
                check status.
              </Typography>
              {setup?.webUrl && (
                <Button
                  href={setup.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="outlined"
                >
                  Open Plex Web
                </Button>
              )}
              <Typography color="text.secondary">
                An internal Docker hostname may not work in your browser. The
                installer can set PLEX_WEB_URL to the browser-accessible Plex
                Web address.
              </Typography>
            </Stack>
          </AccordionDetails>
        </Accordion>
      </Stack>
    </Box>
  );
}
