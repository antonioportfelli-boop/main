import assert from "node:assert/strict";
import test from "node:test";
import { requestWithTimeoutAndLateCleanup } from "./media-permission.ts";

test("late permission success is cleaned up after timeout", async () => {
  let stopped = false;
  const stream = { stop: () => { stopped = true; } };

  await assert.rejects(
    requestWithTimeoutAndLateCleanup(
      () => new Promise<typeof stream>((resolve) => setTimeout(() => resolve(stream), 15)),
      (lateStream) => lateStream.stop(),
      1,
    ),
    /request-timeout/,
  );

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(stopped, true);
});

test("permission result before timeout is returned without cleanup", async () => {
  let cleaned = false;
  const result = { ok: true };
  const actual = await requestWithTimeoutAndLateCleanup(
    async () => result,
    () => { cleaned = true; },
    100,
  );
  assert.equal(actual, result);
  assert.equal(cleaned, false);
});
