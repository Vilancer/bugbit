import * as fs from 'fs';
import * as path from 'path';

describe('action.yml', () => {
  it('keeps the description under the Marketplace 125-character limit', () => {
    const yml = fs.readFileSync(path.join(__dirname, '..', 'action.yml'), 'utf8');
    const match = yml.match(/^description:\s*'([^']*)'\s*$/m);
    expect(match).not.toBeNull();
    expect(match![1].length).toBeLessThan(125);
  });
});
