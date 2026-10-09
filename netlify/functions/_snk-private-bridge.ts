import { createHash } from 'node:crypto';
export type BridgeLineEvent = { type?: string; source?: { type?: string; groupId?: string; roomId?: string }; message?: { type?: string; text?: string } };
export type PrivateProbe = { ok: true; statuses: Array<{ index: number; status: 'NONE' | 'PENDING' | 'ACTIVE'; system?: string }> };
export type PrivateDispatch = { ok: true; handledIndexes: number[] };
const channelId = (event: BridgeLineEvent) => event.source?.type === 'room' ? event.source.roomId : event.source?.groupId;
const groupHash = (id: string) => createHash('sha256').update(id.trim().toLowerCase(), 'utf8').digest('hex');
const isBusinessBindingCommand = (event: BridgeLineEvent) => event.message?.type === 'text'
  && /^ผูกทีม\s+/u.test(event.message.text?.trim() ?? '');

/** Runtime-only retirement metadata. Never put real group hashes in source control. */
function disconnectedRouting(env: Record<string, string | undefined>) {
  const disabled = /^(0|false|off|no)$/i.test((env.SNK_OS_PRIVATE_TRANSPORT_ENABLED ?? '1').trim());
  const hashes = (env.SNK_OS_RETIRED_GROUP_HASHES ?? '').trim().split(/[,\s]+/u).filter(Boolean);
  // Missing/malformed retirement metadata fails closed for new group binding,
  // rather than letting a previously personal conversation enter business logs.
  const configured = hashes.length > 0 && hashes.every(hash => /^[a-f0-9]{64}$/i.test(hash));
  return { disabled, configured, retired: new Set(hashes.map(hash => hash.toLowerCase())) };
}
function isBindingCommand(event: BridgeLineEvent): boolean {
  const text = event.message?.type === 'text' ? event.message.text?.trim() ?? '' : '';
  return /^(?:SNK-\d{6,8}|(?:ยืนยันกลุ่มการเงิน|ยืนยัน\s*กลุ่ม\s*snk\s*money|ผูก(?:กลุ่ม)?\s*snk\s*money|ยืนยัน\s*snk\s*money)\s*SNK-\d{6,8})$/iu.test(text);
}
/** Domain metadata only. Business groups never send their content or query SNK records. */
export async function routePrivateOpsEvents<T extends BridgeLineEvent>(
  events: T[],
  probe: (groupIds: string[]) => Promise<PrivateProbe>,
  isBusinessBound: (groupId: string) => Promise<boolean>,
  dispatch: (events: T[]) => Promise<PrivateDispatch>,
  log: (name: string, data: Record<string, unknown>) => void = () => undefined,
  env: Record<string, string | undefined> = process.env,
): Promise<Set<number>> {
  const handled = new Set<number>();
  const disconnected = disconnectedRouting(env);
  const groups: Array<{ item: T; index: number; id: string }> = [];
  for (const [index,item] of events.entries()) {
    const id=channelId(item);
    if (!['group','room'].includes(item.source?.type ?? '') || !id) continue;
    if (await isBusinessBound(id)) continue;
    if (disconnected.disabled) {
      // Established business routes retain precedence. Other groups never reach
      // SNK while disconnected. Only a new, non-retired group's explicit business
      // binding command may continue into the existing authorization handler.
      if (disconnected.configured && !disconnected.retired.has(groupHash(id)) && isBusinessBindingCommand(item)) continue;
      handled.add(index);
      log('SNK_PRIVATE_TRANSPORT_DISABLED', { system: 'disconnected', retirementConfigured: disconnected.configured });
      continue;
    }
    groups.push({ item,index,id });
  }
  if (!groups.length) return handled;
  const result=await probe(groups.map(group=>group.id));
  if (result.ok !== true || !Array.isArray(result.statuses) || result.statuses.length !== groups.length) throw new Error('private_route_probe_incomplete');
  const candidates: Array<{ item:T; index:number }> = [];
  for (const [position,group] of groups.entries()) {
    const entry=result.statuses[position];
    if (entry?.index !== position || !['ACTIVE','PENDING','NONE'].includes(entry.status)) throw new Error('private_route_probe_invalid');
    const explicitBusinessBind=isBusinessBindingCommand(group.item);
    if (entry.status==='NONE' && explicitBusinessBind) continue;
    if (entry.status==='ACTIVE' || entry.status==='PENDING' || isBindingCommand(group.item)) {
      candidates.push(group);
    } else {
      // Consume unconfigured groups without guessing a domain or storing their conversation.
      handled.add(group.index);
      log('LINE_GROUP_UNCONFIGURED',{ groupHash:createHash('sha256').update(group.id.trim().toLowerCase()).digest('hex'), system:'unconfigured' });
    }
  }
  if (!candidates.length) return handled;
  const response=await dispatch(candidates.map(candidate=>candidate.item));
  if (response.ok !== true || !Array.isArray(response.handledIndexes)) throw new Error('private_route_dispatch_incomplete');
  for (const index of response.handledIndexes) {
    if (!Number.isInteger(index) || !candidates[index]) throw new Error('private_route_dispatch_invalid');
    handled.add(candidates[index].index);
  }
  // A known personal channel can never fall through to a business handler, even while paused.
  if (candidates.some(candidate=>!handled.has(candidate.index))) throw new Error('private_event_not_consumed');
  return handled;
}

