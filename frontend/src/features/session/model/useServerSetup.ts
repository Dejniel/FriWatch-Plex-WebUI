import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createServerSetupClient, ServerSetupError } from "../api/serverSetup";
import { useAuthSession } from "./authSession";

export function useServerSetup() {
  const { revision, ownerUser } = useAuthSession();
  const client = useMemo(
    () => createServerSetupClient(revision, ownerUser?.id),
    [revision, ownerUser?.id],
  );
  const queryClient = useQueryClient();
  const key = ["plex-server-setup", revision, client.accountId];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => client.info(signal),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), [client]);

  const run = async (kind: "claim" | "check") => {
    if (operation.current || !query.data || !client.isCurrent()) return;
    if (kind === "claim" && (uncertain || query.data.state !== "unclaimed"))
      return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(null);
    try {
      const result = await (kind === "claim"
        ? client.claim(query.data.serverId, code.trim(), controller.signal)
        : client.verify(query.data.serverId, controller.signal));
      if (!client.isCurrent() || controller.signal.aborted) return;
      queryClient.setQueryData(key, result);
      setUncertain(result.state === "pending");
      if (kind === "claim") setCode("");
    } catch (failure) {
      if (!client.isCurrent() || controller.signal.aborted) return;
      setError(
        failure instanceof Error
          ? failure.message
          : "Server setup failed. Try again.",
      );
      if (failure instanceof ServerSetupError && failure.mayHaveSubmitted) {
        setUncertain(true);
        setCode("");
      }
    } finally {
      if (operation.current === controller) operation.current = null;
      if (client.isCurrent()) setPending(false);
    }
  };

  return {
    setup: query.data,
    loading: query.isPending || query.isFetching,
    error: error ?? (query.error instanceof Error ? query.error.message : null),
    pending,
    code,
    setCode,
    checkOnly: uncertain || query.data?.state !== "unclaimed",
    claim: () => run("claim"),
    check: () => run("check"),
    reload: () => query.refetch(),
    continue: client.continue,
  };
}
