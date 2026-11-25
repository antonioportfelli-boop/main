import assert from "node:assert/strict";
import test from "node:test";
import {
  browserReportedLatencyMs,
  cpuLoadUnavailable,
  modeledBufferLatencyMs,
} from "./metrics.ts";

test("modeled latency is explicitly marked as a model", () => {
  const metric = modeledBufferLatencyMs(128, 48_000, 2);
  assert.equal(metric.value, (128 / 48_000) * 2 * 1000);
  assert.equal(metric.source, "model");
  assert.equal(metric.available, true);
  assert.match(metric.description, /not a device round-trip measurement/i);
});

test("invalid modeled latency is unavailable, not zero", () => {
  const metric = modeledBufferLatencyMs(0, 48_000);
  assert.equal(metric.value, null);
  assert.equal(metric.available, false);
});

test("browser latency is distinguished from physical loopback", () => {
  const metric = browserReportedLatencyMs(0.01, 0.02);
  assert.equal(metric.value, 30);
  assert.equal(metric.source, "browser-api");
  assert.match(metric.description, /not an ASIO or physical loopback measurement/i);
});

test("missing browser latency remains unavailable", () => {
  const metric = browserReportedLatencyMs(undefined, 0.02);
  assert.equal(metric.value, null);
  assert.equal(metric.available, false);
});

test("CPU utilization is never fabricated from audio metrics", () => {
  const metric = cpuLoadUnavailable();
  assert.equal(metric.value, null);
  assert.equal(metric.available, false);
  assert.match(metric.description, /does not expose/i);
});
