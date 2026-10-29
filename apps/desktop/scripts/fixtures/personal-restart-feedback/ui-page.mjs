import assert from 'node:assert/strict';
export default {
  name: 'personal-restart-feedback', entry: './fixture.tsx',
  viewport: { width: 540, height: 480 },
  real: 'UpdateBanner, useUpdateStatus subscription and real progress/busy translations',
  notCovered: 'Native installer; automatic banner deferral is covered by its own component tests',
  stubs: { 'src/renderer/hooks/useDeferUpdateBannerWhileBusy': 'export const useDeferUpdateBannerWhileBusy = () => false;' },
  cases: {
    default: { about: 'Expanded banner shows progress during activity check and installer preparation' },
    collapsed: { about: 'Collapsed banner keeps a disabled progress indicator' },
    busy: { about: 'A busy installer produces an explicit explanation' },
  },
  async check(page, ui) {
    const label = ui.case === 'collapsed'
      ? await ui.t('update.banner.ariaCollapsed', { version: '0.1.119' })
      : await ui.t('update.banner.ariaExpanded', { version: '0.1.119' });
    await page.getByRole('button', { name: label, exact: true }).click();
    const progress = page.getByRole('button', { name: await ui.t('update.banner.personalRestarting'), exact: true });
    await progress.waitFor(); assert.equal(await progress.isDisabled(), true);
    if (ui.case !== 'collapsed') await page.locator('p').filter({ hasText: await ui.t('update.banner.personalRestarting') }).waitFor();
    await ui.capture('checking');
    await page.getByRole('button', { name: 'Finish activity check' }).click();
    if (ui.case === 'busy') {
      await page.getByText(await ui.t('update.banner.personalBusyDescription'), { exact: true }).waitFor();
    } else {
      await progress.waitFor(); assert.equal(await progress.isDisabled(), true);
    }
    assert.equal(await page.evaluate(() => window.__restartCalls), 1);
    await ui.capture('controller-result');
  },
};
