// Bound backend waits, including response-body reads. Do not retry writes:
// a timeout does not prove that the server rejected a booking or state update.
export const BACKEND_TIMEOUT_MS = 2500;

export function backendFetch(
  input: string,
  init: RequestInit = {},
  timeoutMs = BACKEND_TIMEOUT_MS,
): Promise<Response> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, deadline])
    : deadline;
  return fetch(input, { ...init, signal });
}
