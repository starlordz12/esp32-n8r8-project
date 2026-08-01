"use client";

import { useEffect, useState } from "react";

import {
  isDashboardSnapshot,
  type DashboardSnapshot,
} from "./dashboard-contract";

const SNAPSHOT_POLL_INTERVAL_MS = 2_000;

export function useDashboardSnapshot() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [endpointAvailable, setEndpointAvailable] = useState(true);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestController: AbortController | undefined;

    async function pollSnapshot() {
      requestController = new AbortController();
      try {
        const response = await fetch("/api/ruview/snapshot", {
          cache: "no-store",
          signal: requestController.signal,
        });
        const payload: unknown = await response.json();
        if (!response.ok || !isDashboardSnapshot(payload)) {
          throw new Error("Invalid dashboard snapshot");
        }
        if (active) {
          setSnapshot(payload);
          setEndpointAvailable(true);
        }
      } catch {
        if (active && !requestController.signal.aborted) {
          setEndpointAvailable(false);
        }
      } finally {
        if (active) timer = setTimeout(pollSnapshot, SNAPSHOT_POLL_INTERVAL_MS);
      }
    }

    void pollSnapshot();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      requestController?.abort();
    };
  }, []);

  return { snapshot, endpointAvailable };
}
