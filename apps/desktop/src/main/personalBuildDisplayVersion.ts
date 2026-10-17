/** Display identity only. Runtime/updater identity remains app.getVersion(). */
export function personalBuildDisplayVersion(
  runtimeVersion: string,
  metadata: unknown,
  sourceCommit: unknown,
): { display: string; detail: string } | null {
  if (runtimeVersion !== '0.0.0' || !metadata || typeof metadata !== 'object') return null;
  const value = metadata as Record<string, unknown>;
  if (
    value.schemaVersion !== 1 ||
    value.managedBy !== 'local-release-follower' ||
    typeof value.upstreamVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(value.upstreamVersion) ||
    typeof value.sourceCommit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.sourceCommit) ||
    value.sourceCommit !== sourceCommit
  ) return null;
  const display = `${value.upstreamVersion}-personal`;
  return { display, detail: `${display} · ${value.sourceCommit.slice(0, 7)}` };
}
