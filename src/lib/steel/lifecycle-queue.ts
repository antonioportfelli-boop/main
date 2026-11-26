/** Serialize asynchronous engine lifecycle mutations without poisoning the queue on failure. */
export function createSerialLifecycleQueue() {
  let queue: Promise<void> = Promise.resolve();

  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = queue.then(operation, operation);
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };
}
