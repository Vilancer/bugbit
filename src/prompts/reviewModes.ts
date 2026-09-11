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

function canonicalizeMode(mode: string): string {
  return Object.hasOwn(MODE_ALIASES, mode) ? MODE_ALIASES[mode] : mode;
}

export function parseReviewModes(input: string): string[] {
  const seen = new Set<string>();
  const modes: string[] = [];
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
    'Use title and body as author intent; prefer high-impact findings over micro-nits.',
    'When diffMode is hunk_ranges or paths_only, read files for targeted context; still scope comments to changed paths/lines.',
    'Do not spawn task subagents to discover changed files.',
    'You MUST call post_review before finishing (use an empty findings array if no issues).',
    'On large diffs, cover multiple risk areas in one batch.',
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

function loadDescribePrompt(promptsDir: string, actionPath: string): string {
  const describePath = path.join(promptsDir, 'describe.md');
  const template = fs.readFileSync(describePath, 'utf-8');
  return template.replaceAll('{{GITHUB_ACTION_PATH}}', actionPath);
}

function buildDescribePrefetchedSection(prefetched?: PrefetchedPrData): string {
  if (!prefetched) {
    return '';
  }

  const lines = [
    '<prefetched_pr_data>',
    'PR context and diff are preloaded below. Treat this as the authoritative scope for the description.',
    'Use title and existing body as author intent; do not contradict the stated objective.',
    'Pass ONLY the auto-describe section to update_pr_description — never rewrite or include the author body; the tool appends after it.',
    'When diffMode is hunk_ranges or paths_only, use file paths and diff stats to build the File Walkthrough; read files only if needed.',
    'Do NOT call post_review in describe mode. Do NOT spawn subagents.',
    'You MUST call update_pr_description before finishing. Then call set_pr_labels with inferred type + review-effort labels.',
    JSON.stringify(prefetched, null, 2),
    '</prefetched_pr_data>',
  ];

  return `\n\n${lines.join('\n')}`;
}

export interface DescribePromptResult {
  prompt: string;
}

export function buildDescribePrompt(
  promptsDir: string,
  actionPath: string,
  prefetched?: PrefetchedPrData,
): DescribePromptResult {
  const describeTemplate = loadDescribePrompt(promptsDir, actionPath);
  return {
    prompt: `${describeTemplate}${buildDescribePrefetchedSection(prefetched)}`,
  };
}
