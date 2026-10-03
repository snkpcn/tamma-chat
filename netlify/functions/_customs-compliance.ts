export const WW7_CUSTOMS_VERSION='ww7-customs-compliance-2026-10-03';

export type CustomsVerificationStatus='draft'|'verified'|'rejected';
export type CustomsDestinationDecision='allowed'|'review_required'|'prohibited';
export type CustomsSnapshotDecision='eligible'|'review_required'|'prohibited';

export type ProductCustomsProfile={
  productId:string;
  originCountryCode:string;
  classificationSystem:string;
  classificationCode:string;
  customsDescription:string;
  verificationStatus:CustomsVerificationStatus;
};

export type DestinationRule={
  productId:string;
  countryCode:string;
  decision:CustomsDestinationDecision;
  status:'draft'|'certification'|'live'|'suspended';
  enabled:boolean;
};

export type ComplianceLine={
  productId:string;
  quantity:number;
  profile:ProductCustomsProfile|null;
  rule:DestinationRule|null;
};

export function normalizeClassificationCode(value:unknown):string|null{
  if(typeof value!=='string')return null;
  const code=value.replace(/\s+/g,'').trim();
  return /^\d{6,12}$/.test(code)?code:null;
}

export function evaluateCustomsCompliance(lines:ComplianceLine[]):{
  decision:CustomsSnapshotDecision;
  reasons:string[];
}{
  if(!Array.isArray(lines)||!lines.length)return{decision:'review_required',reasons:['no_products']};
  const reasons:string[]=[];
  let prohibited=false;
  let review=false;
  for(const line of lines){
    if(!Number.isSafeInteger(line.quantity)||line.quantity<1){
      review=true; reasons.push(`${line.productId}:invalid_quantity`); continue;
    }
    if(!line.profile){
      review=true; reasons.push(`${line.productId}:customs_profile_missing`); continue;
    }
    if(line.profile.verificationStatus!=='verified'){
      review=true; reasons.push(`${line.productId}:customs_profile_not_verified`);
    }
    if(!normalizeClassificationCode(line.profile.classificationCode)){
      review=true; reasons.push(`${line.productId}:classification_invalid`);
    }
    if(!line.rule||!line.rule.enabled||line.rule.status!=='live'){
      review=true; reasons.push(`${line.productId}:destination_rule_not_live`); continue;
    }
    if(line.rule.decision==='prohibited'){
      prohibited=true; reasons.push(`${line.productId}:destination_prohibited`);
    }else if(line.rule.decision!=='allowed'){
      review=true; reasons.push(`${line.productId}:destination_review_required`);
    }
  }
  if(prohibited)return{decision:'prohibited',reasons};
  if(review)return{decision:'review_required',reasons};
  return{decision:'eligible',reasons:[]};
}
