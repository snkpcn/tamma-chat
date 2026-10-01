(() => {
  'use strict';

  const STORAGE_KEY = 'thammachat-lang-v1';
  const SUPPORTED = ['th','en','zh','lo','vi'];
  const LOCALES = { th:'th-TH', en:'en-US', zh:'zh-CN', lo:'lo-LA', vi:'vi-VN' };
  const LANGUAGE_LABELS = {
    th:['ไทย','TH'], en:['English','EN'], zh:['中文','ZH'], lo:['ລາວ','LO'], vi:['Tiếng Việt','VI']
  };
  const PROVINCES_TH = {
    chaiyaphum:'ชัยภูมิ', khonkaen:'ขอนแก่น', buriram:'บุรีรัมย์', surin:'สุรินทร์',
    sisaket:'ศรีสะเกษ', nakhonratchasima:'นครราชสีมา', roiet:'ร้อยเอ็ด',
    mahasarakham:'มหาสารคาม', kalasin:'กาฬสินธุ์', sakonnakhon:'สกลนคร',
    nakhonphanom:'นครพนม', mukdahan:'มุกดาหาร', yasothon:'ยโสธร',
    amnatcharoen:'อำนาจเจริญ', ubonratchathani:'อุบลราชธานี', udonthani:'อุดรธานี',
    nongkhai:'หนองคาย', buengkan:'บึงกาฬ', loei:'เลย', nongbualamphu:'หนองบัวลำภู'
  };
  const PROVINCES_LATIN = {
    chaiyaphum:'Chaiyaphum', khonkaen:'Khon Kaen', buriram:'Buriram', surin:'Surin',
    sisaket:'Sisaket', nakhonratchasima:'Nakhon Ratchasima', roiet:'Roi Et',
    mahasarakham:'Maha Sarakham', kalasin:'Kalasin', sakonnakhon:'Sakon Nakhon',
    nakhonphanom:'Nakhon Phanom', mukdahan:'Mukdahan', yasothon:'Yasothon',
    amnatcharoen:'Amnat Charoen', ubonratchathani:'Ubon Ratchathani', udonthani:'Udon Thani',
    nongkhai:'Nong Khai', buengkan:'Bueng Kan', loei:'Loei', nongbualamphu:'Nong Bua Lam Phu'
  };

  const D = {
    th:{
      switch_language:'เปลี่ยนภาษา',
      map_page_title:'แผนที่ของดีอีสาน — ทำมา-ชาติ OTOP',
      map_meta:'เลือกจังหวัดบนแผนที่อีสาน แล้วรู้จักผู้คน วิถีชีวิต และเรื่องราวของแต่ละพื้นที่ ก่อนเลือกชมสินค้าชุมชน',
      map_skip:'ข้ามไปยังแผนที่', map_back:'กลับหน้าหลักทำมา-ชาติ', login:'เข้าสู่ระบบ', signup:'สมัครสมาชิก', account:'บัญชีของฉัน',
      map_overline:'ประสบการณ์อีสาน 20 จังหวัด', map_title:'เลือกจังหวัดที่อยากรู้จัก',
      map_intro:'แตะบนแผนที่หรือเลือกชื่อจังหวัดด้านล่าง เพื่อเปิดเรื่องราวของผู้คน วิถีชีวิต และสิ่งที่ทำให้แต่ละพื้นที่ไม่เหมือนกัน',
      map_legend_aria:'คำอธิบายแผนที่', map_selected:'จังหวัดที่เลือก', map_other:'จังหวัดอื่น',
      map_loading:'กำลังเปิดแผนที่อีสาน…', map_aria:'แผนที่ขอบเขตจริง 20 จังหวัดภาคอีสาน', map_quick_aria:'รายชื่อ 20 จังหวัด',
      map_story_label:'เรื่องราวของจังหวัด', map_concept:'เลือกซื้อเมื่อพร้อม หลังจากได้รู้จักที่มา คนทำ และคุณค่าของพื้นที่นั้นแล้ว',
      map_footer:'กิน พัก ทำกิจกรรม และรู้จักของดีอีสาน', map_province_header:'ประสบการณ์จังหวัด · {order}',
      map_cta:'ดูสินค้าจาก{name}', map_error:'ไม่สามารถเปิดแผนที่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
      map_generic_title:'รู้จัก {name} ผ่านงานฝีมือ อาหาร และผู้คน',
      map_generic_desc:'สำรวจของดี งานฝีมือ อาหาร และเรื่องราวของผู้คนใน {name} ก่อนเลือกสินค้าที่อยากพากลับบ้าน',
      store_page_title:'ร้าน OTOP {name} · ทำมา-ชาติ', store_nav:'หน้าร้าน OTOP', store_back:'กลับหน้าหลักทำมา-ชาติ',
      province:'จังหวัด', choose_province:'เลือกจังหวัด', search:'ค้นหาสินค้า', cart:'ตะกร้า', open_cart:'เปิดตะกร้าสินค้า',
      hero_kicker:'OTOP · จากมือคน จากพื้นที่ และจากเวลา', hero_title:'ของที่มีที่มา<br>ก่อนจะมีราคา',
      hero_lead:'เราไม่ได้เลือกมาแค่เพราะสวยหรือขายได้ แต่เพราะแต่ละชิ้นมีคนทำ มีพื้นที่ มีเวลา และมีเหตุผลที่มันควรเกิดที่นี่',
      hero_shop:'ดูของดีจาก{name} ↓', view_map:'ดูแผนที่ของดีอีสาน', store_eyebrow:'OTOP · ของดีจากคนทำจริง',
      shop_title:'เลือกของดีจาก{name}', store_intro:'เลือกดูรายละเอียดสินค้า รู้จักที่มา แล้วใส่ตะกร้าเมื่อพร้อม สินค้าทุกชิ้นในหน้านี้มาจาก{name}',
      shipping_loading:'กำลังโหลดข้อมูลการจัดส่ง', curated_now:'CURATED NOW', real_sales:'REAL SALES',
      curated_title:'คัดสรรโดย ทำมา-ชาติ', best_seller:'สินค้าขายดี', curated_sub:'ของที่เราอยากให้เริ่มรู้จัก',
      best_seller_sub:'สินค้าที่มียอดขายสำเร็จจริง เรียงตามจำนวนที่ขายได้', collections:'COLLECTIONS',
      catalog_title:'สินค้า OTOP {name}', loading_products:'กำลังโหลดสินค้า…', featured:'สินค้าแนะนำ', price_low:'ราคาต่ำ–สูง', price_high:'ราคาสูง–ต่ำ',
      sort_aria:'เรียงสินค้า', no_products_category:'ยังไม่มีสินค้าในหมวดนี้', no_search:'ไม่พบสินค้าที่ค้นหา',
      no_products_province:'ยังไม่มีสินค้าจาก{name}ที่พร้อมจำหน่าย', back_map:'กลับไปเลือกจังหวัดบนแผนที่',
      catalog_status:'{count} รายการ · ราคาและสต็อกอัปเดตจากหลังบ้าน', catalog_empty:'ยังไม่มีสินค้าที่พร้อมจำหน่ายจากจังหวัดนี้',
      view_product:'ดูสินค้า →', stock:'เหลือ {count} ชิ้น', product_detail:'ดูรายละเอียด {name}',
      community_product:'สินค้าชุมชนจาก{name}', story_piece:'เรื่องของชิ้นนี้', value_piece:'VALUE OF THIS PIECE',
      origin:'ที่มา', maker:'ผู้ผลิต', material:'วัสดุ / วัตถุดิบ', process:'วิธีทำ', why_here:'ทำไมต้องเป็นที่นี่',
      sku_meta:'รหัสสินค้า {sku}<br>มีสินค้า {count} ชิ้น · ราคาและสต็อกอัปเดตจากหลังบ้าน',
      close_product:'ปิดรายละเอียดสินค้า', quantity:'จำนวนสินค้า', decrease:'ลดจำนวน', increase:'เพิ่มจำนวน', add_cart:'ใส่ตะกร้า',
      cart_checkout:'ตะกร้าสินค้าและชำระเงิน', close:'ปิด', step_cart:'ตะกร้า', step_address:'ที่อยู่จัดส่ง', step_confirm:'ยืนยัน',
      subtotal:'ค่าสินค้า', shipping:'ค่าจัดส่ง', total:'รวม', free:'ฟรี', continue:'ดำเนินการต่อ',
      choose_address:'เลือกที่อยู่จัดส่ง', note_team:'หมายเหตุถึงทีมงาน', note_placeholder:'เช่น แพ็กเป็นของขวัญ',
      place_order:'ยืนยันคำสั่งซื้อ', back_cart:'กลับไปแก้ตะกร้า', cart_empty:'ยังไม่มีสินค้าในตะกร้า',
      no_address:'ยังไม่มีที่อยู่จัดส่ง กรุณาเพิ่มที่อยู่ในบัญชีของฉันก่อน', add_address:'เพิ่มที่อยู่จัดส่ง',
      address_notice:'เลือกที่อยู่ที่บันทึกไว้ ระบบจะเก็บสำเนาที่อยู่นี้กับออเดอร์เพื่อให้ข้อมูลการจัดส่งไม่เปลี่ยนภายหลัง',
      payment_total:'ยอดชำระ', order_received:'รับคำสั่งซื้อแล้ว ✅', order_number:'เลขออเดอร์', payment_code:'รหัสชำระเงิน',
      payment_instruction:'โอนตามยอดด้านบน แล้วส่งสลิปให้ทองไทยใน LINE เพื่อให้ทีมงานตรวจสอบ เมื่อยืนยันแล้วสถานะจะเปลี่ยนเป็นกำลังเตรียมสินค้า',
      track_order:'ดูออเดอร์และติดตามพัสดุ', member_load_error:'โหลดข้อมูลสมาชิกไม่สำเร็จ กรุณาลองใหม่',
      product_load_error:'โหลดสินค้าไม่สำเร็จ', product_system_error:'ระบบสินค้าไม่พร้อมชั่วคราว กรุณาลองใหม่', err_stock:'สินค้าในตะกร้ามีจำนวนไม่พอ กรุณาปรับจำนวน', err_product:'มีสินค้าบางรายการปิดขายหรือหมดแล้ว', err_address:'ไม่พบที่อยู่จัดส่ง กรุณาเลือกใหม่', err_checkout:'ระบบรับออเดอร์ขัดข้องชั่วคราว', err_order:'สร้างคำสั่งซื้อไม่สำเร็จ',
      shipping_quote:'ค่าส่ง ฿{fee} · ประมาณ {min}–{max} วัน', shipping_quote_free:'ค่าส่ง ฿{fee} · ส่งฟรีเมื่อครบ ฿{threshold} · ประมาณ {min}–{max} วัน',
      wear_title:'สวมใส่ & งานผ้า', wear_sub:'ผ้า งานเย็บ และของใช้ที่พางานมือออกไปใช้ในชีวิตประจำวัน',
      food_title:'ของกิน & ของฝาก', food_sub:'รสชาติ วัตถุดิบ และวิธีถนอมอาหารที่ผูกกับพื้นที่',
      home_title:'บ้าน & การดูแลตัวเอง', home_sub:'ของใช้ จักสาน และสมุนไพรจากวิถีใกล้ตัว'
    },
    en:{
      switch_language:'Switch language',
      map_page_title:'Isan OTOP Map — Thammachat', map_meta:'Explore the 20 provinces of Isan through local makers, crafts, food and community stories.',
      map_skip:'Skip to map', map_back:'Back to Thammachat home', login:'Log in', signup:'Sign up', account:'My account',
      map_overline:'20 PROVINCES OF ISAN', map_title:'Choose a province to discover',
      map_intro:'Tap the map or choose a province below to discover its people, local life and what makes each place distinct.',
      map_legend_aria:'Map legend', map_selected:'Selected province', map_other:'Other provinces', map_loading:'Opening the Isan map…',
      map_aria:'Map of the 20 provinces of Northeastern Thailand', map_quick_aria:'List of 20 provinces', map_story_label:'Province story',
      map_concept:'Shop when you are ready, after getting to know the place, its makers and the value behind each piece.',
      map_footer:'Eat, stay, explore and discover the best of Isan', map_province_header:'PROVINCE EXPERIENCE · {order}',
      map_cta:'Shop from {name}', map_error:'The map is unavailable right now. Please try again.',
      map_generic_title:'Discover {name} through craft, food and people',
      map_generic_desc:'Explore local craft, food, makers and stories from {name} before choosing a piece to bring home.',
      store_page_title:'OTOP {name} · Thammachat', store_nav:'OTOP shop', store_back:'Back to Thammachat home',
      province:'Province', choose_province:'Choose province', search:'Search products', cart:'Cart', open_cart:'Open shopping cart',
      hero_kicker:'OTOP · FROM HANDS, PLACE & TIME', hero_title:'A story first.<br>A price second.',
      hero_lead:'We choose each piece not only because it is beautiful or sellable, but because it carries a maker, a place, time and a reason to exist here.',
      hero_shop:'Shop {name} ↓', view_map:'Explore the Isan map', store_eyebrow:'OTOP · FROM REAL MAKERS',
      shop_title:'Shop the best of {name}', store_intro:'Explore each product, learn where it comes from, and add it to your cart when ready. Every item on this page comes from {name}.',
      shipping_loading:'Loading shipping information', curated_now:'CURATED NOW', real_sales:'REAL SALES',
      curated_title:'Curated by Thammachat', best_seller:'Best sellers', curated_sub:'Pieces we think you should discover first',
      best_seller_sub:'Products ranked by completed sales', collections:'COLLECTIONS', catalog_title:'OTOP products · {name}',
      loading_products:'Loading products…', featured:'Featured', price_low:'Price: low to high', price_high:'Price: high to low', sort_aria:'Sort products',
      no_products_category:'No products in this collection yet', no_search:'No matching products found', no_products_province:'No products from {name} are ready for sale yet',
      back_map:'Back to province map', catalog_status:'{count} items · price and stock updated from back office', catalog_empty:'No products from this province are ready for sale yet',
      view_product:'View product →', stock:'{count} in stock', product_detail:'View details for {name}', community_product:'Community product from {name}',
      story_piece:'THE STORY OF THIS PIECE', value_piece:'VALUE OF THIS PIECE', origin:'Origin', maker:'Maker', material:'Material / ingredient',
      process:'How it is made', why_here:'Why here', sku_meta:'SKU {sku}<br>{count} in stock · price and stock updated from back office',
      close_product:'Close product details', quantity:'Quantity', decrease:'Decrease quantity', increase:'Increase quantity', add_cart:'Add to cart',
      cart_checkout:'Cart and checkout', close:'Close', step_cart:'Cart', step_address:'Shipping address', step_confirm:'Confirm',
      subtotal:'Subtotal', shipping:'Shipping', total:'Total', free:'Free', continue:'Continue', choose_address:'Choose shipping address',
      note_team:'Note to our team', note_placeholder:'e.g. Please wrap as a gift', place_order:'Place order', back_cart:'Back to cart', cart_empty:'Your cart is empty',
      no_address:'You do not have a shipping address yet. Add one in your account first.', add_address:'Add shipping address',
      address_notice:'Choose a saved address. A snapshot will be stored with the order so delivery details do not change later.',
      payment_total:'Amount due', order_received:'Order received ✅', order_number:'Order', payment_code:'Payment code',
      payment_instruction:'Transfer the amount shown, then send the payment slip to Thongthai on LINE for team verification. After verification, the order moves to packing.',
      track_order:'View order and track shipment', member_load_error:'Could not load your member information. Please try again.',
      product_load_error:'Could not load products', product_system_error:'The product system is temporarily unavailable. Please try again.', err_stock:'Some items do not have enough stock. Please adjust the quantity.', err_product:'One or more products are unavailable or sold out.', err_address:'Shipping address not found. Please choose another address.', err_checkout:'Checkout is temporarily unavailable.', err_order:'Could not create the order.',
      shipping_quote:'Shipping ฿{fee} · about {min}–{max} days', shipping_quote_free:'Shipping ฿{fee} · free over ฿{threshold} · about {min}–{max} days',
      wear_title:'Wear & textiles', wear_sub:'Textiles, sewing and useful pieces that bring local craft into everyday life',
      food_title:'Food & pantry', food_sub:'Flavours, ingredients and preservation traditions rooted in place',
      home_title:'Home & wellness', home_sub:'Homeware, basketry and herbs from everyday local life'
    },
    zh:{
      switch_language:'切换语言',
      map_page_title:'伊森 OTOP 地图 — Thammachat', map_meta:'通过当地手作、食物、创作者与社区故事探索泰国东北部 20 个府。',
      map_skip:'跳到地图', map_back:'返回 Thammachat 首页', login:'登录', signup:'注册', account:'我的账户',
      map_overline:'泰国东北部 20 个府', map_title:'选择一个府开始探索',
      map_intro:'点击地图或选择下方府名，认识当地的人、生活方式与每个地方独特的故事。',
      map_legend_aria:'地图图例', map_selected:'已选择', map_other:'其他地区', map_loading:'正在打开伊森地图…',
      map_aria:'泰国东北部 20 个府地图', map_quick_aria:'20 个府列表', map_story_label:'地方故事',
      map_concept:'了解产地、创作者与作品价值之后，再决定是否购买。',
      map_footer:'吃、住、体验，并认识伊森的地方好物', map_province_header:'地方体验 · {order}', map_cta:'查看 {name} 商品',
      map_error:'目前无法打开地图，请稍后再试。', map_generic_title:'从手作、食物与人认识 {name}',
      map_generic_desc:'先探索 {name} 的手作、食物、创作者与故事，再选择想带回家的作品。',
      store_page_title:'OTOP {name} · Thammachat', store_nav:'OTOP 商店', store_back:'返回 Thammachat 首页',
      province:'府', choose_province:'选择府', search:'搜索商品', cart:'购物车', open_cart:'打开购物车',
      hero_kicker:'OTOP · 来自手、土地与时间', hero_title:'先有故事<br>再有价格',
      hero_lead:'我们选择一件作品，不只因为它好看或能卖，而是因为它背后有人、地方、时间，以及在这里诞生的理由。',
      hero_shop:'查看 {name} 好物 ↓', view_map:'查看伊森地图', store_eyebrow:'OTOP · 来自真实创作者',
      shop_title:'挑选 {name} 好物', store_intro:'查看商品详情与来源，准备好后再加入购物车。本页商品均来自 {name}。',
      shipping_loading:'正在加载配送信息', curated_now:'本期精选', real_sales:'真实销量', curated_title:'Thammachat 精选', best_seller:'畅销商品',
      curated_sub:'我们希望你先认识的作品', best_seller_sub:'按已完成销量排序', collections:'商品分类', catalog_title:'{name} OTOP 商品',
      loading_products:'正在加载商品…', featured:'推荐商品', price_low:'价格：低到高', price_high:'价格：高到低', sort_aria:'商品排序',
      no_products_category:'此分类暂时没有商品', no_search:'没有找到符合条件的商品', no_products_province:'{name} 暂无可售商品', back_map:'返回府地图',
      catalog_status:'{count} 件 · 价格与库存来自后台实时数据', catalog_empty:'此地区暂无可售商品', view_product:'查看商品 →', stock:'库存 {count} 件',
      product_detail:'查看 {name} 详情', community_product:'来自 {name} 的社区商品', story_piece:'这件作品的故事', value_piece:'作品价值',
      origin:'产地', maker:'创作者', material:'材料 / 原料', process:'制作方式', why_here:'为什么来自这里',
      sku_meta:'商品编号 {sku}<br>库存 {count} 件 · 价格与库存来自后台实时数据', close_product:'关闭商品详情', quantity:'数量', decrease:'减少数量', increase:'增加数量',
      add_cart:'加入购物车', cart_checkout:'购物车与结账', close:'关闭', step_cart:'购物车', step_address:'配送地址', step_confirm:'确认',
      subtotal:'商品金额', shipping:'配送费', total:'合计', free:'免费', continue:'继续', choose_address:'选择配送地址',
      note_team:'给团队的备注', note_placeholder:'例如：请包装成礼物', place_order:'确认下单', back_cart:'返回修改购物车', cart_empty:'购物车还是空的',
      no_address:'尚未保存配送地址，请先在账户中添加。', add_address:'添加配送地址', address_notice:'请选择已保存地址。系统会把地址快照保存在订单中，避免之后被修改。',
      payment_total:'应付金额', order_received:'已收到订单 ✅', order_number:'订单号', payment_code:'付款代码',
      payment_instruction:'请按显示金额转账，并在 LINE 中把付款凭证发送给 Thongthai 供团队核验。确认后订单将进入备货状态。',
      track_order:'查看订单与物流', member_load_error:'无法加载会员信息，请重试。', product_load_error:'商品加载失败', product_system_error:'商品系统暂时不可用，请稍后再试。', err_stock:'部分商品库存不足，请调整数量。', err_product:'部分商品已停售或售罄。', err_address:'未找到配送地址，请重新选择。', err_checkout:'结账系统暂时不可用。', err_order:'无法创建订单。',
      shipping_quote:'运费 ฿{fee} · 约 {min}–{max} 天', shipping_quote_free:'运费 ฿{fee} · 满 ฿{threshold} 免运费 · 约 {min}–{max} 天',
      wear_title:'服饰与织物', wear_sub:'把当地手作带进日常生活的织物、缝制与实用品', food_title:'食品与伴手礼', food_sub:'与地方紧密相连的味道、食材与保存方式',
      home_title:'家居与身心', home_sub:'来自当地日常生活的家用品、编织与草本'
    },
    lo:{
      switch_language:'ປ່ຽນພາສາ',
      map_page_title:'ແຜນທີ່ OTOP ອີສານ — ທຳມາ-ຊາດ', map_meta:'ສຳຫຼວດ 20 ແຂວງອີສານ ຜ່ານຊ່າງຝີມື ອາຫານ ແລະເລື່ອງລາວຂອງຊຸມຊົນ.',
      map_skip:'ໄປທີ່ແຜນທີ່', map_back:'ກັບໜ້າຫຼັກ ທຳມາ-ຊາດ', login:'ເຂົ້າລະບົບ', signup:'ສະໝັກສະມາຊິກ', account:'ບັນຊີຂອງຂ້ອຍ',
      map_overline:'20 ແຂວງອີສານ', map_title:'ເລືອກແຂວງທີ່ຢາກຮູ້ຈັກ', map_intro:'ແຕະແຜນທີ່ ຫຼື ເລືອກຊື່ແຂວງດ້ານລຸ່ມ ເພື່ອຮູ້ຈັກຜູ້ຄົນ ວິຖີຊີວິດ ແລະເອກະລັກຂອງແຕ່ລະພື້ນທີ່.',
      map_legend_aria:'ຄຳອະທິບາຍແຜນທີ່', map_selected:'ແຂວງທີ່ເລືອກ', map_other:'ແຂວງອື່ນ', map_loading:'ກຳລັງເປີດແຜນທີ່ອີສານ…',
      map_aria:'ແຜນທີ່ 20 ແຂວງພາກອີສານ', map_quick_aria:'ລາຍຊື່ 20 ແຂວງ', map_story_label:'ເລື່ອງລາວຂອງແຂວງ',
      map_concept:'ເລືອກຊື້ເມື່ອພ້ອມ ຫຼັງຈາກຮູ້ຈັກທີ່ມາ ຄົນເຮັດ ແລະຄຸນຄ່າຂອງພື້ນທີ່.',
      map_footer:'ກິນ ພັກ ເຮັດກິດຈະກຳ ແລະຮູ້ຈັກຂອງດີອີສານ', map_province_header:'ປະສົບການປະຈຳແຂວງ · {order}', map_cta:'ເບິ່ງສິນຄ້າຈາກ {name}',
      map_error:'ຕອນນີ້ບໍ່ສາມາດເປີດແຜນທີ່ໄດ້ ກະລຸນາລອງໃໝ່.', map_generic_title:'ຮູ້ຈັກ {name} ຜ່ານງານຝີມື ອາຫານ ແລະຜູ້ຄົນ',
      map_generic_desc:'ສຳຫຼວດງານຝີມື ອາຫານ ຄົນເຮັດ ແລະເລື່ອງລາວຈາກ {name} ກ່ອນເລືອກຂອງທີ່ຢາກນຳກັບບ້ານ.',
      store_page_title:'OTOP {name} · ທຳມາ-ຊາດ', store_nav:'ຮ້ານ OTOP', store_back:'ກັບໜ້າຫຼັກ ທຳມາ-ຊາດ',
      province:'ແຂວງ', choose_province:'ເລືອກແຂວງ', search:'ຄົ້ນຫາສິນຄ້າ', cart:'ກະຕ່າ', open_cart:'ເປີດກະຕ່າ',
      hero_kicker:'OTOP · ຈາກມື ຈາກພື້ນທີ່ ແລະຈາກເວລາ', hero_title:'ມີເລື່ອງລາວກ່ອນ<br>ຈຶ່ງມີລາຄາ',
      hero_lead:'ພວກເຮົາບໍ່ເລືອກຂອງພຽງເພາະສວຍ ຫຼືຂາຍໄດ້ ແຕ່ເພາະແຕ່ລະຊິ້ນມີຄົນເຮັດ ມີພື້ນທີ່ ມີເວລາ ແລະມີເຫດຜົນທີ່ຄວນເກີດຢູ່ທີ່ນີ້.',
      hero_shop:'ເບິ່ງຂອງດີຈາກ {name} ↓', view_map:'ເບິ່ງແຜນທີ່ຂອງດີອີສານ', store_eyebrow:'OTOP · ຈາກຄົນເຮັດຈິງ',
      shop_title:'ເລືອກຂອງດີຈາກ {name}', store_intro:'ເບິ່ງລາຍລະອຽດ ຮູ້ຈັກທີ່ມາ ແລ້ວຄ່ອຍໃສ່ກະຕ່າເມື່ອພ້ອມ. ສິນຄ້າໃນໜ້ານີ້ມາຈາກ {name}.',
      shipping_loading:'ກຳລັງໂຫຼດຂໍ້ມູນຈັດສົ່ງ', curated_now:'ຄັດສັນຕອນນີ້', real_sales:'ຍອດຂາຍຈິງ', curated_title:'ຄັດສັນໂດຍ ທຳມາ-ຊາດ',
      best_seller:'ຂາຍດີ', curated_sub:'ຂອງທີ່ຢາກໃຫ້ຮູ້ຈັກກ່ອນ', best_seller_sub:'ຮຽງຕາມຍອດຂາຍທີ່ສຳເລັດ', collections:'ໝວດສິນຄ້າ',
      catalog_title:'ສິນຄ້າ OTOP {name}', loading_products:'ກຳລັງໂຫຼດສິນຄ້າ…', featured:'ສິນຄ້າແນະນຳ', price_low:'ລາຄາຕ່ຳ–ສູງ', price_high:'ລາຄາສູງ–ຕ່ຳ',
      sort_aria:'ຈັດລຽງສິນຄ້າ', no_products_category:'ຍັງບໍ່ມີສິນຄ້າໃນໝວດນີ້', no_search:'ບໍ່ພົບສິນຄ້າທີ່ຄົ້ນຫາ',
      no_products_province:'ຍັງບໍ່ມີສິນຄ້າຈາກ {name} ທີ່ພ້ອມຂາຍ', back_map:'ກັບໄປເລືອກແຂວງໃນແຜນທີ່',
      catalog_status:'{count} ລາຍການ · ລາຄາແລະສະຕັອກອັບເດດຈາກຫຼັງບ້ານ', catalog_empty:'ຍັງບໍ່ມີສິນຄ້າທີ່ພ້ອມຂາຍ',
      view_product:'ເບິ່ງສິນຄ້າ →', stock:'ເຫຼືອ {count} ຊິ້ນ', product_detail:'ເບິ່ງລາຍລະອຽດ {name}', community_product:'ສິນຄ້າຊຸມຊົນຈາກ {name}',
      story_piece:'ເລື່ອງຂອງຊິ້ນນີ້', value_piece:'ຄຸນຄ່າຂອງຊິ້ນນີ້', origin:'ທີ່ມາ', maker:'ຜູ້ຜະລິດ', material:'ວັດສະດຸ / ວັດຖຸດິບ',
      process:'ວິທີເຮັດ', why_here:'ເປັນຫຍັງຕ້ອງເປັນທີ່ນີ້', sku_meta:'SKU {sku}<br>ມີສິນຄ້າ {count} ຊິ້ນ · ລາຄາແລະສະຕັອກອັບເດດຈາກຫຼັງບ້ານ',
      close_product:'ປິດລາຍລະອຽດ', quantity:'ຈຳນວນ', decrease:'ຫຼຸດຈຳນວນ', increase:'ເພີ່ມຈຳນວນ', add_cart:'ໃສ່ກະຕ່າ',
      cart_checkout:'ກະຕ່າແລະຊຳລະເງິນ', close:'ປິດ', step_cart:'ກະຕ່າ', step_address:'ທີ່ຢູ່ຈັດສົ່ງ', step_confirm:'ຢືນຢັນ',
      subtotal:'ຄ່າສິນຄ້າ', shipping:'ຄ່າຈັດສົ່ງ', total:'ລວມ', free:'ຟຣີ', continue:'ດຳເນີນຕໍ່', choose_address:'ເລືອກທີ່ຢູ່ຈັດສົ່ງ',
      note_team:'ໝາຍເຫດຫາທີມງານ', note_placeholder:'ເຊັ່ນ ຫໍ່ເປັນຂອງຂວັນ', place_order:'ຢືນຢັນຄຳສັ່ງຊື້', back_cart:'ກັບໄປແກ້ກະຕ່າ',
      cart_empty:'ຍັງບໍ່ມີສິນຄ້າໃນກະຕ່າ', no_address:'ຍັງບໍ່ມີທີ່ຢູ່ຈັດສົ່ງ ກະລຸນາເພີ່ມໃນບັນຊີກ່ອນ', add_address:'ເພີ່ມທີ່ຢູ່ຈັດສົ່ງ',
      address_notice:'ເລືອກທີ່ຢູ່ທີ່ບັນທຶກໄວ້. ລະບົບຈະເກັບສຳເນົາທີ່ຢູ່ກັບອໍເດີ ເພື່ອບໍ່ໃຫ້ຂໍ້ມູນປ່ຽນພາຍຫຼັງ.',
      payment_total:'ຍອດຊຳລະ', order_received:'ຮັບຄຳສັ່ງຊື້ແລ້ວ ✅', order_number:'ເລກອໍເດີ', payment_code:'ລະຫັດຊຳລະ',
      payment_instruction:'ໂອນຕາມຍອດດ້ານເທິງ ແລ້ວສົ່ງສະລິບໃຫ້ທອງໄທໃນ LINE ເພື່ອໃຫ້ທີມງານກວດສອບ. ຫຼັງຢືນຢັນ ສະຖານະຈະເປັນກຳລັງຈັດເຕັມສິນຄ້າ.',
      track_order:'ເບິ່ງອໍເດີແລະຕິດຕາມພັດສະດຸ', member_load_error:'ໂຫຼດຂໍ້ມູນສະມາຊິກບໍ່ສຳເລັດ ກະລຸນາລອງໃໝ່',
      product_load_error:'ໂຫຼດສິນຄ້າບໍ່ສຳເລັດ', product_system_error:'ລະບົບສິນຄ້າບໍ່ພ້ອມຊົ່ວຄາວ ກະລຸນາລອງໃໝ່', err_stock:'ສິນຄ້າບາງລາຍການມີຈຳນວນບໍ່ພໍ ກະລຸນາປັບຈຳນວນ', err_product:'ສິນຄ້າບາງລາຍການປິດຂາຍ ຫຼື ໝົດ', err_address:'ບໍ່ພົບທີ່ຢູ່ຈັດສົ່ງ ກະລຸນາເລືອກໃໝ່', err_checkout:'ລະບົບຮັບອໍເດີຂັດຂ້ອງຊົ່ວຄາວ', err_order:'ສ້າງຄຳສັ່ງຊື້ບໍ່ສຳເລັດ',
      shipping_quote:'ຄ່າສົ່ງ ฿{fee} · ປະມານ {min}–{max} ມື້', shipping_quote_free:'ຄ່າສົ່ງ ฿{fee} · ສົ່ງຟຣີເມື່ອຄົບ ฿{threshold} · ປະມານ {min}–{max} ມື້',
      wear_title:'ເຄື່ອງນຸ່ງ & ງານຜ້າ', wear_sub:'ຜ້າ ງານຫຍິບ ແລະຂອງໃຊ້ທີ່ນຳງານຝີມືເຂົ້າສູ່ຊີວິດປະຈຳວັນ',
      food_title:'ຂອງກິນ & ຂອງຝາກ', food_sub:'ລົດຊາດ ວັດຖຸດິບ ແລະວິທີຖະໜອມອາຫານທີ່ຜູກກັບພື້ນທີ່',
      home_title:'ບ້ານ & ການດູແລຕົນເອງ', home_sub:'ຂອງໃຊ້ ງານສານ ແລະສະໝຸນໄພຈາກວິຖີຊີວິດໃກ້ຕົວ'
    },
    vi:{
      switch_language:'Đổi ngôn ngữ',
      map_page_title:'Bản đồ OTOP Isan — Thammachat', map_meta:'Khám phá 20 tỉnh vùng Isan qua nghề thủ công, ẩm thực, người làm và câu chuyện cộng đồng.',
      map_skip:'Đi đến bản đồ', map_back:'Về trang chủ Thammachat', login:'Đăng nhập', signup:'Đăng ký', account:'Tài khoản của tôi',
      map_overline:'20 TỈNH VÙNG ISAN', map_title:'Chọn một tỉnh để khám phá',
      map_intro:'Chạm vào bản đồ hoặc chọn tên tỉnh bên dưới để tìm hiểu con người, đời sống địa phương và nét riêng của từng nơi.',
      map_legend_aria:'Chú giải bản đồ', map_selected:'Tỉnh đang chọn', map_other:'Tỉnh khác', map_loading:'Đang mở bản đồ Isan…',
      map_aria:'Bản đồ 20 tỉnh vùng Đông Bắc Thái Lan', map_quick_aria:'Danh sách 20 tỉnh', map_story_label:'Câu chuyện địa phương',
      map_concept:'Hãy mua khi bạn đã sẵn sàng, sau khi hiểu nơi chốn, người làm và giá trị phía sau từng sản phẩm.',
      map_footer:'Ăn, nghỉ, trải nghiệm và khám phá sản vật Isan', map_province_header:'TRẢI NGHIỆM ĐỊA PHƯƠNG · {order}', map_cta:'Xem sản phẩm từ {name}',
      map_error:'Hiện không thể mở bản đồ. Vui lòng thử lại.', map_generic_title:'Khám phá {name} qua nghề thủ công, ẩm thực và con người',
      map_generic_desc:'Khám phá nghề thủ công, ẩm thực, người làm và câu chuyện từ {name} trước khi chọn một món mang về.',
      store_page_title:'OTOP {name} · Thammachat', store_nav:'Cửa hàng OTOP', store_back:'Về trang chủ Thammachat',
      province:'Tỉnh', choose_province:'Chọn tỉnh', search:'Tìm sản phẩm', cart:'Giỏ hàng', open_cart:'Mở giỏ hàng',
      hero_kicker:'OTOP · TỪ ĐÔI TAY, VÙNG ĐẤT & THỜI GIAN', hero_title:'Có câu chuyện trước<br>rồi mới có giá',
      hero_lead:'Chúng tôi không chọn một món chỉ vì đẹp hay dễ bán, mà vì mỗi món có người làm, có vùng đất, có thời gian và có lý do để được sinh ra ở đây.',
      hero_shop:'Xem sản vật {name} ↓', view_map:'Xem bản đồ Isan', store_eyebrow:'OTOP · TỪ NGƯỜI LÀM THẬT',
      shop_title:'Chọn sản vật từ {name}', store_intro:'Xem chi tiết, tìm hiểu nguồn gốc và thêm vào giỏ khi bạn sẵn sàng. Mọi sản phẩm trên trang này đều đến từ {name}.',
      shipping_loading:'Đang tải thông tin giao hàng', curated_now:'ĐANG TUYỂN CHỌN', real_sales:'DOANH SỐ THỰC', curated_title:'Thammachat tuyển chọn',
      best_seller:'Bán chạy', curated_sub:'Những món chúng tôi muốn bạn khám phá trước', best_seller_sub:'Xếp theo số đơn đã hoàn tất',
      collections:'BỘ SƯU TẬP', catalog_title:'Sản phẩm OTOP · {name}', loading_products:'Đang tải sản phẩm…', featured:'Nổi bật',
      price_low:'Giá: thấp đến cao', price_high:'Giá: cao đến thấp', sort_aria:'Sắp xếp sản phẩm', no_products_category:'Chưa có sản phẩm trong nhóm này',
      no_search:'Không tìm thấy sản phẩm phù hợp', no_products_province:'Chưa có sản phẩm từ {name} sẵn sàng bán', back_map:'Quay lại bản đồ tỉnh',
      catalog_status:'{count} sản phẩm · giá và tồn kho cập nhật từ hệ thống', catalog_empty:'Chưa có sản phẩm từ tỉnh này sẵn sàng bán',
      view_product:'Xem sản phẩm →', stock:'Còn {count} sản phẩm', product_detail:'Xem chi tiết {name}', community_product:'Sản phẩm cộng đồng từ {name}',
      story_piece:'CÂU CHUYỆN CỦA SẢN PHẨM', value_piece:'GIÁ TRỊ CỦA SẢN PHẨM', origin:'Nguồn gốc', maker:'Người làm', material:'Vật liệu / nguyên liệu',
      process:'Cách làm', why_here:'Vì sao là nơi này', sku_meta:'SKU {sku}<br>Còn {count} sản phẩm · giá và tồn kho cập nhật từ hệ thống',
      close_product:'Đóng chi tiết sản phẩm', quantity:'Số lượng', decrease:'Giảm số lượng', increase:'Tăng số lượng', add_cart:'Thêm vào giỏ',
      cart_checkout:'Giỏ hàng và thanh toán', close:'Đóng', step_cart:'Giỏ hàng', step_address:'Địa chỉ giao hàng', step_confirm:'Xác nhận',
      subtotal:'Tiền hàng', shipping:'Phí giao hàng', total:'Tổng', free:'Miễn phí', continue:'Tiếp tục', choose_address:'Chọn địa chỉ giao hàng',
      note_team:'Ghi chú cho đội ngũ', note_placeholder:'Ví dụ: gói làm quà', place_order:'Xác nhận đơn hàng', back_cart:'Quay lại giỏ', cart_empty:'Giỏ hàng đang trống',
      no_address:'Bạn chưa có địa chỉ giao hàng. Vui lòng thêm địa chỉ trong tài khoản trước.', add_address:'Thêm địa chỉ giao hàng',
      address_notice:'Chọn địa chỉ đã lưu. Hệ thống sẽ lưu một bản chụp địa chỉ cùng đơn hàng để thông tin giao hàng không thay đổi về sau.',
      payment_total:'Số tiền cần thanh toán', order_received:'Đã nhận đơn hàng ✅', order_number:'Mã đơn hàng', payment_code:'Mã thanh toán',
      payment_instruction:'Chuyển đúng số tiền hiển thị rồi gửi biên lai cho Thongthai trên LINE để đội ngũ xác minh. Sau khi xác nhận, đơn hàng sẽ chuyển sang trạng thái đóng gói.',
      track_order:'Xem đơn hàng và theo dõi vận chuyển', member_load_error:'Không tải được thông tin thành viên. Vui lòng thử lại.',
      product_load_error:'Không tải được sản phẩm', product_system_error:'Hệ thống sản phẩm tạm thời không khả dụng. Vui lòng thử lại.', err_stock:'Một số sản phẩm không đủ tồn kho. Vui lòng điều chỉnh số lượng.', err_product:'Một số sản phẩm đã ngừng bán hoặc hết hàng.', err_address:'Không tìm thấy địa chỉ giao hàng. Vui lòng chọn địa chỉ khác.', err_checkout:'Hệ thống đặt hàng tạm thời không khả dụng.', err_order:'Không thể tạo đơn hàng.',
      shipping_quote:'Phí giao hàng ฿{fee} · khoảng {min}–{max} ngày', shipping_quote_free:'Phí giao hàng ฿{fee} · miễn phí từ ฿{threshold} · khoảng {min}–{max} ngày',
      wear_title:'Trang phục & dệt may', wear_sub:'Vải, đồ may và vật dụng đưa nghề thủ công địa phương vào đời sống hàng ngày',
      food_title:'Ẩm thực & quà tặng', food_sub:'Hương vị, nguyên liệu và cách bảo quản gắn với vùng đất',
      home_title:'Nhà cửa & chăm sóc bản thân', home_sub:'Đồ gia dụng, đan lát và thảo mộc từ đời sống địa phương'
    }
  };

  let current = 'th';
  const listeners = new Set();

  function interpolate(value, vars = {}) {
    return String(value).replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
  }
  function t(key, vars) {
    const dict = D[current] || D.th;
    return interpolate(dict[key] ?? D.th[key] ?? key, vars);
  }
  function locale() { return LOCALES[current] || LOCALES.th; }
  function provinceName(id) {
    return current === 'th' ? (PROVINCES_TH[id] || id) : (PROVINCES_LATIN[id] || PROVINCES_TH[id] || id);
  }
  function productName(product) {
    const tr = product?.metadata?.translations?.[current] || product?.metadata?.i18n?.[current];
    return typeof tr?.name === 'string' && tr.name.trim() ? tr.name.trim() : String(product?.name || '');
  }
  function productStory(product) {
    if (current === 'th') return product?.story || null;
    const tr = product?.metadata?.translations?.[current] || product?.metadata?.i18n?.[current];
    return tr?.story && typeof tr.story === 'object' ? tr.story : null;
  }
  function languageFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (SUPPORTED.includes(saved)) return saved;
    } catch (_) {}
    const nav = String(navigator.language || '').toLowerCase();
    if (nav.startsWith('en')) return 'en';
    if (nav.startsWith('zh')) return 'zh';
    if (nav.startsWith('lo')) return 'lo';
    if (nav.startsWith('vi')) return 'vi';
    return 'th';
  }
  function notify() {
    document.documentElement.lang = current;
    document.querySelectorAll('.site-lang-menu button[data-lang]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.lang === current);
    });
    document.querySelectorAll('.site-lang-toggle').forEach(btn => {
      btn.textContent = LANGUAGE_LABELS[current][1];
      btn.setAttribute('aria-label', t('switch_language'));
    });
    listeners.forEach(fn => { try { fn(current); } catch (e) { console.error(e); } });
    window.dispatchEvent(new CustomEvent('otop:i18n-change', { detail:{ lang: current } }));
  }
  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    current = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
    document.querySelectorAll('.site-lang-switch').forEach(el => el.classList.remove('is-open'));
    notify();
  }
  function mountSwitcher(slot) {
    if (!slot || slot.querySelector('.site-lang-switch')) return;
    const wrap = document.createElement('div');
    wrap.className = 'site-lang-switch';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'site-lang-toggle';
    toggle.setAttribute('aria-haspopup','menu');
    const menu = document.createElement('div');
    menu.className = 'site-lang-menu';
    menu.setAttribute('role','menu');
    for (const lang of SUPPORTED) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.lang = lang;
      btn.setAttribute('role','menuitem');
      btn.innerHTML = '<span>'+LANGUAGE_LABELS[lang][0]+'</span><span class="site-lang-code">'+LANGUAGE_LABELS[lang][1]+'</span>';
      btn.addEventListener('click', () => setLang(lang));
      menu.append(btn);
    }
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      wrap.classList.toggle('is-open');
    });
    wrap.append(toggle, menu);
    slot.prepend(wrap);
    document.addEventListener('click', e => {
      if (!wrap.contains(e.target)) wrap.classList.remove('is-open');
    });
  }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  current = languageFromStorage();
  document.documentElement.lang = current;

  window.OtopI18n = {
    t, locale, lang:() => current, setLang, onChange, mountSwitcher,
    provinceName, productName, productStory,
    provinceIds:Object.keys(PROVINCES_TH),
    provincesThai:{...PROVINCES_TH},
    provincesLatin:{...PROVINCES_LATIN}
  };
})();
