import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildSkillPrompt,
  parseReviewModes,
  validateReviewModes,
} from '../src/prompts/reviewModes';

function makePromptsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bugbit-prompts-'));
  const promptsDir = path.join(dir, 'prompts');
  fs.mkdirSync(promptsDir);

  fs.writeFileSync(
    path.join(promptsDir, 'system.md'),
    'System uses get_pr_context tool at {{GITHUB_ACTION_PATH}}',
  );

  return promptsDir;
}

describe('parseReviewModes', () => {
  it('parses comma-separated modes', () => {
    expect(parseReviewModes('code-review, security-review')).toEqual([
      'code-review',
      'security-review',
    ]);
  });

  it('canonicalizes Cursor skill aliases', () => {
    expect(parseReviewModes('review-bugbot, review-security, simplify')).toEqual([
      'code-review',
      'security-review',
      'simplify',
    ]);
  });
});

describe('validateReviewModes', () => {
  it('throws on unknown mode', () => {
    expect(() => validateReviewModes(['bogus'])).toThrow('Unknown review mode: bogus');
  });

  it('throws when no modes are provided', () => {
    expect(() => validateReviewModes([])).toThrow(
      'review-modes must include at least one mode',
    );
  });
});

describe('buildSkillPrompt', () => {
  it('returns prompt and parsed modes', () => {
    const promptsDir = makePromptsDir();
    const actionPath = path.dirname(promptsDir);

    const { prompt, modes } = buildSkillPrompt('code-review, security-review', promptsDir, actionPath);

    expect(modes).toEqual(['code-review', 'security-review']);
    expect(prompt.startsWith('/review-bugbot\n/review-security\n\n')).toBe(true);
    expect(prompt).toContain(actionPath);
    expect(prompt).toContain('get_pr_context tool');
  });

  it('maps review-bugbot aliases to code-review and /review-bugbot', () => {
    const promptsDir = makePromptsDir();
    const actionPath = path.dirname(promptsDir);

    const { prompt, modes } = buildSkillPrompt('review-bugbot, bugbot', promptsDir, actionPath);

    expect(modes).toEqual(['code-review', 'code-review']);
    expect(prompt.startsWith('/review-bugbot\n/review-bugbot\n\n')).toBe(true);
  });

  it('injects /simplify for simplify mode', () => {
    const promptsDir = makePromptsDir();
    const actionPath = path.dirname(promptsDir);

    const { prompt } = buildSkillPrompt('simplify', promptsDir, actionPath);

    expect(prompt.startsWith('/simplify\n\n')).toBe(true);
  });

  it('appends prefetched PR data when provided', () => {
    const promptsDir = makePromptsDir();
    const actionPath = path.dirname(promptsDir);

    const { prompt } = buildSkillPrompt('code-review', promptsDir, actionPath, {
      context: { number: 1 },
      diff: { files: [{ path: 'a.ts' }] },
    });

    expect(prompt).toContain('<prefetched_pr_data>');
    expect(prompt).toContain('"number": 1');
    expect(prompt).toContain('You MUST call post_review before finishing');
  });
});
