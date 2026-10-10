/** Action inputs that carry credentials; GitHub exposes each input as INPUT_<NAME> in the env. */
const SECRET_INPUTS = ['github-token', 'cursor-api-key', 'claude-code-oauth-token', 'anthropic-api-key'];

/** Actions runtime credentials only the artifact upload needs. */
const RUNTIME_VARS = ['ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL'];

function inputEnvName(name: string): string {
  return `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
}

/**
 * Removes credentials from process.env after bugbit has read its inputs, so agents (the Cursor SDK
 * runs tools with this process's env) can't read them. Returns a helper that puts the Actions
 * runtime token back only for the duration of an artifact upload.
 */
export function scrubSecretEnv(env: NodeJS.ProcessEnv = process.env): <T>(fn: () => Promise<T>) => Promise<T> {
  for (const name of SECRET_INPUTS) {
    delete env[inputEnvName(name)];
  }
  const runtime: Record<string, string> = {};
  for (const name of RUNTIME_VARS) {
    if (env[name] !== undefined) {
      runtime[name] = env[name]!;
      delete env[name];
    }
  }
  return async (fn) => {
    Object.assign(env, runtime);
    try {
      return await fn();
    } finally {
      for (const name of Object.keys(runtime)) delete env[name];
    }
  };
}
