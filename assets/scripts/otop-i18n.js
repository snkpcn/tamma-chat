(() => {
  'use strict';

  const STORAGE_KEY = 'thammachat-lang-v1';
  const SUPPORTED = ['th','en','zh','lo','vi'];
  const LOCALES = { th:'th-TH', en:'en-US', zh:'zh-CN', lo:'lo-LA', vi:'vi-VN' };

  const PROVINCES = {
    chaiyaphum:{th:'ชัยภูมิ',en:'Chaiyaphum',zh:'猜也蓬',lo:'ໄຊຍະພູມ',vi:'Chaiyaphum'},
    khonkaen:{th:'ขอนแก่น',en:'Khon Kaen',zh:'孔敬',lo:'ຂອນແກ່ນ',vi:'Khon Kaen'},
    buriram:{th:'บุรีรัมย์',en:'Buriram',zh:'武里南',lo:'ບຸຣີຣຳ',vi:'Buriram'},
    surin:{th:'สุรินทร์',en:'Surin',zh:'素林',lo:'ສຸຣິນ',vi:'Surin'},
    sisaket:{th:'ศรีสะเกษ',en:'Sisaket',zh:'四色菊',lo:'ສີສະເກດ',vi:'Sisaket'},
    nakhonratchasima:{th:'นครราชสีมา',en:'Nakhon Ratchasima',zh:'呵叻',lo:'ນະຄອນຣາຊະສີມາ',vi:'Nakhon Ratchasima'},
    roiet:{th:'ร้อยเอ็ด',en:'Roi Et',zh:'黎逸',lo:'ຮ້ອຍເອັດ',vi:'Roi Et'},
    mahasarakham:{th:'มหาสารคาม',en:'Maha Sarakham',zh:'玛哈沙拉堪',lo:'ມະຫາສາຣະຄາມ',vi:'Maha Sarakham'},
    kalasin:{th:'กาฬสินธุ์',en:'Kalasin',zh:'加拉信',lo:'ກາລະສິນ',vi:'Kalasin'},
    sakonnakhon:{th:'สกลนคร',en:'Sakon Nakhon',zh:'沙功那空',lo:'ສະກົນນະຄອນ',vi:'Sakon Nakhon'},
    nakhonphanom:{th:'นครพนม',en:'Nakhon Phanom',zh:'那空拍侬',lo:'ນະຄອນພະນົມ',vi:'Nakhon Phanom'},
    mukdahan:{th:'มุกดาหาร',en:'Mukdahan',zh:'穆达汉',lo:'ມຸກດາຫານ',vi:'Mukdahan'},
    yasothon:{th:'ยโสธร',en:'Yasothon',zh:'益梭通',lo:'ຍະໂສທອນ',vi:'Yasothon'},
    amnatcharoen:{th:'อำนาจเจริญ',en:'Amnat Charoen',zh:'安纳乍能',lo:'ອຳນາດຈະເລີນ',vi:'Amnat Charoen'},
    ubonratchathani:{th:'อุบลราชธานี',en:'Ubon Ratchathani',zh:'乌汶',lo:'ອຸບົນຣາຊະທານີ',vi:'Ubon Ratchathani'},
    udonthani:{th:'อุดรธานี',en:'Udon Thani',zh:'乌隆',lo:'ອຸດອນທານີ',vi:'Udon Thani'},
    nongkhai:{th:'หนองคาย',en:'Nong Khai',zh:'廊开',lo:'ໜອງຄາຍ',vi:'Nong Khai'},
    buengkan:{th:'บึงกาฬ',en:'Bueng Kan',zh:'汶干',lo:'ບຶງການ',vi:'Bueng Kan'},
    loei:{th:'เลย',en:'Loei',zh:'黎府',lo:'ເລີຍ',vi:'Loei'},
    nongbualamphu:{th:'หนองบัวลำภู',en:'Nong Bua Lamphu',zh:'农磨兰普',lo:'ໜອງບົວລຳພູ',vi:'Nong Bua Lamphu'}
  };

  const COPY = {
    th:{
      language:'ภาษา', login:'เข้าสู่ระบบ', signup:'สมัครสมาชิก', account:'บัญชีของฉัน',
      map_skip:'ข้ามไปยังแผนที่', map_overline:'ประสบการณ์อีสาน 20 จังหวัด',
      map_title:'เลือกจังหวัดที่อยากรู้จัก', map_intro:'แตะบนแผนที่หรือเลือกชื่อจังหวัดด้านล่าง เพื่อเปิดเรื่องราวของผู้คน วิถีชีวิต และสิ่งที่ทำให้แต่ละพื้นที่ไม่เหมือนกัน',
      map_selected:'จังหวัดที่เลือก', map_other:'จังหวัดอื่น', map_loading:'กำลังเปิดแผนที่อีสาน…',
      map_quick_label:'รายชื่อ 20 จังหวัด', province_story_label:'เรื่องราวของจังหวัด',
      province_experience_title:'ผู้คน งานฝีมือ และวิถีของ{province}',
      province_experience_desc:'ทำความรู้จัก{province}ผ่านงานฝีมือ อาหาร วิถีชุมชน และเรื่องเล่าจากพื้นที่ ก่อนเลือกของที่อยากพากลับบ้าน',
      map_cta:'ดูสินค้าจาก{province}', map_concept:'เลือกซื้อเมื่อพร้อม หลังจากได้รู้จักที่มา คนทำ และคุณค่าของพื้นที่นั้นแล้ว',
      map_footer:'กิน พัก ทำกิจกรรม และรู้จักของดีอีสาน', map_error:'ไม่สามารถเปิดแผนที่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
      province_counter:'ประสบการณ์จังหวัด · {order}',

      shop_province:'จังหวัด', shop_search:'ค้นหาสินค้า', shop_account:'บัญชีของฉัน', shop_cart:'ตะกร้า',
      hero_kicker:'ISAN CRAFT · ทำมา-ชาติ OTOP', hero_title:'ของที่มีที่มา ก่อนจะมีราคา',
      hero_lead:'เราไม่ได้เลือกมาแค่เพราะสวยหรือขายได้ แต่เพราะแต่ละชิ้นมีคนทำ มีพื้นที่ มีเวลา และมีเหตุผลที่มันควรเกิดที่นี่',
      hero_shop:'ดูของดีจาก{province} ↓', hero_map:'เปิดแผนที่ 20 จังหวัด',
      province_eyebrow:'OTOP · ของดีจากคนทำจริง', shop_title:'เลือกของดีจาก{province}',
      province_intro:'เลือกดูรายละเอียดสินค้า รู้จักที่มา แล้วใส่ตะกร้าเมื่อพร้อม สินค้าทุกชิ้นในหน้านี้มาจาก{province}',
      shipping_loading:'กำลังโหลดข้อมูลการจัดส่ง', curated:'คัดสรรโดย ทำมา-ชาติ', curated_sub:'ของที่เราอยากให้เริ่มรู้จัก',
      best_seller:'สินค้าขายดี', best_seller_sub:'สินค้าที่มียอดขายสำเร็จจริง เรียงตามจำนวนที่ขายได้',
      collections:'COLLECTIONS', catalog_heading:'สินค้า OTOP {province}', catalog_loading:'กำลังโหลดสินค้า…',
      sort_featured:'สินค้าแนะนำ', sort_low_high:'ราคาต่ำ–สูง', sort_high_low:'ราคาสูง–ต่ำ',
      category_wear:'สวมใส่ & งานผ้า', category_wear_sub:'ผ้า งานเย็บ และของใช้ที่พางานมือออกไปใช้ในชีวิตประจำวัน',
      category_food:'ของกิน & ของฝาก', category_food_sub:'รสชาติ วัตถุดิบ และวิธีถนอมอาหารที่ผูกกับพื้นที่',
      category_home:'บ้าน & การดูแลตัวเอง', category_home_sub:'ของใช้ จักสาน และสมุนไพรจากวิถีใกล้ตัว',
      view_product:'ดูสินค้า →', stock_left:'เหลือ {count} ชิ้น', items_count:'{count} รายการ',
      no_products:'ยังไม่มีสินค้าที่พร้อมจำหน่ายจากจังหวัดนี้', no_search:'ไม่พบสินค้าที่ค้นหา',
      back_map:'กลับไปเลือกจังหวัดบนแผนที่', no_category:'ยังไม่มีสินค้าในหมวดนี้',
      product_story:'เรื่องของชิ้นนี้', value_piece:'คุณค่าของชิ้นนี้', origin:'ที่มา', maker:'ผู้ผลิต',
      material:'วัสดุ / วัตถุดิบ', process:'วิธีทำ', why_here:'ทำไมต้องเป็นที่นี่',
      product_code:'รหัสสินค้า', stock_updated:'ราคาและสต็อกอัปเดตจากหลังบ้าน',
      add_cart:'ใส่ตะกร้า', close:'ปิด', cart_title:'ตะกร้าสินค้า', cart_empty:'ยังไม่มีสินค้าในตะกร้า',
      subtotal:'ค่าสินค้า', shipping:'ค่าจัดส่ง', free:'ฟรี', total:'รวม', continue:'ดำเนินการต่อ',
      step_cart:'ตะกร้า', step_address:'ที่อยู่จัดส่ง', step_confirm:'ยืนยัน',
      choose_address:'เลือกที่อยู่จัดส่ง', no_address:'ยังไม่มีที่อยู่จัดส่ง กรุณาเพิ่มที่อยู่ในบัญชีของฉันก่อน',
      add_address:'เพิ่มที่อยู่จัดส่ง', address_notice:'เลือกที่อยู่ที่บันทึกไว้ ระบบจะเก็บสำเนาที่อยู่นี้กับออเดอร์เพื่อให้ข้อมูลการจัดส่งไม่เปลี่ยนภายหลัง',
      note_team:'หมายเหตุถึงทีมงาน', note_ph:'เช่น แพ็กเป็นของขวัญ', place_order:'ยืนยันคำสั่งซื้อ', back_cart:'กลับไปแก้ตะกร้า',
      payment_due:'ยอดชำระ', order_confirmed:'รับคำสั่งซื้อแล้ว', order_number:'เลขออเดอร์', payment_code:'รหัสชำระเงิน',
      promptpay_note:'โอนตามยอดด้านบน แล้วส่งสลิปให้ทองไทยใน LINE เพื่อให้ทีมงานตรวจสอบ เมื่อยืนยันแล้วสถานะจะเปลี่ยนเป็นกำลังเตรียมสินค้า',
      track_order:'ดูออเดอร์และติดตามพัสดุ', catalog_error:'ระบบสินค้าไม่พร้อมชั่วคราว กรุณาลองใหม่',
      catalog_load_error:'โหลดสินค้าไม่สำเร็จ', member_load_error:'โหลดข้อมูลสมาชิกไม่สำเร็จ กรุณาลองใหม่',
      shipping_line:'ค่าส่ง ฿{fee} · ประมาณ {min}–{max} วัน', shipping_free_line:'ค่าส่ง ฿{fee} · ส่งฟรีเมื่อครบ ฿{threshold} · ประมาณ {min}–{max} วัน',
      catalog_status:'{count} รายการ · ราคาและสต็อกอัปเดตจากหลังบ้าน',
      detail_fallback:'สินค้าชุมชนจาก{province}'
    },
    en:{
      language:'Language', login:'Sign in', signup:'Join', account:'My account',
      map_skip:'Skip to map', map_overline:'20 Provinces of Isan',
      map_title:'Choose a province to discover', map_intro:'Tap the map or choose a province below to explore its people, craft, everyday life and local character.',
      map_selected:'Selected province', map_other:'Other provinces', map_loading:'Opening the Isan map…',
      map_quick_label:'20 provinces', province_story_label:'Province story',
      province_experience_title:'People, craft and everyday life in {province}',
      province_experience_desc:'Meet {province} through local craft, food, community life and stories from the place before choosing something to take home.',
      map_cta:'Shop from {province}', map_concept:'Buy when you are ready—after knowing where it comes from, who made it and why the place matters.',
      map_footer:'Eat, stay, explore and discover the good things of Isan', map_error:'The map could not be opened right now. Please try again.',
      province_counter:'Province experience · {order}',

      shop_province:'Province', shop_search:'Search products', shop_account:'My account', shop_cart:'Cart',
      hero_kicker:'ISAN CRAFT · THAMMACHAT OTOP', hero_title:'Know the story before the price',
      hero_lead:'We choose each piece not simply because it looks good or sells, but because it carries a maker, a place, time and a reason to exist here.',
      hero_shop:'Explore {province} ↓', hero_map:'Open the 20-province map',
      province_eyebrow:'OTOP · FROM REAL MAKERS', shop_title:'Discover goods from {province}',
      province_intro:'Explore each product, learn where it comes from, and add it to your cart when you are ready. Every item on this page comes from {province}.',
      shipping_loading:'Loading shipping information', curated:'Curated by Thammachat', curated_sub:'Pieces we think are worth discovering first',
      best_seller:'Best sellers', best_seller_sub:'Products ranked by completed sales',
      collections:'COLLECTIONS', catalog_heading:'OTOP products from {province}', catalog_loading:'Loading products…',
      sort_featured:'Featured', sort_low_high:'Price: low to high', sort_high_low:'Price: high to low',
      category_wear:'Wear & Textiles', category_wear_sub:'Textiles, sewing and useful pieces that bring local craft into everyday life.',
      category_food:'Food & Pantry', category_food_sub:'Flavours, ingredients and preservation methods rooted in place.',
      category_home:'Home & Wellness', category_home_sub:'Household goods, weaving and herbs from everyday local life.',
      view_product:'View product →', stock_left:'{count} left', items_count:'{count} items',
      no_products:'No products from this province are available yet.', no_search:'No matching products found.',
      back_map:'Back to the province map', no_category:'No products in this category yet.',
      product_story:'The story of this piece', value_piece:'VALUE OF THIS PIECE', origin:'Origin', maker:'Maker',
      material:'Material / ingredient', process:'How it is made', why_here:'Why it belongs here',
      product_code:'Product code', stock_updated:'Price and stock updated from back office',
      add_cart:'Add to cart', close:'Close', cart_title:'Shopping cart', cart_empty:'Your cart is empty.',
      subtotal:'Subtotal', shipping:'Shipping', free:'Free', total:'Total', continue:'Continue',
      step_cart:'Cart', step_address:'Shipping address', step_confirm:'Confirm',
      choose_address:'Choose a shipping address', no_address:'You do not have a shipping address yet. Add one in My Account first.',
      add_address:'Add shipping address', address_notice:'Choose a saved address. A snapshot is stored with the order so shipping details do not change later.',
      note_team:'Note to our team', note_ph:'e.g. Pack as a gift', place_order:'Place order', back_cart:'Back to cart',
      payment_due:'Amount due', order_confirmed:'Order received', order_number:'Order number', payment_code:'Payment code',
      promptpay_note:'Pay the amount above, then send the slip to Thongthai in LINE for verification. Once verified, the order moves to packing.',
      track_order:'View order & track parcel', catalog_error:'The store is temporarily unavailable. Please try again.',
      catalog_load_error:'Could not load products', member_load_error:'Could not load member information. Please try again.',
      shipping_line:'Shipping ฿{fee} · about {min}–{max} days', shipping_free_line:'Shipping ฿{fee} · free over ฿{threshold} · about {min}–{max} days',
      catalog_status:'{count} items · price and stock updated from back office',
      detail_fallback:'Community-made product from {province}'
    },
    zh:{
      language:'语言', login:'登录', signup:'注册', account:'我的账户',
      map_skip:'跳到地图', map_overline:'泰国东北部 20 府',
      map_title:'选择一个府开始探索', map_intro:'点击地图或下方府名，了解当地的人、手艺、生活方式与独特故事。',
      map_selected:'已选择', map_other:'其他府', map_loading:'正在打开东北部地图…',
      map_quick_label:'20 府列表', province_story_label:'地方故事',
      province_experience_title:'{province}的人、手艺与生活',
      province_experience_desc:'从手工艺、食物、社区生活和当地故事认识{province}，再决定想把哪一件作品带回家。',
      map_cta:'查看{province}商品', map_concept:'了解来源、制作者与地方价值之后，再从容选择购买。',
      map_footer:'吃、住、体验，并认识真正的伊森好物', map_error:'暂时无法打开地图，请稍后再试。',
      province_counter:'府体验 · {order}',

      shop_province:'府', shop_search:'搜索商品', shop_account:'我的账户', shop_cart:'购物车',
      hero_kicker:'ISAN CRAFT · THAMMACHAT OTOP', hero_title:'先认识来处，再看价格',
      hero_lead:'我们选择一件作品，不只是因为它好看或好卖，而是因为它背后有制作者、地方、时间，以及在这里诞生的理由。',
      hero_shop:'探索{province} ↓', hero_map:'打开 20 府地图',
      province_eyebrow:'OTOP · 来自真正的制作者', shop_title:'挑选{province}好物',
      province_intro:'查看商品细节，认识它的来处，准备好后再加入购物车。本页商品均来自{province}。',
      shipping_loading:'正在加载配送信息', curated:'ทำมา-ชาติ 精选', curated_sub:'值得先认识的作品',
      best_seller:'热销商品', best_seller_sub:'按真实完成订单排序',
      collections:'系列', catalog_heading:'{province} OTOP 商品', catalog_loading:'正在加载商品…',
      sort_featured:'推荐商品', sort_low_high:'价格从低到高', sort_high_low:'价格从高到低',
      category_wear:'服饰与织物', category_wear_sub:'把地方手艺带进日常生活的织物、缝制品与实用品。',
      category_food:'食品与伴手礼', category_food_sub:'与土地相连的味道、原料和保存方式。',
      category_home:'家居与身心照护', category_home_sub:'来自日常生活的家用品、编织品与草本制品。',
      view_product:'查看商品 →', stock_left:'剩余 {count} 件', items_count:'{count} 件',
      no_products:'该府目前还没有可销售商品。', no_search:'没有找到符合条件的商品。',
      back_map:'返回府地图', no_category:'此分类暂时没有商品。',
      product_story:'这件作品的故事', value_piece:'这件作品的价值', origin:'来源', maker:'制作者',
      material:'材料 / 原料', process:'制作方式', why_here:'为什么属于这里',
      product_code:'商品编号', stock_updated:'价格与库存来自后台最新数据',
      add_cart:'加入购物车', close:'关闭', cart_title:'购物车', cart_empty:'购物车还是空的。',
      subtotal:'商品金额', shipping:'运费', free:'免费', total:'合计', continue:'继续',
      step_cart:'购物车', step_address:'配送地址', step_confirm:'确认',
      choose_address:'选择配送地址', no_address:'你还没有配送地址，请先在“我的账户”中添加。',
      add_address:'添加配送地址', address_notice:'选择已保存的地址。系统会把地址快照保存到订单中，避免之后资料变化。',
      note_team:'给团队的备注', note_ph:'例如：请包装成礼物', place_order:'确认订单', back_cart:'返回购物车',
      payment_due:'应付金额', order_confirmed:'已收到订单', order_number:'订单号', payment_code:'付款代码',
      promptpay_note:'请按上方金额付款，再通过 LINE 把付款凭证发送给 Thongthai 审核。确认后订单会进入备货状态。',
      track_order:'查看订单与物流', catalog_error:'商店暂时无法使用，请稍后再试。',
      catalog_load_error:'商品加载失败', member_load_error:'会员资料加载失败，请重试。',
      shipping_line:'运费 ฿{fee} · 约 {min}–{max} 天', shipping_free_line:'运费 ฿{fee} · 满 ฿{threshold} 免运费 · 约 {min}–{max} 天',
      catalog_status:'{count} 件 · 价格与库存来自后台最新数据',
      detail_fallback:'来自{province}的社区商品'
    },
    lo:{
      language:'ພາສາ', login:'ເຂົ້າລະບົບ', signup:'ສະໝັກສະມາຊິກ', account:'ບັນຊີຂອງຂ້ອຍ',
      map_skip:'ໄປທີ່ແຜນທີ່', map_overline:'20 ແຂວງອີສານ',
      map_title:'ເລືອກແຂວງທີ່ຢາກຮູ້ຈັກ', map_intro:'ແຕະແຜນທີ່ ຫຼື ເລືອກຊື່ແຂວງດ້ານລຸ່ມ ເພື່ອຮູ້ຈັກຜູ້ຄົນ ຝີມື ວິຖີຊີວິດ ແລະ ເລື່ອງລາວຂອງແຕ່ລະພື້ນທີ່.',
      map_selected:'ແຂວງທີ່ເລືອກ', map_other:'ແຂວງອື່ນ', map_loading:'ກຳລັງເປີດແຜນທີ່ອີສານ…',
      map_quick_label:'ລາຍຊື່ 20 ແຂວງ', province_story_label:'ເລື່ອງລາວຂອງແຂວງ',
      province_experience_title:'ຜູ້ຄົນ ຝີມື ແລະ ວິຖີຂອງ{province}',
      province_experience_desc:'ຮູ້ຈັກ{province}ຜ່ານງານຝີມື ອາຫານ ຊຸມຊົນ ແລະ ເລື່ອງລາວຈາກພື້ນທີ່ ກ່ອນເລືອກຂອງທີ່ຢາກນຳກັບບ້ານ.',
      map_cta:'ເບິ່ງສິນຄ້າຈາກ{province}', map_concept:'ເລືອກຊື້ເມື່ອພ້ອມ ຫຼັງຈາກຮູ້ທີ່ມາ ຄົນເຮັດ ແລະ ຄຸນຄ່າຂອງພື້ນທີ່.',
      map_footer:'ກິນ ພັກ ເຮັດກິດຈະກຳ ແລະ ຮູ້ຈັກຂອງດີອີສານ', map_error:'ຕອນນີ້ເປີດແຜນທີ່ບໍ່ໄດ້ ກະລຸນາລອງໃໝ່.',
      province_counter:'ປະສົບການແຂວງ · {order}',

      shop_province:'ແຂວງ', shop_search:'ຄົ້ນຫາສິນຄ້າ', shop_account:'ບັນຊີຂອງຂ້ອຍ', shop_cart:'ກະຕ່າ',
      hero_kicker:'ISAN CRAFT · THAMMACHAT OTOP', hero_title:'ຮູ້ທີ່ມາ ກ່ອນເບິ່ງລາຄາ',
      hero_lead:'ເຮົາເລືອກແຕ່ລະຊິ້ນບໍ່ແມ່ນເພາະສວຍ ຫຼື ຂາຍໄດ້ເທົ່ານັ້ນ ແຕ່ເພາະມີຄົນເຮັດ ມີພື້ນທີ່ ມີເວລາ ແລະ ເຫດຜົນທີ່ຄວນເກີດຢູ່ບ່ອນນີ້.',
      hero_shop:'ເບິ່ງຂອງດີຈາກ{province} ↓', hero_map:'ເປີດແຜນທີ່ 20 ແຂວງ',
      province_eyebrow:'OTOP · ຂອງດີຈາກຄົນເຮັດຈິງ', shop_title:'ເລືອກຂອງດີຈາກ{province}',
      province_intro:'ເບິ່ງລາຍລະອຽດ ຮູ້ທີ່ມາ ແລ້ວໃສ່ກະຕ່າເມື່ອພ້ອມ. ສິນຄ້າໜ້ານີ້ມາຈາກ{province}.',
      shipping_loading:'ກຳລັງໂຫຼດຂໍ້ມູນການຈັດສົ່ງ', curated:'ຄັດເລືອກໂດຍ ทำมา-ชาติ', curated_sub:'ຂອງທີ່ຢາກໃຫ້ຮູ້ຈັກກ່ອນ',
      best_seller:'ສິນຄ້າຂາຍດີ', best_seller_sub:'ຮຽງຕາມຍອດຂາຍທີ່ສຳເລັດແລ້ວ',
      collections:'COLLECTIONS', catalog_heading:'ສິນຄ້າ OTOP {province}', catalog_loading:'ກຳລັງໂຫຼດສິນຄ້າ…',
      sort_featured:'ສິນຄ້າແນະນຳ', sort_low_high:'ລາຄາຕ່ຳ–ສູງ', sort_high_low:'ລາຄາສູງ–ຕ່ຳ',
      category_wear:'ເຄື່ອງນຸ່ງ & ງານຜ້າ', category_wear_sub:'ຜ້າ ງານຫຍິບ ແລະ ຂອງໃຊ້ທີ່ນຳງານຝີມືເຂົ້າສູ່ຊີວິດປະຈຳວັນ.',
      category_food:'ອາຫານ & ຂອງຝາກ', category_food_sub:'ລົດຊາດ ວັດຖຸດິບ ແລະ ວິທີຖະໜອມອາຫານທີ່ຜູກກັບພື້ນທີ່.',
      category_home:'ບ້ານ & ການດູແລຕົນເອງ', category_home_sub:'ຂອງໃຊ້ ງານສານ ແລະ ສະໝຸນໄພຈາກວິຖີໃກ້ຕົວ.',
      view_product:'ເບິ່ງສິນຄ້າ →', stock_left:'ເຫຼືອ {count} ຊິ້ນ', items_count:'{count} ລາຍການ',
      no_products:'ຍັງບໍ່ມີສິນຄ້າຈາກແຂວງນີ້ທີ່ພ້ອມຂາຍ.', no_search:'ບໍ່ພົບສິນຄ້າທີ່ຄົ້ນຫາ.',
      back_map:'ກັບໄປເລືອກແຂວງໃນແຜນທີ່', no_category:'ຍັງບໍ່ມີສິນຄ້າໃນໝວດນີ້.',
      product_story:'ເລື່ອງຂອງຊິ້ນນີ້', value_piece:'ຄຸນຄ່າຂອງຊິ້ນນີ້', origin:'ທີ່ມາ', maker:'ຜູ້ຜະລິດ',
      material:'ວັດສະດຸ / ວັດຖຸດິບ', process:'ວິທີເຮັດ', why_here:'ເປັນຫຍັງຕ້ອງເປັນທີ່ນີ້',
      product_code:'ລະຫັດສິນຄ້າ', stock_updated:'ລາຄາແລະສະຕັອກອັບເດດຈາກຫຼັງບ້ານ',
      add_cart:'ໃສ່ກະຕ່າ', close:'ປິດ', cart_title:'ກະຕ່າສິນຄ້າ', cart_empty:'ຍັງບໍ່ມີສິນຄ້າໃນກະຕ່າ.',
      subtotal:'ຄ່າສິນຄ້າ', shipping:'ຄ່າຈັດສົ່ງ', free:'ຟຣີ', total:'ລວມ', continue:'ດຳເນີນຕໍ່',
      step_cart:'ກະຕ່າ', step_address:'ທີ່ຢູ່ຈັດສົ່ງ', step_confirm:'ຢືນຢັນ',
      choose_address:'ເລືອກທີ່ຢູ່ຈັດສົ່ງ', no_address:'ຍັງບໍ່ມີທີ່ຢູ່ຈັດສົ່ງ ກະລຸນາເພີ່ມໃນບັນຊີກ່ອນ.',
      add_address:'ເພີ່ມທີ່ຢູ່ຈັດສົ່ງ', address_notice:'ເລືອກທີ່ຢູ່ທີ່ບັນທຶກໄວ້. ລະບົບຈະເກັບສຳເນົາທີ່ຢູ່ໄວ້ກັບອໍເດີ.',
      note_team:'ໝາຍເຫດເຖິງທີມງານ', note_ph:'ເຊັ່ນ ຫໍ່ເປັນຂອງຂວັນ', place_order:'ຢືນຢັນຄຳສັ່ງຊື້', back_cart:'ກັບໄປແກ້ກະຕ່າ',
      payment_due:'ຍອດຊຳລະ', order_confirmed:'ຮັບຄຳສັ່ງຊື້ແລ້ວ', order_number:'ເລກອໍເດີ', payment_code:'ລະຫັດຊຳລະ',
      promptpay_note:'ໂອນຕາມຍອດຂ້າງເທິງ ແລ້ວສົ່ງສະລິບໃຫ້ Thongthai ໃນ LINE ເພື່ອໃຫ້ທີມກວດສອບ.',
      track_order:'ເບິ່ງອໍເດີ ແລະ ຕິດຕາມພັດສະດຸ', catalog_error:'ຮ້ານຄ້າບໍ່ພ້ອມຊົ່ວຄາວ ກະລຸນາລອງໃໝ່.',
      catalog_load_error:'ໂຫຼດສິນຄ້າບໍ່ສຳເລັດ', member_load_error:'ໂຫຼດຂໍ້ມູນສະມາຊິກບໍ່ສຳເລັດ ກະລຸນາລອງໃໝ່.',
      shipping_line:'ຄ່າສົ່ງ ฿{fee} · ປະມານ {min}–{max} ມື້', shipping_free_line:'ຄ່າສົ່ງ ฿{fee} · ສົ່ງຟຣີເມື່ອຄົບ ฿{threshold} · ປະມານ {min}–{max} ມື້',
      catalog_status:'{count} ລາຍການ · ລາຄາແລະສະຕັອກອັບເດດຈາກຫຼັງບ້ານ',
      detail_fallback:'ສິນຄ້າຊຸມຊົນຈາກ{province}'
    },
    vi:{
      language:'Ngôn ngữ', login:'Đăng nhập', signup:'Đăng ký', account:'Tài khoản của tôi',
      map_skip:'Bỏ qua đến bản đồ', map_overline:'20 tỉnh vùng Isan',
      map_title:'Chọn một tỉnh để khám phá', map_intro:'Chạm vào bản đồ hoặc chọn tên tỉnh bên dưới để tìm hiểu con người, nghề thủ công, đời sống và câu chuyện riêng của từng vùng.',
      map_selected:'Tỉnh đang chọn', map_other:'Tỉnh khác', map_loading:'Đang mở bản đồ Isan…',
      map_quick_label:'Danh sách 20 tỉnh', province_story_label:'Câu chuyện của tỉnh',
      province_experience_title:'Con người, nghề thủ công và nhịp sống của {province}',
      province_experience_desc:'Khám phá {province} qua nghề thủ công, ẩm thực, đời sống cộng đồng và những câu chuyện tại chỗ trước khi chọn món đồ muốn mang về.',
      map_cta:'Xem sản phẩm từ {province}', map_concept:'Hãy mua khi bạn đã sẵn sàng—sau khi hiểu nguồn gốc, người làm và giá trị của nơi ấy.',
      map_footer:'Ăn, nghỉ, trải nghiệm và khám phá những điều hay của Isan', map_error:'Hiện chưa thể mở bản đồ. Vui lòng thử lại.',
      province_counter:'Trải nghiệm tỉnh · {order}',

      shop_province:'Tỉnh', shop_search:'Tìm sản phẩm', shop_account:'Tài khoản của tôi', shop_cart:'Giỏ hàng',
      hero_kicker:'ISAN CRAFT · THAMMACHAT OTOP', hero_title:'Biết câu chuyện trước khi nhìn giá',
      hero_lead:'Chúng tôi không chọn một món chỉ vì đẹp hay dễ bán, mà vì phía sau nó có người làm, một vùng đất, thời gian và lý do để nó tồn tại ở đây.',
      hero_shop:'Khám phá {province} ↓', hero_map:'Mở bản đồ 20 tỉnh',
      province_eyebrow:'OTOP · TỪ NHỮNG NGƯỜI LÀM THẬT', shop_title:'Khám phá sản phẩm từ {province}',
      province_intro:'Xem chi tiết, hiểu nguồn gốc và thêm vào giỏ khi bạn sẵn sàng. Mọi sản phẩm trên trang này đều đến từ {province}.',
      shipping_loading:'Đang tải thông tin vận chuyển', curated:'Tuyển chọn bởi Thammachat', curated_sub:'Những món đáng để biết đến trước',
      best_seller:'Bán chạy', best_seller_sub:'Sắp xếp theo số đơn hàng hoàn tất thực tế',
      collections:'BỘ SƯU TẬP', catalog_heading:'Sản phẩm OTOP {province}', catalog_loading:'Đang tải sản phẩm…',
      sort_featured:'Nổi bật', sort_low_high:'Giá thấp đến cao', sort_high_low:'Giá cao đến thấp',
      category_wear:'Trang phục & Dệt may', category_wear_sub:'Vải, đồ may và vật dụng đưa tay nghề địa phương vào đời sống hằng ngày.',
      category_food:'Ẩm thực & Quà tặng', category_food_sub:'Hương vị, nguyên liệu và cách bảo quản gắn với vùng đất.',
      category_home:'Nhà cửa & Chăm sóc', category_home_sub:'Đồ dùng, đồ đan và thảo mộc từ đời sống địa phương.',
      view_product:'Xem sản phẩm →', stock_left:'Còn {count} món', items_count:'{count} sản phẩm',
      no_products:'Tỉnh này hiện chưa có sản phẩm sẵn sàng bán.', no_search:'Không tìm thấy sản phẩm phù hợp.',
      back_map:'Quay lại bản đồ tỉnh', no_category:'Chưa có sản phẩm trong danh mục này.',
      product_story:'Câu chuyện của món đồ', value_piece:'GIÁ TRỊ CỦA MÓN ĐỒ', origin:'Nguồn gốc', maker:'Người làm',
      material:'Vật liệu / nguyên liệu', process:'Cách làm', why_here:'Vì sao phải là nơi này',
      product_code:'Mã sản phẩm', stock_updated:'Giá và tồn kho cập nhật từ hệ thống quản trị',
      add_cart:'Thêm vào giỏ', close:'Đóng', cart_title:'Giỏ hàng', cart_empty:'Giỏ hàng đang trống.',
      subtotal:'Tiền hàng', shipping:'Phí vận chuyển', free:'Miễn phí', total:'Tổng cộng', continue:'Tiếp tục',
      step_cart:'Giỏ hàng', step_address:'Địa chỉ giao hàng', step_confirm:'Xác nhận',
      choose_address:'Chọn địa chỉ giao hàng', no_address:'Bạn chưa có địa chỉ giao hàng. Hãy thêm địa chỉ trong Tài khoản của tôi trước.',
      add_address:'Thêm địa chỉ giao hàng', address_notice:'Chọn địa chỉ đã lưu. Hệ thống sẽ lưu bản chụp địa chỉ cùng đơn hàng để thông tin giao hàng không thay đổi.',
      note_team:'Ghi chú cho đội ngũ', note_ph:'Ví dụ: gói làm quà', place_order:'Xác nhận đơn hàng', back_cart:'Quay lại giỏ',
      payment_due:'Số tiền cần thanh toán', order_confirmed:'Đã nhận đơn hàng', order_number:'Mã đơn hàng', payment_code:'Mã thanh toán',
      promptpay_note:'Thanh toán số tiền ở trên rồi gửi ảnh biên nhận cho Thongthai trên LINE để đội ngũ kiểm tra. Sau khi xác nhận, đơn sẽ chuyển sang khâu chuẩn bị hàng.',
      track_order:'Xem đơn & theo dõi kiện hàng', catalog_error:'Cửa hàng tạm thời không khả dụng. Vui lòng thử lại.',
      catalog_load_error:'Không tải được sản phẩm', member_load_error:'Không tải được thông tin thành viên. Vui lòng thử lại.',
      shipping_line:'Phí vận chuyển ฿{fee} · khoảng {min}–{max} ngày', shipping_free_line:'Phí vận chuyển ฿{fee} · miễn phí từ ฿{threshold} · khoảng {min}–{max} ngày',
      catalog_status:'{count} sản phẩm · giá và tồn kho cập nhật từ hệ thống quản trị',
      detail_fallback:'Sản phẩm cộng đồng từ {province}'
    }
  };

  let current = 'th';

  function interpolate(value, vars={}) {
    return String(value ?? '').replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
  }
  function t(key, vars={}) {
    const dict = COPY[current] || COPY.th;
    const raw = dict[key] ?? COPY.th[key] ?? key;
    return interpolate(raw, vars);
  }
  function provinceName(id, lang=current) {
    return PROVINCES[id]?.[lang] || PROVINCES[id]?.th || id;
  }
  function locale() { return LOCALES[current] || LOCALES.th; }
  function readSaved() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (SUPPORTED.includes(saved)) return saved;
    } catch {}
    const nav = (navigator.language || 'th').toLowerCase();
    if (nav.startsWith('en')) return 'en';
    if (nav.startsWith('zh')) return 'zh';
    if (nav.startsWith('lo')) return 'lo';
    if (nav.startsWith('vi')) return 'vi';
    return 'th';
  }
  function applyStatic() {
    document.documentElement.lang = current;
    document.querySelectorAll('[data-otop-i18n]').forEach(el => {
      el.textContent = t(el.getAttribute('data-otop-i18n'));
    });
    document.querySelectorAll('[data-otop-i18n-placeholder]').forEach(el => {
      el.setAttribute('placeholder', t(el.getAttribute('data-otop-i18n-placeholder')));
    });
    document.querySelectorAll('[data-otop-i18n-aria]').forEach(el => {
      el.setAttribute('aria-label', t(el.getAttribute('data-otop-i18n-aria')));
    });
    document.querySelectorAll('[data-otop-lang-select]').forEach(el => { el.value = current; });
  }
  function setLang(lang, persist=true) {
    if (!SUPPORTED.includes(lang)) return;
    current = lang;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
    }
    applyStatic();
    window.dispatchEvent(new CustomEvent('otop:i18n-change', { detail:{ lang } }));
  }
  function init() {
    current = readSaved();
    applyStatic();
    document.querySelectorAll('[data-otop-lang-select]').forEach(select => {
      select.addEventListener('change', () => setLang(select.value));
    });
    window.dispatchEvent(new CustomEvent('otop:i18n-ready', { detail:{ lang:current } }));
  }

  window.OTOP_I18N = {
    t, setLang, init, lang:() => current, locale, provinceName,
    supported:[...SUPPORTED], provinces:PROVINCES
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
