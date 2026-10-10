import type { ClaudeAuth } from '../agent/claudeAgent';

export type Provider = 'cursor' | 'claude';

export function parseProvider(input: string): Provider {
  const provider = (input || 'cursor').trim().toLowerCase();
  if (provider === 'cursor' || provider === 'claude') {
    return provider;
  }
  throw new Error(`Unknown provider: ${input}. Allowed: cursor, claude`);
}

/** claude-code-oauth-token (from `claude setup-token`) wins over anthropic-api-key. */
export function resolveClaudeAuth(oauthToken: string, apiKey: string): ClaudeAuth {
  if (oauthToken) {
    return { kind: 'oauth-token', token: oauthToken };
  }
  if (apiKey) {
    return { kind: 'api-key', key: apiKey };
  }
  throw new Error(
    'provider: claude needs claude-code-oauth-token (run `claude setup-token`) or anthropic-api-key.',
  );
}
