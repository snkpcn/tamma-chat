import type { OtopProvince } from './types';

const province = (
  provinceId: string,
  provinceName: string,
  sortOrder: number,
  productCount = 0,
  heroSubtitle = 'สินค้า OTOP และภูมิปัญญาชุมชน',
): OtopProvince => ({
  provinceId,
  provinceName,
  region: 'อีสาน',
  mapLabel: provinceName,
  heroTitle: `ของดี${provinceName}`,
  heroSubtitle,
  heroImage: `/images/otop/provinces/${provinceId}/hero.png`,
  heroProductImage: `/images/otop/provinces/${provinceId}/product-hero.png`,
  productCount,
  isActive: true,
  sortOrder,
});

export const OTOP_PROVINCES: OtopProvince[] = [
  province('chaiyaphum', 'ชัยภูมิ', 1, 10, 'ผ้าไหม อาหารพื้นถิ่น และภูมิปัญญาชุมชน'),
  province('khonkaen', 'ขอนแก่น', 2),
  province('buriram', 'บุรีรัมย์', 3),
  province('surin', 'สุรินทร์', 4),
  province('sisaket', 'ศรีสะเกษ', 5),
  province('nakhonratchasima', 'นครราชสีมา', 6),
  province('roiet', 'ร้อยเอ็ด', 7),
  province('mahasarakham', 'มหาสารคาม', 8),
  province('kalasin', 'กาฬสินธุ์', 9),
  province('sakonnakhon', 'สกลนคร', 10),
  province('nakhonphanom', 'นครพนม', 11),
  province('mukdahan', 'มุกดาหาร', 12),
  province('yasothon', 'ยโสธร', 13),
  province('amnatcharoen', 'อำนาจเจริญ', 14),
  province('ubonratchathani', 'อุบลราชธานี', 15),
  province('udonthani', 'อุดรธานี', 16),
  province('nongkhai', 'หนองคาย', 17),
  province('buengkan', 'บึงกาฬ', 18),
  province('loei', 'เลย', 19),
  province('nongbualamphu', 'หนองบัวลำภู', 20),
];
