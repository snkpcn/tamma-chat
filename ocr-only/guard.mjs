// Netlify BRANCH is a checkout ref; HEAD is the Git provider's source branch.
// Existing deploy 6acb31b57b9914000887d083 log L5: pull/617/head.
// https://docs.netlify.com/build/configure-builds/environment-variables/#git-metadata
export const approvedPreview = Object.freeze({
  siteId:'8c1f4d60-68c9-4940-9152-89e9c967e22c',
  head:'codex/ocr-only-preview-once',
  reviewId:'617',
  checkoutRef:'pull/617/head',
});

export function preflight(env) {
  const populated=Object.entries(env).filter(([,value])=>Boolean(value));
  const checks={
    netlify:env.NETLIFY==='true',
    deployPreview:env.CONTEXT==='deploy-preview',
    site:env.SITE_ID===approvedPreview.siteId,
    pullRequest:env.PULL_REQUEST==='true',
    review:env.REVIEW_ID===approvedPreview.reviewId,
    head:env.HEAD===approvedPreview.head,
    checkoutRef:env.BRANCH===approvedPreview.checkoutRef,
    databaseCredentialsAbsent:!populated.some(([key])=>
      (/^SUPABASE_/i.test(key)&&key!=='SUPABASE_URL')
      ||/^(DATABASE(?:_|$)|POSTGRES(?:QL)?(?:_|$)|DB_|PGPASSWORD$|PGPASSFILE$|PGSERVICEFILE$|PGSERVICE$|PGHOST$|PGUSER$|PGDATABASE$)/i.test(key)),
    lineCredentialsAbsent:!populated.some(([key])=>/^LINE_/i.test(key)),
    otherProviderCredentialsAbsent:!populated.some(([key])=>
      /^(OPENAI_|GOOGLE_API_KEY$|FACEBOOK_APP_SECRET$|FACEBOOK_PAGE_ACCESS_TOKEN$)/i.test(key)),
    geminiPresent:Boolean(env.GEMINI_API_KEY),
  };
  const failures=[
    ['netlify','BLOCKED_NOT_NETLIFY'],['deployPreview','BLOCKED_CONTEXT'],
    ['site','BLOCKED_SITE'],['pullRequest','BLOCKED_NOT_PR'],
    ['review','BLOCKED_REVIEW'],['head','BLOCKED_HEAD'],
    ['checkoutRef','BLOCKED_CHECKOUT_REF'],
    ['databaseCredentialsAbsent','BLOCKED_DATABASE_CREDENTIALS'],
    ['lineCredentialsAbsent','BLOCKED_LINE_CREDENTIALS'],
    ['otherProviderCredentialsAbsent','BLOCKED_OTHER_PROVIDER_CREDENTIALS'],
    ['geminiPresent','BLOCKED_MISSING_GEMINI'],
  ];
  // Only hardcoded labels and booleans leave this function, never env values.
  return {status:failures.find(([key])=>!checks[key])?.[1]||'READY',checks};
}

export function ocrChildEnvironment(env) {
  // Build-system credentials, proxies, DB URLs and Node hooks cannot reach OCR.
  return {GEMINI_API_KEY:env.GEMINI_API_KEY};
}
