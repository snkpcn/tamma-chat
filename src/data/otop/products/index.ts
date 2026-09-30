import type { OtopProduct } from '../types';
import { AMNATCHAROEN_OTOP_PRODUCTS } from './amnatcharoen';
import { BUENGKAN_OTOP_PRODUCTS } from './buengkan';
import { BURIRAM_OTOP_PRODUCTS } from './buriram';
import { CHAIYAPHUM_OTOP_PRODUCTS } from './chaiyaphum';
import { KALASIN_OTOP_PRODUCTS } from './kalasin';
import { KHONKAEN_OTOP_PRODUCTS } from './khonkaen';
import { LOEI_OTOP_PRODUCTS } from './loei';
import { MAHASARAKHAM_OTOP_PRODUCTS } from './mahasarakham';
import { MUKDAHAN_OTOP_PRODUCTS } from './mukdahan';
import { NAKHONPHANOM_OTOP_PRODUCTS } from './nakhonphanom';
import { NAKHONRATCHASIMA_OTOP_PRODUCTS } from './nakhonratchasima';
import { NONGBUALAMPHU_OTOP_PRODUCTS } from './nongbualamphu';
import { NONGKHAI_OTOP_PRODUCTS } from './nongkhai';
import { ROIET_OTOP_PRODUCTS } from './roiet';
import { SAKONNAKHON_OTOP_PRODUCTS } from './sakonnakhon';
import { SISAKET_OTOP_PRODUCTS } from './sisaket';
import { SURIN_OTOP_PRODUCTS } from './surin';
import { UBONRATCHATHANI_OTOP_PRODUCTS } from './ubonratchathani';
import { UDONTHANI_OTOP_PRODUCTS } from './udonthani';
import { YASOTHON_OTOP_PRODUCTS } from './yasothon';

export {
  AMNATCHAROEN_OTOP_PRODUCTS,
  BUENGKAN_OTOP_PRODUCTS,
  BURIRAM_OTOP_PRODUCTS,
  CHAIYAPHUM_OTOP_PRODUCTS,
  KALASIN_OTOP_PRODUCTS,
  KHONKAEN_OTOP_PRODUCTS,
  LOEI_OTOP_PRODUCTS,
  MAHASARAKHAM_OTOP_PRODUCTS,
  MUKDAHAN_OTOP_PRODUCTS,
  NAKHONPHANOM_OTOP_PRODUCTS,
  NAKHONRATCHASIMA_OTOP_PRODUCTS,
  NONGBUALAMPHU_OTOP_PRODUCTS,
  NONGKHAI_OTOP_PRODUCTS,
  ROIET_OTOP_PRODUCTS,
  SAKONNAKHON_OTOP_PRODUCTS,
  SISAKET_OTOP_PRODUCTS,
  SURIN_OTOP_PRODUCTS,
  UBONRATCHATHANI_OTOP_PRODUCTS,
  UDONTHANI_OTOP_PRODUCTS,
  YASOTHON_OTOP_PRODUCTS,
};

export const ALL_OTOP_PRODUCTS: OtopProduct[] = [
  ...CHAIYAPHUM_OTOP_PRODUCTS,
  ...KHONKAEN_OTOP_PRODUCTS,
  ...BURIRAM_OTOP_PRODUCTS,
  ...SURIN_OTOP_PRODUCTS,
  ...SISAKET_OTOP_PRODUCTS,
  ...NAKHONRATCHASIMA_OTOP_PRODUCTS,
  ...ROIET_OTOP_PRODUCTS,
  ...MAHASARAKHAM_OTOP_PRODUCTS,
  ...KALASIN_OTOP_PRODUCTS,
  ...SAKONNAKHON_OTOP_PRODUCTS,
  ...NAKHONPHANOM_OTOP_PRODUCTS,
  ...MUKDAHAN_OTOP_PRODUCTS,
  ...YASOTHON_OTOP_PRODUCTS,
  ...AMNATCHAROEN_OTOP_PRODUCTS,
  ...UBONRATCHATHANI_OTOP_PRODUCTS,
  ...UDONTHANI_OTOP_PRODUCTS,
  ...NONGKHAI_OTOP_PRODUCTS,
  ...BUENGKAN_OTOP_PRODUCTS,
  ...LOEI_OTOP_PRODUCTS,
  ...NONGBUALAMPHU_OTOP_PRODUCTS,
];

export function getOtopProductsByProvince(provinceId: string): OtopProduct[] {
  return ALL_OTOP_PRODUCTS.filter((product) => product.provinceId === provinceId);
}

export function getOtopProductById(productId: string): OtopProduct | undefined {
  return ALL_OTOP_PRODUCTS.find((product) => product.id === productId);
}
