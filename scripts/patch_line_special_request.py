from pathlib import Path

p=Path('netlify/functions/_operations-db.ts')
s=p.read_text()

old="""  quantity: number;\n  status: 'collecting' | 'awaiting_phone' | 'needs_slot' | 'ready' | 'submitted' | 'failed' | 'cancelled';\n  booking_code: string | null;\n};"""
new="""  quantity: number;\n  special_request: string | null;\n  status: 'collecting' | 'awaiting_phone' | 'awaiting_special_request' | 'needs_slot' | 'ready' | 'submitted' | 'failed' | 'cancelled';\n  booking_code: string | null;\n};"""
assert old in s, 'session type anchor missing'
s=s.replace(old,new,1)

old="`booking_sessions?guest_id=eq.${guestDbId}&select=service_type,resource_code,requested_date,requested_time,end_date,party_size,quantity,status,booking_code&limit=1`"
new="`booking_sessions?guest_id=eq.${guestDbId}&select=service_type,resource_code,requested_date,requested_time,end_date,party_size,quantity,special_request,status,booking_code&limit=1`"
assert old in s, 'session select anchor missing'
s=s.replace(old,new,1)

old="""  let session = await loadLineBookingSession(identity.guestDbId);\n  let lineOnlyContact = false;\n\n  // LINE is already a verified channel."""
new="""  let session = await loadLineBookingSession(identity.guestDbId);\n  let lineOnlyContact = false;\n\n  // Special requests are captured by Thongthai inside the booking flow and\n  // stored on the booking itself. Empty string means the guest explicitly said none.\n  if (session?.status === 'awaiting_special_request') {\n    const noRequest = /^(?:ไม่มี|ไม่มีครับ|ไม่มีค่ะ|ไม่ต้อง|ไม่เป็นไร|none|no|nope)$/iu.test(text);\n    const specialRequest = noRequest ? '' : text.replace(/\\s+/g, ' ').trim().slice(0, 1000);\n    if (!noRequest && !specialRequest) {\n      return 'ถ้าไม่มีคำขอพิเศษ ตอบว่า “ไม่มี” ได้เลยครับ หรือบอกสิ่งที่อยากให้ทีมเตรียมไว้ได้เลย';\n    }\n    await saveLineBookingSession(identity.guestDbId, environment, {\n      status: 'collecting',\n      special_request: specialRequest,\n    });\n    session = { ...session, status: 'collecting', special_request: specialRequest };\n  }\n\n  // LINE is already a verified channel."""
assert old in s, 'line session anchor missing'
s=s.replace(old,new,1)

old="""      service_type: 'stay', resource_code: null, requested_date: null, requested_time: null,\n      end_date: null, party_size: null, quantity: 1, status: 'collecting', booking_code: null,\n    };"""
new="""      service_type: 'stay', resource_code: null, requested_date: null, requested_time: null,\n      end_date: null, party_size: null, quantity: 1, special_request: null, status: 'collecting', booking_code: null,\n    };"""
assert old in s, 'session init anchor missing'
s=s.replace(old,new,1)

old="""  if (!contact.phone && !lineOnlyContact) {\n    await saveLineBookingSession(identity.guestDbId, environment, { status: 'awaiting_phone' });\n    return 'ขอบคุณครับ ขอเบอร์โทรสำรองสำหรับทีมงานอีกนิดครับ (ถ้าสะดวกให้ติดต่อทาง LINE นี้อย่างเดียว ตอบว่า “ใช้ LINE นี้ได้เลย” ได้ครับ)';\n  }\n\n  let created: { bookingCode: string; status: string; startAt: string; endAt: string };"""
new="""  if (!contact.phone && !lineOnlyContact) {\n    await saveLineBookingSession(identity.guestDbId, environment, { status: 'awaiting_phone' });\n    return 'ขอบคุณครับ ขอเบอร์โทรสำรองสำหรับทีมงานอีกนิดครับ (ถ้าสะดวกให้ติดต่อทาง LINE นี้อย่างเดียว ตอบว่า “ใช้ LINE นี้ได้เลย” ได้ครับ)';\n  }\n\n  if (session.special_request === null) {\n    await saveLineBookingSession(identity.guestDbId, environment, { status: 'awaiting_special_request' });\n    return 'ก่อนส่งคำขอจอง มีอะไรอยากให้ทองไทยแจ้งทีมเตรียมไว้เป็นพิเศษไหมครับ เช่น หมอนเพิ่ม เด็ก/ผู้สูงอายุ การเข้าถึง อาหาร/อาการแพ้ วันพิเศษ เวลาเข้าถึง หรือความต้องการเรื่องแม่บ้าน ถ้าไม่มีตอบว่า “ไม่มี” ได้เลยครับ';\n  }\n  const specialRequest = session.special_request.trim() || null;\n\n  let created: { bookingCode: string; status: string; startAt: string; endAt: string };"""
assert old in s, 'special request prompt anchor missing'
s=s.replace(old,new,1)

old="""      date: requestedDate, endDate, partySize, quantity,\n      customerName: contact.fullName, phone: suppliedPhone ?? contact.phone,\n      environment,\n    });"""
new="""      date: requestedDate, endDate, partySize, quantity,\n      customerName: contact.fullName, phone: suppliedPhone ?? contact.phone,\n      note: specialRequest,\n      environment,\n    });"""
assert old in s, 'create booking note anchor missing'
s=s.replace(old,new,1)

old="""  environment: 'live' | 'test';\n}): Promise<{ bookingCode: string; status: string; startAt: string; endAt: string }> {"""
new="""  environment: 'live' | 'test';\n  specialRequest?: string | null;\n}): Promise<{ bookingCode: string; status: string; startAt: string; endAt: string }> {"""
# first occurrence is createUnscheduledStayRequest input in this region
idx=s.find('async function createUnscheduledStayRequest')
assert idx>=0, 'unscheduled function missing'
sub=s[idx:]
assert old in sub, 'unscheduled input anchor missing'
sub=sub.replace(old,new,1)
s=s[:idx]+sub

old="""      source_channel: 'line',\n      staff_note: 'ยังไม่มีตารางจริงสำหรับช่วงนี้ — กรุณาตรวจสอบห้องว่างก่อนยืนยัน',"""
new="""      source_channel: 'line',\n      customer_note: input.specialRequest?.slice(0, 1000) ?? null,\n      staff_note: 'ยังไม่มีตารางจริงสำหรับช่วงนี้ — กรุณาตรวจสอบห้องว่างก่อนยืนยัน',"""
assert old in s, 'unscheduled note insert anchor missing'
s=s.replace(old,new,1)

old="""      date: requestedDate, endDate, partySize, quantity,\n      environment,\n    });"""
new="""      date: requestedDate, endDate, partySize, quantity,\n      environment, specialRequest,\n    });"""
# this exact anchor is the unscheduled call after catch
idx=s.find('created = await createUnscheduledStayRequest')
assert idx>=0, 'unscheduled call missing'
sub=s[idx:]
assert old in sub, 'unscheduled call anchor missing'
sub=sub.replace(old,new,1)
s=s[:idx]+sub

old="""  return `รับคำขอจองแล้วครับ ✅\\nเลขที่คำขอ: ${created.bookingCode}\\nเฮือนสเตย์ · ${thaiShortDate(requestedDate)} – ${thaiShortDate(endDate)}\\n${partySize} ท่าน · ${quantity} ห้อง\\n\\nสถานะ: รอทีมงานตรวจสอบห้องว่างและยืนยันกลับทาง LINE นี้ ลูกค้าไม่ต้องทักตามครับ\\nหมายเหตุ: ยังไม่ถือว่ายืนยันการจองจนกว่าจะได้รับข้อความยืนยันจากทีมงาน`;"""
new="""  const requestLine = specialRequest ? `\\nคำขอพิเศษ: ${specialRequest}\\nทีมงานจะตรวจสอบคำขอนี้พร้อมการจองครับ` : '';\n  return `รับคำขอจองแล้วครับ ✅\\nเลขที่คำขอ: ${created.bookingCode}\\nเฮือนสเตย์ · ${thaiShortDate(requestedDate)} – ${thaiShortDate(endDate)}\\n${partySize} ท่าน · ${quantity} ห้อง${requestLine}\\n\\nสถานะ: รอทีมงานตรวจสอบห้องว่างและยืนยันกลับทาง LINE นี้ ลูกค้าไม่ต้องทักตามครับ\\nหมายเหตุ: ยังไม่ถือว่ายืนยันการจองหรือคำขอพิเศษจนกว่าจะได้รับข้อความยืนยันจากทีมงาน`;"""
assert old in s, 'final reply anchor missing'
s=s.replace(old,new,1)

p.write_text(s)
