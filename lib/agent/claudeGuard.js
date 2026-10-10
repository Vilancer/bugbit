"use strict";
/**
 * PreToolUse guard for the Claude review session. Permission rules match command prefixes only,
 * so `Bash(git diff:*)` would also approve `git diff --output=README.md` and `Read` would open
 * `.git/config` (where actions/checkout@v4 persists the token). This checks arguments and paths.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitCommand = splitCommand;
exports.checkToolUse = checkToolUse;
exports.reviewGuardHooks = reviewGuardHooks;
/** git subcommands the review may run; each is read-only once the flags below are refused. */
const READ_ONLY_GIT = new Set(['diff', 'log', 'show', 'blame', 'status', 'rev-parse', 'ls-files', 'merge-base']);
/** Flags that write files, read outside the repo, or run external programs. */
const REFUSED_GIT_FLAG = /^(--output(=|$)|--no-index$|--ext-diff$|--textconv$|--contents(=|$))/;
const SHELL_META = /[;&|<>`$()\n\\]/;
/** Paths whose contents are credentials (or can expose them) on a GitHub runner. */
const SECRET_PATH = /(^|\/)(\.env(\..*)?|\.git-credentials|\.netrc|\.npmrc|id_(rsa|ecdsa|ed25519)[^/]*|[^/]+\.(pem|key|p12|pfx))$|(^|\/)\.git\/config$|^\/proc(\/|$)/;
/** Splits a command into words, honouring simple single/double quotes (no expansion). */
function splitCommand(command) {
    const word = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;
    if (command.replace(word, '').trim())
        return undefined; // a stray, unbalanced quote
    return (command.match(word) ?? []).map((w) => w.replace(/"([^"]*)"|'([^']*)'/g, '$1$2'));
}
function checkBash(command) {
    if (SHELL_META.test(command)) {
        return 'Only a single plain git command is allowed (no pipes, redirects, chaining or substitution).';
    }
    const argv = splitCommand(command.trim());
    if (!argv || argv[0] !== 'git' || !READ_ONLY_GIT.has(argv[1] ?? '')) {
        return `Only read-only git commands are allowed: git ${[...READ_ONLY_GIT].join(' | ')}.`;
    }
    const refused = argv.slice(2).find((arg) => REFUSED_GIT_FLAG.test(arg));
    if (refused) {
        return `git flag ${refused} is not allowed in review (it writes files or reads outside the repo).`;
    }
    return undefined;
}
function isSecretPath(value, runnerTemp) {
    if (typeof value !== 'string' || !value)
        return false;
    const normalized = value.replace(/\/+$/, '');
    return SECRET_PATH.test(normalized) || (!!runnerTemp && normalized.startsWith(runnerTemp));
}
/** Returns why a tool call must be refused, or undefined to let normal permissions decide. */
function checkToolUse(toolName, input, runnerTemp = process.env.RUNNER_TEMP) {
    if (toolName === 'Bash') {
        return checkBash(String(input.command ?? ''));
    }
    if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob') {
        const target = [input.file_path, input.path, input.pattern, input.glob].find((value) => isSecretPath(value, runnerTemp));
        if (target !== undefined) {
            return `Reading ${String(target)} is not allowed: it can contain credentials.`;
        }
    }
    return undefined;
}
/** SDK hook config: refuse guarded tool calls before permissions run (also covers subagents). */
function reviewGuardHooks() {
    return {
        PreToolUse: [
            {
                matcher: 'Bash|Read|Grep|Glob',
                hooks: [
                    async (input) => {
                        const reason = checkToolUse(String(input.tool_name ?? ''), (input.tool_input ?? {}));
                        return reason
                            ? {
                                hookSpecificOutput: {
                                    hookEventName: 'PreToolUse',
                                    permissionDecision: 'deny',
                                    permissionDecisionReason: reason,
                                },
                            }
                            : {};
                    },
                ],
            },
        ],
    };
}
