import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('../index.html', import.meta.url);
let html = await readFile(file, 'utf8');

const marker = '/* CHAT_COPY_POLISH_V1 */';
if (html.includes(marker)) {
  console.log('CHAT_COPY_POLISH_ALREADY_APPLIED');
  process.exit(0);
}

const chatBodyBefore = '.chat-body{ flex:1; overflow-y:auto; padding:14px 18px; display:flex; flex-direction:column; gap:10px; }';
const chatBodyAfter = '.chat-body{ flex:1; overflow-y:auto; overflow-x:hidden; padding:14px 18px; display:flex; flex-direction:column; gap:10px; min-width:0; }';
const turnBefore = '.turn-bot{ display:flex; align-items:flex-start; gap:9px; max-width:92%; align-self:flex-start; }';
const turnAfter = '.turn-bot{ display:flex; align-items:flex-start; gap:9px; max-width:92%; min-width:0; align-self:flex-start; }';
const msgBefore = '.msg{ padding:11px 15px; border-radius:16px; font-size:13.8px; line-height:1.6; max-width:100%; }';
const msgAfter = '.msg{ padding:11px 15px; border-radius:16px; font-size:13.8px; line-height:1.68; max-width:100%; min-width:0; white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; }';

for (const [before, after, label] of [
  [chatBodyBefore, chatBodyAfter, 'chat-body'],
  [turnBefore, turnAfter, 'turn-bot'],
  [msgBefore, msgAfter, 'msg'],
]) {
  if (!html.includes(before)) throw new Error(`CHAT_COPY_POLISH_MISSING_SELECTOR:${label}`);
  html = html.replace(before, `${marker}\n${after}`);
}

await writeFile(file, html, 'utf8');
console.log('CHAT_COPY_POLISH_APPLIED');
