// Read schema availability through PostgREST without reading customer rows.
// Full ACL, constraint and trigger verification remains in the SQL preflight.
export async function checkCustomerTurnHostedReadiness({ baseUrl, serviceRoleKey, fetchImpl = fetch }) {
  if (!baseUrl || !serviceRoleKey) return [{ name: 'configuration', pass: false }];
  const headers = { apikey: serviceRoleKey, Authorization: 'Bearer ' + serviceRoleKey };
  const checks = [];
  for (const [name, path] of [
    ['turn_claim', 'customer_turn_outcomes?select=event_id,outcome,claimed_at&limit=0'],
    ['monitor_context', 'thongthai_customer_turn_monitor?select=context_persisted&limit=0'],
    ['line_delivery_outbox', 'line_customer_deliveries?select=event_id,target_hash,payload_enc,status,mode,lease_id,leased_at,expires_at&limit=0'],
  ]) {
    try {
      const response = await fetchImpl(baseUrl.replace(/\/$/, '') + '/rest/v1/' + path, {
        headers, redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      checks.push({ name, status: response.status, pass: response.ok && Array.isArray(data) && data.length === 0 });
    } catch {
      checks.push({ name, pass: false });
    }
  }
  return checks;
}
