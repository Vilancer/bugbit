import * as fs from 'fs';
import * as path from 'path';
import type { PrefetchedPrData } from '../github/types';

export const ALLOWED_MODES = ['code-review', 'security-review', 'simplify'] as const;
export type ReviewMode = (typeof ALLOWED_MODES)[number];

export const SKILL_BY_MODE: Record<ReviewMode, string> = {
  'code-review': '/review-bugbot',
  'security-review': '/review-security',
  simplify: '/simplify',
};

const MODE_ALIASES: Record<string, ReviewMode> = {
  'code-review': 'code-review',
  'review-bugbot': 'code-review',
  bugbot: 'code-review',
  'security-review': 'security-review',
  'review-security': 'security-review',
  simplify: 'simplify',
};

const ALLOWED_MODE_LIST =
  'code-review, security-review, simplify (aliases: review-bugbot, bugbot, review-security)';

export function parseReviewModes(input: string): string[] {
  return input
    .split(',')
    .map((mode) => mode.trim())
    .filter(Boolean)
    .map((mode) => MODE_ALIASES[mode] ?? mode);
}

export function validateReviewModes(modes: string[]): void {
  if (modes.length === 0) {
    throw new Error(
      `review-modes must include at least one mode. Allowed: ${ALLOWED_MODE_LIST}`,
    );
  }

  for (const mode of modes) {
    if (!(ALLOWED_MODES as readonly string[]).includes(mode)) {
      throw new Error(
        `Unknown review mode: ${mode}. Allowed: ${ALLOWED_MODE_LIST}`,
      );
    }
  }
}

function loadSystemPrompt(promptsDir: string, actionPath: string): string {
  const systemPath = path.join(promptsDir, 'system.md');
  const systemPrompt = fs.readFileSync(systemPath, 'utf-8');
  return systemPrompt.replaceAll('{{GITHUB_ACTION_PATH}}', actionPath);
}

function buildPrefetchedSection(prefetched?: PrefetchedPrData): string {
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

export interface SkillPromptResult {
  prompt: string;
  modes: string[];
}

export function buildSkillPrompt(
  modesInput: string,
  promptsDir: string,
  actionPath: string,
  prefetched?: PrefetchedPrData,
): SkillPromptResult {
  const modes = parseReviewModes(modesInput);
  validateReviewModes(modes);

  const skillLines = modes
    .map((mode) => SKILL_BY_MODE[mode as ReviewMode])
    .join('\n');
  const systemPrompt = loadSystemPrompt(promptsDir, actionPath);

  return {
    prompt: `${skillLines}\n\n${systemPrompt}${buildPrefetchedSection(prefetched)}`,
    modes,
  };
}
