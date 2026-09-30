export type OtopProvince = {
  provinceId: string;
  provinceName: string;
  region: 'อีสาน';
  mapLabel: string;
  heroTitle: string;
  heroSubtitle: string;
  heroImage: string;
  heroProductImage?: string;
  productCount: number;
  isActive: boolean;
  sortOrder: number;
};

export type OtopProduct = {
  id: string;
  provinceId: string;
  provinceName: string;

  productName: string;
  originPlace: string;
  makerName?: string;
  makerType: string;
  category: string;

  coreValue: string;
  craftProcess: string;
  materialOrIngredient: string;
  whyHere: string;
  shortDescription: string;
  longStory?: string;
  imageCaption: string;
  storyKeywords: string[];

  image: string;
  gallery: string[];

  price: number | null;
  unit: string;
  availableForSale: boolean;
  stockStatus: 'story-only' | 'in-stock' | 'out-of-stock' | 'preorder';

  shippingType: 'parcel' | 'cold-chain' | 'pickup-only' | 'not-available';
  requiresColdChain: boolean;
  shelfLife: string | null;

  lineNotifyGroup?: string;
  sourceConfidence: 'high' | 'medium' | 'needs-confirmation';
  publicClaimSafe: boolean;
  needsOwnerConfirmation: string[];
};
