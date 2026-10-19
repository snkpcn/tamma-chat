// Facts supplied in this conversation, received 2026-10-18. References have
// not been independently checked. This is not an orderable menu/stock source.
export const USER_VENUE_FACTS = {
  sourceId:'user_supplied_cafe_facilities_menu_20261018',
  receivedAt:'2026-10-18',
  scope:'inthanin_tadtone_cafe_and_garden',
  admission:{feeThb:0,freeAreas:['เข้าคาเฟ่','จอดรถ','ถ่ายรูปในสวนหย่อม','เดินชมบึงน้ำ'],paidServices:['อาหาร','เครื่องดื่ม','บริการเสริมและกิจกรรม']},
  parking:{locationTh:'ลานจอดรถด้านหน้าร้าน',spacious:true,accessibleSpaces:true,nearCafeRamp:true},
  toilets:{separate:true,accessible:true,wheelchairTurningSpace:true,grabRails:true},
  // Access described for the cafe arrival path, not every venue/activity/stay.
  accessibility:{cafeRamp:true,allVenueZonesVerified:false,wheelchairLoanVerified:false},
  restaurant:{examples:['ตำไทย','ตำลาว','ตำซั่ว','ตำป่า','ไก่ทอด','คอหมูย่าง','หมูยอ','แคปหมู'],expandedRestaurantPhase:true,currentOperatingStatus:null},
  bakery:{examples:['ครัวซองต์เนยสดไดมอนด์','เค้ก','ขนมปังปิ้ง','แซนวิช'],rotatesDaily:true},
  childFoodReferences:['ไก่ย่าง','คอหมูย่าง','ไข่เจียวหมูสับ','หมูแดดเดียวทอด','ไก่ทอดเกลือ'],
  // A mild-food suggestion is not an ingredient/allergen/child-safety guarantee.
  childFoodRequiresKitchenConfirmation:true,
  horseReference:{durationMinutes:90,priceThb:500,status:'user_supplied_reference_not_live_offering'},
} as const;

export type CafePriceReference={
  code:string;nameTh:string;aliases:string[];category:'coffee'|'tea'|'cocoa'|'addon';
  prices:Partial<Record<'hot'|'iced'|'blended'|'addon',number>>;
};
export const CAFE_PRICE_REFERENCES:CafePriceReference[]=[
  {code:'espresso',nameTh:'เอสเพรสโซ่',aliases:['เอสเพรสโซ่','เอสเปรสโซ่','espresso'],category:'coffee',prices:{hot:40,iced:65,blended:75}},
  {code:'americano',nameTh:'อเมริกาโน่',aliases:['อเมริกาโน่','อเมริกาโน','americano'],category:'coffee',prices:{hot:40,iced:60}},
  {code:'cappuccino',nameTh:'คาปูชิโน่',aliases:['คาปูชิโน่','คาปูชิโน','cappuccino'],category:'coffee',prices:{hot:55,iced:70,blended:80}},
  {code:'cafe_latte',nameTh:'ลาเต้',aliases:['ลาเต้','latte'],category:'coffee',prices:{hot:55,iced:70,blended:80}},
  {code:'mocha',nameTh:'มอคค่า',aliases:['มอคค่า','มอคคา','mocha'],category:'coffee',prices:{hot:60,iced:75,blended:85}},
  {code:'cocoa',nameTh:'อินทนิลโกโก้',aliases:['อินทนิลโกโก้','โกโก้','cocoa'],category:'cocoa',prices:{hot:50,iced:60,blended:70}},
  {code:'thai_tea_latte',nameTh:'ชาไทยลาเต้',aliases:['ชาไทยลาเต้','ชาไทย','thai tea'],category:'tea',prices:{hot:50,iced:60,blended:70}},
  {code:'green_tea_latte',nameTh:'ชาเขียวลาเต้',aliases:['ชาเขียวลาเต้','ชาเขียว','green tea'],category:'tea',prices:{hot:55,iced:65,blended:75}},
  {code:'bubble_milk_tea',nameTh:'ชานมไข่มุก',aliases:['ชานมไข่มุก','bubble milk tea'],category:'tea',prices:{iced:65}},
  {code:'shizuoka_matcha_shot',nameTh:'เพิ่มช็อตชิซูโอกะมัทฉะ',aliases:['ชิซูโอกะ','ชิซุโอกะ','shizuoka'],category:'addon',prices:{addon:15}},
  {code:'uji_premium_matcha_shot',nameTh:'เพิ่มช็อตอูจิพรีเมียมมัทฉะ',aliases:['อูจิพรีเมียม','ช็อตอูจิ','uji premium','uji matcha shot'],category:'addon',prices:{addon:25}},
];
export const CAFE_PRICE_REFERENCE_PROVENANCE={
  sourceId:'user_supplied_cafe_price_references_20261018',receivedAt:'2026-10-18',
  verification:'mixed_user_and_third_party_references_not_confirmed_branch_prices',
  urls:['https://th.pricelisto.com/download-inthanin-th-menu-pdf','https://salehere.co.th/inthanin/update-price-inthanin'],
  // These ranges include a cited OTHER branch (Suthep); never final Tadtone prices.
  bakeryRanges:[{nameTh:'ขนมปังปิ้งแซนด์วิช / ปังเย็น',minThb:45,maxThb:65},{nameTh:'เค้กและเบเกอรี',minThb:50,maxThb:85}],
  bakeryReferenceUrl:'https://www.wongnai.com/restaurants/835873ui-inthanin-coffee-สุเทพ/menu?menuGroupId=items',
  arabicaClaim:'100% Arabica, user-supplied brand description; not independently verified',
} as const;
