/**
 * Source-tagged runtime metric helpers.
 *
 * These helpers intentionally distinguish browser-reported latency from a
 * modeled buffer estimate. They do not infer CPU utilization or native ASIO
 * availability from audio level, voice count, or browser APIs.
 */

export type MetricSource =
  | "model"
  | "browser-api"
  | "worklet-meter"
  | "native-driver"
  | "loopback-measurement";

export interface RuntimeMetric {
  name: string;
  value: number | null;
  unit: "ms" | "percent" | "linear";
  source: MetricSource;
  available: boolean;
  description: string;
}

export function modeledBufferLatencyMs(
  bufferFrames: number,
  sampleRateHz: number,
  bufferCount = 2,
): RuntimeMetric {
  const valid =
    Number.isFinite(bufferFrames) &&
    Number.isFinite(sampleRateHz) &&
    Number.isFinite(bufferCount) &&
    bufferFrames > 0 &&
    sampleRateHz > 0 &&
    bufferCount > 0;

  return {
    name: "modeled-buffer-latency",
    value: valid ? (bufferFrames / sampleRateHz) * bufferCount * 1000 : null,
    unit: "ms",
    source: "model",
    available: valid,
    description: valid
      ? `Simplified estimate using ${bufferCount} buffers; not a device round-trip measurement.`
      : "Unavailable: buffer frames, sample rate, and buffer count must be finite positive numbers.",
  };
}

export function browserReportedLatencyMs(
  baseLatencySeconds: number | null | undefined,
  outputLatencySeconds: number | null | undefined,
): RuntimeMetric {
  const values = [baseLatencySeconds, outputLatencySeconds];
  const available = values.every(
    (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
  );

  return {
    name: "browser-reported-audio-latency",
    value: available
      ? ((baseLatencySeconds as number) + (outputLatencySeconds as number)) * 1000
      : null,
    unit: "ms",
    source: "browser-api",
    available,
    description: available
      ? "Sum of browser AudioContext latency properties; not an ASIO or physical loopback measurement."
      : "Unavailable: browser latency properties are missing or invalid.",
  };
}

/** CPU load cannot be inferred from peak amplitude or active voice count. */
export function cpuLoadUnavailable(): RuntimeMetric {
  return {
    name: "cpu-load",
    value: null,
    unit: "percent",
    source: "browser-api",
    available: false,
    description:
      "Unavailable: this browser audio path does not expose a validated CPU-utilization measurement.",
  };
}
