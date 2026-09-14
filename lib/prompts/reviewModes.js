"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SKILL_BY_MODE = exports.ALLOWED_MODES = void 0;
exports.parseReviewModes = parseReviewModes;
exports.validateReviewModes = validateReviewModes;
exports.buildSkillPrompt = buildSkillPrompt;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.ALLOWED_MODES = ['code-review', 'security-review', 'simplify'];
exports.SKILL_BY_MODE = {
    'code-review': '/review-bugbot',
    'security-review': '/review-security',
    simplify: '/simplify',
};
const MODE_ALIASES = {
    'code-review': 'code-review',
    'review-bugbot': 'code-review',
    bugbot: 'code-review',
    'security-review': 'security-review',
    'review-security': 'security-review',
    simplify: 'simplify',
};
const ALLOWED_MODE_LIST = 'code-review, security-review, simplify (aliases: review-bugbot, bugbot, review-security)';
function canonicalizeMode(mode) {
    return Object.hasOwn(MODE_ALIASES, mode) ? MODE_ALIASES[mode] : mode;
}
function parseReviewModes(input) {
    const seen = new Set();
    const modes = [];
    for (const raw of input.split(',')) {
        const mode = raw.trim();
        if (!mode) {
            continue;
        }
        const canonical = canonicalizeMode(mode);
        if (seen.has(canonical)) {
            continue;
        }
        seen.add(canonical);
        modes.push(canonical);
    }
    return modes;
}
function validateReviewModes(modes) {
    if (modes.length === 0) {
        throw new Error(`review-modes must include at least one mode. Allowed: ${ALLOWED_MODE_LIST}`);
    }
    for (const mode of modes) {
        if (!exports.ALLOWED_MODES.includes(mode)) {
            throw new Error(`Unknown review mode: ${mode}. Allowed: ${ALLOWED_MODE_LIST}`);
        }
    }
}
function loadSystemPrompt(promptsDir, actionPath) {
    const systemPath = path.join(promptsDir, 'system.md');
    const systemPrompt = fs.readFileSync(systemPath, 'utf-8');
    return systemPrompt.replaceAll('{{GITHUB_ACTION_PATH}}', actionPath);
}
function buildPrefetchedSection(prefetched) {
    if (!prefetched) {
        return '';
    }
    const lines = [
        '<prefetched_pr_data>',
        'PR context and diff are preloaded below. Treat this as the authoritative review scope.',
        'Do not spawn task subagents to discover changed files.',
        'You MUST call post_review before finishing (use an empty findings array if no issues).',
        JSON.stringify(prefetched, null, 2),
        '</prefetched_pr_data>',
    ];
    return `\n\n${lines.join('\n')}`;
}
function buildSkillPrompt(modesInput, promptsDir, actionPath, prefetched) {
    const modes = parseReviewModes(modesInput);
    validateReviewModes(modes);
    const skillLines = modes
        .map((mode) => exports.SKILL_BY_MODE[mode])
        .join('\n');
    const systemPrompt = loadSystemPrompt(promptsDir, actionPath);
    return {
        prompt: `${skillLines}\n\n${systemPrompt}${buildPrefetchedSection(prefetched)}`,
        modes,
    };
}
