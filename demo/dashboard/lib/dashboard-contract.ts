export const DASHBOARD_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type AdapterConnection =
  | "unconfigured"
  | "connected"
  | "simulated"
  | "waiting"
  | "offline"
  | "error";

export interface DashboardNode {
  id: string;
  rssiDbm: number | null;
  subcarrierCount: number | null;
}

export interface DashboardSnapshot {
  schemaVersion: typeof DASHBOARD_SNAPSHOT_SCHEMA_VERSION;
  mode: "live" | "preview";
  connection: AdapterConnection;
  generatedAt: string;
  source: string | null;
  tick: number | null;
  reading: {
    presence: boolean | null;
    confidencePercent: number | null;
    motion: string | null;
  };
  nodes: DashboardNode[];
  message: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDashboardSnapshot(value: unknown): value is DashboardSnapshot {
  if (!isRecord(value) || value.schemaVersion !== DASHBOARD_SNAPSHOT_SCHEMA_VERSION) {
    return false;
  }
  const validConnections: AdapterConnection[] = [
    "unconfigured",
    "connected",
    "simulated",
    "waiting",
    "offline",
    "error",
  ];
  const reading = value.reading;
  const validReading =
    isRecord(reading) &&
    (reading.presence === null || typeof reading.presence === "boolean") &&
    (reading.confidencePercent === null ||
      (typeof reading.confidencePercent === "number" &&
        Number.isFinite(reading.confidencePercent))) &&
    (reading.motion === null || typeof reading.motion === "string");
  const validNodes =
    Array.isArray(value.nodes) &&
    value.nodes.every(
      (node) =>
        isRecord(node) &&
        typeof node.id === "string" &&
        (node.rssiDbm === null ||
          (typeof node.rssiDbm === "number" && Number.isFinite(node.rssiDbm))) &&
        (node.subcarrierCount === null ||
          (typeof node.subcarrierCount === "number" &&
            Number.isInteger(node.subcarrierCount))),
    );
  return (
    (value.mode === "live" || value.mode === "preview") &&
    validConnections.includes(value.connection as AdapterConnection) &&
    typeof value.generatedAt === "string" &&
    (value.source === null || typeof value.source === "string") &&
    (value.tick === null ||
      (typeof value.tick === "number" && Number.isFinite(value.tick))) &&
    typeof value.message === "string" &&
    validReading &&
    validNodes
  );
}
