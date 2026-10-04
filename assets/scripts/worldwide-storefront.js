(() => {
  'use strict';

  const STORAGE_KEY = 'thammachat-market-v1';
  const CERTIFICATION_URL = '/api/ww12/certification';
  const SUPPORTED = ['th', 'en', 'zh', 'lo', 'vi', 'ja', 'ko'];

  const MARKETS = Object.freeze({
    TH: Object.freeze({
      countryCode: 'TH', currencyCode: 'THB', status: 'live', carrier: 'TH_DOMESTIC',
      names: { th:'ประเทศไทย', en:'Thailand', zh:'泰国', lo:'ປະເທດໄທ', vi:'Thái Lan', ja:'タイ', ko:'태국' },
    }),
    JP: Object.freeze({
      countryCode: 'JP', currencyCode: 'JPY', status: 'certification', carrier: 'DHL_EXPRESS',
      names: { th:'ญี่ปุ่น', en:'Japan', zh:'日本', lo:'ຍີ່ປຸ່ນ', vi:'Nhật Bản', ja:'日本', ko:'일본' },
    }),
    KR: Object.freeze({
      countryCode: 'KR', currencyCode: 'KRW', status: 'certification', carrier: 'DHL_EXPRESS',
      names: { th:'เกาหลีใต้', en:'South Korea', zh:'韩国', lo:'ເກົາຫຼີໃຕ້', vi:'Hàn Quốc', ja:'韓国', ko:'한국' },
    }),
    US: Object.freeze({
      countryCode: 'US', currencyCode: 'USD', status: 'certification', carrier: 'DHL_EXPRESS',
      names: { th:'สหรัฐอเมริกา', en:'United States', zh:'美国', lo:'ສະຫະລັດ', vi:'Hoa Kỳ', ja:'アメリカ', ko:'미국' },
    }),
  });

  const COPY = {
    th: {
      market_aria:'เลือกประเทศปลายทางและสกุลเงิน', global_overline:'GLOBAL COMMERCE · ปลายทางที่คุณเลือก',
      global_title:'จากอีสาน สู่ปลายทางทั่วโลก',
      global_intro_live:'เลือกปลายทางเพื่อดูสกุลเงิน วิธีจัดส่ง ภาษีนำเข้า และวิธีชำระเงินตามประเทศจริง',
      global_intro_cert:'เส้นทางซื้อขายสำหรับ{country}ผูกกับสถานะรับรอง WW‑12 จริง จึงยังไม่เปิดรับเงินหรือออกเลขพัสดุก่อนพร้อม',
      status_live:'เปิดขายแล้ว', status_cert:'กำลังรับรองก่อนเปิดขาย', route_origin:'ส่งจาก ชัยภูมิ · ไทย', route_destination:'ปลายทาง',
      currency:'สกุลเงิน', shipping:'การจัดส่ง', duties:'ภาษีและศุลกากร', payment:'การชำระเงิน',
      base_price_thb:'ราคาต้นทาง THB', domestic_network:'จัดส่งภายในประเทศ', dhl_express:'DHL Express',
      shipping_after_cert:'คำนวณเรตจริงหลังรับรอง', domestic_tax:'รวมในราคาขายไทย', duties_at_checkout:'แสดงก่อนชำระเงิน',
      promptpay:'PromptPay', cards_after_cert:'บัตรสากลผ่าน Stripe หลังรับรอง',
      product_domestic:'พร้อมส่งในประเทศไทย', product_preview:'{country} · {currency} · กำลังรับรอง',
      detail_market_live:'พร้อมจัดส่งในประเทศไทย', detail_market_cert:'กำลังรับรองสินค้าและเส้นทางจัดส่งไป{country}',
      cart_shipping_pending:'คำนวณหลังผ่านการรับรอง', cart_duties_pending:'แสดงก่อนชำระเงินจริง', checkout_preview:'ดูขั้นตอนส่งต่างประเทศ',
      step_cart:'ตะกร้า', step_address:'ที่อยู่', step_shipping:'ขนส่ง', step_duties:'ภาษีนำเข้า', step_payment:'ชำระเงิน',
      checkout_title:'เช็กเอาต์ต่างประเทศ', destination:'ประเทศปลายทาง', address_format:'ที่อยู่สากล', international_address:'รองรับชื่อผู้รับ ที่อยู่ รัฐ/จังหวัด รหัสไปรษณีย์ ประเทศ และเบอร์โทรสากล',
      shipping_quote:'ราคาขนส่ง', quote_pending:'DHL Express จะส่งเรตและระยะเวลาจริงหลังประเทศนี้ผ่านการรับรอง',
      customs_review:'ศุลกากร', customs_pending:'ตรวจ HS Code ข้อจำกัดสินค้า และภาษีของประเทศปลายทางก่อนเปิดขาย',
      payment_method:'วิธีชำระเงิน', payment_pending:'รองรับบัตรสากลและแสดงยอดใน {currency} หลังการรับรอง',
      cert_title:'ยังไม่เปิดรับชำระเงินข้ามประเทศ', cert_body:'ขณะนี้ {country} อยู่ในขั้นรับรองสินค้า ขนส่ง ศุลกากร และการชำระเงิน คุณดูสินค้าและขั้นตอนทั้งหมดได้ แต่ระบบจะไม่สร้างออเดอร์ต่างประเทศจนกว่าจะผ่านครบ',
      checkout_locked:'เปิดชำระเงินเมื่อผ่านการรับรอง', back_to_cart:'กลับไปที่ตะกร้า', cert_source:'สถานะจากระบบรับรอง WW‑12', unavailable:'ยังไม่เปิดใช้งาน',
    },
    en: {
      market_aria:'Choose destination country and currency', global_overline:'GLOBAL COMMERCE · YOUR DESTINATION',
      global_title:'From Isan to destinations worldwide',
      global_intro_live:'Choose a destination to see its currency, delivery, import duties and payment path.',
      global_intro_cert:'The {country} commerce route follows the live WW‑12 certification state, so payment and shipment creation remain locked until it is ready.',
      status_live:'Open for orders', status_cert:'Certification in progress', route_origin:'Ships from Chaiyaphum · Thailand', route_destination:'Destination',
      currency:'Currency', shipping:'Delivery', duties:'Duties & customs', payment:'Payment',
      base_price_thb:'Origin price in THB', domestic_network:'Domestic delivery', dhl_express:'DHL Express',
      shipping_after_cert:'Live rate after certification', domestic_tax:'Included in Thai price', duties_at_checkout:'Shown before payment',
      promptpay:'PromptPay', cards_after_cert:'Global cards via Stripe after certification',
      product_domestic:'Available for delivery in Thailand', product_preview:'{country} · {currency} · certification',
      detail_market_live:'Available for delivery in Thailand', detail_market_cert:'Product and delivery route to {country} are being certified',
      cart_shipping_pending:'Calculated after certification', cart_duties_pending:'Shown before live payment', checkout_preview:'Preview international checkout',
      step_cart:'Cart', step_address:'Address', step_shipping:'Delivery', step_duties:'Duties', step_payment:'Payment',
      checkout_title:'International checkout', destination:'Destination country', address_format:'International address', international_address:'Recipient, street, city, state or province, postal code, country and international phone are supported.',
      shipping_quote:'Delivery quote', quote_pending:'DHL Express will return a live rate and ETA after this market is certified.',
      customs_review:'Customs review', customs_pending:'HS code, product restrictions and destination duties are checked before launch.',
      payment_method:'Payment method', payment_pending:'Global cards and a total in {currency} become available after certification.',
      cert_title:'International payment is not open yet', cert_body:'{country} is currently being certified for products, delivery, customs and payment. You can preview the complete journey, but no international order will be created until every gate passes.',
      checkout_locked:'Checkout opens after certification', back_to_cart:'Back to cart', cert_source:'Status supplied by WW‑12 certification', unavailable:'Not available yet',
    },
    zh: {
      market_aria:'选择目的地国家和币种', global_overline:'全球商务 · 您的目的地', global_title:'从伊善，送往世界各地',
      global_intro_live:'选择目的地，查看当地币种、配送、进口税费和付款方式。', global_intro_cert:'{country}购物路线与 WW‑12 实时认证状态相连；准备完成前不会收款或创建运单。',
      status_live:'已开放订购', status_cert:'认证进行中', route_origin:'从泰国猜也蓬发货', route_destination:'目的地', currency:'币种', shipping:'配送', duties:'税费与海关', payment:'付款',
      base_price_thb:'泰铢原始价格', domestic_network:'泰国境内配送', dhl_express:'DHL Express', shipping_after_cert:'认证后显示实时运费', domestic_tax:'已含在泰国售价中', duties_at_checkout:'付款前显示', promptpay:'PromptPay', cards_after_cert:'认证后通过 Stripe 使用国际卡',
      product_domestic:'可配送至泰国境内', product_preview:'{country} · {currency} · 认证中', detail_market_live:'可配送至泰国境内', detail_market_cert:'正在认证送往{country}的商品和配送路线',
      cart_shipping_pending:'认证后计算', cart_duties_pending:'正式付款前显示', checkout_preview:'预览国际结账', step_cart:'购物车', step_address:'地址', step_shipping:'配送', step_duties:'税费', step_payment:'付款',
      checkout_title:'国际结账', destination:'目的地国家', address_format:'国际地址', international_address:'支持收件人、街道、城市、州或省、邮编、国家及国际电话号码。', shipping_quote:'配送报价', quote_pending:'该市场通过认证后，DHL Express 将提供实时运费与时效。', customs_review:'海关审核', customs_pending:'上线前核对 HS 编码、商品限制及目的地税费。', payment_method:'付款方式', payment_pending:'认证后可使用国际卡，并以 {currency} 显示应付总额。',
      cert_title:'国际付款尚未开放', cert_body:'{country}的商品、配送、海关和付款正在认证中。您可以预览完整流程，但所有关卡通过前不会创建国际订单。', checkout_locked:'认证后开放结账', back_to_cart:'返回购物车', cert_source:'状态来自 WW‑12 认证系统', unavailable:'尚未开放',
    },
    lo: {
      market_aria:'ເລືອກປະເທດປາຍທາງ ແລະ ສະກຸນເງິນ', global_overline:'ການຄ້າທົ່ວໂລກ · ປາຍທາງຂອງທ່ານ', global_title:'ຈາກອີສານ ສູ່ປາຍທາງທົ່ວໂລກ',
      global_intro_live:'ເລືອກປາຍທາງເພື່ອເບິ່ງສະກຸນເງິນ ການຈັດສົ່ງ ພາສີນຳເຂົ້າ ແລະ ການຊຳລະ.', global_intro_cert:'ເສັ້ນທາງຊື້ຂາຍໄປ{country}ເຊື່ອມກັບສະຖານະຮັບຮອງ WW‑12 ແລະ ຈະບໍ່ຮັບເງິນກ່ອນພ້ອມ.',
      status_live:'ເປີດຮັບອໍເດີແລ້ວ', status_cert:'ກຳລັງຮັບຮອງ', route_origin:'ສົ່ງຈາກ ໄຊຍະພູມ · ໄທ', route_destination:'ປາຍທາງ', currency:'ສະກຸນເງິນ', shipping:'ການຈັດສົ່ງ', duties:'ພາສີ ແລະ ພາສີສຸລະກາກອນ', payment:'ການຊຳລະ',
      base_price_thb:'ລາຄາຕົ້ນທາງ THB', domestic_network:'ຈັດສົ່ງໃນໄທ', dhl_express:'DHL Express', shipping_after_cert:'ລາຄາຈິງຫຼັງຮັບຮອງ', domestic_tax:'ລວມໃນລາຄາໄທ', duties_at_checkout:'ສະແດງກ່ອນຊຳລະ', promptpay:'PromptPay', cards_after_cert:'ບັດສາກົນຜ່ານ Stripe ຫຼັງຮັບຮອງ',
      product_domestic:'ພ້ອມສົ່ງໃນໄທ', product_preview:'{country} · {currency} · ກຳລັງຮັບຮອງ', detail_market_live:'ພ້ອມສົ່ງໃນໄທ', detail_market_cert:'ກຳລັງຮັບຮອງສິນຄ້າ ແລະ ເສັ້ນທາງໄປ{country}',
      cart_shipping_pending:'ຄຳນວນຫຼັງຮັບຮອງ', cart_duties_pending:'ສະແດງກ່ອນຊຳລະຈິງ', checkout_preview:'ເບິ່ງຂັ້ນຕອນສົ່ງຕ່າງປະເທດ', step_cart:'ກະຕ່າ', step_address:'ທີ່ຢູ່', step_shipping:'ຂົນສົ່ງ', step_duties:'ພາສີ', step_payment:'ຊຳລະ',
      checkout_title:'ຊຳລະເງິນສາກົນ', destination:'ປະເທດປາຍທາງ', address_format:'ທີ່ຢູ່ສາກົນ', international_address:'ຮອງຮັບຊື່ຜູ້ຮັບ ຖະໜົນ ເມືອງ ແຂວງ/ລັດ ລະຫັດໄປສະນີ ປະເທດ ແລະ ເບີສາກົນ.', shipping_quote:'ລາຄາຂົນສົ່ງ', quote_pending:'DHL Express ຈະສົ່ງລາຄາ ແລະ ເວລາຈິງຫຼັງຮັບຮອງ.', customs_review:'ກວດສຸລະກາກອນ', customs_pending:'ກວດ HS Code ຂໍ້ຈຳກັດ ແລະ ພາສີກ່ອນເປີດຂາຍ.', payment_method:'ວິທີຊຳລະ', payment_pending:'ເປີດບັດສາກົນ ແລະ ຍອດ {currency} ຫຼັງຮັບຮອງ.',
      cert_title:'ຍັງບໍ່ເປີດຊຳລະຂ້າມປະເທດ', cert_body:'{country} ກຳລັງຮັບຮອງສິນຄ້າ ຂົນສົ່ງ ສຸລະກາກອນ ແລະ ການຊຳລະ. ທ່ານເບິ່ງຂັ້ນຕອນໄດ້ ແຕ່ຈະບໍ່ສ້າງອໍເດີຈົນກວ່າຈະຜ່ານທັງໝົດ.', checkout_locked:'ເປີດຊຳລະຫຼັງຮັບຮອງ', back_to_cart:'ກັບໄປກະຕ່າ', cert_source:'ສະຖານະຈາກລະບົບ WW‑12', unavailable:'ຍັງບໍ່ເປີດ',
    },
    vi: {
      market_aria:'Chọn quốc gia và tiền tệ nhận hàng', global_overline:'THƯƠNG MẠI TOÀN CẦU · ĐIỂM ĐẾN CỦA BẠN', global_title:'Từ Isan đến các điểm đến trên toàn thế giới',
      global_intro_live:'Chọn điểm đến để xem tiền tệ, vận chuyển, thuế nhập khẩu và phương thức thanh toán.', global_intro_cert:'Lộ trình mua hàng tới {country} bám theo trạng thái chứng nhận WW‑12 thực tế, nên chưa thu tiền hoặc tạo vận đơn trước khi sẵn sàng.',
      status_live:'Đã mở đặt hàng', status_cert:'Đang chứng nhận', route_origin:'Gửi từ Chaiyaphum · Thái Lan', route_destination:'Điểm đến', currency:'Tiền tệ', shipping:'Vận chuyển', duties:'Thuế & hải quan', payment:'Thanh toán',
      base_price_thb:'Giá gốc bằng THB', domestic_network:'Giao hàng nội địa', dhl_express:'DHL Express', shipping_after_cert:'Giá thực sau chứng nhận', domestic_tax:'Đã gồm trong giá Thái Lan', duties_at_checkout:'Hiện trước khi thanh toán', promptpay:'PromptPay', cards_after_cert:'Thẻ quốc tế qua Stripe sau chứng nhận',
      product_domestic:'Sẵn sàng giao tại Thái Lan', product_preview:'{country} · {currency} · đang chứng nhận', detail_market_live:'Sẵn sàng giao tại Thái Lan', detail_market_cert:'Đang chứng nhận sản phẩm và tuyến giao tới {country}',
      cart_shipping_pending:'Tính sau khi chứng nhận', cart_duties_pending:'Hiện trước thanh toán thật', checkout_preview:'Xem trước thanh toán quốc tế', step_cart:'Giỏ hàng', step_address:'Địa chỉ', step_shipping:'Vận chuyển', step_duties:'Thuế', step_payment:'Thanh toán',
      checkout_title:'Thanh toán quốc tế', destination:'Quốc gia nhận hàng', address_format:'Địa chỉ quốc tế', international_address:'Hỗ trợ người nhận, đường, thành phố, bang/tỉnh, mã bưu chính, quốc gia và số điện thoại quốc tế.', shipping_quote:'Báo giá vận chuyển', quote_pending:'DHL Express sẽ trả giá và thời gian thực sau khi thị trường này được chứng nhận.', customs_review:'Kiểm tra hải quan', customs_pending:'Kiểm tra mã HS, hạn chế sản phẩm và thuế tại điểm đến trước khi mở bán.', payment_method:'Phương thức thanh toán', payment_pending:'Thẻ quốc tế và tổng tiền bằng {currency} sẽ mở sau chứng nhận.',
      cert_title:'Chưa mở thanh toán quốc tế', cert_body:'{country} đang được chứng nhận về sản phẩm, vận chuyển, hải quan và thanh toán. Bạn có thể xem toàn bộ hành trình nhưng đơn quốc tế sẽ không được tạo cho tới khi mọi cổng đều đạt.', checkout_locked:'Mở thanh toán sau chứng nhận', back_to_cart:'Quay lại giỏ', cert_source:'Trạng thái từ hệ thống chứng nhận WW‑12', unavailable:'Chưa khả dụng',
    },
    ja: {
      market_aria:'配送先の国と通貨を選択', global_overline:'グローバルコマース · 配送先', global_title:'イサーンから世界の配送先へ',
      global_intro_live:'配送先を選ぶと、通貨、配送、輸入関税、支払い方法を確認できます。', global_intro_cert:'{country}向けの購入経路は WW‑12 の実際の認証状況と連動し、準備完了まで決済や配送ラベルを作成しません。',
      status_live:'注文受付中', status_cert:'認証手続き中', route_origin:'タイ・チャイヤプームから発送', route_destination:'配送先', currency:'通貨', shipping:'配送', duties:'関税・通関', payment:'支払い',
      base_price_thb:'THB 基準価格', domestic_network:'タイ国内配送', dhl_express:'DHL Express', shipping_after_cert:'認証後に実料金を表示', domestic_tax:'タイ国内価格に含む', duties_at_checkout:'支払い前に表示', promptpay:'PromptPay', cards_after_cert:'認証後 Stripe で国際カード対応',
      product_domestic:'タイ国内へ配送可能', product_preview:'{country} · {currency} · 認証中', detail_market_live:'タイ国内へ配送可能', detail_market_cert:'{country}向けの商品と配送経路を認証中',
      cart_shipping_pending:'認証後に計算', cart_duties_pending:'本決済前に表示', checkout_preview:'海外チェックアウトを確認', step_cart:'カート', step_address:'住所', step_shipping:'配送', step_duties:'関税', step_payment:'支払い',
      checkout_title:'海外チェックアウト', destination:'配送先の国', address_format:'国際住所', international_address:'受取人、住所、市区町村、都道府県、郵便番号、国、国際電話番号に対応します。', shipping_quote:'配送料金', quote_pending:'この市場の認証後、DHL Express の実料金と所要日数を表示します。', customs_review:'通関確認', customs_pending:'開始前に HS コード、商品規制、配送先の関税を確認します。', payment_method:'支払い方法', payment_pending:'認証後、国際カードと {currency} 建て合計額を利用できます。',
      cert_title:'海外決済はまだ開始していません', cert_body:'{country}向けの商品、配送、通関、決済を現在認証中です。全工程を確認できますが、すべての条件を満たすまで海外注文は作成されません。', checkout_locked:'認証後に決済を開始', back_to_cart:'カートに戻る', cert_source:'WW‑12 認証システムの状態', unavailable:'未提供',
    },
    ko: {
      market_aria:'배송 국가와 통화 선택', global_overline:'글로벌 커머스 · 선택한 배송지', global_title:'이산에서 전 세계 배송지로',
      global_intro_live:'배송지를 선택하면 통화, 배송, 수입 관세와 결제 경로를 확인할 수 있습니다.', global_intro_cert:'{country} 구매 경로는 실제 WW‑12 인증 상태와 연동되며, 준비가 끝나기 전에는 결제나 운송장을 생성하지 않습니다.',
      status_live:'주문 가능', status_cert:'인증 진행 중', route_origin:'태국 차이야품에서 발송', route_destination:'배송지', currency:'통화', shipping:'배송', duties:'관세·통관', payment:'결제',
      base_price_thb:'THB 기준 가격', domestic_network:'태국 국내 배송', dhl_express:'DHL Express', shipping_after_cert:'인증 후 실시간 요금', domestic_tax:'태국 판매가에 포함', duties_at_checkout:'결제 전에 표시', promptpay:'PromptPay', cards_after_cert:'인증 후 Stripe 국제 카드',
      product_domestic:'태국 내 배송 가능', product_preview:'{country} · {currency} · 인증 중', detail_market_live:'태국 내 배송 가능', detail_market_cert:'{country}행 상품과 배송 경로를 인증 중입니다',
      cart_shipping_pending:'인증 후 계산', cart_duties_pending:'실제 결제 전에 표시', checkout_preview:'해외 결제 단계 미리보기', step_cart:'장바구니', step_address:'주소', step_shipping:'배송', step_duties:'관세', step_payment:'결제',
      checkout_title:'해외 결제', destination:'배송 국가', address_format:'국제 주소', international_address:'수령인, 도로명, 도시, 주/도, 우편번호, 국가와 국제 전화번호를 지원합니다.', shipping_quote:'배송 견적', quote_pending:'이 시장의 인증 후 DHL Express 실시간 요금과 예상 기간을 표시합니다.', customs_review:'통관 검토', customs_pending:'출시 전에 HS 코드, 상품 제한과 목적지 관세를 확인합니다.', payment_method:'결제 수단', payment_pending:'인증 후 국제 카드와 {currency} 결제 금액을 이용할 수 있습니다.',
      cert_title:'해외 결제는 아직 열리지 않았습니다', cert_body:'{country}의 상품, 배송, 통관과 결제를 현재 인증 중입니다. 전체 과정을 미리 볼 수 있지만 모든 조건을 통과하기 전에는 해외 주문을 생성하지 않습니다.', checkout_locked:'인증 후 결제 가능', back_to_cart:'장바구니로 돌아가기', cert_source:'WW‑12 인증 시스템 상태', unavailable:'아직 이용 불가',
    },
  };

  let certificationSnapshot = null;
  let selectedCountryCode = readInitialMarket();

  function language() {
    const value = window.OTOP_I18N?.lang?.() || window.ThammachatLocale?.get?.() || 'th';
    return SUPPORTED.includes(value) ? value : 'en';
  }

  function interpolate(value, vars = {}) {
    return String(value ?? '').replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
  }

  function t(key, vars = {}) {
    const lang = language();
    return interpolate(COPY[lang]?.[key] ?? COPY.en[key] ?? key, vars);
  }

  function readInitialMarket() {
    const query = new URLSearchParams(location.search).get('country');
    if (query && MARKETS[query.toUpperCase()]) return query.toUpperCase();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && MARKETS[saved]) return saved;
    } catch {}
    return 'TH';
  }

  function marketName(market = currentMarket()) {
    const lang = language();
    return market.names[lang] || market.names.en;
  }

  function marketStatus(market = currentMarket()) {
    if (market.countryCode === 'TH') return 'live';
    const remote = certificationSnapshot?.firstWave?.find(item => item?.marketCode === market.countryCode);
    const safelyLive = remote?.certified === true
      && certificationSnapshot?.liveForeignMarkets > 0
      && certificationSnapshot?.currentForeignCertifications > 0
      && certificationSnapshot?.liveGlobalPaymentMethods > 0
      && certificationSnapshot?.liveGlobalShippingServices > 0;
    return safelyLive ? 'live' : 'certification';
  }

  function currentMarket() {
    const base = MARKETS[selectedCountryCode] || MARKETS.TH;
    return { ...base, status: marketStatus(base) };
  }

  function optionLabel(market) {
    return `${market.countryCode} · ${marketName(market)} · ${market.currencyCode}`;
  }

  function setMarket(countryCode, options = {}) {
    const next = String(countryCode || '').toUpperCase();
    if (!MARKETS[next]) return false;
    selectedCountryCode = next;
    if (options.persist !== false) {
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    }
    if (options.updateUrl !== false) {
      const url = new URL(location.href);
      if (next === 'TH') url.searchParams.delete('country');
      else url.searchParams.set('country', next);
      history.replaceState({}, '', url);
    }
    window.dispatchEvent(new CustomEvent('worldwide:market-change', { detail:{ market:currentMarket() } }));
    return true;
  }

  function syncSelect(select) {
    if (!select) return;
    select.innerHTML = Object.values(MARKETS).map(market =>
      `<option value="${market.countryCode}">${optionLabel(market)}</option>`
    ).join('');
    select.value = selectedCountryCode;
    select.setAttribute('aria-label', t('market_aria'));
  }

  async function refreshCertification() {
    try {
      const response = await fetch(CERTIFICATION_URL, { headers:{ Accept:'application/json' }, cache:'no-store' });
      const data = await response.json();
      if (!response.ok || data?.ok !== true || !Array.isArray(data?.firstWave)) throw new Error('invalid_certification_snapshot');
      certificationSnapshot = data;
      window.dispatchEvent(new CustomEvent('worldwide:certification-change', { detail:{ snapshot:data, market:currentMarket() } }));
      return data;
    } catch {
      certificationSnapshot = null;
      window.dispatchEvent(new CustomEvent('worldwide:certification-change', { detail:{ snapshot:null, market:currentMarket() } }));
      return null;
    }
  }

  window.TAMMA_WORLDWIDE_STOREFRONT = Object.freeze({
    markets: MARKETS,
    t,
    language,
    marketName,
    currentMarket,
    marketStatus,
    setMarket,
    syncSelect,
    refreshCertification,
    certificationSnapshot: () => certificationSnapshot,
    certificationUrl: CERTIFICATION_URL,
  });
})();
