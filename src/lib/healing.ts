export type HealOutcome = "verified" | "fallback" | "failed" | "unknown";

export type HealEvent = {
  op: string;
  attempt: number;
  status: "ok" | "retry" | "timeout" | "fallback" | "verified" | "unverified" | "failed" | "unknown";
  detail: string;
  at: string;
};

export type HealReport<T> = {
  value: T | null;
  outcome: HealOutcome;
  events: HealEvent[];
};

export function isHealTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "HealTimeout";
}

function stamp(now?: () => string): string {
  return now ? now() : new Date().toISOString();
}

async function attemptOnce<T>(
  run: (attempt: number, signal: AbortSignal) => Promise<T> | T,
  attempt: number,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(run(attempt, controller.signal)),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const error = new Error(`Timed out after ${timeoutMs}ms`);
          error.name = "HealTimeout";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resilient<T>(options: {
  op: string;
  timeoutMs: number;
  retries: number;
  run: (attempt: number, signal: AbortSignal) => Promise<T> | T;
  fallback?: (error: unknown) => Promise<T> | T;
  verify?: (value: T) => boolean;
  sideEffect?: boolean;
  isRetryable?: (error: unknown) => boolean;
  now?: () => string;
}): Promise<HealReport<T>> {
  const events: HealEvent[] = [];
  const retryable = options.isRetryable ?? ((error: unknown) => !isHealTimeout(error));
  let lastError: unknown = new Error("The operation did not run.");
  const attempts = options.retries + 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await attemptOnce(options.run, attempt, options.timeoutMs);
      if (options.verify && !options.verify(value)) {
        events.push({
          op: options.op,
          attempt,
          status: "unverified",
          detail: "The result failed verification.",
          at: stamp(options.now),
        });
        if (options.sideEffect) {
          events.push({
            op: options.op,
            attempt,
            status: "unknown",
            detail: "A write may have landed. Hearth will not repeat it.",
            at: stamp(options.now),
          });
          return { value, outcome: "unknown", events };
        }
        lastError = new Error("verification failed");
        if (attempt < attempts) {
          events.push({
            op: options.op,
            attempt,
            status: "retry",
            detail: "Retrying a read that failed verification.",
            at: stamp(options.now),
          });
        }
        continue;
      }
      events.push({
        op: options.op,
        attempt,
        status: options.verify ? "verified" : "ok",
        detail: options.verify ? "Result verified." : "Completed.",
        at: stamp(options.now),
      });
      return { value, outcome: "verified", events };
    } catch (error) {
      lastError = error;
      if (isHealTimeout(error)) {
        events.push({
          op: options.op,
          attempt,
          status: "timeout",
          detail: error instanceof Error ? error.message : "Timed out.",
          at: stamp(options.now),
        });
        if (options.sideEffect) {
          events.push({
            op: options.op,
            attempt,
            status: "unknown",
            detail: "The write timed out. Outcome unknown. Hearth will not retry it.",
            at: stamp(options.now),
          });
          return { value: null, outcome: "unknown", events };
        }
        if (attempt < attempts) {
          events.push({
            op: options.op,
            attempt,
            status: "retry",
            detail: "Retrying after a timeout.",
            at: stamp(options.now),
          });
          continue;
        }
        break;
      }
      const message = error instanceof Error ? error.message : "The operation failed.";
      if (retryable(error) && attempt < attempts) {
        events.push({
          op: options.op,
          attempt,
          status: "retry",
          detail: message,
          at: stamp(options.now),
        });
        continue;
      }
      events.push({
        op: options.op,
        attempt,
        status: "failed",
        detail: message,
        at: stamp(options.now),
      });
      break;
    }
  }

  if (options.fallback && !options.sideEffect) {
    try {
      const value = await options.fallback(lastError);
      if (options.verify && !options.verify(value)) {
        events.push({
          op: options.op,
          attempt: attempts,
          status: "failed",
          detail: "Fallback failed verification.",
          at: stamp(options.now),
        });
        return { value: null, outcome: "failed", events };
      }
      events.push({
        op: options.op,
        attempt: attempts,
        status: "fallback",
        detail: "Used the fallback path.",
        at: stamp(options.now),
      });
      return { value, outcome: "fallback", events };
    } catch (error) {
      events.push({
        op: options.op,
        attempt: attempts,
        status: "failed",
        detail: error instanceof Error ? error.message : "Fallback failed.",
        at: stamp(options.now),
      });
    }
  }

  return { value: null, outcome: "failed", events };
}
