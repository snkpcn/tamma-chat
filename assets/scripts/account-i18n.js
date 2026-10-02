(() => {
  'use strict';
  const STORAGE_KEY='thammachat-lang-v1';
  const SUPPORTED=['th','en','zh','lo','vi'];
  const LOCALES={th:'th-TH',en:'en-US',zh:'zh-CN',lo:'lo-LA',vi:'vi-VN'};
  const D={
    th:{
      page_title:'บัญชีของฉัน · ทำมา-ชาติ',back_web:'กลับหน้าเว็บ',member_eyebrow:'สมาชิกทำมา-ชาติ',account_title:'บัญชีของฉัน',
      hero_desc:'ดูข้อมูลสมาชิก แผนเที่ยว คำสั่งซื้อ และเรื่องที่ทีมทำมา-ชาติต้องติดตามได้ในหน้าเดียว โดยเชื่อมกับรหัสสมาชิกเดิม',
      rewards_title:'รางวัลของฉัน',items_count:'{count} รายการ',rewards_desc:'รางวัลจากการเล่นหมากรุกกับทองไทย — ใช้ได้จริงในทำมา-ชาติ แสดงหน้าจอนี้ให้พนักงานเพื่อใช้สิทธิ์',play_chess:'เล่นหมากรุกกับทองไทย',
      login:'เข้าสู่ระบบ',signup:'สมัครบัญชี',email:'อีเมล',password:'รหัสผ่าน',password_ph:'อย่างน้อย 8 ตัวอักษร',
      auth_privacy:'ระบบบัญชีใช้ Supabase Auth โดยตรง รหัสผ่านไม่ถูกส่งเข้า Thongthai Brain และไม่ถูกเก็บในฐานข้อมูลลูกค้าของทำมา-ชาติ',
      your_account:'บัญชีของคุณ',logout:'ออกจากระบบ',contact_info:'ข้อมูลติดต่อ',encrypted:'เข้ารหัสในระบบ',
      contact_name:'ชื่อที่ให้ทีมงานติดต่อ',full_name_ph:'ชื่อ-นามสกุล',phone:'เบอร์โทร',preferred_contact:'ช่องทางที่สะดวก',
      phone_option:'โทรศัพท์',email_option:'อีเมล',account_email:'อีเมลบัญชี',birth_date:'วันเกิด',gender:'เพศ',
      gender_unspecified:'ยังไม่ระบุ',gender_male:'ชาย',gender_female:'หญิง',gender_non_binary:'นอนไบนารี',gender_self:'ระบุเอง',gender_private:'ไม่ประสงค์ระบุ',gender_desc:'คำที่ใช้ระบุเพศ',
      marketing_optin:'รับข่าวสาร/ข้อเสนอจากทำมา-ชาติ (ไม่จำเป็น)',research_optin:'ยินยอมให้นำข้อมูลแบบไม่ระบุตัวตนไปใช้พัฒนาบริการ/งานวิจัย (ไม่จำเป็นและแยกจากการตลาด)',
      save_profile:'บันทึกข้อมูล',refresh:'รีเฟรชรายการ',address_book:'สมุดที่อยู่จัดส่ง',add_address:'+ เพิ่มที่อยู่',
      address_intro:'บันทึกได้หลายที่อยู่ แต่ละที่อยู่กำหนดชื่อผู้รับและเบอร์โทรแยกกันได้',address_label:'ชื่อเรียกที่อยู่',address_label_ph:'บ้าน / ที่ทำงาน',
      recipient_name:'ชื่อผู้รับ',recipient_name_ph:'ชื่อ-นามสกุลผู้รับ',recipient_phone:'เบอร์โทรผู้รับ',address_line1:'บ้านเลขที่ อาคาร ถนน ซอย',address_line1_ph:'บ้านเลขที่ หมู่ ถนน ซอย',
      address_line2:'รายละเอียดเพิ่มเติม',address_line2_ph:'อาคาร ชั้น ห้อง (ถ้ามี)',subdistrict:'ตำบล / แขวง',district:'อำเภอ / เขต',province:'จังหวัด',postal_code:'รหัสไปรษณีย์',
      delivery_instructions:'หมายเหตุถึงขนส่ง',delivery_ph:'เช่น โทรก่อนถึง ฝาก รปภ.',default_address:'ตั้งเป็นที่อยู่หลัก',save_address:'บันทึกที่อยู่',cancel:'ยกเลิก',
      bookings:'การจอง',orders:'คำสั่งซื้อ OTOP',inquiries:'เรื่องที่สอบถามร้านกาแฟ',
      privacy:'ข้อมูลชื่อ เบอร์โทร อีเมล และที่อยู่สำหรับการจัดส่งถูกเก็บแยกจากความจำเชิงสนทนาของทองไทย และเข้ารหัสฝั่งเซิร์ฟเวอร์ ใช้เพื่อให้บริการ การจอง คำสั่งซื้อ และการติดต่อกลับเท่านั้น',
      status_requested:'รอตรวจสอบ',status_confirmed:'ยืนยันแล้ว',status_cancelled:'ยกเลิก',status_completed:'เสร็จแล้ว',status_no_show:'ไม่มา',status_preparing:'กำลังเตรียม',status_ready:'พร้อมรับ',status_shipped:'จัดส่งแล้ว',status_open:'รอตอบ',status_replied:'ตอบแล้ว',status_closed:'ปิดเรื่อง',
      shipping_awaiting_payment:'รอตรวจสอบการชำระเงิน',shipping_packing:'กำลังเตรียมสินค้า',shipping_ready_to_ship:'พร้อมส่ง',shipping_shipped:'ส่งแล้ว',shipping_delivered:'จัดส่งสำเร็จ',shipping_delivery_failed:'นำจ่ายไม่สำเร็จ',shipping_returned:'พัสดุตีกลับ',shipping_cancelled:'ยกเลิกการจัดส่ง',
      payment_quote_required:'รอกำหนดยอด',payment_awaiting_payment:'รอชำระเงิน',payment_proof_submitted:'ส่งหลักฐานแล้ว',payment_verified:'ชำระแล้ว',payment_rejected:'หลักฐานไม่ผ่าน',payment_cancelled:'ยกเลิก',
      no_bookings:'ยังไม่มีรายการจอง',service_restaurant:'ร้านอาหาร',service_stay:'ที่พัก',service_activity:'กิจกรรม',party_count:'จำนวน {count} คน',quantity_units:'{count} หน่วย',
      no_orders:'ยังไม่มีคำสั่งซื้อ',carrier:'ขนส่ง',track_parcel:'ติดตามพัสดุ ↗',product:'สินค้า',subtotal:'ค่าสินค้า',shipping_fee:'ค่าจัดส่ง',payment:'การชำระเงิน',ship_to:'จัดส่ง',
      no_inquiries:'ยังไม่มีเรื่องที่ส่งให้ร้านกาแฟ',team:'ทีมงาน',account_load_failed:'โหลดบัญชีไม่สำเร็จ',auth_invalid:'กรอกอีเมลและรหัสผ่านอย่างน้อย 8 ตัวอักษร',
      auth_failed:'ไม่สำเร็จ',signup_confirm:'สมัครเรียบร้อยแล้ว กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ (ถ้าระบบขอการยืนยัน)',generic_error:'เกิดข้อผิดพลาด',
      profile_save_failed:'บันทึกไม่สำเร็จ',profile_saved:'บันทึกข้อมูลแล้ว',no_addresses:'ยังไม่มีที่อยู่จัดส่ง',address_default_badge:'ที่อยู่หลัก',
      addr_subdistrict_prefix:'ต./แขวง',addr_district_prefix:'อ./เขต',addr_province_prefix:'จ.',note_prefix:'หมายเหตุ',edit:'แก้ไข',delete:'ลบ',
      address_load_failed:'โหลดที่อยู่ไม่สำเร็จ',invalid_phone:'กรุณาตรวจสอบเบอร์โทร',invalid_postal_code:'รหัสไปรษณีย์ต้องมี 5 หลัก',recipient_name_required:'กรุณากรอกชื่อผู้รับ',
      address_line_required:'กรุณากรอกบ้านเลขที่และที่อยู่',district_required:'กรุณากรอกอำเภอ/เขต',province_required:'กรุณากรอกจังหวัด',address_save_failed:'บันทึกที่อยู่ไม่สำเร็จ',
      address_saved:'บันทึกที่อยู่แล้ว',delete_confirm:'ลบที่อยู่นี้ออกจากสมุดที่อยู่ใช่ไหม',delete_failed:'ลบที่อยู่ไม่สำเร็จ',address_deleted:'ลบที่อยู่แล้ว',refresh_failed:'รีเฟรชไม่สำเร็จ',
      member_complete:'MEMBER · PROFILE COMPLETE',member_incomplete:'MEMBER · PROFILE INCOMPLETE',customer_account:'CUSTOMER ACCOUNT',
      reward_available:'พร้อมใช้งาน',reward_partial:'ใช้ไปบางส่วน',reward_used:'ใช้สิทธิ์แล้ว',reward_expired:'หมดอายุแล้ว',reward_expiry:'ใช้ได้ถึงวันนี้ 23:59 น. ({date})',reward_expiry_simple:'ใช้ได้ถึงวันนี้ 23:59 น.',
      reward_scope_all:'ใช้ได้ทุกโซน',reward_scope_one:'ใช้ได้ 1 โซน',redeem_now:'ใช้สิทธิ์ตอนนี้',redeemed:'ใช้สิทธิ์แล้ว',no_rewards:'ยังไม่มีรางวัลจากการเล่นหมากรุกกับทองไทย',rewards_load_failed:'โหลดรางวัลไม่สำเร็จ',
      redeem_confirm_title:'ยืนยันการใช้สิทธิ์',redeem_confirm_body:'แสดงหน้าจอนี้ให้พนักงาน แล้วกดยืนยันเพื่อใช้สิทธิ์ส่วนลดนี้ที่โซนนี้ การใช้สิทธิ์นี้จะไม่สามารถย้อนกลับได้',confirm:'ยืนยัน'
    },
    en:{
      page_title:'My Account · Thammachat',back_web:'Back to website',member_eyebrow:'Thammachat Member',account_title:'My Account',
      hero_desc:'View your member details, journeys, orders, bookings and team follow-ups in one place, connected to your existing member identity.',
      rewards_title:'My Rewards',items_count:'{count} items',rewards_desc:'Rewards earned by challenging Thongthai at chess. Show this screen to staff when you are ready to redeem.',play_chess:'Play chess with Thongthai',
      login:'Sign in',signup:'Create account',email:'Email',password:'Password',password_ph:'At least 8 characters',
      auth_privacy:'Your account uses Supabase Auth directly. Passwords are never sent to Thongthai Brain or stored in Thammachat customer data.',
      your_account:'Your account',logout:'Sign out',contact_info:'Contact details',encrypted:'Encrypted',
      contact_name:'Contact name',full_name_ph:'Full name',phone:'Phone',preferred_contact:'Preferred contact',
      phone_option:'Phone',email_option:'Email',account_email:'Account email',birth_date:'Date of birth',gender:'Gender',
      gender_unspecified:'Not specified',gender_male:'Male',gender_female:'Female',gender_non_binary:'Non-binary',gender_self:'Self-described',gender_private:'Prefer not to say',gender_desc:'How you describe your gender',
      marketing_optin:'Receive Thammachat news and offers (optional)',research_optin:'Allow anonymized data to improve services/research (optional and separate from marketing)',
      save_profile:'Save details',refresh:'Refresh',address_book:'Shipping addresses',add_address:'+ Add address',
      address_intro:'Save multiple shipping addresses, each with its own recipient name and phone number.',address_label:'Address label',address_label_ph:'Home / Work',
      recipient_name:'Recipient name',recipient_name_ph:'Recipient full name',recipient_phone:'Recipient phone',address_line1:'Street address',address_line1_ph:'House number, building, street',
      address_line2:'Additional details',address_line2_ph:'Building, floor, room (optional)',subdistrict:'Subdistrict / Locality',district:'District / City',province:'Province / State',postal_code:'Postal code',
      delivery_instructions:'Delivery instructions',delivery_ph:'e.g. Call before arrival',default_address:'Set as default address',save_address:'Save address',cancel:'Cancel',
      bookings:'Bookings',orders:'OTOP Orders',inquiries:'Cafe inquiries',
      privacy:'Names, phone numbers, email and shipping addresses are kept separate from Thongthai conversational memory and encrypted server-side. They are used only for service, bookings, orders and follow-up contact.',
      status_requested:'Pending review',status_confirmed:'Confirmed',status_cancelled:'Cancelled',status_completed:'Completed',status_no_show:'No-show',status_preparing:'Preparing',status_ready:'Ready',status_shipped:'Shipped',status_open:'Awaiting reply',status_replied:'Replied',status_closed:'Closed',
      shipping_awaiting_payment:'Awaiting payment review',shipping_packing:'Packing',shipping_ready_to_ship:'Ready to ship',shipping_shipped:'Shipped',shipping_delivered:'Delivered',shipping_delivery_failed:'Delivery failed',shipping_returned:'Returned',shipping_cancelled:'Shipping cancelled',
      payment_quote_required:'Awaiting amount',payment_awaiting_payment:'Awaiting payment',payment_proof_submitted:'Proof submitted',payment_verified:'Paid',payment_rejected:'Proof rejected',payment_cancelled:'Cancelled',
      no_bookings:'No bookings yet',service_restaurant:'Restaurant',service_stay:'Stay',service_activity:'Activity',party_count:'{count} guests',quantity_units:'{count} units',
      no_orders:'No orders yet',carrier:'Carrier',track_parcel:'Track parcel ↗',product:'Product',subtotal:'Subtotal',shipping_fee:'Shipping',payment:'Payment',ship_to:'Ship to',
      no_inquiries:'No cafe inquiries yet',team:'Team',account_load_failed:'Could not load account',auth_invalid:'Enter an email and a password of at least 8 characters',
      auth_failed:'Could not complete request',signup_confirm:'Account created. Please confirm your email before signing in if confirmation is required.',generic_error:'Something went wrong',
      profile_save_failed:'Could not save',profile_saved:'Details saved',no_addresses:'No shipping addresses yet',address_default_badge:'Default',
      addr_subdistrict_prefix:'Locality',addr_district_prefix:'District',addr_province_prefix:'Province',note_prefix:'Note',edit:'Edit',delete:'Delete',
      address_load_failed:'Could not load addresses',invalid_phone:'Check the phone number',invalid_postal_code:'Check the postal code',recipient_name_required:'Enter the recipient name',
      address_line_required:'Enter the street address',district_required:'Enter the district or city',province_required:'Enter the province or state',address_save_failed:'Could not save address',
      address_saved:'Address saved',delete_confirm:'Remove this address from your address book?',delete_failed:'Could not delete address',address_deleted:'Address deleted',refresh_failed:'Could not refresh',
      member_complete:'MEMBER · PROFILE COMPLETE',member_incomplete:'MEMBER · PROFILE INCOMPLETE',customer_account:'CUSTOMER ACCOUNT',
      reward_available:'Available',reward_partial:'Partially used',reward_used:'Redeemed',reward_expired:'Expired',reward_expiry:'Valid until 23:59 today ({date})',reward_expiry_simple:'Valid until 23:59 today',
      reward_scope_all:'Valid in all zones',reward_scope_one:'Valid in 1 zone',redeem_now:'Redeem now',redeemed:'Redeemed',no_rewards:'No chess rewards yet',rewards_load_failed:'Could not load rewards',
      redeem_confirm_title:'Confirm redemption',redeem_confirm_body:'Show this screen to staff, then confirm to redeem the discount in this zone. Redemption cannot be reversed.',confirm:'Confirm'
    },
    zh:{
      page_title:'我的账户 · Thammachat',back_web:'返回网站',member_eyebrow:'Thammachat 会员',account_title:'我的账户',
      hero_desc:'在一个页面查看会员资料、行程、订单、预订和团队跟进事项，并与现有会员身份连接。',
      rewards_title:'我的奖励',items_count:'{count} 项',rewards_desc:'与 Thongthai 下棋获得的奖励。准备使用时请向工作人员出示此页面。',play_chess:'与 Thongthai 下棋',
      login:'登录',signup:'创建账户',email:'电子邮箱',password:'密码',password_ph:'至少 8 个字符',
      auth_privacy:'账户直接使用 Supabase Auth。密码不会发送到 Thongthai Brain，也不会存入 Thammachat 客户资料。',
      your_account:'你的账户',logout:'退出登录',contact_info:'联系方式',encrypted:'已加密',
      contact_name:'联系姓名',full_name_ph:'姓名',phone:'电话',preferred_contact:'首选联系方式',
      phone_option:'电话',email_option:'电子邮箱',account_email:'账户邮箱',birth_date:'出生日期',gender:'性别',
      gender_unspecified:'未指定',gender_male:'男',gender_female:'女',gender_non_binary:'非二元',gender_self:'自行描述',gender_private:'不愿透露',gender_desc:'性别描述',
      marketing_optin:'接收 Thammachat 新闻与优惠（可选）',research_optin:'允许匿名数据用于改进服务/研究（可选，与营销分开）',
      save_profile:'保存资料',refresh:'刷新',address_book:'配送地址',add_address:'+ 添加地址',
      address_intro:'可保存多个配送地址，每个地址可分别设置收件人姓名和电话。',address_label:'地址名称',address_label_ph:'家 / 公司',
      recipient_name:'收件人姓名',recipient_name_ph:'收件人姓名',recipient_phone:'收件人电话',address_line1:'街道地址',address_line1_ph:'门牌、楼宇、街道',
      address_line2:'补充信息',address_line2_ph:'楼宇、楼层、房间（可选）',subdistrict:'地区 / 街道',district:'区 / 城市',province:'府 / 省 / 州',postal_code:'邮政编码',
      delivery_instructions:'配送备注',delivery_ph:'例如：到达前致电',default_address:'设为默认地址',save_address:'保存地址',cancel:'取消',
      bookings:'预订',orders:'OTOP 订单',inquiries:'咖啡馆咨询',
      privacy:'姓名、电话、邮箱和配送地址与 Thongthai 的对话记忆分开保存，并在服务器端加密，仅用于服务、预订、订单和联系。',
      status_requested:'待审核',status_confirmed:'已确认',status_cancelled:'已取消',status_completed:'已完成',status_no_show:'未到店',status_preparing:'准备中',status_ready:'可领取',status_shipped:'已发货',status_open:'待回复',status_replied:'已回复',status_closed:'已关闭',
      shipping_awaiting_payment:'待核对付款',shipping_packing:'打包中',shipping_ready_to_ship:'待发货',shipping_shipped:'已发货',shipping_delivered:'已送达',shipping_delivery_failed:'配送失败',shipping_returned:'已退回',shipping_cancelled:'配送已取消',
      payment_quote_required:'待确定金额',payment_awaiting_payment:'待付款',payment_proof_submitted:'已提交凭证',payment_verified:'已付款',payment_rejected:'凭证未通过',payment_cancelled:'已取消',
      no_bookings:'暂无预订',service_restaurant:'餐厅',service_stay:'住宿',service_activity:'活动',party_count:'{count} 位客人',quantity_units:'{count} 个',
      no_orders:'暂无订单',carrier:'承运商',track_parcel:'追踪包裹 ↗',product:'商品',subtotal:'商品金额',shipping_fee:'运费',payment:'付款',ship_to:'配送至',
      no_inquiries:'暂无咖啡馆咨询',team:'团队',account_load_failed:'无法加载账户',auth_invalid:'请输入邮箱和至少 8 个字符的密码',
      auth_failed:'请求未完成',signup_confirm:'账户已创建。如系统要求，请先确认邮箱再登录。',generic_error:'发生错误',
      profile_save_failed:'保存失败',profile_saved:'资料已保存',no_addresses:'暂无配送地址',address_default_badge:'默认地址',
      addr_subdistrict_prefix:'地区',addr_district_prefix:'区/城市',addr_province_prefix:'府/省',note_prefix:'备注',edit:'编辑',delete:'删除',
      address_load_failed:'无法加载地址',invalid_phone:'请检查电话号码',invalid_postal_code:'请检查邮政编码',recipient_name_required:'请输入收件人姓名',
      address_line_required:'请输入街道地址',district_required:'请输入区或城市',province_required:'请输入府、省或州',address_save_failed:'地址保存失败',
      address_saved:'地址已保存',delete_confirm:'确定从地址簿删除此地址吗？',delete_failed:'删除地址失败',address_deleted:'地址已删除',refresh_failed:'刷新失败',
      member_complete:'会员 · 资料完整',member_incomplete:'会员 · 资料未完整',customer_account:'客户账户',
      reward_available:'可使用',reward_partial:'已部分使用',reward_used:'已使用',reward_expired:'已过期',reward_expiry:'今天 23:59 前有效（{date}）',reward_expiry_simple:'今天 23:59 前有效',
      reward_scope_all:'所有区域可用',reward_scope_one:'1 个区域可用',redeem_now:'立即使用',redeemed:'已使用',no_rewards:'暂无棋局奖励',rewards_load_failed:'无法加载奖励',
      redeem_confirm_title:'确认使用奖励',redeem_confirm_body:'向工作人员出示此页面，然后确认在该区域使用折扣。使用后无法撤销。',confirm:'确认'
    },
    lo:{
      page_title:'ບັນຊີຂອງຂ້ອຍ · Thammachat',back_web:'ກັບໄປເວັບໄຊ',member_eyebrow:'ສະມາຊິກ Thammachat',account_title:'ບັນຊີຂອງຂ້ອຍ',
      hero_desc:'ເບິ່ງຂໍ້ມູນສະມາຊິກ ແຜນທ່ອງທ່ຽວ ຄຳສັ່ງຊື້ ການຈອງ ແລະ ເລື່ອງທີ່ທີມຕ້ອງຕິດຕາມໃນໜ້າດຽວ.',
      rewards_title:'ລາງວັນຂອງຂ້ອຍ',items_count:'{count} ລາຍການ',rewards_desc:'ລາງວັນຈາກການຫຼິ້ນໝາກຮຸກກັບ Thongthai. ສະແດງໜ້ານີ້ໃຫ້ພະນັກງານເມື່ອຈະໃຊ້ສິດ.',play_chess:'ຫຼິ້ນໝາກຮຸກກັບ Thongthai',
      login:'ເຂົ້າລະບົບ',signup:'ສ້າງບັນຊີ',email:'ອີເມວ',password:'ລະຫັດຜ່ານ',password_ph:'ຢ່າງໜ້ອຍ 8 ຕົວອັກສອນ',
      auth_privacy:'ບັນຊີໃຊ້ Supabase Auth ໂດຍກົງ. ລະຫັດຜ່ານບໍ່ຖືກສົ່ງໃຫ້ Thongthai Brain ແລະ ບໍ່ຖືກເກັບໃນຂໍ້ມູນລູກຄ້າ Thammachat.',
      your_account:'ບັນຊີຂອງທ່ານ',logout:'ອອກຈາກລະບົບ',contact_info:'ຂໍ້ມູນຕິດຕໍ່',encrypted:'ເຂົ້າລະຫັດ',
      contact_name:'ຊື່ສຳລັບຕິດຕໍ່',full_name_ph:'ຊື່-ນາມສະກຸນ',phone:'ເບີໂທ',preferred_contact:'ຊ່ອງທາງທີ່ສະດວກ',
      phone_option:'ໂທລະສັບ',email_option:'ອີເມວ',account_email:'ອີເມວບັນຊີ',birth_date:'ວັນເກີດ',gender:'ເພດ',
      gender_unspecified:'ຍັງບໍ່ລະບຸ',gender_male:'ຊາຍ',gender_female:'ຍິງ',gender_non_binary:'ບໍ່ແບ່ງສອງເພດ',gender_self:'ລະບຸເອງ',gender_private:'ບໍ່ປະສົງລະບຸ',gender_desc:'ຄຳທີ່ໃຊ້ລະບຸເພດ',
      marketing_optin:'ຮັບຂ່າວ ແລະ ຂໍ້ສະເໜີຈາກ Thammachat (ບໍ່ບັງຄັບ)',research_optin:'ຍິນຍອມໃຫ້ໃຊ້ຂໍ້ມູນບໍ່ລະບຸຕົວຕົນເພື່ອພັດທະນາບໍລິການ/ວິຈັຍ (ບໍ່ບັງຄັບ)',
      save_profile:'ບັນທຶກຂໍ້ມູນ',refresh:'ໂຫຼດໃໝ່',address_book:'ທີ່ຢູ່ຈັດສົ່ງ',add_address:'+ ເພີ່ມທີ່ຢູ່',
      address_intro:'ບັນທຶກໄດ້ຫຼາຍທີ່ຢູ່ ແຕ່ລະທີ່ຢູ່ກຳນົດຊື່ຜູ້ຮັບ ແລະ ເບີໂທແຍກໄດ້.',address_label:'ຊື່ທີ່ຢູ່',address_label_ph:'ເຮືອນ / ບ່ອນເຮັດວຽກ',
      recipient_name:'ຊື່ຜູ້ຮັບ',recipient_name_ph:'ຊື່-ນາມສະກຸນຜູ້ຮັບ',recipient_phone:'ເບີໂທຜູ້ຮັບ',address_line1:'ທີ່ຢູ່',address_line1_ph:'ເລກບ້ານ ອາຄານ ຖະໜົນ',
      address_line2:'ລາຍລະອຽດເພີ່ມ',address_line2_ph:'ອາຄານ ຊັ້ນ ຫ້ອງ (ຖ້າມີ)',subdistrict:'ຕຳບົນ / ເຂດ',district:'ເມືອງ / ເຂດ',province:'ແຂວງ / ຈັງຫວັດ',postal_code:'ລະຫັດໄປສະນີ',
      delivery_instructions:'ໝາຍເຫດການສົ່ງ',delivery_ph:'ເຊັ່ນ ໂທກ່ອນມາຮອດ',default_address:'ຕັ້ງເປັນທີ່ຢູ່ຫຼັກ',save_address:'ບັນທຶກທີ່ຢູ່',cancel:'ຍົກເລີກ',
      bookings:'ການຈອງ',orders:'ຄຳສັ່ງຊື້ OTOP',inquiries:'ຄຳຖາມຮ້ານກາເຟ',
      privacy:'ຊື່ ເບີໂທ ອີເມວ ແລະ ທີ່ຢູ່ສົ່ງຖືກແຍກຈາກຄວາມຈຳການສົນທະນາຂອງ Thongthai ແລະ ເຂົ້າລະຫັດຝັ່ງເຊີເວີ.',
      status_requested:'ລໍຖ້າກວດ',status_confirmed:'ຢືນຢັນແລ້ວ',status_cancelled:'ຍົກເລີກ',status_completed:'ສຳເລັດ',status_no_show:'ບໍ່ມາ',status_preparing:'ກຳລັງກຽມ',status_ready:'ພ້ອມຮັບ',status_shipped:'ສົ່ງແລ້ວ',status_open:'ລໍຖ້າຕອບ',status_replied:'ຕອບແລ້ວ',status_closed:'ປິດເລື່ອງ',
      shipping_awaiting_payment:'ລໍຖ້າກວດເງິນ',shipping_packing:'ກຳລັງຈັດຂອງ',shipping_ready_to_ship:'ພ້ອມສົ່ງ',shipping_shipped:'ສົ່ງແລ້ວ',shipping_delivered:'ຈັດສົ່ງສຳເລັດ',shipping_delivery_failed:'ສົ່ງບໍ່ສຳເລັດ',shipping_returned:'ສົ່ງກັບ',shipping_cancelled:'ຍົກເລີກການສົ່ງ',
      payment_quote_required:'ລໍຖ້າກຳນົດຍອດ',payment_awaiting_payment:'ລໍຖ້າຊຳລະ',payment_proof_submitted:'ສົ່ງຫຼັກຖານແລ້ວ',payment_verified:'ຊຳລະແລ້ວ',payment_rejected:'ຫຼັກຖານບໍ່ຜ່ານ',payment_cancelled:'ຍົກເລີກ',
      no_bookings:'ຍັງບໍ່ມີການຈອງ',service_restaurant:'ຮ້ານອາຫານ',service_stay:'ທີ່ພັກ',service_activity:'ກິດຈະກຳ',party_count:'{count} ຄົນ',quantity_units:'{count} ໜ່ວຍ',
      no_orders:'ຍັງບໍ່ມີຄຳສັ່ງຊື້',carrier:'ຂົນສົ່ງ',track_parcel:'ຕິດຕາມພັດສະດຸ ↗',product:'ສິນຄ້າ',subtotal:'ຄ່າສິນຄ້າ',shipping_fee:'ຄ່າຈັດສົ່ງ',payment:'ການຊຳລະ',ship_to:'ຈັດສົ່ງ',
      no_inquiries:'ຍັງບໍ່ມີຄຳຖາມຮ້ານກາເຟ',team:'ທີມງານ',account_load_failed:'ໂຫຼດບັນຊີບໍ່ສຳເລັດ',auth_invalid:'ກະລຸນາກອກອີເມວແລະລະຫັດຜ່ານຢ່າງໜ້ອຍ 8 ຕົວ',
      auth_failed:'ດຳເນີນການບໍ່ສຳເລັດ',signup_confirm:'ສ້າງບັນຊີແລ້ວ ກະລຸນາຢືນຢັນອີເມວກ່ອນເຂົ້າລະບົບຖ້າລະບົບຮ້ອງຂໍ.',generic_error:'ເກີດຂໍ້ຜິດພາດ',
      profile_save_failed:'ບັນທຶກບໍ່ສຳເລັດ',profile_saved:'ບັນທຶກແລ້ວ',no_addresses:'ຍັງບໍ່ມີທີ່ຢູ່ສົ່ງ',address_default_badge:'ທີ່ຢູ່ຫຼັກ',
      addr_subdistrict_prefix:'ຕຳບົນ',addr_district_prefix:'ເມືອງ',addr_province_prefix:'ແຂວງ',note_prefix:'ໝາຍເຫດ',edit:'ແກ້ໄຂ',delete:'ລຶບ',
      address_load_failed:'ໂຫຼດທີ່ຢູ່ບໍ່ສຳເລັດ',invalid_phone:'ກວດເບີໂທ',invalid_postal_code:'ກວດລະຫັດໄປສະນີ',recipient_name_required:'ກອກຊື່ຜູ້ຮັບ',
      address_line_required:'ກອກທີ່ຢູ່',district_required:'ກອກເມືອງ/ເຂດ',province_required:'ກອກແຂວງ/ຈັງຫວັດ',address_save_failed:'ບັນທຶກທີ່ຢູ່ບໍ່ສຳເລັດ',
      address_saved:'ບັນທຶກທີ່ຢູ່ແລ້ວ',delete_confirm:'ລຶບທີ່ຢູ່ນີ້ອອກບໍ?',delete_failed:'ລຶບບໍ່ສຳເລັດ',address_deleted:'ລຶບທີ່ຢູ່ແລ້ວ',refresh_failed:'ໂຫຼດໃໝ່ບໍ່ສຳເລັດ',
      member_complete:'ສະມາຊິກ · ໂປຣໄຟລ໌ຄົບ',member_incomplete:'ສະມາຊິກ · ໂປຣໄຟລ໌ບໍ່ຄົບ',customer_account:'ບັນຊີລູກຄ້າ',
      reward_available:'ພ້ອມໃຊ້',reward_partial:'ໃຊ້ບາງສ່ວນແລ້ວ',reward_used:'ໃຊ້ແລ້ວ',reward_expired:'ໝົດອາຍຸ',reward_expiry:'ໃຊ້ໄດ້ຮອດ 23:59 ມື້ນີ້ ({date})',reward_expiry_simple:'ໃຊ້ໄດ້ຮອດ 23:59 ມື້ນີ້',
      reward_scope_all:'ໃຊ້ໄດ້ທຸກໂຊນ',reward_scope_one:'ໃຊ້ໄດ້ 1 ໂຊນ',redeem_now:'ໃຊ້ສິດຕອນນີ້',redeemed:'ໃຊ້ແລ້ວ',no_rewards:'ຍັງບໍ່ມີລາງວັນໝາກຮຸກ',rewards_load_failed:'ໂຫຼດລາງວັນບໍ່ສຳເລັດ',
      redeem_confirm_title:'ຢືນຢັນການໃຊ້ສິດ',redeem_confirm_body:'ສະແດງໜ້ານີ້ໃຫ້ພະນັກງານ ແລ້ວຢືນຢັນເພື່ອໃຊ້ສ່ວນຫຼຸດໃນໂຊນນີ້. ການໃຊ້ສິດບໍ່ສາມາດຍ້ອນກັບໄດ້.',confirm:'ຢືນຢັນ'
    },
    vi:{
      page_title:'Tài khoản của tôi · Thammachat',back_web:'Về trang web',member_eyebrow:'Thành viên Thammachat',account_title:'Tài khoản của tôi',
      hero_desc:'Xem thông tin thành viên, hành trình, đơn hàng, đặt chỗ và các việc đội ngũ cần theo dõi trong một trang.',
      rewards_title:'Phần thưởng của tôi',items_count:'{count} mục',rewards_desc:'Phần thưởng khi chơi cờ với Thongthai. Hãy đưa màn hình này cho nhân viên khi bạn muốn sử dụng.',play_chess:'Chơi cờ với Thongthai',
      login:'Đăng nhập',signup:'Tạo tài khoản',email:'Email',password:'Mật khẩu',password_ph:'Ít nhất 8 ký tự',
      auth_privacy:'Tài khoản dùng Supabase Auth trực tiếp. Mật khẩu không được gửi đến Thongthai Brain và không được lưu trong dữ liệu khách hàng Thammachat.',
      your_account:'Tài khoản của bạn',logout:'Đăng xuất',contact_info:'Thông tin liên hệ',encrypted:'Đã mã hóa',
      contact_name:'Tên liên hệ',full_name_ph:'Họ và tên',phone:'Số điện thoại',preferred_contact:'Kênh liên hệ ưu tiên',
      phone_option:'Điện thoại',email_option:'Email',account_email:'Email tài khoản',birth_date:'Ngày sinh',gender:'Giới tính',
      gender_unspecified:'Chưa xác định',gender_male:'Nam',gender_female:'Nữ',gender_non_binary:'Phi nhị nguyên',gender_self:'Tự mô tả',gender_private:'Không muốn nêu',gender_desc:'Cách bạn mô tả giới tính',
      marketing_optin:'Nhận tin và ưu đãi từ Thammachat (không bắt buộc)',research_optin:'Cho phép dùng dữ liệu ẩn danh để cải thiện dịch vụ/nghiên cứu (không bắt buộc, tách khỏi tiếp thị)',
      save_profile:'Lưu thông tin',refresh:'Làm mới',address_book:'Địa chỉ giao hàng',add_address:'+ Thêm địa chỉ',
      address_intro:'Có thể lưu nhiều địa chỉ, mỗi địa chỉ có tên người nhận và số điện thoại riêng.',address_label:'Tên địa chỉ',address_label_ph:'Nhà / Công ty',
      recipient_name:'Tên người nhận',recipient_name_ph:'Họ tên người nhận',recipient_phone:'Điện thoại người nhận',address_line1:'Địa chỉ',address_line1_ph:'Số nhà, tòa nhà, đường',
      address_line2:'Thông tin bổ sung',address_line2_ph:'Tòa nhà, tầng, phòng (nếu có)',subdistrict:'Phường / Xã',district:'Quận / Huyện / Thành phố',province:'Tỉnh / Bang',postal_code:'Mã bưu chính',
      delivery_instructions:'Ghi chú giao hàng',delivery_ph:'Ví dụ: gọi trước khi đến',default_address:'Đặt làm địa chỉ mặc định',save_address:'Lưu địa chỉ',cancel:'Hủy',
      bookings:'Đặt chỗ',orders:'Đơn hàng OTOP',inquiries:'Yêu cầu gửi quán cà phê',
      privacy:'Tên, điện thoại, email và địa chỉ giao hàng được lưu tách khỏi bộ nhớ hội thoại của Thongthai và được mã hóa phía máy chủ.',
      status_requested:'Chờ kiểm tra',status_confirmed:'Đã xác nhận',status_cancelled:'Đã hủy',status_completed:'Hoàn tất',status_no_show:'Không đến',status_preparing:'Đang chuẩn bị',status_ready:'Sẵn sàng',status_shipped:'Đã gửi',status_open:'Chờ trả lời',status_replied:'Đã trả lời',status_closed:'Đã đóng',
      shipping_awaiting_payment:'Chờ kiểm tra thanh toán',shipping_packing:'Đang đóng gói',shipping_ready_to_ship:'Sẵn sàng gửi',shipping_shipped:'Đã gửi',shipping_delivered:'Đã giao',shipping_delivery_failed:'Giao thất bại',shipping_returned:'Đã hoàn trả',shipping_cancelled:'Đã hủy giao hàng',
      payment_quote_required:'Chờ xác định số tiền',payment_awaiting_payment:'Chờ thanh toán',payment_proof_submitted:'Đã gửi chứng từ',payment_verified:'Đã thanh toán',payment_rejected:'Chứng từ bị từ chối',payment_cancelled:'Đã hủy',
      no_bookings:'Chưa có đặt chỗ',service_restaurant:'Nhà hàng',service_stay:'Lưu trú',service_activity:'Hoạt động',party_count:'{count} khách',quantity_units:'{count} đơn vị',
      no_orders:'Chưa có đơn hàng',carrier:'Đơn vị vận chuyển',track_parcel:'Theo dõi kiện hàng ↗',product:'Sản phẩm',subtotal:'Tiền hàng',shipping_fee:'Phí vận chuyển',payment:'Thanh toán',ship_to:'Giao đến',
      no_inquiries:'Chưa có yêu cầu gửi quán cà phê',team:'Đội ngũ',account_load_failed:'Không tải được tài khoản',auth_invalid:'Nhập email và mật khẩu ít nhất 8 ký tự',
      auth_failed:'Không thể hoàn tất yêu cầu',signup_confirm:'Đã tạo tài khoản. Hãy xác nhận email trước khi đăng nhập nếu hệ thống yêu cầu.',generic_error:'Đã xảy ra lỗi',
      profile_save_failed:'Không lưu được',profile_saved:'Đã lưu thông tin',no_addresses:'Chưa có địa chỉ giao hàng',address_default_badge:'Mặc định',
      addr_subdistrict_prefix:'Phường/Xã',addr_district_prefix:'Quận/Huyện',addr_province_prefix:'Tỉnh',note_prefix:'Ghi chú',edit:'Sửa',delete:'Xóa',
      address_load_failed:'Không tải được địa chỉ',invalid_phone:'Kiểm tra số điện thoại',invalid_postal_code:'Kiểm tra mã bưu chính',recipient_name_required:'Nhập tên người nhận',
      address_line_required:'Nhập địa chỉ',district_required:'Nhập quận/huyện/thành phố',province_required:'Nhập tỉnh/bang',address_save_failed:'Không lưu được địa chỉ',
      address_saved:'Đã lưu địa chỉ',delete_confirm:'Xóa địa chỉ này khỏi sổ địa chỉ?',delete_failed:'Không xóa được địa chỉ',address_deleted:'Đã xóa địa chỉ',refresh_failed:'Không làm mới được',
      member_complete:'THÀNH VIÊN · HỒ SƠ HOÀN TẤT',member_incomplete:'THÀNH VIÊN · HỒ SƠ CHƯA ĐỦ',customer_account:'TÀI KHOẢN KHÁCH HÀNG',
      reward_available:'Có thể dùng',reward_partial:'Đã dùng một phần',reward_used:'Đã sử dụng',reward_expired:'Đã hết hạn',reward_expiry:'Có hiệu lực đến 23:59 hôm nay ({date})',reward_expiry_simple:'Có hiệu lực đến 23:59 hôm nay',
      reward_scope_all:'Dùng ở mọi khu vực',reward_scope_one:'Dùng ở 1 khu vực',redeem_now:'Sử dụng ngay',redeemed:'Đã sử dụng',no_rewards:'Chưa có phần thưởng cờ vua',rewards_load_failed:'Không tải được phần thưởng',
      redeem_confirm_title:'Xác nhận sử dụng',redeem_confirm_body:'Đưa màn hình này cho nhân viên rồi xác nhận để dùng ưu đãi tại khu vực này. Không thể hoàn tác.',confirm:'Xác nhận'
    }
  };
  let current='th';
  function interpolate(v,vars={}){return String(v??'').replace(/\{(\w+)\}/g,(_,k)=>vars[k]??'');}
  function t(key,vars={}){const d=D[current]||D.th;return interpolate(d[key]??D.th[key]??key,vars);}
  function locale(){return LOCALES[current]||LOCALES.th;}
  function read(){try{const v=localStorage.getItem(STORAGE_KEY);if(SUPPORTED.includes(v))return v;}catch{}const n=(navigator.language||'th').toLowerCase();return SUPPORTED.find(x=>n.startsWith(x))||'th';}
  function apply(){
    document.documentElement.lang=current;
    document.title=t('page_title');
    document.querySelectorAll('[data-account-i18n]').forEach(el=>el.textContent=t(el.getAttribute('data-account-i18n')));
    document.querySelectorAll('[data-account-i18n-placeholder]').forEach(el=>el.setAttribute('placeholder',t(el.getAttribute('data-account-i18n-placeholder'))));
    document.querySelectorAll('[data-account-lang-select]').forEach(el=>el.value=current);
  }
  function setLang(lang,persist=true){if(!SUPPORTED.includes(lang))return;current=lang;if(persist)try{localStorage.setItem(STORAGE_KEY,lang);}catch{}apply();window.dispatchEvent(new CustomEvent('account:i18n-change',{detail:{lang}}));}
  function init(){
    current=read();apply();
    document.querySelectorAll('[data-account-lang-select]').forEach(el=>el.addEventListener('change',()=>setLang(el.value)));
    window.addEventListener('storage',e=>{if(e.key===STORAGE_KEY&&SUPPORTED.includes(e.newValue))setLang(e.newValue,false);});
    window.dispatchEvent(new CustomEvent('account:i18n-ready',{detail:{lang:current}}));
  }
  window.AccountI18n={t,locale,lang:()=>current,setLang,init};
  init();
})();