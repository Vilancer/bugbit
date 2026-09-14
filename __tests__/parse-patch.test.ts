type HunkLine = { type: string; oldLine?: number; newLine?: number; content: string };
type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: HunkLine[];
};

let parseUnifiedPatch: (patch: string) => Hunk[];
let buildLineMap: (files: Array<{ path: string; status: string; hunks?: Hunk[] }>) => Map<string, Set<number>>;
let mapGitHubStatus: (status: string) => string;
let mapPullRequestFiles: (
  fileList: Array<{
    filename: string;
    status: string;
    previous_filename?: string;
    patch?: string;
  }>,
) => Array<{ path: string; status: string; previous_filename?: string; hunks?: Hunk[] }>;
let buildSizedDiff: (
  files: Array<Record<string, unknown>>,
  limit?: number,
) => { diffMode: string; files: Array<Record<string, unknown>> };

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../scripts/lib/parse-patch.mjs');
  parseUnifiedPatch = mod.parseUnifiedPatch;
  buildLineMap = mod.buildLineMap;
  mapGitHubStatus = mod.mapGitHubStatus;
  mapPullRequestFiles = mod.mapPullRequestFiles;
  buildSizedDiff = mod.buildSizedDiff;
});

describe('parseUnifiedPatch', () => {
  it('parses single-hunk patch with correct oldStart and newStart', () => {
    const patch = [
      '@@ -10,3 +10,4 @@',
      ' context line',
      '+added line',
      ' another context',
    ].join('\n');

    const hunks = parseUnifiedPatch(patch);

    expect(hunks).toHaveLength(1);
    expect(hunks[0].oldStart).toBe(10);
    expect(hunks[0].newStart).toBe(10);
    expect(hunks[0].lines).toEqual([
      { type: 'context', oldLine: 10, newLine: 10, content: 'context line' },
      { type: 'add', newLine: 11, content: 'added line' },
      { type: 'context', oldLine: 11, newLine: 12, content: 'another context' },
    ]);
  });
});

describe('buildLineMap', () => {
  it('includes context and add lines and excludes delete-only new lines', () => {
    const files = [
      {
        path: 'src/example.ts',
        status: 'modified',
        hunks: [
          {
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 3,
            lines: [
              { type: 'context', oldLine: 1, newLine: 1, content: ' keep' },
              { type: 'delete', oldLine: 2, content: 'remove' },
              { type: 'add', newLine: 2, content: 'insert' },
            ],
          },
        ],
      },
    ];

    const lineMap = buildLineMap(files);
    const lines = lineMap.get('src/example.ts');

    expect(lines).toBeDefined();
    expect(lines?.has(1)).toBe(true);
    expect(lines?.has(2)).toBe(true);
    expect(lines?.size).toBe(2);
  });

  it('skips deleted files', () => {
    const files = [{ path: 'src/removed.ts', status: 'deleted' }];
    const lineMap = buildLineMap(files);

    expect(lineMap.has('src/removed.ts')).toBe(false);
  });
});

describe('mapGitHubStatus', () => {
  it('maps removed to deleted and passes through other statuses', () => {
    expect(mapGitHubStatus('removed')).toBe('deleted');
    expect(mapGitHubStatus('added')).toBe('added');
    expect(mapGitHubStatus('modified')).toBe('modified');
    expect(mapGitHubStatus('renamed')).toBe('renamed');
  });
});

describe('mapPullRequestFiles', () => {
  it('maps deleted files without hunks', () => {
    const files = mapPullRequestFiles([
      { filename: 'src/removed.ts', status: 'removed' },
    ]);

    expect(files).toEqual([{ path: 'src/removed.ts', status: 'deleted' }]);
  });

  it('includes previous_filename for renamed files', () => {
    const files = mapPullRequestFiles([
      {
        filename: 'src/new-name.ts',
        status: 'renamed',
        previous_filename: 'src/old-name.ts',
        patch: '@@ -1 +1 @@\n-old\n+new',
      },
    ]);

    expect(files[0]).toMatchObject({
      path: 'src/new-name.ts',
      status: 'renamed',
      previous_filename: 'src/old-name.ts',
    });
    expect(files[0].hunks).toHaveLength(1);
  });

  it('uses empty hunks when patch is missing', () => {
    const files = mapPullRequestFiles([
      { filename: 'src/large.ts', status: 'modified' },
    ]);

    expect(files).toEqual([
      { path: 'src/large.ts', status: 'modified', hunks: [] },
    ]);
  });
});

describe('buildSizedDiff', () => {
  it('keeps full hunks when under the size limit', () => {
    const files = mapPullRequestFiles([
      {
        filename: 'src/a.ts',
        status: 'modified',
        patch: '@@ -1 +1 @@\n-old\n+new',
      },
    ]);

    const result = buildSizedDiff(files, 10_000);
    expect(result.diffMode).toBe('full');
    expect(result.files[0].hunks).toBeDefined();
  });

  it('falls back to hunk_ranges then paths_only when over the limit', () => {
    const files = mapPullRequestFiles(
      Array.from({ length: 8 }, (_, i) => ({
        filename: `src/f${i}.ts`,
        status: 'modified',
        patch: `@@ -1,20 +1,20 @@\n${' context\n'.repeat(10)}+added line ${i}\n`,
      })),
    );

    const hunkRanges = buildSizedDiff(files, 900);
    expect(hunkRanges.diffMode).toBe('hunk_ranges');
    expect((hunkRanges.files[0] as { hunks?: unknown[] }).hunks?.[0]).not.toHaveProperty('lines');

    const pathsOnly = buildSizedDiff(files, 200);
    expect(pathsOnly.diffMode).toBe('paths_only');
    expect(pathsOnly.files[0]).not.toHaveProperty('hunks');
    expect(pathsOnly.files).toHaveLength(8);
  });
});
