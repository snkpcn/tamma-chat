export type BotQualitySignal = {
  eventType: 'phrase' | 'demand' | 'risk';
  category: string;
  domain: 'system';
};

export type BotQualityEvaluationInput = {
  customerMessage: string;
  assistantMessage: string;
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
};

export function evaluateBotQualitySignals(_input: BotQualityEvaluationInput): BotQualitySignal[] {
  return [];
}
