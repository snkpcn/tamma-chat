import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyServiceFeedback } from '../netlify/functions/_service-mind-feedback-intent';
import {
  composeIncidentResponse,
  composeSafetyIssueResponse,
} from '../netlify/functions/_service-mind-feedback-response';

test('missing child is an urgent incident, not a generic lost-property case', () => {
  const match=classifyServiceFeedback('ลูกหาย หาไม่เจอครับ');
  assert.ok(match);
  assert.equal(match?.feedbackType,'incident');
  assert.equal(match?.severity,'urgent');
  assert.ok(match?.issueKeywords.includes('missing_person'));
  const response=composeIncidentResponse(match!,true,[{team:'owner_general',status:'sent'}]);
  assert.match(response,/คนพลัดหลง/u);
  assert.match(response,/191/u);
  assert.doesNotMatch(response,/ของหาย/u);
});

test('food illness opens a high incident with immediate care guidance', () => {
  const match=classifyServiceFeedback('กินอาหารแล้วอาเจียนกับท้องเสียครับ');
  assert.ok(match);
  assert.equal(match?.feedbackType,'incident');
  assert.equal(match?.severity,'high');
  assert.ok(match?.issueKeywords.includes('food_illness'));
  const response=composeIncidentResponse(match!,true,[{team:'restaurant',status:'sent'},{team:'owner_general',status:'sent'}]);
  assert.match(response,/หยุดรับประทาน/u);
  assert.match(response,/ทีมร้านอาหารและเจ้าของ/u);
});

test('urgent physical safety response prioritizes immediate action and emergency contact', () => {
  const match=classifyServiceFeedback('มีคนบาดเจ็บเลือดออกหลังทำกิจกรรมครับ');
  assert.ok(match);
  assert.equal(match?.feedbackType,'safety_issue');
  assert.equal(match?.severity,'urgent');
  const response=composeSafetyIssueResponse(match!,true,[{team:'activity',status:'sent'},{team:'owner_general',status:'sent'}]);
  assert.match(response,/หยุดกิจกรรม/u);
  assert.match(response,/1669/u);
  assert.doesNotMatch(response,/สภาพพื้นจริง/u);
  assert.doesNotMatch(response,/🚨|🙏|😊/u);
});
