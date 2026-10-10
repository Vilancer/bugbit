import { scrubSecretEnv } from '../src/runtime/secretEnv';

describe('scrubSecretEnv', () => {
  it('removes credential inputs and runtime tokens, keeping other inputs', () => {
    const env: NodeJS.ProcessEnv = {
      'INPUT_GITHUB-TOKEN': 'ghs',
      'INPUT_CURSOR-API-KEY': 'crsr',
      'INPUT_CLAUDE-CODE-OAUTH-TOKEN': 'oat',
      'INPUT_ANTHROPIC-API-KEY': 'api',
      'INPUT_REVIEW-MODES': 'code-review',
      ACTIONS_RUNTIME_TOKEN: 'rt',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'idt',
      PATH: '/usr/bin',
    };
    scrubSecretEnv(env);
    expect(env).toEqual({ 'INPUT_REVIEW-MODES': 'code-review', PATH: '/usr/bin' });
  });

  it('restores the Actions runtime token only while the upload runs', async () => {
    const env: NodeJS.ProcessEnv = { ACTIONS_RUNTIME_TOKEN: 'rt' };
    const withActionsRuntime = scrubSecretEnv(env);

    await expect(withActionsRuntime(async () => env.ACTIONS_RUNTIME_TOKEN)).resolves.toBe('rt');
    expect(env.ACTIONS_RUNTIME_TOKEN).toBeUndefined();

    await expect(
      withActionsRuntime(async () => {
        throw new Error('upload failed');
      }),
    ).rejects.toThrow('upload failed');
    expect(env.ACTIONS_RUNTIME_TOKEN).toBeUndefined();
  });
});
