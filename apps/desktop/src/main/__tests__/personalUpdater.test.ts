import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { PersonalUpdater, locatePersonalUpdater } from '../personalUpdater';

const mocks = vi.hoisted(() => ({ exec: vi.fn(), spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.exec, spawn: mocks.spawn }));
let root: string;
let context: Parameters<typeof locatePersonalUpdater>[0];
let worker: EventEmitter & { stdout: PassThrough; unref: ReturnType<typeof vi.fn> };
const instances: PersonalUpdater[] = [];
const sha = 'a'.repeat(40);
function write(relative: string, value: unknown) {
  const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
function metadata(overrides = {}) {
  return { schemaVersion: 1, managedBy: 'local-release-follower', upstreamVersion: '0.1.115', sourceCommit: sha,
    updater: { protocolVersion: 1, root }, ...overrides };
}
function make() { const value = new PersonalUpdater(context, root); instances.push(value); return value; }
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-updater-'));
  fs.mkdirSync(path.join(root, 'Cindy.app', 'Contents', 'Resources'), { recursive: true });
  fs.mkdirSync(path.join(root, 'state'));
  context = { resources: path.join(root, 'Cindy.app', 'Contents', 'Resources'), appPath: path.join(root, 'Cindy.app'),
    runtimeVersion: '0.0.0', packaged: true, development: false, platform: 'darwin', emit: vi.fn(), quit: vi.fn(), warn: vi.fn() };
  write('Cindy.app/Contents/Resources/cindy-personal-build.json', metadata());
  write('Cindy.app/Contents/Resources/cindy-source.json', { sourceCommit: sha });
  write('config.json', { region: 'cn', bundleId: 'com.xd.cindycn', installTarget: context.appPath });
  write('automation/controller.py', 'fixture');
  worker = Object.assign(new EventEmitter(), { stdout: new PassThrough(), unref: vi.fn() });
  mocks.spawn.mockReset().mockReturnValue(worker);
  mocks.exec.mockReset().mockImplementation((_file, args, _options, callback) => {
    const command = args[args.indexOf('--root') + 2];
    callback(null, JSON.stringify(command === 'status'
      ? { update: { status: 'ready', version: '0.1.115', generation: 'ready' } }
      : { status: 'prepared', requestId: 'b'.repeat(32) }));
  });
});
afterEach(() => { instances.splice(0).forEach(x => x.stop()); fs.rmSync(root, { recursive: true, force: true }); });

describe('local update identity', () => {
  it('binds controller to packaged app and exact source identity', () => {
    expect(locatePersonalUpdater(context)).toEqual({ root: fs.realpathSync(root) });
    write('Cindy.app/Contents/Resources/cindy-source.json', { sourceCommit: 'b'.repeat(40) });
    expect(locatePersonalUpdater(context)).toEqual({ invalid: true });
  });
  it('leaves ordinary official and development builds alone', () => {
    fs.unlinkSync(path.join(context.resources, 'cindy-personal-build.json'));
    expect(locatePersonalUpdater(context)).toBeNull();
    expect(locatePersonalUpdater({ ...context, development: true })).toBeNull();
  });
  it('does not fall through when local metadata or install target is invalid', () => {
    write('config.json', { installTarget: '/unrelated' });
    expect(locatePersonalUpdater(context)).toEqual({ invalid: true });
    fs.writeFileSync(path.join(context.resources, 'cindy-personal-build.json'), '{');
    expect(locatePersonalUpdater(context)).toEqual({ invalid: true });
  });
});
describe('personal update lifecycle', () => {
  it('projects ready version and warns on controller failure without exposing paths', async () => {
    const adapter = make(); await adapter.refresh();
    expect(adapter.snapshot()).toMatchObject({ status: 'ready', version: '0.1.115' });
    mocks.exec.mockImplementation((_f, _a, _o, callback) => callback(new Error('/private/credential')));
    await adapter.refresh(); expect(adapter.snapshot()).toEqual({ status: 'error', errorCode: 'personal_updater_unavailable' });
  });
  it('quits only after installer handshake and coalesces duplicate clicks', async () => {
    const adapter = make(); await adapter.refresh();
    const first = adapter.relaunch(); const duplicate = adapter.relaunch();
    await new Promise(resolve => setImmediate(resolve));
    expect(context.quit).not.toHaveBeenCalled();
    worker.stdout.write(JSON.stringify({ status: 'armed', requestId: 'b'.repeat(32) }) + '\n');
    await Promise.all([first, duplicate]);
    expect(context.quit).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn.mock.calls[0][1]).toContain('apply-and-relaunch');
  });
  it('rejects stale response and keeps app running', async () => {
    const adapter = make(); await adapter.refresh();
    mocks.exec.mockImplementation((_f, _a, _o, callback) => callback(null, JSON.stringify({ status: 'stale' })));
    await adapter.relaunch(); expect(context.quit).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it('cannot restart while newer version is being prepared', async () => {
    mocks.exec.mockImplementation((_f, _a, _o, callback) => callback(null, JSON.stringify({ update: { status: 'superseding', generation: 'old' } })));
    const adapter = make(); await adapter.refresh(); await adapter.relaunch();
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(context.quit).not.toHaveBeenCalled();
  });
  it('failed installer start or invalid ack never quits', async () => {
    const adapter = make(); await adapter.refresh(); const restart = adapter.relaunch();
    await new Promise(resolve => setImmediate(resolve));
    worker.stdout.write('{"status":"wrong"}\n'); await restart;
    expect(context.quit).not.toHaveBeenCalled(); expect(adapter.snapshot().errorCode).toBe('personal_install_failed');
  });
});


it('keeps a verified package available when manual discovery fails', async () => {
  const adapter = make(); await adapter.refresh();
  mocks.exec.mockImplementation((_f, _a, _o, callback) => callback(new Error('offline')));
  expect(await adapter.checkNow()).toMatchObject({ status: 'ready', discoveryError: true, version: '0.1.115' });
  expect(context.quit).not.toHaveBeenCalled();
});
