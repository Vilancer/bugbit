import { parseProvider, resolveClaudeAuth } from '../src/runtime/provider';

describe('parseProvider', () => {
  it('defaults to cursor and accepts claude case-insensitively', () => {
    expect(parseProvider('')).toBe('cursor');
    expect(parseProvider(' Claude ')).toBe('claude');
  });

  it('rejects unknown providers', () => {
    expect(() => parseProvider('codex')).toThrow('Unknown provider: codex');
  });
});

describe('resolveClaudeAuth', () => {
  it('prefers the setup-token OAuth token over the API key', () => {
    expect(resolveClaudeAuth('oat', 'key')).toEqual({ kind: 'oauth-token', token: 'oat' });
    expect(resolveClaudeAuth('', 'key')).toEqual({ kind: 'api-key', key: 'key' });
  });

  it('fails with a setup-token hint when neither is set', () => {
    expect(() => resolveClaudeAuth('', '')).toThrow('claude setup-token');
  });
});
