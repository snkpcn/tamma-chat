from pathlib import Path

p = Path('netlify/functions/_operations-db.ts')
s = p.read_text()

old = "  let requestedDate = session.requested_date ?? bookingDateFromText(text);\n"
new = "  let requestedDate = bookingDateFromText(text) ?? session.requested_date;\n"
assert old in s, 'requestedDate priority anchor not found'
s = s.replace(old, new, 1)

old_catch = '''  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('no_matching_schedule')) throw error;
    created = await createUnscheduledStayRequest({
      guestDbId: identity.guestDbId, customerId: identity.customerId,
      date: requestedDate, endDate, partySize, quantity,
      environment,
    });
  }
'''
new_catch = '''  } catch (error) {
    if (error instanceof Error && error.message.includes('schedule_full')) {
      const nearest = await findNearestStayAvailability(requestedDate, endDate, quantity, environment, 30);
      if (nearest) {
        await saveLineBookingSession(identity.guestDbId, environment, {
          requested_date: nearest.date,
          end_date: nearest.endDate,
          party_size: partySize,
          quantity,
          status: 'collecting',
          booking_code: null,
        });
        return `ขออภัยครับ ช่วง ${thaiShortDate(requestedDate)} – ${thaiShortDate(endDate)} ห้องเต็มแล้วครับ ❌\\nวันที่ใกล้สุดที่ยังมีห้องพอคือ ${thaiShortDate(nearest.date)} – ${thaiShortDate(nearest.endDate)} (${nearest.available} หลังว่าง)\\n\\nถ้าต้องการช่วงนี้ ตอบว่า “จองวันที่นี้” ได้เลยครับ`;
      }
      return `ขออภัยครับ ช่วง ${thaiShortDate(requestedDate)} – ${thaiShortDate(endDate)} ห้องเต็มแล้วครับ ❌ และยังไม่พบช่วงที่มีห้องพอใน 30 วันถัดไป กรุณาเลือกวันอื่นครับ`;
    }
    if (!(error instanceof Error) || !error.message.includes('no_matching_schedule')) throw error;
    created = await createUnscheduledStayRequest({
      guestDbId: identity.guestDbId, customerId: identity.customerId,
      date: requestedDate, endDate, partySize, quantity,
      environment,
    });
  }
'''
assert old_catch in s, 'stay booking catch anchor not found'
s = s.replace(old_catch, new_catch, 1)

anchor = '''export interface CreateBookingInput {
'''
helper = '''function shiftIsoDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function findNearestStayAvailability(
  date: string,
  endDate: string,
  quantity: number,
  environment: 'live' | 'test',
  maxDays = 30,
): Promise<{ date: string; endDate: string; available: number } | null> {
  const nights = Math.round((new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86400000);
  if (nights < 1) return null;
  for (let offset = 1; offset <= maxDays; offset += 1) {
    const candidateDate = shiftIsoDate(date, offset);
    const candidateEnd = shiftIsoDate(endDate, offset);
    const options = await scheduleRowsForBooking({
      serviceType: 'stay',
      date: candidateDate,
      endDate: candidateEnd,
      environment,
    });
    if (options.length !== nights) continue;
    const available = Math.min(...options.map(option => option.available));
    if (available >= quantity) return { date: candidateDate, endDate: candidateEnd, available };
  }
  return null;
}

'''
assert anchor in s, 'CreateBookingInput anchor not found'
s = s.replace(anchor, helper + anchor, 1)

p.write_text(s)
