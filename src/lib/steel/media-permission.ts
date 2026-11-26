/**
 * Bound a permission request without leaking a resource that resolves after
 * the caller has timed out. The request itself is not cancellable in browsers;
 * late success is therefore disposed through the supplied cleanup callback.
 */
export async function requestWithTimeoutAndLateCleanup<T>(
  request: () => Promise<T>,
  cleanup: (value: T) => void,
  timeoutMs = 900,
): Promise<T> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const pending = request().then((value) => {
    if (timedOut) {
      cleanup(value);
      throw new Error("request-timeout");
    }
    return value;
  });

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("request-timeout"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
