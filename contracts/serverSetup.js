const states = new Set(["unclaimed", "pending", "claimed", "verified"]);

function httpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function readPlexServerSetup(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.serverId !== "string" ||
    !value.serverId.trim() ||
    !httpUrl(value.serverUrl) ||
    !states.has(value.state) ||
    (value.webUrl !== undefined && !httpUrl(value.webUrl)) ||
    (value.accountId !== undefined &&
      (typeof value.accountId !== "string" ||
        !/^[1-9]\d*$/.test(value.accountId))) ||
    (value.state === "verified" && !value.accountId)
  )
    throw new Error("Plex returned invalid server setup information.");
  return {
    serverId: value.serverId,
    serverUrl: value.serverUrl,
    state: value.state,
    ...(value.webUrl && { webUrl: value.webUrl }),
    ...(value.accountId && { accountId: value.accountId }),
  };
}
