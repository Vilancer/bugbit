"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseProvider = parseProvider;
exports.resolveClaudeAuth = resolveClaudeAuth;
function parseProvider(input) {
    const provider = (input || 'cursor').trim().toLowerCase();
    if (provider === 'cursor' || provider === 'claude') {
        return provider;
    }
    throw new Error(`Unknown provider: ${input}. Allowed: cursor, claude`);
}
/** claude-code-oauth-token (from `claude setup-token`) wins over anthropic-api-key. */
function resolveClaudeAuth(oauthToken, apiKey) {
    if (oauthToken) {
        return { kind: 'oauth-token', token: oauthToken };
    }
    if (apiKey) {
        return { kind: 'api-key', key: apiKey };
    }
    throw new Error('provider: claude needs claude-code-oauth-token (run `claude setup-token`) or anthropic-api-key.');
}
