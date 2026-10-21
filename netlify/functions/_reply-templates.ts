/** Fixed reply wording for the deterministic answers, in every language the
 *  site offers (th, en, zh, lo, vi).
 *
 *  Only sentences live here. Every number, price, time and name is passed in
 *  from live data and inserted as is: a template never translates a figure,
 *  and a stored name with no translation stays as stored. English is the
 *  wording the renderers already used; zh, lo and vi were added for the
 *  customers who write in them (they should be reviewed by native speakers).
 *  A language without its own entry falls back to English, never to Thai. */
import type { CustomerLanguage } from './_customer-language';

export type ReplyLanguage = 'en' | 'zh' | 'lo' | 'vi';
type Table<T> = Record<ReplyLanguage, T>;

/** The non-Thai reply language for `language` (English for ja/ko). */
export function replyLanguage(language: CustomerLanguage | string): ReplyLanguage {
  return language === 'zh' || language === 'lo' || language === 'vi' ? language : 'en';
}

const money: Table<(value: number) => string> = {
  en: value => `${Math.round(value)} THB`,
  zh: value => `${Math.round(value)} 泰铢`,
  lo: value => `${Math.round(value)} ບາດ`,
  vi: value => `${Math.round(value)} baht`,
};
const duration: Table<(minutes: number) => string> = {
  en: minutes => minutes === 60 ? '1 hour' : `${minutes} min`,
  zh: minutes => minutes === 60 ? '1 小时' : `${minutes} 分钟`,
  lo: minutes => minutes === 60 ? '1 ຊົ່ວໂມງ' : `${minutes} ນາທີ`,
  vi: minutes => minutes === 60 ? '1 giờ' : `${minutes} phút`,
};

export const T = {
  money: (l: ReplyLanguage, value: number) => money[l](value),
  duration: (l: ReplyLanguage, minutes: number) => duration[l](minutes),

  greeting: {
    en: "Hi, I'm Thongthai 😊 I can help with dining, stays, activities, location, weather, or planning your trip.",
    zh: '您好，我是 Thongthai 😊 可以帮您了解餐饮、住宿、活动、位置、天气，或安排行程。',
    lo: 'ສະບາຍດີ ຂ້ອຍແມ່ນທອງໄທ 😊 ຊ່ວຍໄດ້ເລື່ອງ ອາຫານ, ທີ່ພັກ, ກິດຈະກຳ, ສະຖານທີ່, ອາກາດ ຫຼື ຈັດທ່ຽວ.',
    vi: 'Xin chào, tôi là Thongthai 😊 Tôi có thể giúp về ăn uống, chỗ ở, hoạt động, vị trí, thời tiết hoặc lên lịch trình.',
  } as Table<string>,

  catalog: {
    opener: { en: 'Here’s what Thammachat offers 😊', zh: '这里是 Thammachat 提供的内容 😊', lo: 'ນີ້ແມ່ນສິ່ງທີ່ Thammachat ມີ 😊', vi: 'Đây là những gì Thammachat có 😊' } as Table<string>,
    dining: { en: 'Dining', zh: '餐饮', lo: 'ອາຫານ', vi: 'Ăn uống' } as Table<string>,
    activities: { en: 'Activities', zh: '活动', lo: 'ກິດຈະກຳ', vi: 'Hoạt động' } as Table<string>,
    stay: { en: 'Stay', zh: '住宿', lo: 'ທີ່ພັກ', vi: 'Chỗ ở' } as Table<string>,
    relax: { en: 'Relax', zh: '休闲', lo: 'ພັກຜ່ອນ', vi: 'Thư giãn' } as Table<string>,
    cafe: { en: 'Café', zh: '咖啡馆', lo: 'ຄາເຟ່', vi: 'Quán cà phê' } as Table<string>,
    noRounds: {
      en: 'no activity rounds are open for booking right now', zh: '目前没有开放预订的活动场次',
      lo: 'ຕອນນີ້ຍັງບໍ່ມີຮອບກິດຈະກຳເປີດໃຫ້ຈອງ', vi: 'hiện chưa có lượt hoạt động nào mở đặt',
    } as Table<string>,
    unreadable: {
      en: 'I can’t check the latest activity list right now; our staff will confirm it', zh: '目前无法查看最新活动列表，工作人员会再确认',
      lo: 'ຕອນນີ້ຍັງກວດລາຍການກິດຈະກຳລ່າສຸດບໍ່ໄດ້ ພະນັກງານຈະຢືນຢັນໃຫ້', vi: 'hiện tôi chưa kiểm tra được danh sách hoạt động mới nhất; nhân viên sẽ xác nhận',
    } as Table<string>,
    closingOk: {
      en: 'Tell me how many people and when you’re free, and I’ll put together a short plan.', zh: '告诉我人数和有空的时间，我帮您安排一个简短的行程。',
      lo: 'ບອກຈຳນວນຄົນ ແລະ ເວລາທີ່ສະດວກ ທອງໄທຈະຈັດແຜນສັ້ນໆໃຫ້.', vi: 'Hãy cho tôi biết số người và thời gian rảnh, tôi sẽ lên một kế hoạch ngắn.',
    } as Table<string>,
    closingUnverified: {
      en: 'Tell me how many people and when you’re free. Our staff will confirm which activities are open.', zh: '告诉我人数和有空的时间。开放哪些活动，工作人员会再确认。',
      lo: 'ບອກຈຳນວນຄົນ ແລະ ເວລາທີ່ສະດວກ. ພະນັກງານຈະຢືນຢັນວ່າກິດຈະກຳໃດເປີດ.', vi: 'Hãy cho tôi biết số người và thời gian rảnh. Nhân viên sẽ xác nhận hoạt động nào đang mở.',
    } as Table<string>,
  },

  price: {
    options: {
      en: (name: string, parts: string[]) => `${name}: ${parts.join(' or ')} 😊`,
      zh: (name: string, parts: string[]) => `${name}：${parts.join('，或 ')} 😊`,
      lo: (name: string, parts: string[]) => `${name}: ${parts.join(' ຫຼື ')} 😊`,
      vi: (name: string, parts: string[]) => `${name}: ${parts.join(' hoặc ')} 😊`,
    } as Table<(name: string, parts: string[]) => string>,
    option: {
      en: (length: string, price: string) => `${length} for ${price}`,
      zh: (length: string, price: string) => `${length} ${price}`,
      lo: (length: string, price: string) => `${length} ${price}`,
      vi: (length: string, price: string) => `${length} giá ${price}`,
    } as Table<(length: string, price: string) => string>,
    unset: { en: '(no price set yet)', zh: '（尚未定价）', lo: '(ຍັງບໍ່ໄດ້ຕັ້ງລາຄາ)', vi: '(chưa có giá)' } as Table<string>,
    unknown: {
      en: (name: string) => `I don’t have a confirmed price for ${name} in our system yet, so I won’t guess.`,
      zh: (name: string) => `系统里还没有${name}的确认价格，我不会乱猜。`,
      lo: (name: string) => `ໃນລະບົບຍັງບໍ່ມີລາຄາທີ່ຢືນຢັນສຳລັບ${name} ທອງໄທຈະບໍ່ເດົາ.`,
      vi: (name: string) => `Hệ thống chưa có giá xác nhận cho ${name}, nên tôi sẽ không đoán.`,
    } as Table<(name: string) => string>,
    boats: {
      en: (n: number) => ` We have ${n} pedal boats.`, zh: (n: number) => ` 目前有 ${n} 艘脚踏船。`,
      lo: (n: number) => ` ຕອນນີ້ມີເຮືອເປັດ ${n} ລຳ.`, vi: (n: number) => ` Hiện có ${n} thuyền đạp vịt.`,
    } as Table<(n: number) => string>,
  },

  menu: {
    intro: { en: '🍽️ Dishes worth trying right now', zh: '🍽️ 现在值得一试的菜', lo: '🍽️ ເມນູທີ່ໜ້າລອງຕອນນີ້', vi: '🍽️ Các món nên thử lúc này' } as Table<string>,
    askParty: {
      en: 'How many of you are coming? I can help size it for your table.', zh: '请问几位？我可以帮您按人数搭配。',
      lo: 'ມາຈັກຄົນ? ທອງໄທຊ່ວຍຈັດໃຫ້ພໍດີໂຕະໄດ້.', vi: 'Bạn đi mấy người? Tôi có thể giúp chọn món vừa đủ cho bàn.',
    } as Table<string>,
    more: {
      en: 'I can send the full menu if you’d like to see more.', zh: '如果想看更多，我可以发完整菜单。',
      lo: 'ຖ້າຢາກເບິ່ງເພີ່ມ ທອງໄທສົ່ງເມນູເຕັມໃຫ້ໄດ້.', vi: 'Nếu muốn xem thêm, tôi có thể gửi toàn bộ thực đơn.',
    } as Table<string>,
    readFailed: {
      en: 'I couldn’t read the latest menu and prices just now, so I can’t recommend dishes yet. Please try again in a moment.',
      zh: '现在暂时读不到最新的菜单和价格，所以还无法推荐菜品，请稍后再试。',
      lo: 'ຕອນນີ້ຍັງອ່ານເມນູ ແລະ ລາຄາລ່າສຸດບໍ່ໄດ້ ຈຶ່ງຍັງແນະນຳອາຫານບໍ່ໄດ້ ກະລຸນາລອງໃໝ່ອີກຈັກໜ້ອຍ.',
      vi: 'Hiện tôi chưa đọc được thực đơn và giá mới nhất, nên chưa thể gợi ý món. Vui lòng thử lại sau ít phút.',
    } as Table<string>,
    unavailable: {
      sold_out: { en: 'Everything you asked about is sold out right now.', zh: '您问的菜目前都卖完了。', lo: 'ສິ່ງທີ່ຖາມຕອນນີ້ໝົດທຸກລາຍການແລ້ວ.', vi: 'Những món bạn hỏi hiện đã hết.' },
      no_stock_data: {
        en: 'I don’t have current stock data for the menu, so I can’t confirm which dishes are available right now.',
        zh: '目前没有菜单的最新库存数据，所以无法确认哪些菜现在有供应。',
        lo: 'ຕອນນີ້ຍັງບໍ່ມີຂໍ້ມູນສະຕັອກລ່າສຸດຂອງເມນູ ຈຶ່ງຢືນຢັນບໍ່ໄດ້ວ່າເມນູໃດພ້ອມຂາຍ.',
        vi: 'Hiện chưa có dữ liệu tồn kho mới nhất của thực đơn, nên tôi không xác nhận được món nào đang có.',
      },
      constraints: { en: 'No dish that fits those requirements is in stock right now.', zh: '目前没有符合这些要求且有库存的菜。', lo: 'ຕອນນີ້ບໍ່ມີເມນູທີ່ກົງເງື່ອນໄຂ ແລະ ມີສະຕັອກ.', vi: 'Hiện không có món nào phù hợp yêu cầu mà còn hàng.' },
      no_items: { en: 'There are no menu items in our system to confirm right now.', zh: '系统里目前没有可确认的菜单项目。', lo: 'ຕອນນີ້ໃນລະບົບບໍ່ມີລາຍການເມນູໃຫ້ຢືນຢັນ.', vi: 'Hiện hệ thống không có món nào để xác nhận.' },
    } as Record<'sold_out' | 'no_stock_data' | 'constraints' | 'no_items', Table<string>>,
  },

  hours: {
    venue: {
      en: (o: string, c: string) => `Our regular hours are ${o}–${c} every day, with no weekly closing day.`,
      zh: (o: string, c: string) => `我们的正常营业时间是每天 ${o}–${c}，没有固定休息日。`,
      lo: (o: string, c: string) => `ເວລາເປີດປົກກະຕິແມ່ນທຸກມື້ ${o}–${c} ບໍ່ມີມື້ພັກປະຈຳອາທິດ.`,
      vi: (o: string, c: string) => `Giờ mở cửa thường lệ là ${o}–${c} mỗi ngày, không có ngày nghỉ cố định trong tuần.`,
    } as Table<(o: string, c: string) => string>,
    cafe: {
      en: (name: string, o: string, c: string) => `The café (${name}) is open ${o}–${c} every day.`,
      zh: (name: string, o: string, c: string) => `咖啡馆（${name}）每天 ${o}–${c} 营业。`,
      lo: (name: string, o: string, c: string) => `ຄາເຟ່ (${name}) ເປີດທຸກມື້ ${o}–${c}.`,
      vi: (name: string, o: string, c: string) => `Quán cà phê (${name}) mở cửa ${o}–${c} mỗi ngày.`,
    } as Table<(name: string, o: string, c: string) => string>,
    restaurantNone: {
      en: (name: string) => `I don’t have separate opening hours for the restaurant (${name}) on record, so I won’t guess.`,
      zh: (name: string) => `系统里没有餐厅（${name}）单独的营业时间，我不会乱猜。`,
      lo: (name: string) => `ໃນລະບົບຍັງບໍ່ມີເວລາເປີດ–ປິດແຍກຂອງຮ້ານອາຫານ (${name}) ທອງໄທຈະບໍ່ເດົາ.`,
      vi: (name: string) => `Hệ thống chưa có giờ mở cửa riêng của nhà hàng (${name}), nên tôi sẽ không đoán.`,
    } as Table<(name: string) => string>,
    restaurantVenue: {
      en: (o: string, c: string) => ` Thammachat as a whole is open ${o}–${c} every day; please check with the team before coming for an early or late meal.`,
      zh: (o: string, c: string) => ` Thammachat 整体每天 ${o}–${c} 营业；如果想早上或傍晚用餐，请先向工作人员确认。`,
      lo: (o: string, c: string) => ` ພື້ນທີ່ Thammachat ເປີດທຸກມື້ ${o}–${c}; ຖ້າຈະມາກິນຕອນເຊົ້າ ຫຼື ແລງ ແນະນຳໃຫ້ສອບຖາມທີມງານກ່ອນ.`,
      vi: (o: string, c: string) => ` Toàn khu Thammachat mở cửa ${o}–${c} mỗi ngày; nếu muốn ăn sớm hoặc muộn, vui lòng hỏi nhân viên trước.`,
    } as Table<(o: string, c: string) => string>,
  },

  item: {
    available: {
      en: (name: string, price: string) => `${name} is available, ${price}`, zh: (name: string, price: string) => `${name}有，${price}，现在可以点`,
      lo: (name: string, price: string) => `${name} ມີ ${price} ພ້ອມສັ່ງ`, vi: (name: string, price: string) => `${name} đang có, ${price}`,
    } as Table<(name: string, price: string) => string>,
    soldOut: {
      en: (name: string) => `${name} is sold out right now`, zh: (name: string) => `${name}目前已售完`,
      lo: (name: string) => `${name} ຕອນນີ້ໝົດແລ້ວ`, vi: (name: string) => `${name} hiện đã hết`,
    } as Table<(name: string) => string>,
    menuNoData: {
      en: (name: string, price: string) => `${name} (${price}) is on the menu, but I have no current stock figure, so I can’t confirm it’s available now`,
      zh: (name: string, price: string) => `${name}（${price}）在菜单上，但目前没有最新库存数据，无法确认现在能否点`,
      lo: (name: string, price: string) => `${name} (${price}) ມີໃນເມນູ ແຕ່ຍັງບໍ່ມີຂໍ້ມູນສະຕັອກລ່າສຸດ ຢືນຢັນບໍ່ໄດ້ວ່າພ້ອມສັ່ງ`,
      vi: (name: string, price: string) => `${name} (${price}) có trong thực đơn, nhưng chưa có số liệu tồn kho mới nhất nên tôi không xác nhận được là còn`,
    } as Table<(name: string, price: string) => string>,
    inStock: {
      en: (name: string, n: number, price: string) => `${name} is in stock (${n} left), ${price}`,
      zh: (name: string, n: number, price: string) => `${name}有货（剩 ${n} 件），${price}`,
      lo: (name: string, n: number, price: string) => `${name} ມີ ເຫຼືອ ${n} ຊິ້ນ ລາຄາ ${price}`,
      vi: (name: string, n: number, price: string) => `${name} còn hàng (còn ${n}), ${price}`,
    } as Table<(name: string, n: number, price: string) => string>,
    listedNoData: {
      en: (name: string, price: string) => `${name} (${price}) is listed, but I have no current stock figure, so I can’t confirm any are left`,
      zh: (name: string, price: string) => `${name}（${price}）在列表上，但目前没有最新库存数据，无法确认还有没有`,
      lo: (name: string, price: string) => `${name} (${price}) ມີໃນລາຍການ ແຕ່ຍັງບໍ່ມີຂໍ້ມູນສະຕັອກລ່າສຸດ ຢືນຢັນບໍ່ໄດ້ວ່າຍັງເຫຼືອ`,
      vi: (name: string, price: string) => `${name} (${price}) có trong danh sách, nhưng chưa có số liệu tồn kho mới nhất nên tôi không xác nhận được là còn`,
    } as Table<(name: string, price: string) => string>,
    matches: { en: 'Here’s what matches:', zh: '符合您问的有：', lo: 'ທີ່ກົງກັບທີ່ຖາມມີດັ່ງນີ້:', vi: 'Những mục phù hợp:' } as Table<string>,
    end: { en: '.', zh: '。', lo: '.', vi: '.' } as Table<string>,
    partialFailure: {
      en: (what: 'menu' | 'products') => `(I couldn’t read ${what === 'menu' ? 'the menu' : 'the souvenir list'} just now.)`,
      zh: (what: 'menu' | 'products') => `（暂时读不到${what === 'menu' ? '菜单' : '纪念品列表'}。）`,
      lo: (what: 'menu' | 'products') => `(ຕອນນີ້ອ່ານ${what === 'menu' ? 'ເມນູອາຫານ' : 'ລາຍການຂອງຝາກ'}ບໍ່ໄດ້.)`,
      vi: (what: 'menu' | 'products') => `(Hiện tôi chưa đọc được ${what === 'menu' ? 'thực đơn' : 'danh sách quà lưu niệm'}.)`,
    } as Table<(what: 'menu' | 'products') => string>,
    readFailed: {
      en: (stem: string) => `I couldn’t read our live menu and product list just now, so I can’t confirm whether we have ${stem}. Please ask again in a moment.`,
      zh: (stem: string) => `现在读不到最新的菜单和商品列表，所以无法确认有没有${stem}，请稍后再问。`,
      lo: (stem: string) => `ຕອນນີ້ອ່ານເມນູ ແລະ ລາຍການສິນຄ້າລ່າສຸດບໍ່ໄດ້ ຈຶ່ງຢືນຢັນບໍ່ໄດ້ວ່າມີ${stem}ບໍ່ ກະລຸນາຖາມໃໝ່ອີກຈັກໜ້ອຍ.`,
      vi: (stem: string) => `Hiện tôi chưa đọc được thực đơn và danh sách sản phẩm, nên không xác nhận được có ${stem} không. Vui lòng hỏi lại sau ít phút.`,
    } as Table<(stem: string) => string>,
    notListed: {
      en: (stem: string) => `${stem} isn’t on our menu or souvenir list right now.`,
      zh: (stem: string) => `目前菜单和纪念品列表里没有${stem}。`,
      lo: (stem: string) => `ຕອນນີ້ບໍ່ມີ${stem}ໃນເມນູອາຫານ ແລະ ລາຍການຂອງຝາກ.`,
      vi: (stem: string) => `Hiện ${stem} không có trong thực đơn hoặc danh sách quà lưu niệm.`,
    } as Table<(stem: string) => string>,
  },

  rounds: {
    ask: {
      en: (name: string, what: 'day' | 'length' | 'both', lengths: string) => `I can check live ${name} slots for you — ${what === 'both' ? `which day, and how long${lengths}` : what === 'day' ? 'which day' : `how long${lengths}`}?`,
      zh: (name: string, what: 'day' | 'length' | 'both', lengths: string) => `我可以帮您查${name}的实时空位——${what === 'both' ? `哪一天、玩多久${lengths}` : what === 'day' ? '哪一天' : `玩多久${lengths}`}？`,
      lo: (name: string, what: 'day' | 'length' | 'both', lengths: string) => `ທອງໄທກວດຄິວຫວ່າງຂອງ${name}ຈາກລະບົບໃຫ້ໄດ້ ຢາກກວດ${what === 'both' ? `ມື້ໃດ ແລະ ຈັກນາທີ${lengths}` : what === 'day' ? 'ມື້ໃດ' : `ຈັກນາທີ${lengths}`}?`,
      vi: (name: string, what: 'day' | 'length' | 'both', lengths: string) => `Tôi có thể kiểm tra lượt trống của ${name} — ${what === 'both' ? `ngày nào, và bao lâu${lengths}` : what === 'day' ? 'ngày nào' : `bao lâu${lengths}`}?`,
    } as Table<(name: string, what: 'day' | 'length' | 'both', lengths: string) => string>,
    open: {
      en: (head: string, slots: string[]) => `${head}: open slots at ${slots.join(', ')}.`,
      zh: (head: string, slots: string[]) => `${head}：还有空位的时段 ${slots.join('、')}。`,
      lo: (head: string, slots: string[]) => `${head}: ຍັງຫວ່າງຮອບ ${slots.join(', ')}.`,
      vi: (head: string, slots: string[]) => `${head}: còn trống lúc ${slots.join(', ')}.`,
    } as Table<(head: string, slots: string[]) => string>,
    slot: {
      en: (time: string, free: number) => `${time} (${free} free)`, zh: (time: string, free: number) => `${time}（剩 ${free} 位）`,
      lo: (time: string, free: number) => `${time} (ຫວ່າງ ${free})`, vi: (time: string, free: number) => `${time} (còn ${free})`,
    } as Table<(time: string, free: number) => string>,
    bookHint: {
      en: ' Tell me which slot you’d like to book.', zh: ' 想预订哪个时段，告诉我就好。',
      lo: ' ຖ້າຈະຈອງ ບອກຮອບທີ່ຕ້ອງການໄດ້ເລີຍ.', vi: ' Hãy cho tôi biết bạn muốn đặt lượt nào.',
    } as Table<string>,
    nothingBooked: { en: ' Nothing has been booked.', zh: ' 还没有为您预订任何东西。', lo: ' ຍັງບໍ່ໄດ້ຈອງຫຍັງໃຫ້.', vi: ' Chưa đặt gì cho bạn.' } as Table<string>,
    none: {
      en: (head: string) => `${head}: no free slot I can confirm (full, or not opened yet).`,
      zh: (head: string) => `${head}：没有可以确认的空位（已满或尚未开放）。`,
      lo: (head: string) => `${head}: ຍັງບໍ່ມີຄິວຫວ່າງທີ່ຢືນຢັນໄດ້ (ເຕັມ ຫຼື ຍັງບໍ່ເປີດຮອບ).`,
      vi: (head: string) => `${head}: chưa có lượt trống nào xác nhận được (đã kín hoặc chưa mở).`,
    } as Table<(head: string) => string>,
    unreadable: {
      en: (name: string) => `I can’t confirm live ${name} slots right now.`, zh: (name: string) => `现在无法确认${name}的实时空位。`,
      lo: (name: string) => `ຕອນນີ້ຍັງກວດຄິວສົດຂອງ ${name} ໃຫ້ຢືນຢັນບໍ່ໄດ້.`, vi: (name: string) => `Hiện tôi không xác nhận được lượt trống của ${name}.`,
    } as Table<(name: string) => string>,
    head: {
      en: (name: string, length: string, day: string) => `${name}, ${length}, ${day}`,
      zh: (name: string, length: string, day: string) => `${name} ${length}，${day}`,
      lo: (name: string, length: string, day: string) => `${name} ${length} ${day}`,
      vi: (name: string, length: string, day: string) => `${name}, ${length}, ${day}`,
    } as Table<(name: string, length: string, day: string) => string>,
  },
};
