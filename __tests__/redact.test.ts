import { githubTokenForms, redactSecrets } from '../src/github/redact';

describe('redactSecrets', () => {
  it('replaces known secrets and token shapes in nested values, leaving other data alone', () => {
    const input = {
      findings: [{ line: 3, body: 'token my-plain-secret and ghs_' + 'a'.repeat(36) }],
      title: 'key sk-ant-api03-' + 'b'.repeat(40) + ' and crsr_' + 'c'.repeat(40),
    };
    expect(redactSecrets(input, ['my-plain-secret'])).toEqual({
      findings: [{ line: 3, body: 'token [redacted] and [redacted]' }],
      title: 'key [redacted] and [redacted]',
    });
  });
});

describe('githubTokenForms', () => {
  it('includes the basic-auth header actions/checkout persists', () => {
    expect(githubTokenForms('ghs_abc')).toEqual([
      'ghs_abc',
      Buffer.from('x-access-token:ghs_abc').toString('base64'),
    ]);
    expect(githubTokenForms('')).toEqual([]);
  });
});
