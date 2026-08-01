import {
  DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
  type DashboardNode,
  type DashboardSnapshot,
} from "./dashboard-contract.ts";

interface FetchSnapshotOptions {
  baseUrl?: string;
  apiToken?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  now?: () => number;
}

type JsonRecord = Record<string, unknown>;

const DEFAULT_TIMEOUT_MS = 1_500;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function confidencePercent(value: unknown): number | null {
  const confidence = finiteNumber(value);
  if (confidence === null) return null;
  const percent = confidence <= 1 ? confidence * 100 : confidence;
  return Math.round(clamp(percent, 0, 100));
}

function normalizeMotion(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeNode(value: unknown): DashboardNode | null {
  if (!isRecord(value)) return null;
  const nodeId = finiteNumber(value.node_id);
  if (nodeId === null || !Number.isInteger(nodeId) || nodeId < 0 || nodeId > 255) {
    return null;
  }

  const rssiDbm = finiteNumber(value.rssi_dbm);
  const subcarrierCount = finiteNumber(value.subcarrier_count);
  if (
    rssiDbm === null ||
    subcarrierCount === null ||
    !Number.isInteger(subcarrierCount) ||
    subcarrierCount < 0
  ) {
    return null;
  }
  return {
    id: `node-${String(nodeId).padStart(2, "0")}`,
    rssiDbm,
    subcarrierCount,
  };
}

function baseSnapshot(now: number): Pick<
  DashboardSnapshot,
  "schemaVersion" | "generatedAt" | "tick" | "reading" | "nodes"
> {
  return {
    schemaVersion: DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    tick: null,
    reading: {
      presence: null,
      confidencePercent: null,
      motion: null,
    },
    nodes: [],
  };
}

export function unconfiguredSnapshot(now = Date.now()): DashboardSnapshot {
  return {
    ...baseSnapshot(now),
    mode: "preview",
    connection: "unconfigured",
    source: null,
    message: "Preview data is active until the local RuView service is configured.",
  };
}

export function errorSnapshot(message: string, now = Date.now()): DashboardSnapshot {
  return {
    ...baseSnapshot(now),
    mode: "preview",
    connection: "error",
    source: null,
    message,
  };
}

export function normalizeRuViewSnapshot(
  healthPayload: unknown,
  latestPayload: unknown,
  now = Date.now(),
): DashboardSnapshot {
  const base = baseSnapshot(now);
  if (!isRecord(healthPayload)) {
    return errorSnapshot("RuView returned an invalid health response.", now);
  }

  const healthSource = text(healthPayload.source);
  const latest = isRecord(latestPayload) ? latestPayload : null;
  const latestSource = latest ? text(latest.source) : null;
  // `/health` applies RuView's five-second ESP32 staleness rule, while the
  // latest endpoint can still contain a cached pre-disconnect update.
  const source = healthSource ?? latestSource;
  const normalizedSource = source?.toLowerCase() ?? "";
  const tick = finiteNumber(latest?.tick ?? healthPayload.tick);

  if (normalizedSource.includes("offline")) {
    return {
      ...base,
      connection: "offline",
      mode: "preview",
      source,
      tick,
      message: "RuView is running, but no recent ESP32 frames are arriving.",
    };
  }

  if (normalizedSource.includes("simulat")) {
    return {
      ...base,
      connection: "simulated",
      mode: "preview",
      source,
      tick,
      message: "RuView is connected in simulation mode; readings remain labeled preview data.",
    };
  }

  if (!latest || text(latest.status)?.toLowerCase().includes("no data")) {
    return {
      ...base,
      connection: "waiting",
      mode: "preview",
      source,
      tick,
      message: "RuView is connected and waiting for its first sensing update.",
    };
  }

  const classification = isRecord(latest.classification) ? latest.classification : null;
  const nodes = Array.isArray(latest.nodes)
    ? latest.nodes.map(normalizeNode).filter((node): node is DashboardNode => node !== null)
    : [];
  const hardwareSource = normalizedSource.startsWith("esp32");
  const presence =
    typeof classification?.presence === "boolean" ? classification.presence : null;
  const confidence = confidencePercent(classification?.confidence);
  const motion = normalizeMotion(classification?.motion_level);

  if (
    !hardwareSource ||
    !classification ||
    nodes.length === 0 ||
    presence === null ||
    confidence === null ||
    motion === null
  ) {
    return {
      ...base,
      connection: "waiting",
      mode: "preview",
      source,
      tick,
      message: "RuView is connected, but a complete ESP32 sensing update is not available yet.",
    };
  }

  return {
    ...base,
    connection: "connected",
    mode: "live",
    source,
    tick,
    reading: {
      presence,
      confidencePercent: confidence,
      motion,
    },
    nodes,
    message: "Live ESP32 sensing data is connected through the local RuView service.",
  };
}

function parseBaseUrl(rawBaseUrl: string): URL | null {
  try {
    const url = new URL(rawBaseUrl);
    const supportedProtocol = url.protocol === "http:" || url.protocol === "https:";
    return supportedProtocol && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("authorization");
    }
    throw new Error(`${label}:${response.status}`);
  }
  return response.json();
}

export async function fetchRuViewSnapshot({
  baseUrl,
  apiToken,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetcher = fetch,
  now = Date.now,
}: FetchSnapshotOptions): Promise<DashboardSnapshot> {
  if (!baseUrl?.trim()) return unconfiguredSnapshot(now());

  const parsedBaseUrl = parseBaseUrl(baseUrl.trim());
  if (!parsedBaseUrl) {
    return errorSnapshot("The local RuView service address is invalid.", now());
  }

  const controller = new AbortController();
  const requestedTimeout = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const boundedTimeout = clamp(Math.round(requestedTimeout), MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), boundedTimeout);
  const headers = new Headers({ accept: "application/json" });
  if (apiToken?.trim()) headers.set("authorization", `Bearer ${apiToken.trim()}`);

  try {
    const request = (pathname: string) =>
      fetcher(new URL(pathname, parsedBaseUrl), {
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
    const [healthResponse, latestResponse] = await Promise.all([
      request("/health"),
      request("/api/v1/sensing/latest"),
    ]);
    const [healthPayload, latestPayload] = await Promise.all([
      responseJson(healthResponse, "health"),
      responseJson(latestResponse, "latest"),
    ]);
    return normalizeRuViewSnapshot(healthPayload, latestPayload, now());
  } catch (error) {
    if (error instanceof Error && error.message === "authorization") {
      return errorSnapshot("RuView data access needs a valid local API token.", now());
    }
    if (controller.signal.aborted) {
      return errorSnapshot("The local RuView service did not respond in time.", now());
    }
    return errorSnapshot("The local RuView service is unavailable.", now());
  } finally {
    clearTimeout(timeout);
  }
}
