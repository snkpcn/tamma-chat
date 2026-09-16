from pathlib import Path

# ------------------------------------------------------------------
# Brain: live restaurant menu + preorder tools
# ------------------------------------------------------------------
p=Path('netlify/functions/_thongthai-brain-v3.ts')
s=p.read_text()
s=s.replace("  | 'create_cafe_inquiry' | 'list_otop_products' | 'create_otop_order';", "  | 'create_cafe_inquiry' | 'list_otop_products' | 'create_otop_order'\n  | 'list_restaurant_menu' | 'create_restaurant_preorder';")
s=s.replace("  'list_booking_options','create_booking','create_cafe_inquiry','list_otop_products','create_otop_order',", "  'list_booking_options','create_booking','create_cafe_inquiry','list_otop_products','create_otop_order',\n  'list_restaurant_menu','create_restaurant_preorder',")
old="""- Activity booking is inventory-backed. The verified world facts contain the current real catalog, prices and active inventory. Never invent them.\n"""
new="""- Restaurant MENU source of truth is verified world fact `restaurant_menu_live`, backed by tamma_chart_os menu + recipes + live stock. For food/menu/price/ingredient/availability questions, use ONLY this live source. Never rely on an old poster, memory, or invented dish. If `orderable=false`, say the dish is temporarily unavailable and, when useful, name the unavailable ingredient. The customer menu page is the `menuUrl` in that fact.\n- Restaurant PREORDER is different from a restaurant/table booking. For food ordered ahead, collect exact menu items + quantity, pickup date, pickup time, customer name, and contact if the channel itself is not reachable. Then use create_restaurant_preorder. A successful preorder is REQUESTED until staff accepts it in the restaurant LINE group. Never claim staff accepted it before the tool result says so.\n- Activity booking is inventory-backed. The verified world facts contain the current real catalog, prices and active inventory. Never invent them.\n"""
if old not in s: raise SystemExit('brain operations marker missing')
s=s.replace(old,new,1)
old="""5. create_otop_order {sku, quantity, customerName?, phone?, email?, fulfillmentType?, shippingAddress?, note?} — create a REAL requested order after explicit choice.\n6. save_journey {}, favorite_experience {experienceId}, unfavorite_experience {experienceId}, mark_visited {experienceId}, request_handoff {reasonCode} keep their prior meanings.\n"""
new="""5. create_otop_order {sku, quantity, customerName?, phone?, email?, fulfillmentType?, shippingAddress?, note?} — create a REAL requested order after explicit choice.\n6. list_restaurant_menu {} — read the current real ตำมา-ชาติ menu, prices, ingredients and live availability from the restaurant source of truth. Use it when a fresh explicit menu lookup is helpful.\n7. create_restaurant_preorder {date, time, items:[{name,quantity}], customerName, phone?, email?, note?} — create a REAL food preorder request. Item names must come from the live menu. Date/time is the requested food pickup time in Asia/Bangkok.\n8. save_journey {}, favorite_experience {experienceId}, unfavorite_experience {experienceId}, mark_visited {experienceId}, request_handoff {reasonCode} keep their prior meanings.\n"""
if old not in s: raise SystemExit('brain tool docs marker missing')
s=s.replace(old,new,1)
marker="""    if (name === 'create_cafe_inquiry') {\n"""
insert="""    if (name === 'list_restaurant_menu') { calls.push({ name, args: {} }); continue; }\n    if (name === 'create_restaurant_preorder') {\n      const date = dateString(args.date); const time = timeString(args.time);\n      const customerName = safeString(args.customerName,120);\n      const rawItems = Array.isArray(args.items) ? args.items : [];\n      const items = rawItems.slice(0,20).map(item => item && typeof item === 'object' ? item as Record<string,unknown> : {})\n        .map(item => ({ name:safeString(item.name,160), quantity:safeNumber(item.quantity,1,50) ?? 1 }))\n        .filter((item): item is {name:string;quantity:number} => Boolean(item.name));\n      if (!date || !time || !customerName || !items.length) continue;\n      calls.push({ name, args: { date,time,items,customerName,\n        ...(safeString(args.phone,30) ? {phone:safeString(args.phone,30)} : {}),\n        ...(safeString(args.email,160) ? {email:safeString(args.email,160)} : {}),\n        ...(safeString(args.note,1000) ? {note:safeString(args.note,1000)} : {}),\n      }}); continue;\n    }\n"""+marker
if marker not in s: raise SystemExit('brain normalize marker missing')
s=s.replace(marker,insert,1)
p.write_text(s)

# ------------------------------------------------------------------
# Runtime: load menu facts + execute preorder tools
# ------------------------------------------------------------------
p=Path('netlify/functions/_thongthai-runtime-v3.ts')
s=p.read_text()
needle="""import {\n  createBooking, createCafeInquiry, createOtopOrder, listBookingOptions, listOtopProducts,\n  type OpsChannel, type ServiceType,\n} from './_operations-db';\n"""
repl=needle+"import { createRestaurantPreorder, listRestaurantMenu, loadRestaurantWorldFacts } from './_restaurant-sot';\n"
if needle not in s: raise SystemExit('runtime imports marker missing')
s=s.replace(needle,repl,1)
old="""    const worldPromise = Promise.all([\n    dbFetch('world_facts?active=eq.true&verified=eq.true&select=fact_key,category,fact_value,source,updated_at&order=fact_key.asc').then(r => r.json() as Promise<WorldFactRow[]>),\n    loadActivityWorldFacts(),\n  ]).then(([baseFacts, activityFacts]) => [...baseFacts, ...activityFacts]);\n"""
new="""    const worldPromise = Promise.all([\n    dbFetch('world_facts?active=eq.true&verified=eq.true&select=fact_key,category,fact_value,source,updated_at&order=fact_key.asc').then(r => r.json() as Promise<WorldFactRow[]>),\n    loadActivityWorldFacts(),\n    loadRestaurantWorldFacts(),\n  ]).then(([baseFacts, activityFacts, restaurantFacts]) => [...baseFacts, ...activityFacts, ...restaurantFacts]);\n"""
if old not in s: raise SystemExit('runtime world marker missing')
s=s.replace(old,new,1)
s=s.replace("  if (message.includes('insufficient_stock')) return 'insufficient_stock';", "  if (message.includes('insufficient_stock')) return 'insufficient_stock';\n  if (message.includes('menu_item_not_found')) return 'menu_item_not_found';\n  if (message.includes('menu_item_unavailable')) return 'menu_item_unavailable';\n  if (message.includes('invalid_requested_time')) return 'invalid_requested_time';")
marker="""      if (call.name === 'create_cafe_inquiry') {\n"""
insert="""      if (call.name === 'list_restaurant_menu') {\n        const menu = await listRestaurantMenu();\n        results.push({name:call.name,ok:true,detail:JSON.stringify({menuUrl:'https://tamma-chat.netlify.app/menu.html',items:menu.map(item=>({name:item.name,category:item.category_name,price:item.selling_price,orderable:item.is_orderable,availableServings:item.available_servings,ingredients:item.ingredient_names,unavailableIngredients:item.unavailable_ingredients}))})});\n        continue;\n      }\n      if (call.name === 'create_restaurant_preorder') {\n        try {\n          const created = await createRestaurantPreorder({\n            guestDbId, channel:provider(channel), date:String(call.args.date ?? ''), time:String(call.args.time ?? ''),\n            items:Array.isArray(call.args.items) ? call.args.items as Array<{name:string;quantity:number}> : [],\n            customerName:String(call.args.customerName ?? ''),\n            phone:typeof call.args.phone==='string' ? call.args.phone : null,\n            email:typeof call.args.email==='string' ? call.args.email : null,\n            note:typeof call.args.note==='string' ? call.args.note : null,\n          });\n          await insertEvent(guestDbId,'agent_action','order',{action:'create_restaurant_preorder',preorderCode:created.preorderCode,channel});\n          results.push({name:call.name,ok:true,detail:JSON.stringify(created)});\n        } catch(error) { results.push({name:call.name,ok:false,detail:toolErrorDetail(error)}); }\n        continue;\n      }\n"""+marker
if marker not in s: raise SystemExit('runtime execute marker missing')
s=s.replace(marker,insert,1)
p.write_text(s)

# ------------------------------------------------------------------
# LINE: restaurant stock text + preorder staff postbacks
# ------------------------------------------------------------------
p=Path('netlify/functions/line-webhook.ts')
s=p.read_text()
needle="""import { handleStaffBookingPostback, type LineMessage } from './_ops-line-ui';\n"""
repl=needle+"import { handleRestaurantPreorderPostback, handleRestaurantStockText } from './_restaurant-sot';\n"
if needle not in s: raise SystemExit('line import marker missing')
s=s.replace(needle,repl,1)
old="""  if (event.type === 'postback' && typeof event.postback?.data === 'string') {\n    const messages = await handleStaffBookingPostback({\n"""
new="""  if (event.type === 'postback' && typeof event.postback?.data === 'string') {\n    const preorderMessages = await handleRestaurantPreorderPostback({ targetId, data: event.postback.data });\n    if (preorderMessages?.length) {\n      await replyToLine(event.replyToken, preorderMessages as LineMessage[], accessToken);\n      return;\n    }\n    const messages = await handleStaffBookingPostback({\n"""
if old not in s: raise SystemExit('line postback marker missing')
s=s.replace(old,new,1)
marker="""  const reply = await handleLineOpsGroupMessage({\n"""
insert="""  const restaurantStockReply = await handleRestaurantStockText({ targetId, text: event.message.text });\n  if (restaurantStockReply) {\n    await replyToLine(event.replyToken, restaurantStockReply, accessToken);\n    return;\n  }\n\n"""+marker
if marker not in s: raise SystemExit('line text marker missing')
s=s.replace(marker,insert,1)
p.write_text(s)
