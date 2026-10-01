import {
  THONGTHAI_STAGING_AGENT_METADATA,
  THONGTHAI_STAGING_AGENT_NAME,
  thongthaiStagingAgentConfig,
} from '../netlify/functions/_thongthai-agent-profile';

type AgentRecord = {
  id: string;
  name?: string | null;
  metadata?: Record<string, string>;
};

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) {
  throw new Error('OPENAI_API_KEY is required to create or update Thongthai-Staging.');
}

const baseUrl = 'https://api.openai.com/v1';
const headers = {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

async function openai<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status} ${path}: ${body.slice(0, 600)}`);
  }
  return body ? JSON.parse(body) as T : ({} as T);
}

async function findExistingAgent(): Promise<AgentRecord | null> {
  let after: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ limit: '100', order: 'desc' });
    if (after) query.set('after', after);
    const result = await openai<{ data?: AgentRecord[]; has_more?: boolean; last_id?: string }>(
      `/agents?${query.toString()}`,
    );
    const agents = result.data ?? [];
    const match = agents.find(agent =>
      agent.name === THONGTHAI_STAGING_AGENT_NAME
      && agent.metadata?.app === THONGTHAI_STAGING_AGENT_METADATA.app
      && agent.metadata?.role === THONGTHAI_STAGING_AGENT_METADATA.role
      && agent.metadata?.environment === THONGTHAI_STAGING_AGENT_METADATA.environment
    );
    if (match) return match;
    if (!result.has_more || !result.last_id) return null;
    after = result.last_id;
  }
  return null;
}

async function main(): Promise<void> {
  const config = thongthaiStagingAgentConfig();
  const existing = await findExistingAgent();

  const agent = existing
    ? await openai<AgentRecord>(`/agents/${existing.id}`, {
        method: 'POST',
        body: JSON.stringify(config),
      })
    : await openai<AgentRecord>('/agents', {
        method: 'POST',
        body: JSON.stringify(config),
      });

  console.log(JSON.stringify({
    action: existing ? 'updated' : 'created',
    agent_id: agent.id,
    name: agent.name,
    model: config.model,
    profile_version: THONGTHAI_STAGING_AGENT_METADATA.profile_version,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
