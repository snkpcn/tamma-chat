export type SemanticMarkerFailure = {
  id:string;
  actual:{
    domain:string;
    action:string;
    informationNeed:string;
    needsClarification:boolean;
    confidence:number;
  };
};

export type SemanticMarkerSummary = {
  evaluated:number;
  pass:number;
  failed:number;
  passPct:number;
  failures:SemanticMarkerFailure[];
};

function token(value:string,max:number):string{
  const normalized=value.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');
  return (normalized || 'x').slice(0,max);
}

export function semanticCertificationMarkerNames(result:SemanticMarkerSummary):string[]{
  const pct=Math.round(result.passPct*100);
  const names=[
    `semcert-s-p${result.pass}-f${result.failed}-t${result.evaluated}-r${pct}`,
  ];

  result.failures.forEach((failure,index)=>{
    names.push([
      `semcert-f${String(index+1).padStart(2,'0')}`,
      token(failure.id,18),
      `d${token(failure.actual.domain,3)}`,
      `a${token(failure.actual.action,4)}`,
      `n${token(failure.actual.informationNeed,4)}`,
      `c${failure.actual.needsClarification?1:0}`,
      `q${Math.max(0,Math.min(100,Math.round(failure.actual.confidence*100)))}`,
    ].join('-'));
  });
  return names;
}
