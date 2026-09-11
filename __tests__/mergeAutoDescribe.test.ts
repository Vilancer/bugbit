let AUTO_DESCRIBE_END: string;
let AUTO_DESCRIBE_START: string;
let mergeAutoDescribeBody: (existingBody: string, generatedBody: string) => string;
let stripAutoDescribeSection: (text: string) => string;
let hasAutoDescribeSection: (text: string) => boolean;

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../scripts/lib/operations.mjs');
  AUTO_DESCRIBE_END = mod.AUTO_DESCRIBE_END;
  AUTO_DESCRIBE_START = mod.AUTO_DESCRIBE_START;
  mergeAutoDescribeBody = mod.mergeAutoDescribeBody;
  stripAutoDescribeSection = mod.stripAutoDescribeSection;
  hasAutoDescribeSection = mod.hasAutoDescribeSection;
});

const generated = `### PR Type
Feature

### Description
- Adds widget`;

describe('mergeAutoDescribeBody', () => {
  it('appends auto-describe after author body', () => {
    const merged = mergeAutoDescribeBody('## My notes\nPlease review', generated);
    expect(merged).toContain('## My notes\nPlease review');
    expect(merged).toContain(AUTO_DESCRIBE_START);
    expect(merged).toContain('### PR Type');
    expect(merged).toContain(AUTO_DESCRIBE_END);
    expect(merged.indexOf('## My notes')).toBeLessThan(merged.indexOf(AUTO_DESCRIBE_START));
  });

  it('replaces prior auto-describe on re-run without duplicating author text', () => {
    const first = mergeAutoDescribeBody('Author text', generated);
    const second = mergeAutoDescribeBody(first, '### PR Type\nBug Fix\n\n### Description\n- Fix');
    expect(second.match(/Author text/g)).toHaveLength(1);
    expect(second).toContain('Bug Fix');
    expect(second).not.toContain('Adds widget');
    expect(second.match(new RegExp(AUTO_DESCRIBE_START, 'g'))).toHaveLength(1);
  });

  it('uses only auto-describe when author body is empty', () => {
    const merged = mergeAutoDescribeBody('', generated);
    expect(merged.startsWith(AUTO_DESCRIBE_START)).toBe(true);
    expect(merged.endsWith(AUTO_DESCRIBE_END)).toBe(true);
  });

  it('stripAutoDescribeSection removes the marked block', () => {
    const full = `Keep me\n\n${AUTO_DESCRIBE_START}\n### PR Type\nFeature\n${AUTO_DESCRIBE_END}`;
    expect(stripAutoDescribeSection(full)).toBe('Keep me');
  });

  it('hasAutoDescribeSection detects existing markers', () => {
    expect(hasAutoDescribeSection('plain')).toBe(false);
    expect(
      hasAutoDescribeSection(`${AUTO_DESCRIBE_START}\nx\n${AUTO_DESCRIBE_END}`),
    ).toBe(true);
  });
});
