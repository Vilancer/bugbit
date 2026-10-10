"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactSecrets = redactSecrets;
exports.githubTokenForms = githubTokenForms;
/** Token shapes that must never leave through a PR comment, description, or label. */
const TOKEN_PATTERN = /\b(?:sk-ant-[a-z0-9]+-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|crsr_?[A-Za-z0-9]{30,})/g;
/**
 * Replaces known secrets and token-shaped strings in tool arguments before they reach GitHub.
 * Prompt injection in PR content could get either agent to read a credential; whatever it reads
 * can only leave through bugbit tools, and GitHub masks secrets in logs but not in PR comments.
 */
function redactSecrets(value, secrets) {
    if (typeof value === 'string') {
        let text = value;
        for (const secret of secrets) {
            if (secret)
                text = text.split(secret).join('[redacted]');
        }
        return text.replace(TOKEN_PATTERN, '[redacted]');
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactSecrets(item, secrets));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecrets(item, secrets)]));
    }
    return value;
}
/** Every form of the GitHub token an agent could find: raw, and the basic-auth header checkout persists. */
function githubTokenForms(token) {
    return token ? [token, Buffer.from(`x-access-token:${token}`).toString('base64')] : [];
}
