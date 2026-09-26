import { interpretSemanticTurn, emptySemanticContext, type SemanticContext, type SemanticTurn } from '../netlify/functions/_semantic-interpreter';

type Case = {
  id:string;
  message:string;
  context?:SemanticContext;
  expect:{
    domain?:SemanticTurn['domain'];
    speechAct?:NonNullable<SemanticTurn['speechAct']>;
    action?:SemanticTurn['action'];
    constraint?:string;
    needsClarification?:boolean;
  };
};

const ctxRestaurant:SemanticContext={
  ...emptySemanticContext(),
  activeDomain:'restaurant',
  rollingSummary:'customer constraints in restaurant: no_spicy, no_shrimp.',
  recentTurns:[
    {role:'user',content:'ไม่เผ็ดแล้วก็ไม่เอากุ้ง'},
    {role:'assistant',content:'รับทราบครับ'},
  ],
};

const ctxHorse:SemanticContext={
  ...emptySemanticContext(),
  activeDomain:'activity',
  activeTopic:'horse',
  recentEntities:[
    {id:'activity_asset:horse-01',type:'activity_asset',name:'ภาราดร',domain:'activity',source:'catalog',canonical:true},
    {id:'activity_asset:horse-02',type:'activity_asset',name:'ทองไทย',domain:'activity',source:'catalog',canonical:true},
  ],
  recentTurns:[
    {role:'assistant',content:'มีม้า 2 ตัว ภาราดร และ ทองไทย'},
  ],
};

const cases:Case[]=[
  {id:'open-lost-wallet-1',message:'เมื่อวานน่าจะทำกระเป๋าตังหล่นแถวร้านอะ ช่วยดูให้หน่อย',expect:{domain:'incident',speechAct:'incident_report'}},
  {id:'open-lost-item-typo',message:'กะเป๋าตังหาย น่าจะลืมไว้ตอนมะวาน',expect:{domain:'incident',speechAct:'incident_report'}},
  {id:'open-lost-pet',message:'เมื่อวานพาแมวมาแล้วตอนนี้หาไม่เจอ น่าจะหลุดแถวนั้น',expect:{domain:'incident',speechAct:'incident_report'}},
  {id:'open-nearby-cat',message:'แถวร้านมีแมวส้มเดินอยู่บ้างปะ',expect:{domain:'local',speechAct:'question'}},
  {id:'open-local-observation',message:'เมื่อวานเห็นแมวอยู่หน้าร้าน วันนี้ยังอยู่แถวนั้นไหม',expect:{domain:'local',speechAct:'question'}},
  {id:'restaurant-no-pork-1',message:'หมูก็ไม่เอาด้วย',context:ctxRestaurant,expect:{domain:'restaurant',speechAct:'preference_update',action:'provide_information',constraint:'no_pork'}},
  {id:'restaurant-no-pork-2',message:'หมูขอผ่านด้วยนะ',context:ctxRestaurant,expect:{domain:'restaurant',speechAct:'preference_update',constraint:'no_pork'}},
  {id:'restaurant-no-pork-3',message:'ของผมไม่หมูนะ',context:ctxRestaurant,expect:{domain:'restaurant',speechAct:'preference_update',constraint:'no_pork'}},
  {id:'horse-reference',message:'เอาตัวนั้น',context:{...ctxHorse,recentEntities:[ctxHorse.recentEntities[0]!] },expect:{domain:'activity',speechAct:'selection'}},
  {id:'horse-compare',message:'สองตัวนี้ตัวไหนเหมาะกับคนไม่เคยขี่',context:ctxHorse,expect:{domain:'activity',action:'compare'}},
  {id:'open-help',message:'ของหายอะ ไม่รู้หล่นตรงไหน',expect:{domain:'incident'}},
  {id:'open-plain-general',message:'แฟนผมเหนื่อยมาก ขอพักก่อนแป๊บนึง',expect:{domain:'general',speechAct:'statement'}},
];

async function main():Promise<void>{
  let pass=0;
  const failures:Array<Record<string,unknown>>=[];

  for(const item of cases){
    try{
      const turn=await interpretSemanticTurn(item.message,item.context??emptySemanticContext());
      const checks=[
        item.expect.domain===undefined||turn.domain===item.expect.domain,
        item.expect.speechAct===undefined||turn.speechAct===item.expect.speechAct,
        item.expect.action===undefined||turn.action===item.expect.action,
        item.expect.constraint===undefined||turn.constraints.includes(item.expect.constraint),
        item.expect.needsClarification===undefined||turn.needsClarification===item.expect.needsClarification,
      ];

      if(checks.every(Boolean)){
        pass+=1;
      }else{
        failures.push({
          id:item.id,
          message:item.message,
          expected:item.expect,
          actual:{
            normalizedMeaning:turn.normalizedMeaning,
            domain:turn.domain,
            speechAct:turn.speechAct,
            action:turn.action,
            constraints:turn.constraints,
            confidence:turn.confidence,
            needsClarification:turn.needsClarification,
          },
        });
      }
    }catch(error){
      failures.push({id:item.id,message:item.message,error:error instanceof Error?error.message:String(error)});
    }
  }

  const total=cases.length;
  const passPct=total?Math.round(pass/total*10000)/100:0;
  console.log(JSON.stringify({
    kind:'PHASE1_OPEN_WORLD_LIVE_LANGUAGE_ACCEPTANCE',
    total,
    pass,
    failed:failures.length,
    passPct,
    primaryModel:process.env.THONGTHAI_SEMANTIC_MODEL||'gpt-5.6-terra',
    reviewModel:process.env.THONGTHAI_SEMANTIC_REVIEW_MODEL||'gpt-5.6-sol',
    failures,
  },null,2));

  if(failures.length) process.exitCode=1;
}

main().catch(error=>{
  console.error('PHASE1_OPEN_WORLD_LIVE_LANGUAGE_ACCEPTANCE_CRASH',error instanceof Error?error.message:String(error));
  process.exitCode=1;
});
