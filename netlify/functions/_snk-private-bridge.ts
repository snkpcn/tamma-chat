import { createHash } from 'node:crypto';
export type BridgeLineEvent = { type?: string; source?: { type?: string; groupId?: string; roomId?: string }; message?: { type?: string; text?: string } };
export type PrivateProbe = { ok: true; statuses: Array<{ index: number; status: 'NONE' | 'PENDING' | 'ACTIVE'; system?: string }> };
export type PrivateDispatch = { ok: true; handledIndexes: number[] };
const channelId = (event: BridgeLineEvent) => event.source?.type === 'room' ? event.source.roomId : event.source?.groupId;
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
): Promise<Set<number>> {
  const handled = new Set<number>();
  const groups: Array<{ item: T; index: number; id: string }> = [];
  for (const [index,item] of events.entries()) {
    const id=channelId(item);
    if (!['group','room'].includes(item.source?.type ?? '') || !id) continue;
    if (await isBusinessBound(id)) continue;
    groups.push({ item,index,id });
  }
  if (!groups.length) return handled;
  const result=await probe(groups.map(group=>group.id));
  if (result.ok !== true || !Array.isArray(result.statuses) || result.statuses.length !== groups.length) throw new Error('private_route_probe_incomplete');
  const candidates: Array<{ item:T; index:number }> = [];
  for (const [position,group] of groups.entries()) {
    const entry=result.statuses[position];
    if (entry?.index !== position || !['ACTIVE','PENDING','NONE'].includes(entry.status)) throw new Error('private_route_probe_invalid');
    const explicitBusinessBind=group.item.message?.type==='text' && /^ผูกทีม\s+/u.test(group.item.message.text?.trim() ?? '');
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
