# Thongthai Universal Channel Contract

ทองไทยเป็นสมองเดียว หลายแพลตฟอร์มเป็นเพียง adapter รอบนอก ห้ามสร้าง prompt, decision tree, booking logic หรือ customer memory แยกเฉพาะช่องทาง

Canonical brain gateway:

`POST /.netlify/functions/thongthai-chat`

Status endpoint:

`GET /.netlify/functions/thongthai-brain-status`

## Adapter Responsibilities

ทุกแพลตฟอร์มต้องทำแค่สิ่งเหล่านี้:

1. Verify request/webhook ของแพลตฟอร์มนั้น
2. แปลง raw provider id เป็น privacy-safe stable key ก่อนส่งเข้า brain
3. ส่งข้อความเข้า `thongthai-chat`
4. ใส่ `pageContext.section` ให้ตรงช่องทาง
5. render response ที่ brain ส่งกลับใน UI ของแพลตฟอร์มนั้น
6. เก็บ operational contact เฉพาะฝั่ง server และต้องเข้ารหัส/แยกจาก memory

Adapter ห้าม:

- copy prompt ทองไทยไปไว้ใน LINE/Facebook/backoffice แยก
- เดาราคา เวลา ห้องว่าง stock หรือ booking เอง
- เขียน customer memory โดยเก็บ raw chat หรือ PII
- บอกว่าจองสำเร็จถ้า brain/tool/database ยังไม่ได้ยืนยันผล
- ใช้ government/reference/business facts ที่ยังไม่ verified แล้วพูดเหมือนเป็นข้อมูลจริง

## Channel Sections

| Platform | `pageContext.section` | Notes |
|---|---:|---|
| Website | `web` | Main customer web chat |
| LINE OA | `line` | Existing LINE webhook adapter |
| Facebook / Messenger | `facebook` or `messenger` | Brain maps both to `facebook` |
| Backoffice assistant | `backoffice` or `admin` | Owner/staff context only, no customer prompt fork |
| Future platform | channel name | Add mapping in `getBrainChannel` only when behavior truly differs |

## Request Shape

```json
{
  "guestId": "privacy-safe-stable-id",
  "message": "ลูกค้าอยากถาม/สั่ง/จองอะไร",
  "language": "th",
  "chatHistory": [],
  "guestContext": {
    "tripDuration": null,
    "travelerType": null,
    "group": { "adults": null, "children": null, "elderly": null },
    "interests": [],
    "pace": null,
    "budget": null,
    "constraints": []
  },
  "journeyContext": {
    "currentPlan": null,
    "savedPlan": null,
    "visitedExperiences": [],
    "favorites": [],
    "journalEntries": []
  },
  "pageContext": { "section": "line" }
}
```

## Public Response Shape

```json
{
  "message": "ข้อความที่ platform เอาไปแสดง",
  "intent": "booking",
  "contextUpdates": {},
  "journeyAction": { "type": "none", "journey": null },
  "suggestedActions": []
}
```

Only these fields are public contract. Internal fields such as tool calls, state updates, provider names, raw model output and operational details must stay server-side.

## Identity Rule

`guestId` is not necessarily the database guest id. It is a channel-local privacy-safe stable key.

The brain gateway resolves it through `guest_identities` into the canonical anonymous guest when known. This is what makes LINE, website and future channels continue the same memory without exposing raw provider IDs to prompts.

## Booking Truth Rule

ทองไทย may create a booking request through tools, but customer-facing copy must respect the real operational status.

Typical state:

`requested -> confirmed -> completed`

A request is not a confirmed booking until staff confirms it in backoffice or the database/tool result explicitly says so.

## Platform Implementation Pattern

```ts
async function askThongthaiFromAdapter(input: {
  providerSafeId: string;
  message: string;
  section: 'web' | 'line' | 'facebook' | 'backoffice';
}) {
  const response = await fetch('/.netlify/functions/thongthai-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guestId: input.providerSafeId,
      message: input.message,
      language: 'th',
      chatHistory: [],
      guestContext: {
        tripDuration: null,
        travelerType: null,
        group: { adults: null, children: null, elderly: null },
        interests: [],
        pace: null,
        budget: null,
        constraints: [],
      },
      journeyContext: {
        currentPlan: null,
        savedPlan: null,
        visitedExperiences: [],
        favorites: [],
        journalEntries: [],
      },
      pageContext: { section: input.section },
    }),
  });

  if (!response.ok) throw new Error(`Thongthai brain returned ${response.status}`);
  return response.json();
}
```

## Current Production Adapters

- Website: calls `thongthai-chat` directly from the customer site
- LINE: `_line-webhook-core.ts` verifies LINE signature, hashes LINE user id, then calls `thongthai-chat` with `pageContext.section = 'line'`
- Backoffice and future platforms should follow the same adapter pattern instead of creating a separate assistant
