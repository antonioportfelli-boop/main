import assert from "node:assert/strict";
import test from "node:test";
import { createSerialLifecycleQueue } from "./lifecycle-queue.ts";

test("concurrent lifecycle requests execute in sequence", async () => {
  const enqueue = createSerialLifecycleQueue();
  const order: string[] = [];
  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });

  const first = enqueue(async () => {
    order.push("first:start");
    await gate;
    order.push("first:end");
  });
  const second = enqueue(async () => {
    order.push("second:start");
    order.push("second:end");
  });

  await Promise.resolve();
  assert.deepEqual(order, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);
});

test("a failed lifecycle operation does not poison later operations", async () => {
  const enqueue = createSerialLifecycleQueue();
  await assert.rejects(enqueue(async () => { throw new Error("expected"); }), /expected/);
  let ran = false;
  await enqueue(async () => { ran = true; });
  assert.equal(ran, true);
});
