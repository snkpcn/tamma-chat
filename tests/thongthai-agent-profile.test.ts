import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THONGTHAI_AGENT_INSTRUCTIONS,
  THONGTHAI_AGENT_PROFILE_VERSION,
  THONGTHAI_STAGING_AGENT_NAME,
  THONGTHAI_PRODUCTION_AGENT_NAME,
  thongthaiStagingAgentConfig,
  thongthaiProductionAgentConfig,
} from '../netlify/functions/_thongthai-agent-profile';

test('Thongthai staging agent profile locks the owner-defined identity and trust rules', () => {
  assert.equal(THONGTHAI_STAGING_AGENT_NAME, 'Thongthai-Staging');
  assert.match(THONGTHAI_AGENT_PROFILE_VERSION, /^thongthai-agent-profile-v4-prepare-final-/);

  const prompt = THONGTHAI_AGENT_INSTRUCTIONS;
  assert.match(prompt, /You are male\./);
  assert.match(prompt, /"ครับ"/u);
  assert.match(prompt, /Never use "ค่ะ" or "คะ"/u);
  assert.match(prompt, /Isan person in character/i);
  assert.match(prompt, /any language/i);
  assert.match(prompt, /playful/i);
  assert.match(prompt, /Genuine and trustworthy/i);
  assert.match(prompt, /Never invent prices, availability, inventory/i);
  assert.match(prompt, /Never claim a booking, order, payment, refund, notification, cancellation/i);
  assert.match(prompt, /Conversation and transaction are different/i);
  assert.match(prompt, /does not erase the prepared draft/i);
  assert.match(prompt, /get_prepared_\*/i);
  assert.match(prompt, /staff_notified=true/i);
  assert.match(prompt, /delivery is not yet confirmed/i);
  assert.match(prompt, /allergy and dietary constraints seriously/i);
});

test('Thongthai saved-agent config contains stable identity only and stays staging-scoped', () => {
  const config = thongthaiStagingAgentConfig('test-model');
  assert.equal(config.name, 'Thongthai-Staging');
  assert.equal(config.model, 'test-model');
  assert.equal(config.metadata.app, 'thammachat');
  assert.equal(config.metadata.role, 'thongthai');
  assert.equal(config.metadata.environment, 'staging');
  assert.equal(config.metadata.profile_version, THONGTHAI_AGENT_PROFILE_VERSION);

  // Mutable business truth belongs in backoffice/tools, not the saved persona.
  assert.doesNotMatch(config.instructions, /30 นาที\s*=\s*300|45 นาที\s*=\s*500|6 villas|15 Nov/i);
});


test('Thongthai production Agent is separate and prepare-only before live commit cutover', () => {
  const staging = thongthaiStagingAgentConfig('test-model');
  const production = thongthaiProductionAgentConfig('test-model');

  assert.equal(THONGTHAI_PRODUCTION_AGENT_NAME, 'Thongthai-Production');
  assert.equal(production.name, 'Thongthai-Production');
  assert.equal(production.metadata.environment, 'production');
  assert.equal(production.model, 'test-model');
  assert.ok(production.tools.length > 0);
  assert.ok(production.tools.some(tool => /^prepare_/.test(tool.name)));
  assert.ok(production.tools.some(tool => /^get_prepared_/.test(tool.name)));
  assert.ok(production.tools.every(tool => !/^commit_prepared_/.test(tool.name)));
  assert.ok(staging.tools.some(tool => /^commit_prepared_/.test(tool.name)));
  assert.match(production.instructions, /If no matching commit tool is available/i);
  assert.match(production.instructions, /call the matching prepare tool directly/i);
  assert.match(production.instructions, /copy that phrase verbatim/i);
  assert.match(production.instructions, /call the matching get_prepared_\* tool/i);
  assert.match(production.instructions, /nothing has been sent\/created/i);
});
