import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const wrapper=page.slice(page.indexOf('let chatRequestPending = false;'),page.indexOf('async function performUserMessage(text)'));

test('web keeps one turn in flight and releases input on success or failure',async()=>{
  let release:()=>void=()=>{};
  let reject:(error:Error)=>void=()=>{};
  const messages:string[]=[];
  const send={disabled:false};
  const input={readOnly:false};
  const quickWrap={inert:false};
  const context=vm.createContext({input,quickWrap,qs:()=>send,performUserMessage:(message:string)=>{
    messages.push(message);
    return new Promise<void>((resolve,fail)=>{release=resolve;reject=fail;});
  }});
  vm.runInContext(wrapper,context);
  const first=vm.runInContext('handleUserMessage("แนะนำเมนูสำหรับเด็กหน่อย")',context);
  await vm.runInContext('handleUserMessage("มีงบ1000 ไปกินสามคนสั่งอะไรกินดี")',context);
  assert.equal(messages.length,1);
  assert.ok(send.disabled && input.readOnly && quickWrap.inert);
  release();
  await first;
  assert.ok(!send.disabled && !input.readOnly && !quickWrap.inert);
  const next=vm.runInContext('handleUserMessage("มีงบ1000 ไปกินสามคนสั่งอะไรกินดี")',context);
  reject(new Error('transport unavailable'));
  await assert.rejects(next,/transport unavailable/);
  assert.equal(messages.length,2);
  assert.ok(!send.disabled && !input.readOnly && !quickWrap.inert);
});

test('all inline website scripts still parse',()=>{
  for(const match of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gu)) {
    if(match[0].includes('application/ld+json'))continue;
    new vm.Script(match[1]);
  }
});
