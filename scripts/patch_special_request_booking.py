from pathlib import Path

p = Path('netlify/functions/_thongthai-brain-v3.ts')
s = p.read_text()

old_version = "export const THONGTHAI_BRAIN_VERSION = '2026-09-agentic-operations-v3';"
new_version = "export const THONGTHAI_BRAIN_VERSION = '2026-09-agentic-operations-v3-special-request';"
assert old_version in s, 'brain version anchor missing'
s = s.replace(old_version, new_version, 1)

old = "- Stay booking: requires check-in date, check-out date, room quantity, and customer name. Contact information should be requested if not already supplied."
new = """- Stay booking: requires check-in date, check-out date, room quantity, and customer name. Contact information should be requested if not already supplied.\n- Stay special request is part of the booking itself, not a separate generic handoff. Once required stay details are complete, ask once naturally whether the guest needs anything prepared or noted for the stay (examples: extra pillows, child/elderly needs, accessibility, allergy/food concern, celebration setup, arrival timing, housekeeping preference). This question is optional and must not become a loop. If the guest already gave a request, do not ask again. If the guest says none/no, proceed immediately.\n- Put the guest's operational special request into create_booking.note so it travels with the Booking to backoffice and the stay team. Preserve the meaning faithfully; summarize only enough to be clear. Never promise the request is guaranteed. Say the team will review/confirm it with the booking when fulfillment is not already verified."""
assert old in s, 'stay booking policy anchor missing'
s = s.replace(old, new, 1)

old_tool = "2. create_booking {serviceType, resourceCode?, date, time?, endDate?, partySize?, quantity?, customerName?, phone?, email?, note?} — create a REAL requested booking. Use only after explicit booking intent and enough details. Do not call if multiple slots are still ambiguous."
new_tool = "2. create_booking {serviceType, resourceCode?, date, time?, endDate?, partySize?, quantity?, customerName?, phone?, email?, note?} — create a REAL requested booking. For stay, note is the guest's special request / preparation note and must travel with the booking when provided. Use only after explicit booking intent and enough details. Do not call if multiple slots are still ambiguous."
assert old_tool in s, 'create booking tool anchor missing'
s = s.replace(old_tool, new_tool, 1)

p.write_text(s)
