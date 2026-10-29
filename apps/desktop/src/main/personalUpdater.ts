/** Local release-follower backend for the existing application update UI. */
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { personalBuildDisplayVersion } from './personalBuildDisplayVersion';

export interface PersonalUpdateStatus {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'superseding' | 'error';
  version?: string;
  latestVersion?: string;
  generation?: string;
  relaunching?: boolean;
  preparationError?: boolean;
  discoveryError?: boolean;
  errorCode?: string;
}
interface Context {
  resources: string;
  appPath: string;
  runtimeVersion: string;
  platform: string;
  packaged: boolean;
  development: boolean;
  emit: (status: PersonalUpdateStatus) => void;
  quit: () => void;
  warn: (message: string) => void;
  info?: (message: string) => void;
}

export function locatePersonalUpdater(
  context: Context,
): { root?: string; invalid?: boolean } | null {
  if (!context.packaged || context.development || typeof context.resources !== 'string')
    return null;
  const metadataPath = path.join(context.resources, 'cindy-personal-build.json');
  if (!fs.existsSync(metadataPath)) return null;
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (metadata.managedBy !== 'local-release-follower') return null;
    const source = JSON.parse(
      fs.readFileSync(path.join(context.resources, 'cindy-source.json'), 'utf8'),
    );
    const root = metadata.updater?.root;
    if (
      context.platform !== 'darwin' ||
      !personalBuildDisplayVersion(context.runtimeVersion, metadata, source.sourceCommit) ||
      metadata.updater?.protocolVersion !== 1 ||
      typeof root !== 'string' ||
      !path.isAbsolute(root)
    ) {
      return { invalid: true };
    }
    const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    if (
      config.region !== 'cn' ||
      config.bundleId !== 'com.xd.cindycn' ||
      fs.realpathSync(config.installTarget) !== fs.realpathSync(context.appPath) ||
      !fs.statSync(path.join(root, 'automation', 'controller.py')).isFile()
    )
      return { invalid: true };
    return { root: fs.realpathSync(root) };
  } catch {
    // A malformed local build must never fall through to the official downloader.
    return { invalid: true };
  }
}

export class PersonalUpdater {
  private status: PersonalUpdateStatus = { status: 'idle' };
  private timer?: ReturnType<typeof setInterval>;
  private watcher?: fs.FSWatcher;
  private refreshing = false;
  private restarting = false;
  private disposed = false;
  constructor(
    private context: Context,
    private root?: string,
  ) {
    if (!root) this.status = { status: 'error', errorCode: 'personal_updater_unavailable' };
  }
  snapshot(): PersonalUpdateStatus {
    return { ...this.status };
  }
  private publish(status: PersonalUpdateStatus): void {
    if (this.disposed) return;
    this.status = { ...status, relaunching: this.restarting };
    this.context.emit(this.status);
  }
  private call(command: string, args: string[] = []): Promise<Record<string, unknown>> {
    if (!this.root) return Promise.reject(new Error('personal_updater_unavailable'));
    const controller = path.join(this.root, 'automation', 'controller.py');
    return new Promise((resolve, reject) => {
      execFile(
        '/usr/bin/python3',
        ['-B', controller, '--root', this.root!, command, ...args],
        { timeout: 660_000, maxBuffer: 1024 * 1024, cwd: this.root },
        (error, stdout) => {
          if (error) {
            reject(new Error('personal_controller_failed'));
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error('personal_controller_response'));
          }
        },
      );
    });
  }
  async refresh(): Promise<void> {
    if (!this.root || this.refreshing || this.disposed) return;
    this.refreshing = true;
    try {
      const result = await this.call('status');
      const status = result.update as PersonalUpdateStatus | undefined;
      if (
        !status ||
        !['idle', 'checking', 'downloading', 'ready', 'superseding', 'error'].includes(
          status.status,
        )
      ) {
        throw new Error('personal_controller_response');
      }
      this.publish(status);
    } catch {
      this.publish({ status: 'error', errorCode: 'personal_updater_unavailable' });
    } finally {
      this.refreshing = false;
    }
  }
  start(): void {
    if (!this.root) {
      this.publish(this.status);
      return;
    }
    void this.refresh();
    try {
      this.watcher = fs.watch(path.join(this.root, 'state'), () => {
        void this.refresh();
      });
    } catch {
      this.context.warn('Local update state watcher unavailable; using polling');
    }
    this.timer = setInterval(() => {
      void this.refresh();
    }, 30_000);
    this.timer.unref();
    this.check();
  }
  check(): void {
    if (!this.root || this.disposed) return;
    const child = spawn(
      '/usr/bin/python3',
      ['-B', path.join(this.root, 'automation', 'controller.py'), '--root', this.root, 'check'],
      { cwd: this.root, detached: true, stdio: 'ignore' },
    );
    child.on('error', () =>
      this.publish({ status: 'error', errorCode: 'personal_updater_unavailable' }),
    );
    child.unref();
  }
  async checkNow(): Promise<PersonalUpdateStatus> {
    try {
      await this.call('discover');
      this.check();
      await this.refresh();
    } catch {
      // Keep an already verified package usable when release discovery is offline.
      this.publish({ ...this.status, discoveryError: true });
    }
    return this.snapshot();
  }
  async relaunch(): Promise<void> {
    const started = Date.now();
    const generation = this.status.generation;
    const trace = (stage: string) =>
      this.context.info?.(
        `[personal-restart] ${stage} generation=${generation ?? '-'} elapsedMs=${Date.now() - started}`,
      );
    if (this.restarting || this.status.status !== 'ready' || !generation) {
      trace(this.restarting ? 'duplicate-ignored' : 'not-ready');
      return;
    }
    this.restarting = true;
    this.publish(this.status);
    trace('received');
    let quitting = false;
    let failure: string | undefined;
    try {
      const result = await this.call('prepare-restart', [
        generation,
        '--parent-pid',
        String(process.pid),
      ]);
      trace(`prepare-result:${String(result.status)}`);
      if (result.status === 'busy') throw new Error('personal_install_busy');
      if (result.status === 'stale') return;
      if (
        result.status !== 'prepared' ||
        typeof result.requestId !== 'string' ||
        !/^[a-f0-9]{32}$/.test(result.requestId)
      ) {
        throw new Error('personal_installer_response');
      }
      const child = spawn(
        '/usr/bin/python3',
        [
          '-B',
          path.join(this.root!, 'automation', 'controller.py'),
          '--root',
          this.root!,
          'apply-and-relaunch',
          result.requestId,
        ],
        { cwd: this.root, detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      // The installer survives our quit. It confirms durable ownership before quitting is permitted.
      await new Promise<void>((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => finish(new Error('personal_installer_timeout')), 15_000);
        const finish = (error?: Error) => {
          clearTimeout(timeout);
          child.stdout?.removeAllListeners('data');
          child.removeAllListeners('error');
          child.removeAllListeners('exit');
          if (error) {
            child.stdout?.destroy();
            reject(error);
          } else {
            child.stdout?.destroy();
            child.unref();
            resolve();
          }
        };
        child.once('error', () => finish(new Error('personal_installer_failed')));
        child.once('exit', () => finish(new Error('personal_installer_exited')));
        child.stdout?.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          if (output.length > 8192) {
            finish(new Error('personal_installer_response'));
            return;
          }
          if (!output.includes('\n')) return;
          try {
            const ack = JSON.parse(output.split('\n')[0]);
            if (ack.status === 'busy') { finish(new Error('personal_install_busy')); return; }
            if (ack.status !== 'armed' || ack.requestId !== result.requestId) throw new Error();
            finish();
          } catch {
            finish(new Error('personal_installer_response'));
          }
        });
      });
      trace('armed');
      this.context.quit();
      quitting = true;
      trace('quit-requested');
    } catch (error) {
      failure =
        error instanceof Error && error.message === 'personal_install_busy'
          ? 'personal_install_busy'
          : 'personal_install_failed';
      trace(`failed:${failure}`);
    } finally {
      if (!quitting) {
        this.restarting = false;
        if (failure) this.publish({ ...this.status, status: 'error', errorCode: failure });
        else await this.refresh();
      }
    }
  }
  stop(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.watcher?.close();
  }
}
