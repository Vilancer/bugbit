import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildClaudeSkillPrompt,
  buildSkillPrompt,
  parseReviewLevel,
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

  it('deduplicates aliases that map to the same mode', () => {
    expect(parseReviewModes('review-bugbot, bugbot, code-review')).toEqual(['code-review']);
    expect(parseReviewModes('security-review, review-security')).toEqual(['security-review']);
  });

  it('does not treat Object.prototype keys as aliases', () => {
    expect(parseReviewModes('constructor')).toEqual(['constructor']);
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

    expect(modes).toEqual(['code-review']);
    expect(prompt.startsWith('/review-bugbot\n\n')).toBe(true);
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
    expect(prompt).toContain('untrusted author text');
  });
});

describe('parseReviewLevel', () => {
  it('accepts the /code-review levels and empty', () => {
    expect(parseReviewLevel('')).toBeUndefined();
    expect(parseReviewLevel('XHigh')).toBe('xhigh');
  });

  it('rejects unknown levels', () => {
    expect(() => parseReviewLevel('extreme')).toThrow('Unknown review-level: extreme');
  });
});

describe('buildClaudeSkillPrompt', () => {
  function claudePromptsDir(): string {
    const promptsDir = makePromptsDir();
    fs.writeFileSync(path.join(promptsDir, 'claude-system.md'), 'Claude overlay at {{GITHUB_ACTION_PATH}}');
    return promptsDir;
  }

  it('lists Claude skills in order and passes the level to code-review only', () => {
    const result = buildClaudeSkillPrompt(
      'code-review,security-review,simplify',
      claudePromptsDir(),
      '/action',
      { context: { number: 1 } },
      'high',
    );

    expect(result.systemPromptAppend).toBe('Claude overlay at /action');
    expect(result.prompt).toContain('1. Invoke the `code-review` skill with args "high"');
    expect(result.prompt).toContain('2. Invoke the `security-review` skill (findings use mode "security-review")');
    expect(result.prompt).toContain('3. Invoke the `simplify` skill (findings use mode "simplify")');
    expect(result.prompt).toContain('<prefetched_pr_data>');
    expect(result.prompt).not.toContain('/review-bugbot');
  });

  it('omits args when no level is set', () => {
    const result = buildClaudeSkillPrompt('bugbot', claudePromptsDir(), '/action');
    expect(result.prompt).toContain('1. Invoke the `code-review` skill (findings use mode "code-review")');
  });
});
