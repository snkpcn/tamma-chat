/** Basic questions in Chinese, Lao and Vietnamese, read without the model.
 *
 *  Every zh/lo/vi message used to take two paid calls and was then answered
 *  by an English fallback. A closed set of question shapes per language is
 *  read as the Thai question it is -- the same rewrite the English reader
 *  (_english-basic-question.ts) does -- and the turn keeps the customer's
 *  language, so each responder renders its own template for that language
 *  (_reply-templates.ts). Anything outside these shapes keeps the normal
 *  path. Transaction and money words are never a basic question. */
import { readEnglishBasicQuestion, type EnglishBasicQuestion } from './_english-basic-question';

export type BasicQuestion = { topic: EnglishBasicQuestion['topic'] | 'greeting'; canonical: string };

type Lexicon = {
  greeting: RegExp;
  activities: RegExp;
  price: RegExp;
  menu: RegExp;
  hours: RegExp;
  restaurant: RegExp;
  cafe: RegExp;
  available: RegExp;
  minutes: RegExp;
  lengthReply: RegExp;
  today: RegExp;
  tomorrow: RegExp;
  /** Bookings, payments, money matters: never a basic question. */
  not: RegExp;
  activityNames: ReadonlyArray<[RegExp, string]>;
};

const LEXICON: Record<'zh' | 'lo' | 'vi', Lexicon> = {
  zh: {
    greeting: /^(?:你好|您好|嗨|哈喽|哈啰|早上好|下午好|晚上好|大家好)(?:呀|啊|哦)?$/u,
    activities: /(?:有|有些)?(?:什么|哪些)(?:活动|好玩的|可以玩的|项目)|(?:可以|能)(?:做|玩)(?:些)?什么|活动有哪些/u,
    price: /多少钱|价格|价钱|收费|费用/u,
    menu: /菜单|有什么(?:吃的|菜|好吃的)|推荐(?:什么|一下|些)?(?:菜|吃的)/u,
    hours: /(?:几点|什么时候)(?:开门|营业|关门|打烊)|营业时间/u,
    restaurant: /餐厅|饭店|餐馆/u,
    cafe: /咖啡/u,
    available: /有空|有位|空位|还有位置|有名额/u,
    minutes: /(\d{1,3})\s*分钟/u,
    lengthReply: /^(\d{1,3})\s*分钟$/u,
    today: /今天/u,
    tomorrow: /明天/u,
    not: /预订|下单|付款|付钱|取消|退款|退钱|打折|折扣|优惠|便宜|讲价/u,
    activityNames: [[/骑马/u, 'ขี่ม้า'], [/全地形车|沙滩车|atv/iu, 'ATV'], [/射箭/u, 'ยิงธนู'], [/脚踏船|鸭子船/u, 'ปั่นเป็ดน้ำ']],
  },
  lo: {
    greeting: /^ສະບາຍດີ(?:ເດີ້|ຄັບ|ເຈົ້າ|ຈ້າ)?$/u,
    activities: /ມີກິດຈະກຳຫຍັງ|ມີຫຍັງໃຫ້ເຮັດ|ມີຫຍັງຫຼິ້ນ|ກິດຈະກຳມີຫຍັງ/u,
    price: /ລາຄາ|ເທົ່າໃດ|ຈັກບາດ|ຈັກກີບ/u,
    menu: /ເມນູ|ມີຫຍັງກິນ|ອາຫານຫຍັງ|ແນະນຳອາຫານ/u,
    hours: /(?:ເປີດ|ປິດ)(?:ຈັກ|ກີ່)ໂມງ|ເວລາ(?:ເປີດ|ປິດ)/u,
    restaurant: /ຮ້ານອາຫານ/u,
    cafe: /ຄາເຟ|ກາເຟ/u,
    available: /ຫວ່າງ/u,
    minutes: /(\d{1,3})\s*ນາທີ/u,
    lengthReply: /^(\d{1,3})\s*ນາທີ$/u,
    today: /ມື້ນີ້/u,
    tomorrow: /ມື້ອື່ນ/u,
    not: /ຈອງ|ຈ່າຍ|ຍົກເລີກ|ຄືນເງິນ|ເງິນຄືນ|ຫຼຸດ|ສ່ວນຫຼຸດ|ໂປຣ/u,
    activityNames: [[/ຂີ່ມ້າ/u, 'ขี่ม้า'], [/atv|ເອທີວີ/iu, 'ATV'], [/ຍິງທະນູ|ຍິງທນູ/u, 'ยิงธนู'], [/ເຮືອເປັດ|ຖີບເປັດ/u, 'ปั่นเป็ดน้ำ']],
  },
  vi: {
    greeting: /^(?:xin chào|xin chao|chào bạn|chào anh|chào chị|chào em|chào)(?: ạ| nhé)?$/u,
    activities: /có (?:những )?(?:hoạt động|trò chơi) (?:gì|nào)|có gì (?:để )?(?:làm|chơi)|ở đây (?:có gì|làm gì)|hoạt động (?:gì|nào)/u,
    price: /giá|bao nhiêu|bao nhieu/u,
    menu: /thực đơn|menu|có (?:những )?món (?:gì|nào)|món (?:gì|nào) ngon/u,
    hours: /mấy giờ (?:mở|đóng) cửa|giờ mở cửa|mở cửa (?:lúc|từ|đến) mấy giờ/u,
    restaurant: /nhà hàng/u,
    cafe: /cà phê|cafe|café/u,
    available: /còn chỗ|còn trống|có trống|trống không|còn suất|có chỗ/u,
    minutes: /(\d{1,3})\s*phút/u,
    lengthReply: /^(\d{1,3})\s*phút$/u,
    today: /hôm nay/u,
    tomorrow: /ngày mai/u,
    not: /đặt (?:chỗ|bàn|vé|hàng)|thanh toán|hủy|hoàn tiền|giảm giá|khuyến mãi|mặc cả/u,
    activityNames: [[/cưỡi ngựa|cuoi ngua/u, 'ขี่ม้า'], [/atv|xe địa hình/u, 'ATV'], [/bắn cung/u, 'ยิงธนู'], [/đạp vịt|thuyền đạp/u, 'ปั่นเป็ดน้ำ']],
  },
};

function normalize(message: string): string {
  return message.normalize('NFC').toLowerCase().replace(/[?？!！。.,，~～]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

export function readBasicQuestion(message: string, language: string): BasicQuestion | null {
  if (language === 'en') return readEnglishBasicQuestion(message);
  if (language !== 'zh' && language !== 'lo' && language !== 'vi') return null;
  const lex = LEXICON[language];
  const text = normalize(message);
  if (!text || text.length > 60) return null;

  const length = lex.lengthReply.exec(text);
  if (length) return { topic: 'length_reply', canonical: `${Number(length[1])} นาที` };
  if (lex.not.test(text)) return null;
  if (lex.greeting.test(text)) return { topic: 'greeting', canonical: 'สวัสดีครับ' };

  const named = lex.activityNames.filter(([pattern]) => pattern.test(text));
  const day = lex.tomorrow.test(text) ? 'พรุ่งนี้' : lex.today.test(text) ? 'วันนี้' : '';
  if (named.length === 1 && lex.available.test(text)) {
    const minutes = lex.minutes.exec(text);
    return { topic: 'activity_availability', canonical: `${day}${named[0]![1]}${minutes ? ` ${Number(minutes[1])} นาที` : ''}ว่างไหม` };
  }
  if (named.length === 1 && lex.price.test(text)) return { topic: 'activity_price', canonical: `${named[0]![1]}ราคาเท่าไหร่` };
  if (named.length) return null;

  // Regular hours only: "today"/"tomorrow" asks about one day's status.
  if (lex.hours.test(text) && !day) {
    const restaurant = lex.restaurant.test(text);
    const cafe = lex.cafe.test(text);
    if (restaurant && cafe) return null;
    if (restaurant) return { topic: 'unit_hours', canonical: 'ร้านอาหารเปิดกี่โมง' };
    if (cafe) return { topic: 'unit_hours', canonical: 'คาเฟ่เปิดกี่โมง' };
    return { topic: 'hours', canonical: 'เปิดกี่โมง' };
  }
  if (lex.menu.test(text)) return { topic: 'menu', canonical: 'มีเมนูอะไรแนะนำบ้าง' };
  if (lex.activities.test(text)) return { topic: 'activities', canonical: 'มีกิจกรรมอะไรบ้าง' };
  return null;
}
