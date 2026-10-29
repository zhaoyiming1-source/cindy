import assert from 'node:assert/strict';
export default {
  name: 'personal-effort-feedback', entry: './fixture.tsx',
  viewport: { width: 620, height: 400 },
  real: 'EffortSlider and real update failure translations; persistence is deliberately held until acknowledged',
  notCovered: 'Native task IPC, complete UpdateBanner dialog and actual model execution',
  cases: { default: { about: 'Existing task slider retains its released target until save acknowledgement' } },
  async check(page, ui) {
    const slider = page.getByRole('slider');
    const bounds = await slider.boundingBox();
    assert.ok(bounds);
    await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + bounds.height / 2);
    await page.mouse.up();
    assert.equal(await slider.getAttribute('aria-valuenow'), '2');
    await ui.capture('awaiting-save');
    await page.getByRole('button', { name: 'Complete save' }).click();
    assert.equal(await slider.getAttribute('aria-valuenow'), '2');
    await ui.capture('saved');
  },
};
