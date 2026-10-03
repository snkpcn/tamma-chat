# WW-3 — Multilingual Storefront

Status: implementation
Date: 2026-10-03

## Goal

Turn the existing five-language public site into one coherent storefront locale system that can scale to additional certified market locales later without coupling language to country, currency, payment, shipping, or checkout.

WW-3 does not add a new language by guessing translations. The currently certified public languages remain:

- Thai — `th / th-TH`
- English — `en / en-US`
- Chinese — `zh / zh-CN`
- Lao — `lo / lo-LA`
- Vietnamese — `vi / vi-VN`

New languages must be added with complete copy/content certification, not by machine-filling production strings implicitly.

## Global Locale Kernel

All six public surfaces load `assets/scripts/global-locale.js`:

- home
- OTOP map
- OTOP store
- restaurant menu
- account
- chess

The kernel owns:

- one canonical storage key: `thammachat-lang-v1`
- current supported languages
- browser locale normalization
- `navigator.languages` preference order
- `?lang=<locale>` deep-link language
- cross-tab storage synchronization
- BCP47 browser locale output
- one global locale-change event
- fallback policy

Existing page dictionaries remain in their current files. WW-3 changes the resolver, not the already-certified copy.

## Fallback policy

### Thai surface

`th → key`

Thai remains the domestic source language.

### Non-Thai surface

`requested language → English → key`

The runtime must not silently fall back from a non-Thai UI to Thai copy.

This closes the prior risk where an English/Chinese/Lao/Vietnamese surface could show an untranslated Thai fragment if one dictionary key was missing.

For OTOP structured product/province translations, English is merged before the requested non-Thai translation so missing fields use English rather than the Thai source record.

## Browser locale resolution

Examples:

- `en-US` → `en`
- `zh-Hant-TW` → `zh`
- `lo_LA` → `lo`
- unsupported `sv-SE` → current market/default locale

The kernel uses all values in `navigator.languages`, not only the first browser language.

A valid `?lang=` parameter is treated as explicit customer intent and persisted to the same cross-surface preference.

## Commerce separation

Language is presentation state only.

Changing language must never:

- change country
- change market
- change transaction currency
- select a payment provider
- change shipping eligibility
- authorize checkout

WW-1 continues to own market/currency configuration. WW-2 continues to own destination address. Later phases explicitly connect those layers.

## Current production behavior

WW-3 is a backward-compatible runtime consolidation:

- the same five language options remain visible
- the same translation dictionaries remain authoritative
- the same storage key remains valid
- existing saved language preferences continue to work
- no customer data migration is required
- no database DDL is required

The WW-0 `storefront` capability remains reserved for future country/market activation. This refactor does not silently launch a new market or language.

## Definition of Done

- [x] Shared browser Locale Kernel implemented.
- [x] All six public surfaces load it.
- [x] Home/account/menu/OTOP/chess language engines consume it.
- [x] Browser full locale tags normalize deterministically.
- [x] `?lang=` deep-link preference supported.
- [x] Non-Thai UI fallback is English-first.
- [x] OTOP structured content fallback is English-first.
- [x] Language remains independent from country/currency/checkout.
- [x] Existing five-language copy dictionaries remain intact.
- [ ] Existing five-language production certification still passes unchanged.
- [ ] WW-3 audit passes.
- [ ] Full repository CI passes.
- [ ] Production deploy on merged main is ready.
- [ ] WW flags remain deliberately controlled after deploy.
