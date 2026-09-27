// Human Core final certification: proves the REAL deployed LINE webhook
// transport boundary (HTTPS + signature verification) against the actual
// production endpoint -- not just the in-process brain logic that the
// existing 16-turn LINE acceptance suite already covers.
//
// Safety contract (do not weaken):
// - This script NEVER sends a LINE `message` event. netlify/functions/
//   _line-webhook-core.ts's handleEvent() unconditionally calls
//   replyToLine() once it reaches a text message with a replyToken+userId
//   (see its line ~510) -- there is no way to exercise that branch live
//   without also attempting a real outbound LINE Reply API call. A `follow`
//   event is used instead: it passes the exact same live signature
//   verification gate, but the handler's own `if (event.type !== 'message')
//   return;` guard (line ~438) makes it return immediately afterwards --
//   no reply, no processThongthaiChatCore call, no database write, no
//   customer-visible side effect of any kind, verified by reading that
//   source file directly.
// - The channel secret is read from an environment variable the CI
//   workflow injects from a GitHub Actions secret. It is NEVER logged,
//   NEVER echoed, and NEVER included in any request body -- only used
//   locally to compute an HMAC-SHA256 signature, exactly the way
//   verifyLineSignature() in _line-webhook-core.ts computes it.
// - The synthetic userId is clearly CI-marked and not a real LINE user ID,
//   so it can never collide with or affect a real customer record.
const LINE_WEBHOOK_URL = process.env.LINE_WEBHOOK_URL
  ?? 'https://tamma-chat.netlify.app/.netlify/functions/line-webhook';

async function main() {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelSecret) {
    console.log('LINE_TRANSPORT_SECRET_NOT_CONFIGURED: repository LINE_CHANNEL_SECRET is not configured for this run.');
    process.exit(2);
  }

  const { createHmac } = await import('node:crypto');
  const runId = Date.now();
  const syntheticUserId = `Uci-line-transport-cert-${runId}`;
  const rawBody = JSON.stringify({
    destination: 'ci-line-transport-cert',
    events: [
      {
        type: 'follow',
        mode: 'active',
        timestamp: runId,
        replyToken: `ci-transport-cert-reply-token-${runId}`,
        source: { type: 'user', userId: syntheticUserId },
      },
    ],
  });

  function sign(body: string, secret: string): string {
    return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
  }

  async function post(signature: string): Promise<{ status: number; body: string }> {
    const res = await fetch(LINE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-line-signature': signature },
      body: rawBody,
    });
    const body = await res.text().catch(() => '');
    return { status: res.status, body: body.slice(0, 200) };
  }

  const validSignature = sign(rawBody, channelSecret);
  // A syntactically valid base64 signature that is certainly not a match --
  // never derived from the real secret, so this proves rejection, not a
  // near-miss of the real value.
  const invalidSignature = Buffer.from('not-the-real-signature').toString('base64');

  const invalidResult = await post(invalidSignature);
  const validResult = await post(validSignature);

  const invalidRejected = invalidResult.status === 401;
  const validAccepted = validResult.status === 200;

  console.log(JSON.stringify({
    kind: 'LINE_TRANSPORT_CERTIFICATION',
    lineWebhookUrl: LINE_WEBHOOK_URL,
    eventType: 'follow',
    syntheticUserId,
    invalidSignatureProbe: { expectedStatus: 401, actualStatus: invalidResult.status, pass: invalidRejected, body: invalidResult.body },
    validSignatureProbe: { expectedStatus: 200, actualStatus: validResult.status, pass: validAccepted, body: validResult.body },
    overallPass: invalidRejected && validAccepted,
  }, null, 2));

  if (!invalidRejected || !validAccepted) {
    console.error('LINE_TRANSPORT_CERTIFICATION_FAILED');
    process.exit(1);
  }
  console.log('LINE_TRANSPORT_CERTIFICATION_PASSED: real deployed webhook enforces live HMAC-SHA256 signature verification (invalid rejected with 401, validly-signed accepted with 200), with zero reply/transaction side effects (follow event, never a message event).');
}

main().catch(error => {
  console.error('LINE_TRANSPORT_CERTIFICATION_CRASHED', error instanceof Error ? error.message : error);
  process.exit(1);
});
