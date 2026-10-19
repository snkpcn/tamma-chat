# ทองไทย: ความเสถียร ข้อมูลจริง และงบ 2 บาท

## สิ่งที่ปรับ

- เส้นทางร่วมของ LINE/เว็บมีขอบเขตรับข้อผิดพลาด ไม่เรียก AI หรือทำรายการซ้ำหลัง backend ล้มเหลว และบอกลูกค้าว่ายังยืนยันผลไม่ได้
- การอ่าน/เขียนฐานข้อมูลหลักของ identity, memory, task, runtime, คาเฟ่, ร้านอาหาร, กิจกรรม, ที่พัก, OTOP, โปรโมชัน และ trace มี deadline 2.5 วินาทีต่อ HTTP request รวมถึงการอ่าน body ไม่ใช่ deadline ของบทสนทนาทั้งหมด ไม่มี retry อัตโนมัติใน helper นี้
- ปรับตัวเลขไทยและตัวคั่นที่มองไม่เห็นก่อนเข้า router/semantic parser ทั้งสองช่องทาง โดยรักษาคำปฏิเสธ ชื่อ และ emoji
- ลด hard cap ค่า AI เป็น 2 บาท การตั้งค่า environment ทำได้เฉพาะลดเพดาน ระบบเดิมใช้ CAS จองวงเงินก่อนเรียก provider และป้องกัน event ซ้ำ
- นับข้อความที่ตอบฟรีเป็นความเคลื่อนไหวของ conversation ด้วย เพื่อไม่รีเซ็ตค่า AI ระหว่างที่ลูกค้ายังคุยต่อเนื่อง
- บล็อก paid fallback เมื่อ Agent เดิมยังบันทึกต้นทุนไม่ครบ ไม่ถือว่าการไม่มี usage แปลว่าค่าใช้จ่ายเป็นศูนย์
- คงเส้นทางตอบจากข้อมูลจริงโดยไม่เรียก AI สำหรับคำถามและ continuation ที่ระบบยืนยันได้ ข้อความกำกวมต้องถามเพิ่ม ราคา/สต็อก/คิวใช้ข้อมูลหลังบ้าน ห้ามเดาตัวเลขจากแผนโครงการ

## นิยามงบและผลต่อ Agent

หนึ่ง conversation ใช้ conversation ID เดิมจนไม่มีความเคลื่อนไหวครบ 30 นาทีตามค่าเริ่มต้น `THONGTHAI_AI_CONVERSATION_IDLE_MS` ไม่ใช่เพดานตลอดอายุสมาชิก ค่าใช้จ่ายนี้เป็นค่า AI ตามราคาที่ตั้งไว้ใน `_ai-cost-policy.ts` และ `THONGTHAI_USD_TO_THB_RATE` ไม่รวม hosting หรือบริการอื่น ต้องเทียบราคาที่ตั้งกับ billing ของ provider ก่อนรับรองต้นทุนเงินจริงใน production

Agent แบบหลาย tool ยังต้องสำรอง 2.75 บาทต่อ turn จึงไม่สามารถเริ่ม paid turn ใหม่ภายใต้เพดาน 2 บาท เส้นทาง customer จะใช้ One-Mind/ตัวตอบจากข้อมูลจริงที่มี cost guard แทน ไม่ลดเงินสำรองโดยไม่มีหลักฐานค่าใช้จ่ายรองรับ เมื่อวงเงินไม่พอ การตอบจากข้อมูลจริงหรือถามเพิ่มยังทำได้ แต่การตีความภาษาที่ซับซ้อนด้วย AI อาจหยุดก่อนครบ 2 บาทเพราะต้องสำรองกรณีเลวร้ายที่สุด

## Monitor

หน้า UI อยู่ในโปรเจค `tamma-backoffice` ที่ `/thongthai-monitor.html` เปิดจากเมนู “ทองไทย Log / Monitor” หรือหน้าสรุปต้นทุน AI ได้ ใช้ login เจ้าของเดิม อ่านข้อมูลผ่าน API ฝั่ง server เท่านั้น กรองวันที่ตามเวลาไทย ช่องทาง และ conversation ID ได้ มี pagination 50 ข้อความต่อหน้าและอัปเดตอัตโนมัติเมื่อเลือกไว้ สถิติบนหน้าเป็นยอดของรายการในหน้านั้น ไม่ใช่ทั้งระบบ

`customer_turn_outcomes` เก็บผลสำเร็จ/ล้มเหลวและชนิด error ของ core เป็นข้อมูลเชิงระบบ 24 ชั่วโมง เพื่อให้ข้อความที่ล้มเหลวก่อนสร้าง response row ยังปรากฏใน monitor ได้ การเขียนส่วนนี้มี deadline 1 วินาทีและไม่ทำให้คำตอบลูกค้าล้มเหลว ถ้าการเขียนล้มเหลวต้องตรวจ function logs ควบคู่กัน

มี migration เพิ่ม view `public.thongthai_customer_turn_monitor` สำหรับ server/service role เท่านั้น ต้องมี `ai_api_cost_events`, `ai_response_turns` และ `one_mind_traces` จาก migration เดิมอยู่ก่อน จึง apply `20261009090000_customer_turn_monitor_v1.sql` ได้

```sql
select occurred_at, channel, event_id, final_response_source,
       cost_thb, cost_accounting_available, recorded_ai_calls,
       failed_ai_calls, knowledge_sources, used_fact_keys,
       degradation_condition, failure_reasons, state_persisted, total_ms
from public.thongthai_customer_turn_monitor
where environment = 'live'
order by occurred_at desc
limit 100;
```

`cost_thb = NULL` หมายถึงยังยืนยันบัญชีต้นทุนไม่ได้ ไม่ใช่ฟรี ส่วนรายละเอียด One-Mind trace เก็บ 24 ชั่วโมงตามระบบเดิม เส้นทาง legacy บางส่วนยังมี source `legacy_or_unclassified` และไม่มี detailed trace ต้องอ่านควบคู่กับ function logs ไม่ควรถือว่าทุกเส้นทางมีข้อมูลแหล่งอ้างอิงครบแล้ว

Function logs ใช้ `event_id` ผูกกับข้อความเดียวกัน:

- `THONGTHAI_CUSTOMER_TURN`: ผลสำเร็จ/ล้มเหลว ระยะเวลา และชนิด error โดยไม่เก็บข้อความลูกค้า
- `THONGTHAI_RESPONSE_SOURCE`: แหล่งคำตอบ การใช้ model และการมีข้อมูลจริง แม้การเขียน telemetry ล้มเหลว
- `THONGTHAI_AI_COST`: การเรียก AI ต้นทุน วงเงินที่เหลือ และเหตุผลที่ถูกบล็อก
- `THONGTHAI_ONE_MIND_TRACE`: แหล่งความรู้ fact keys การจำบริบท ความขัดแย้ง state และขั้นตอนที่ลดระดับการตอบ

ข้อผิดพลาดที่หลุดถึงขอบเขตร่วมจะแสดง diagnostic status 503 ใน log แต่คืน HTTP 200 พร้อมข้อความช่วยลูกค้า เพื่อไม่ให้ transport ทำคำขอจอง/สั่งซื้อซ้ำโดยอัตโนมัติ ผลรายการยังไม่ถูกยืนยัน

## การตรวจสอบและขอบเขต

ชุดทดสอบเดิมครอบคลุมภาษาไทยหลาย turn, context, concurrent state, source unavailable/empty, การตอบจากข้อมูลจริง และ provider outage เพิ่มการทดสอบเลขไทย/ตัวคั่น, deadline หลังได้รับ headers, การยกเลิก request, ledger จริงที่จองวงเงินจนติดเพดาน 2 บาท, Agent usage ที่ยังไม่ครบ และ SQL view ที่รวมต้นทุน/trace รวมทั้งการปิดสิทธิ์ anon

ใช้ `npm test` โดยไม่ต้องมี credentials จริง การทดสอบ deadline ใช้ HTTP server บน localhost ชั่วคราวเท่านั้น ชุดทดสอบไม่ได้ยืนยัน LINE webhook จริง ข้อมูลใน Supabase production หรือคุณภาพโมเดลที่เรียกจริง

ยังไม่ได้ apply migration หรือ deploy จากงานนี้ ขั้นตอน production คือ apply view ผ่านช่องทางฐานข้อมูลที่ใช้งานอยู่ แล้ว deploy โค้ด ทดสอบลูกค้าจำลองบน LINE/เว็บและเทียบ cost events กับ billing ก่อนประกาศว่าครบทั้ง 8 ข้อในระบบจริง
