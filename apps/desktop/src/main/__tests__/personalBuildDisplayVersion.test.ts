import { describe, expect, it } from 'vitest';
import { personalBuildDisplayVersion } from '../personalBuildDisplayVersion';

const commit = 'a'.repeat(40);
const metadata = { schemaVersion: 1, managedBy: 'local-release-follower', upstreamVersion: '0.1.110', sourceCommit: commit };

describe('personal build display version', () => {
  it('shows the actual upstream version with a personal suffix', () => {
    expect(personalBuildDisplayVersion('0.0.0', metadata, commit)).toEqual({ display: '0.1.110-personal', detail: '0.1.110-personal · aaaaaaa' });
  });
  it('follows the next upstream version from build metadata', () => {
    expect(personalBuildDisplayVersion('0.0.0', { ...metadata, upstreamVersion: '0.1.111' }, commit)?.display).toBe('0.1.111-personal');
  });
  it('does not override an official release identity', () => {
    expect(personalBuildDisplayVersion('0.1.110', metadata, commit)).toBeNull();
  });
  it.each([
    null, {}, { ...metadata, schemaVersion: 2 }, { ...metadata, managedBy: 'other' },
    { ...metadata, upstreamVersion: 'v0.1.110' }, { ...metadata, upstreamVersion: '0.1.111-beta' },
    { ...metadata, sourceCommit: 'bad' },
  ])('falls back on absent or malformed metadata: %j', (value) => {
    expect(personalBuildDisplayVersion('0.0.0', value, commit)).toBeNull();
  });
  it('rejects metadata copied from a different source build', () => {
    expect(personalBuildDisplayVersion('0.0.0', metadata, 'b'.repeat(40))).toBeNull();
  });
});
