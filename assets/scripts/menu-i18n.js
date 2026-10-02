(() => {
'use strict';
const KEY='thammachat-lang-v1';
const SUPPORTED=['th','en','zh','lo','vi'];
const LOCALE={th:'th-TH',en:'en-US',zh:'zh-CN',lo:'lo-LA',vi:'vi-VN'};
const UI={
 th:{page_title:'เมนู ตำมา-ชาติ',meta_desc:'เมนูจริงและสถานะวัตถุดิบล่าสุดของร้าน ตำมา-ชาติ',brand:'ตำมา-ชาติ',sub:'เมนูจริง · อัปเดตจากวัตถุดิบและสต๊อกของร้าน',truth:'● Source of Truth — ราคาและสถานะเมนูจากหลังบ้านเดียวกัน',loading:'กำลังโหลดเมนูล่าสุด…',chat:'คุยกับทองไทย / สั่งล่วงหน้า',foot:'เมนูที่ขึ้น “หมดชั่วคราว” จะกลับมาสั่งได้อัตโนมัติเมื่อทีมงานอัปเดตวัตถุดิบเข้า|สูตรและปริมาณวัตถุดิบเป็นข้อมูลปฏิบัติงานของร้านและอาจมีการปรับปรุง',main_ingredients:'วัตถุดิบหลัก',ready:'พร้อมสั่ง',sold_out:'หมดชั่วคราว',count:'{count} เมนู',updated:'อัปเดตล่าสุด {time}',backoffice:'จากหลังบ้าน',load_failed:'โหลดเมนูไม่สำเร็จ',unavailable:'ตอนนี้เปิดเมนูไม่ได้ชั่วคราว',retry:'ลองใหม่'},
 en:{page_title:'Tamma-Chat Menu',meta_desc:'Live Tamma-Chat menu with current ingredient and availability status.',brand:'Tamma-Chat',sub:'Live menu · Updated from current ingredients and stock',truth:'● Source of Truth — Prices and availability from the same back office',loading:'Loading the latest menu…',chat:'Chat with Thongthai / Pre-order',foot:'Items marked “Temporarily unavailable” become orderable automatically when the team updates stock.|Recipes and ingredient quantities are operational data and may be adjusted.',main_ingredients:'Main ingredients',ready:'Available',sold_out:'Temporarily unavailable',count:'{count} menu items',updated:'Updated {time}',backoffice:'from back office',load_failed:'Could not load menu',unavailable:'The menu is temporarily unavailable.',retry:'Try again'},
 zh:{page_title:'Tamma-Chat 菜单',meta_desc:'Tamma-Chat 实时菜单，显示最新食材与供应状态。',brand:'Tamma-Chat',sub:'实时菜单 · 根据食材与库存更新',truth:'● Source of Truth — 价格和供应状态来自同一后台',loading:'正在加载最新菜单…',chat:'联系 Thongthai / 预订',foot:'标记为“暂时售罄”的菜品会在团队更新库存后自动恢复可点。|配方和食材数量属于运营数据，可能调整。',main_ingredients:'主要食材',ready:'可点',sold_out:'暂时售罄',count:'{count} 道',updated:'更新于 {time}',backoffice:'来自后台',load_failed:'菜单加载失败',unavailable:'菜单暂时无法打开。',retry:'重试'},
 lo:{page_title:'ເມນູ Tamma-Chat',meta_desc:'ເມນູສົດຂອງ Tamma-Chat ພ້ອມສະຖານະວັດຖຸດິບແລະສິນຄ້າຫຼ້າສຸດ.',brand:'Tamma-Chat',sub:'ເມນູຈິງ · ອັບເດດຕາມວັດຖຸດິບແລະສະຕັອກ',truth:'● Source of Truth — ລາຄາແລະສະຖານະເມນູຈາກຫຼັງບ້ານດຽວກັນ',loading:'ກຳລັງໂຫຼດເມນູຫຼ້າສຸດ…',chat:'ຄຸຍກັບ Thongthai / ສັ່ງລ່ວງໜ້າ',foot:'ເມນູທີ່ຂຶ້ນ “ຫມົດຊົ່ວຄາວ” ຈະກັບມາສັ່ງໄດ້ເມື່ອທີມອັບເດດສະຕັອກ.|ສູດແລະປະລິມານວັດຖຸດິບເປັນຂໍ້ມູນປະຕິບັດງານແລະອາດປັບປຸງ.',main_ingredients:'ວັດຖຸດິບຫຼັກ',ready:'ພ້ອມສັ່ງ',sold_out:'ຫມົດຊົ່ວຄາວ',count:'{count} ເມນູ',updated:'ອັບເດດ {time}',backoffice:'ຈາກຫຼັງບ້ານ',load_failed:'ໂຫຼດເມນູບໍ່ສຳເລັດ',unavailable:'ຕອນນີ້ເປີດເມນູບໍ່ໄດ້ຊົ່ວຄາວ.',retry:'ລອງໃໝ່'},
 vi:{page_title:'Thực đơn Tamma-Chat',meta_desc:'Thực đơn trực tiếp của Tamma-Chat với tình trạng nguyên liệu và món ăn mới nhất.',brand:'Tamma-Chat',sub:'Thực đơn trực tiếp · Cập nhật theo nguyên liệu và tồn kho',truth:'● Source of Truth — Giá và tình trạng món từ cùng một hệ thống quản trị',loading:'Đang tải thực đơn mới nhất…',chat:'Nhắn Thongthai / Đặt trước',foot:'Món ghi “Tạm hết” sẽ tự động mở lại khi đội ngũ cập nhật tồn kho.|Công thức và định lượng nguyên liệu là dữ liệu vận hành và có thể được điều chỉnh.',main_ingredients:'Nguyên liệu chính',ready:'Có thể gọi',sold_out:'Tạm hết',count:'{count} món',updated:'Cập nhật {time}',backoffice:'từ hệ thống quản trị',load_failed:'Không tải được thực đơn',unavailable:'Thực đơn tạm thời không khả dụng.',retry:'Thử lại'}
};
const CAT={
 'ตำ':{en:'Som Tam',zh:'青木瓜沙拉',lo:'ຕຳ',vi:'Gỏi đu đủ'},
 'เมนูปลา':{en:'Fish',zh:'鱼类',lo:'ເມນູປາ',vi:'Món cá'},
 'ต้ม • นึ่ง':{en:'Soups & Steamed',zh:'汤 · 蒸',lo:'ຕົ້ມ · ໜຶ້ງ',vi:'Canh · Hấp'},
 'ลาบ • น้ำตก • ยำ':{en:'Larb · Nam Tok · Spicy Salads',zh:'Larb · Nam Tok · 凉拌',lo:'ລາບ · ນ້ຳຕົກ · ຍຳ',vi:'Larb · Nam Tok · Gỏi cay'},
 'ย่าง • ทอด':{en:'Grilled & Fried',zh:'烤 · 炸',lo:'ປີ້ງ · ທອດ',vi:'Nướng · Chiên'},
 'ข้าว • เส้น • เคียง':{en:'Rice · Noodles · Sides',zh:'米饭 · 面 · 配菜',lo:'ເຂົ້າ · ເສັ້ນ · ເຄື່ອງຄຽງ',vi:'Cơm · Bún · Món kèm'},
 'น้ำสมุนไพร':{en:'Herbal Drinks',zh:'草本饮品',lo:'ນ້ຳສະໝຸນໄພ',vi:'Nước thảo mộc'},
 'เบียร์สด':{en:'Draft Beer',zh:'生啤',lo:'ເບຍສົດ',vi:'Bia tươi'},
 'Thai Craft Spirits':{en:'Thai Craft Spirits',zh:'泰国精酿烈酒',lo:'ສຸລາຄຣາຟໄທ',vi:'Rượu thủ công Thái'},
 'สุรา':{en:'Spirits',zh:'烈酒',lo:'ສຸລາ',vi:'Rượu mạnh'},
 'ของหวาน':{en:'Desserts',zh:'甜点',lo:'ຂອງຫວານ',vi:'Tráng miệng'}
};
const N={
 'ตำลาว':{en:'Lao-style Som Tam',zh:'老挝风味青木瓜沙拉',lo:'ຕຳລາວ',vi:'Gỏi đu đủ kiểu Lào'},
 'ตำไทย':{en:'Thai Som Tam',zh:'泰式青木瓜沙拉',lo:'ຕຳໄທ',vi:'Gỏi đu đủ kiểu Thái'},
 'ตำซั่วปลาร้า':{en:'Som Tam with Rice Noodles & Fermented Fish',zh:'发酵鱼酱米线青木瓜沙拉',lo:'ຕຳຊົ່ວປາແດກ',vi:'Gỏi đu đủ bún cá lên men'},
 'ตำซั่วไทย':{en:'Thai Som Tam with Rice Noodles',zh:'泰式米线青木瓜沙拉',lo:'ຕຳຊົ່ວໄທ',vi:'Gỏi đu đủ Thái với bún'},
 'ตำข้าวโพด':{en:'Sweet Corn Som Tam',zh:'甜玉米沙拉',lo:'ຕຳເຂົ້າໂພດ',vi:'Gỏi bắp ngọt'},
 'ตำแตง':{en:'Cucumber Som Tam',zh:'黄瓜沙拉',lo:'ຕຳໝາກແຕງ',vi:'Gỏi dưa leo'},
 'ตำถั่ว':{en:'Long Bean Som Tam',zh:'长豆角沙拉',lo:'ຕຳໝາກຖົ່ວ',vi:'Gỏi đậu đũa'},
 'ลาบปลาช่อน':{en:'Snakehead Fish Larb',zh:'黑鱼 Larb',lo:'ລາບປາຊ່ອນ',vi:'Larb cá lóc'},
 'ทอดมันปลาช่อน':{en:'Snakehead Fish Cakes',zh:'炸黑鱼饼',lo:'ທອດມັນປາຊ່ອນ',vi:'Chả cá lóc chiên'},
 'ปลาช่อนทอดสมุนไพร':{en:'Herb-fried Snakehead Fish',zh:'香草炸黑鱼',lo:'ປາຊ່ອນທອດສະໝຸນໄພ',vi:'Cá lóc chiên thảo mộc'},
 'ลาบปลานิล':{en:'Tilapia Larb',zh:'罗非鱼 Larb',lo:'ລາບປານິນ',vi:'Larb cá rô phi'},
 'ปลานิลทอดสมุนไพร':{en:'Herb-fried Tilapia',zh:'香草炸罗非鱼',lo:'ປານິນທອດສະໝຸນໄພ',vi:'Cá rô phi chiên thảo mộc'},
 'ไก่บ้านนึ่งสมุนไพรใส่วุ้นเส้น':{en:'Steamed Free-range Chicken with Herbs & Glass Noodles',zh:'香草粉丝蒸走地鸡',lo:'ໄກ່ບ້ານໜຶ້ງສະໝຸນໄພໃສ່ວຸ້ນເສັ້ນ',vi:'Gà thả vườn hấp thảo mộc và miến'},
 'ต้มแซ่บไก่บ้าน':{en:'Spicy Isan Soup with Free-range Chicken',zh:'酸辣走地鸡汤',lo:'ຕົ້ມແຊບໄກ່ບ້ານ',vi:'Canh chua cay gà thả vườn'},
 'ต้มแซ่บหมู':{en:'Spicy Isan Pork Soup',zh:'酸辣猪肉汤',lo:'ຕົ້ມແຊບໝູ',vi:'Canh chua cay thịt heo'},
 'ต้มแซ่บเนื้อ':{en:'Spicy Isan Beef Soup',zh:'酸辣牛肉汤',lo:'ຕົ້ມແຊບຊີ້ນງົວ',vi:'Canh chua cay bò'},
 'ลาบหมู':{en:'Pork Larb',zh:'猪肉 Larb',lo:'ລາບໝູ',vi:'Larb thịt heo'},
 'ลาบไก่บ้าน':{en:'Free-range Chicken Larb',zh:'走地鸡 Larb',lo:'ລາບໄກ່ບ້ານ',vi:'Larb gà thả vườn'},
 'ลาบเนื้อ':{en:'Beef Larb',zh:'牛肉 Larb',lo:'ລາບຊີ້ນງົວ',vi:'Larb bò'},
 'น้ำตกคอหมู':{en:'Grilled Pork Neck Nam Tok',zh:'烤猪颈肉 Nam Tok',lo:'ນ້ຳຕົກຄໍໝູ',vi:'Nam Tok cổ heo'},
 'น้ำตกเนื้อ':{en:'Beef Nam Tok',zh:'牛肉 Nam Tok',lo:'ນ້ຳຕົກຊີ້ນງົວ',vi:'Nam Tok bò'},
 'ยำวุ้นเส้นหมูสับ':{en:'Spicy Glass Noodle Salad with Minced Pork',zh:'肉末粉丝酸辣沙拉',lo:'ຍຳວຸ້ນເສັ້ນໝູສັບ',vi:'Gỏi miến thịt heo bằm'},
 'คอหมูย่างจิ้มแจ่ว':{en:'Grilled Pork Neck with Jaew Dip',zh:'烤猪颈肉配 Jaew 蘸酱',lo:'ຄໍໝູປີ້ງຈິ້ມແຈ່ວ',vi:'Cổ heo nướng chấm jaew'},
 'เสือร้องไห้':{en:'Crying Tiger Grilled Beef',zh:'虎哭烤牛肉',lo:'ເສືອຮ້ອງໄຫ້',vi:'Bò nướng “Crying Tiger”'},
 'ไก่บ้านย่างจิ้มแจ่ว':{en:'Grilled Free-range Chicken with Jaew Dip',zh:'烤走地鸡配 Jaew 蘸酱',lo:'ໄກ່ບ້ານປີ້ງຈິ້ມແຈ່ວ',vi:'Gà thả vườn nướng chấm jaew'},
 'ไก่บ้านทอดสมุนไพร':{en:'Herb-fried Free-range Chicken',zh:'香草炸走地鸡',lo:'ໄກ່ບ້ານທອດສະໝຸນໄພ',vi:'Gà thả vườn chiên thảo mộc'},
 'คอหมูทอดสมุนไพร':{en:'Herb-fried Pork Neck',zh:'香草炸猪颈肉',lo:'ຄໍໝູທອດສະໝຸນໄພ',vi:'Cổ heo chiên thảo mộc'},
 'ข้าวเหนียว':{en:'Sticky Rice',zh:'糯米饭',lo:'ເຂົ້າໜຽວ',vi:'Xôi nếp'},
 'ข้าวหอมมะลิ':{en:'Jasmine Rice',zh:'茉莉香米饭',lo:'ເຂົ້າຫອມມະລິ',vi:'Cơm gạo jasmine'},
 'ขนมจีน':{en:'Rice Noodles',zh:'泰式米线',lo:'ເຂົ້າປຸ້ນ',vi:'Bún gạo'},
 'ข้าวคอหมูย่างจิ้มแจ่ว':{en:'Rice with Grilled Pork Neck & Jaew',zh:'烤猪颈肉 Jaew 盖饭',lo:'ເຂົ້າຄໍໝູປີ້ງຈິ້ມແຈ່ວ',vi:'Cơm cổ heo nướng chấm jaew'},
 'ข้าวเนื้อย่างจิ้มแจ่ว':{en:'Rice with Grilled Beef & Jaew',zh:'烤牛肉 Jaew 盖饭',lo:'ເຂົ້າຊີ້ນງົວປີ້ງຈິ້ມແຈ່ວ',vi:'Cơm bò nướng chấm jaew'},
 'ไข่เจียวหมูสับ':{en:'Thai Omelette with Minced Pork',zh:'肉末泰式煎蛋',lo:'ໄຂ່ຈຽວໝູສັບ',vi:'Trứng chiên thịt heo bằm'},
 'ไข่เจียวสมุนไพร':{en:'Herb Omelette',zh:'香草煎蛋',lo:'ໄຂ່ຈຽວສະໝຸນໄພ',vi:'Trứng chiên thảo mộc'},
 'ข้าวจี่จิ้มแจ่ว':{en:'Grilled Sticky Rice with Jaew',zh:'烤糯米饼配 Jaew 蘸酱',lo:'ເຂົ້າຈີ່ຈິ້ມແຈ່ວ',vi:'Xôi nướng chấm jaew'},
 'น้ำตะไคร้ใบเตย':{en:'Lemongrass & Pandan Drink',zh:'香茅班兰饮',lo:'ນ້ຳຕະໄຄ້ໃບເຕີຍ',vi:'Nước sả lá dứa'},
 'น้ำมะตูม':{en:'Bael Fruit Drink',zh:'木橘饮',lo:'ນ້ຳໝາກຕູມ',vi:'Nước quả bael'},
 'น้ำกระเจี๊ยบ':{en:'Roselle Drink',zh:'洛神花饮',lo:'ນ້ຳກະເຈີບ',vi:'Nước atisô đỏ'},
 'Singha Draft (แก้ว)':{en:'Singha Draft (Glass)',zh:'胜狮生啤（杯）',lo:'Singha Draft (ແກ້ວ)',vi:'Singha Draft (Ly)'},
 'Singha Draft (เหยือก)':{en:'Singha Draft (Pitcher)',zh:'胜狮生啤（壶）',lo:'Singha Draft (ເຫຍືອກ)',vi:'Singha Draft (Bình)'},
 'SONKLIN':{en:'SONKLIN',zh:'SONKLIN',lo:'SONKLIN',vi:'SONKLIN'},
 'Kirikhan':{en:'Kirikhan',zh:'Kirikhan',lo:'Kirikhan',vi:'Kirikhan'},
 'GAO HANG':{en:'GAO HANG',zh:'GAO HANG',lo:'GAO HANG',vi:'GAO HANG'},
 'Regency':{en:'Regency',zh:'Regency',lo:'Regency',vi:'Regency'},
 'SangSom':{en:'SangSom',zh:'SangSom',lo:'SangSom',vi:'SangSom'},
 'Hong Thong':{en:'Hong Thong',zh:'Hong Thong',lo:'Hong Thong',vi:'Hong Thong'},
 'ไอศกรีมกะทิสด':{en:'Fresh Coconut Milk Ice Cream',zh:'鲜椰奶冰淇淋',lo:'ໄອສະຄຣີມກະທິສົດ',vi:'Kem nước cốt dừa tươi'},
 'กล้วยบวชชี':{en:'Banana in Coconut Milk',zh:'椰奶煮香蕉',lo:'ກ້ວຍບວດຊີ',vi:'Chuối nấu nước cốt dừa'},
 'ข้าวเหนียวดำเปียกมะพร้าวอ่อน':{en:'Black Sticky Rice Pudding with Young Coconut',zh:'嫩椰黑糯米甜粥',lo:'ເຂົ້າໜຽວດຳປຽກໝາກພ້າວອ່ອນ',vi:'Chè nếp cẩm dừa non'}
};
const ING={
 'กระเจี๊ยบแห้ง':{en:'dried roselle',zh:'干洛神花',lo:'ກະເຈີບແຫ້ງ',vi:'atisô đỏ khô'},'กระเทียม':{en:'garlic',zh:'大蒜',lo:'ກະທຽມ',vi:'tỏi'},'กล้วยน้ำว้า':{en:'Namwa banana',zh:'Namwa 香蕉',lo:'ກ້ວຍນ້ຳວ້າ',vi:'chuối Namwa'},'กะทิสด':{en:'fresh coconut milk',zh:'鲜椰奶',lo:'ກະທິສົດ',vi:'nước cốt dừa tươi'},'กะหล่ำปลี':{en:'cabbage',zh:'卷心菜',lo:'ກະຫຼ່ຳປີ',vi:'bắp cải'},'กุ้งแห้ง':{en:'dried shrimp',zh:'虾米',lo:'ກຸ້ງແຫ້ງ',vi:'tôm khô'},'เกลือ':{en:'salt',zh:'盐',lo:'ເກືອ',vi:'muối'},'ไก่บ้าน':{en:'free-range chicken',zh:'走地鸡',lo:'ໄກ່ບ້ານ',vi:'gà thả vườn'},'ขนมจีน':{en:'rice noodles',zh:'米线',lo:'ເຂົ້າປຸ້ນ',vi:'bún gạo'},'ข้าวคั่ว':{en:'toasted rice powder',zh:'烤米粉',lo:'ເຂົ້າຄົ່ວ',vi:'thính gạo'},'ข้าวโพดหวาน':{en:'sweet corn',zh:'甜玉米',lo:'ເຂົ້າໂພດຫວານ',vi:'bắp ngọt'},'ข้าวหอมมะลิ':{en:'jasmine rice',zh:'茉莉香米',lo:'ເຂົ້າຫອມມະລິ',vi:'gạo jasmine'},'ข้าวเหนียว':{en:'sticky rice',zh:'糯米',lo:'ເຂົ້າໜຽວ',vi:'gạo nếp'},'ข้าวเหนียวดำ':{en:'black sticky rice',zh:'黑糯米',lo:'ເຂົ້າໜຽວດຳ',vi:'nếp cẩm'},'ไข่ไก่':{en:'egg',zh:'鸡蛋',lo:'ໄຂ່ໄກ່',vi:'trứng gà'},'คอหมู':{en:'pork neck',zh:'猪颈肉',lo:'ຄໍໝູ',vi:'cổ heo'},'ซอสหอยนางรม':{en:'oyster sauce',zh:'蚝油',lo:'ຊອດຫອຍນາງລົມ',vi:'dầu hào'},'ซีอิ๊วขาว':{en:'light soy sauce',zh:'生抽',lo:'ຊີອິ້ວຂາວ',vi:'nước tương nhạt'},'ตะไคร้':{en:'lemongrass',zh:'香茅',lo:'ຕະໄຄ້',vi:'sả'},'แตงกวา':{en:'cucumber',zh:'黄瓜',lo:'ໝາກແຕງ',vi:'dưa leo'},'ถั่วฝักยาว':{en:'long beans',zh:'长豆角',lo:'ໝາກຖົ່ວຍາວ',vi:'đậu đũa'},'ถั่วลิสงคั่ว':{en:'roasted peanuts',zh:'烤花生',lo:'ຖົ່ວດິນຄົ່ວ',vi:'đậu phộng rang'},'น้ำจิ้มแจ่ว':{en:'jaew dipping sauce',zh:'Jaew 蘸酱',lo:'ນ້ຳຈິ້ມແຈ່ວ',vi:'nước chấm jaew'},'น้ำตาลทราย':{en:'sugar',zh:'白糖',lo:'ນ້ຳຕານຊາຍ',vi:'đường cát'},'น้ำตาลปี๊บ':{en:'palm sugar',zh:'棕榈糖',lo:'ນ້ຳຕານປີບ',vi:'đường thốt nốt'},'น้ำตำไทย':{en:'Thai som tam dressing',zh:'泰式青木瓜沙拉酱',lo:'ນ້ຳຕຳໄທ',vi:'sốt gỏi đu đủ Thái'},'น้ำปลา':{en:'fish sauce',zh:'鱼露',lo:'ນ້ຳປາ',vi:'nước mắm'},'น้ำปลาร้า':{en:'fermented fish sauce',zh:'发酵鱼酱',lo:'ນ້ຳປາແດກ',vi:'mắm cá lên men'},'น้ำมันพืช':{en:'vegetable oil',zh:'植物油',lo:'ນ້ຳມັນພືດ',vi:'dầu thực vật'},'น้ำยำ':{en:'spicy salad dressing',zh:'酸辣凉拌汁',lo:'ນ້ຳຍຳ',vi:'nước trộn gỏi cay'},'น้ำลาบ':{en:'larb seasoning',zh:'Larb 调味汁',lo:'ນ້ຳລາບ',vi:'gia vị larb'},'เนื้อวัว':{en:'beef',zh:'牛肉',lo:'ຊີ້ນງົວ',vi:'thịt bò'},'ใบเตย':{en:'pandan',zh:'班兰叶',lo:'ໃບເຕີຍ',vi:'lá dứa'},'ใบมะกรูด':{en:'makrut lime leaves',zh:'卡菲尔青柠叶',lo:'ໃບໝາກຂີ້ຫູດ',vi:'lá chanh kaffir'},'ปลาช่อน':{en:'snakehead fish',zh:'黑鱼',lo:'ປາຊ່ອນ',vi:'cá lóc'},'ปลานิล':{en:'tilapia',zh:'罗非鱼',lo:'ປານິນ',vi:'cá rô phi'},'แป้งทอดกรอบ':{en:'crispy frying flour',zh:'脆炸粉',lo:'ແປ້ງທອດກອບ',vi:'bột chiên giòn'},'ผักชีฝรั่ง':{en:'culantro',zh:'刺芫荽',lo:'ຜັກຊີຝຣັ່ງ',vi:'ngò gai'},'พริกสด':{en:'fresh chili',zh:'鲜辣椒',lo:'ໝາກເຜັດສົດ',vi:'ớt tươi'},'พริกแห้ง':{en:'dried chili',zh:'干辣椒',lo:'ໝາກເຜັດແຫ້ງ',vi:'ớt khô'},'มะเขือเทศ':{en:'tomato',zh:'番茄',lo:'ໝາກເລັ່ນ',vi:'cà chua'},'มะตูมแห้ง':{en:'dried bael fruit',zh:'干木橘',lo:'ໝາກຕູມແຫ້ງ',vi:'quả bael khô'},'มะนาว':{en:'lime',zh:'青柠',lo:'ໝາກນາວ',vi:'chanh'},'มะพร้าวอ่อน':{en:'young coconut',zh:'嫩椰肉',lo:'ໝາກພ້າວອ່ອນ',vi:'dừa non'},'มะละกอดิบ':{en:'green papaya',zh:'青木瓜',lo:'ໝາກຫຸ່ງດິບ',vi:'đu đủ xanh'},'วุ้นเส้น':{en:'glass noodles',zh:'粉丝',lo:'ວຸ້ນເສັ້ນ',vi:'miến'},'สะระแหน่':{en:'mint',zh:'薄荷',lo:'ສະລະແໜ່',vi:'bạc hà'},'หมูสับ':{en:'minced pork',zh:'猪肉末',lo:'ໝູສັບ',vi:'thịt heo bằm'},'หอมแดง':{en:'shallot',zh:'红葱头',lo:'ຫອມແດງ',vi:'hành tím'},'ไอศกรีมกะทิสด':{en:'fresh coconut milk ice cream',zh:'鲜椰奶冰淇淋',lo:'ໄອສະຄຣີມກະທິສົດ',vi:'kem nước cốt dừa tươi'}
};
let lang='th';
function read(){try{const v=localStorage.getItem(KEY);if(SUPPORTED.includes(v))return v;}catch{}const n=(navigator.language||'th').toLowerCase();return SUPPORTED.find(x=>n.startsWith(x))||'th';}
function fmt(v,vars={}){return String(v??'').replace(/\{(\w+)\}/g,(_,k)=>vars[k]??'');}
function t(k,vars={}){return fmt(UI[lang]?.[k]??UI.th[k]??k,vars);}
function localize(map,value){return lang==='th'?value:(map[value]?.[lang]||value);}
function category(v){return localize(CAT,v);}
function name(v){return localize(N,v);}
function ingredient(v){return localize(ING,v);}
function locale(){return LOCALE[lang]||LOCALE.th;}
function apply(){
 document.documentElement.lang=lang;document.title=t('page_title');
 const md=document.querySelector('meta[name="description"]');if(md)md.content=t('meta_desc');
 document.querySelectorAll('[data-menu-i18n]').forEach(el=>el.textContent=t(el.getAttribute('data-menu-i18n')));
 document.querySelectorAll('[data-menu-lang-select]').forEach(el=>el.value=lang);
}
function setLang(v,persist=true){if(!SUPPORTED.includes(v))return;lang=v;if(persist)try{localStorage.setItem(KEY,v);}catch{}apply();window.dispatchEvent(new CustomEvent('menu:i18n-change',{detail:{lang}}));}
function init(){lang=read();apply();document.querySelectorAll('[data-menu-lang-select]').forEach(el=>el.addEventListener('change',()=>setLang(el.value)));window.addEventListener('storage',e=>{if(e.key===KEY&&SUPPORTED.includes(e.newValue))setLang(e.newValue,false)});window.dispatchEvent(new CustomEvent('menu:i18n-ready',{detail:{lang}}));}
window.MenuI18n={t,category,name,ingredient,locale,lang:()=>lang,setLang,init};
init();
})();