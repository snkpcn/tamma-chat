// Bound backend waits, including response-body reads. Do not retry writes:
// a timeout does not prove that the server rejected a booking or state update.
import { noteBackendWrite } from './_turn-writes';

export const BACKEND_TIMEOUT_MS = 2500;

export function backendFetch(
  input: string,
  init: RequestInit = {},
  timeoutMs = BACKEND_TIMEOUT_MS,
): Promise<Response> {
  if ((init.method ?? 'GET').toUpperCase() !== 'GET') noteBackendWrite(input);
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, deadline])
    : deadline;
  const response = fetch(input, { ...init, signal });
  // Forget again once it lands: a read that overlapped the write may hold the old row.
  if ((init.method ?? 'GET').toUpperCase() !== 'GET') response.then(() => noteBackendWrite(input), () => noteBackendWrite(input));
  return response;
}
