from pathlib import Path

p = Path('netlify/functions/_line-webhook-core.ts')
s = p.read_text()

marker = """async function askThongthai(message: string, userId: string): Promise<ThongthaiResponse> {\n  const response = await fetch(siteBaseUrl() + THONGTHAI_ENDPOINT, {\n"""
if marker not in s:
    raise SystemExit('askThongthai marker missing')

insert_after = """  if (!response.ok) throw new Error(`Thongthai endpoint returned ${response.status}`);\n  return await response.json() as ThongthaiResponse;\n}\n"""
if insert_after not in s:
    raise SystemExit('askThongthai end marker missing')

replacement = insert_after + """\nfunction delay(ms: number): Promise<void> {\n  return new Promise(resolve => setTimeout(resolve, ms));\n}\n\nasync function askThongthaiReliably(message: string, userId: string): Promise<ThongthaiResponse> {\n  try {\n    return await askThongthai(message, userId);\n  } catch (firstError) {\n    console.error(\n      'LINE_THONGTHAI_FIRST_ATTEMPT_ERROR',\n      firstError instanceof Error ? firstError.message.slice(0, 240) : 'unknown',\n    );\n  }\n\n  // A retry is safe for write actions because operational creates (including restaurant preorders)\n  // are idempotent at the database layer. This closes the failure window where a write succeeds\n  // but the model/final response times out and the customer otherwise sees silence.\n  await delay(250);\n  try {\n    return await askThongthai(message, userId);\n  } catch (secondError) {\n    console.error(\n      'LINE_THONGTHAI_SECOND_ATTEMPT_ERROR',\n      secondError instanceof Error ? secondError.message.slice(0, 240) : 'unknown',\n    );\n    return {\n      message: [\n        'ทองไทยรับข้อความแล้วครับ แต่ระบบตอบกลับไม่ทันในรอบนี้',\n        'หากเป็นคำสั่งเดิมที่เพิ่งส่งซ้ำ ระบบจะไม่สร้างออเดอร์ซ้ำครับ',\n        'ลองส่งข้อความเดิมอีกครั้งได้เลย หรือพิมพ์ “ดูออเดอร์ล่าสุด” เพื่อให้ทองไทยตรวจให้อีกครั้งครับ',\n      ].join('\\n'),\n      intent: 'support',\n      journeyAction: { type: 'none', journey: null },\n      suggestedActions: [{ label: 'ลองอีกครั้ง', action: message.slice(0, 180) }],\n    };\n  }\n}\n"""
s = s.replace(insert_after, replacement, 1)

old = """  const result = await askThongthai(message, userId);\n\n  try {\n"""
new = """  const result = await askThongthaiReliably(message, userId);\n\n  try {\n"""
if old not in s:
    raise SystemExit('handleEvent askThongthai call marker missing')
s = s.replace(old, new, 1)

p.write_text(s)
