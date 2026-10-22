# Production web reply deadline

The first production verification of deploy `6ad9cfec6d7f3d62d79a8635` returned a turn-timeout fallback for the allergy declaration and English food question. Their HTTP 200 responses contained fallback text, so they were not successful answers. The intermediate Thai dish question did retain the supplied constraints.

Function logs show a successful OpenAI interpretation continuing beyond the web core's eight-second deadline. One trace spent 6,270 ms in semantic processing and 2,108 ms reading/writing state, before other setup, composition and telemetry. The application discarded that answer while already-issued processing continued. The KKU/local-fixture trial did not have the same latency as production's OpenAI and Supabase round trips.

The web core now allows 22 seconds for answering and drains pending writes until its 23-second hard deadline. The existing 750 ms claim cap and bounded backend waits leave headroom before the browser's 30-second timeout. LINE retains its eight-second answer budget and separate delivery slice. The provider, model IDs, cost guard, real Supabase source and business-operation boundaries are unchanged.

The previous shared budget assumed a ten-second limit for all synchronous functions. Netlify's current configuration documentation lists a 60-second synchronous execution limit: https://docs.netlify.com/build/functions/configuration/ . The site lookup has no explicit shorter synchronous-timeout override. The application deliberately keeps the web deadline below the browser timeout.

Identity registration and the conversation activity heartbeat now overlap response computation through the existing per-turn write collector. They are still drained before returning. Preference capture remains awaited, so current and subsequent food checks see the customer's constraints. Paid calls still reserve/finalize cost through the existing CAS-backed ledger and fail closed when it is unavailable.

Local regression verification includes a web request with 950 ms per database hop: it completed the grounded opening-hours answer after crossing the old eight-second cutoff, with identity bookkeeping completed and no model call. The stalled-backend regression advances the deadline using the test clock and verifies the honest fallback; it does not weaken production timeout handling.

The full suite passed **3,479 / 3,479** cases after this change. The initial targeted deadline, fallback, bookkeeping and LINE suite passed **40 / 40**. Both web and LINE function bundles compiled successfully.

This change restores room to deliver valid answers; it does not claim that all production requests are fast or that a provider outage can always be answered. Real hosted verification must inspect response content, the deployed commit, durations, model-call counts and context persistence. A 200 status alone is insufficient.
