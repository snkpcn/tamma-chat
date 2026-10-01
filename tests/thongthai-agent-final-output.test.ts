import test from 'node:test';
import assert from 'node:assert/strict';
import { finalAssistantTextFromItems } from '../netlify/functions/_thongthai-agent-session';

test('Agent customer output uses only the final assistant message in a tool-using turn', () => {
  const items = [
    {
      type: 'message',
      role: 'assistant',
      turn_id: 'turn-1',
      content: [{ type: 'output_text', text: 'เดี๋ยวผมเช็กให้ครับ' }],
    },
    {
      type: 'message',
      role: 'assistant',
      turn_id: 'turn-1',
      content: [{ type: 'output_text', text: 'น้องภาราดร 45 นาที 500 บาทครับ' }],
    },
  ];
  assert.equal(
    finalAssistantTextFromItems(items, 'turn-1'),
    'น้องภาราดร 45 นาที 500 บาทครับ',
  );
});

test('Agent final-output helper does not cross turn boundaries', () => {
  const items = [
    { type:'message', role:'assistant', turn_id:'old', content:[{ type:'output_text', text:'เก่า' }] },
    { type:'message', role:'assistant', turn_id:'new', content:[{ type:'output_text', text:'ใหม่' }] },
  ];
  assert.equal(finalAssistantTextFromItems(items, 'new'), 'ใหม่');
});
