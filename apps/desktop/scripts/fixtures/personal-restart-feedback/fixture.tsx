import { mountPage, subscription, ctx } from '../../ui-page/harness';
import { UpdateBanner } from '../../../src/renderer/components/sidebar/UpdateBanner';
let finishCheck: () => void = () => {};
const ready = { status: 'ready', version: '0.1.119' };
void mountPage({
  host: {
    getUpdateStatus: async () => ready,
    onUpdateStatus: subscription('updateStatus'),
    clientEndpoints: { websiteUrl: 'https://example.test' },
    describeRelaunchBlockingActivity: () => new Promise((resolve) => {
      finishCheck = () => resolve({ busy: false, categories: [], companionNames: [] });
    }),
    relaunchToUpdate: () => {
      const owner = window as unknown as { __restartCalls?: number; __uiPage: { emit: (name: string, value: unknown) => void } };
      owner.__restartCalls = (owner.__restartCalls ?? 0) + 1;
      owner.__uiPage.emit('updateStatus', ctx.case === 'busy'
        ? { ...ready, status: 'error', errorCode: 'personal_install_busy', relaunching: false }
        : { ...ready, relaunching: true });
    },
  },
  render: () => <main className="min-h-screen bg-[var(--surface)] p-8 text-[var(--text-primary)]">
    <div className="w-[280px]"><UpdateBanner isCollapsed={ctx.case === 'collapsed'} /></div>
    <button onClick={() => finishCheck()}>Finish activity check</button>
  </main>,
});
