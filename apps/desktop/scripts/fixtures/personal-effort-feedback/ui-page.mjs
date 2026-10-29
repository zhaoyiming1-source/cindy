import assert from 'node:assert/strict';
export default {
  name: 'personal-effort-feedback', entry: './fixture.tsx',
  viewport: { width: 620, height: 400 },
  real: 'EffortSlider and real update failure translations; persistence is deliberately held until acknowledged',
  notCovered: 'Native task IPC, complete UpdateBanner dialog and actual model execution',
  cases: { default: { about: 'Existing task slider retains its released target until save acknowledgement' } },
  async check(page, ui) {
    // This case verifies real motion; the screenshot runner defaults to reduced motion.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const slider = page.getByRole('slider');
    const bounds = await slider.boundingBox();
    assert.ok(bounds);
    const thumb = page.locator('[data-effort-thumb]');
    const centerX = async () => { const r = await thumb.boundingBox(); return r.x + r.width / 2; };
    const start = await centerX();
    // A track click must never visit the raw 58% point before snapping to 50%.
    await page.mouse.move(bounds.x + bounds.width * 0.58, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.58 + 1, bounds.y + bounds.height / 2);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.ok(Math.abs(await centerX() - start) < 0.5, 'pressing a track click moved the thumb');
    await page.evaluate(() => {
      window.__clickFrames = [];
      const thumb = document.querySelector('[data-effort-thumb]');
      const began = performance.now();
      const sample = () => {
        const r = thumb.getBoundingClientRect(); window.__clickFrames.push(r.x + r.width / 2);
        if (performance.now() - began < 240) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.mouse.up();
    await page.waitForTimeout(270);
    const frames = await page.evaluate(() => window.__clickFrames);
    const target = bounds.x + bounds.width / 2;
    assert.ok(frames.every((x) => x <= target + 0.5 && x >= start - 0.5), 'click overshot the nearest stop');
    assert.ok(frames.some((x) => x > start + 0.5 && x < target - 0.5), 'click did not animate');
    assert.ok(Math.abs(await centerX() - target) < 0.5);
    await page.getByRole('button', { name: 'Complete save' }).click();
    await slider.press('Home');
    await page.getByRole('button', { name: 'Complete save' }).click();
    await page.waitForTimeout(180);

    const initial = await thumb.boundingBox();
    assert.ok(initial);
    const center = initial.x + initial.width / 2;
    const y = bounds.y + bounds.height / 2;
    // Regression: grab 8px off-centre, then move only 1px (old code jumped 9px).
    await page.mouse.move(center + 8, y);
    await page.mouse.down();
    await page.mouse.move(center + 9, y);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const moved = await thumb.boundingBox();
    assert.ok(moved);
    assert.ok(Math.abs(moved.x + moved.width / 2 - center - 1) < 0.5);
    assert.equal(moved.width, initial.width);
    await page.mouse.up();
    await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.84, bounds.y + bounds.height / 2);
    await page.mouse.up();
    assert.equal(await slider.getAttribute('aria-valuenow'), '2');
    const maxGap = await page.evaluate(() => new Promise((resolve) => {
      const slider = document.querySelector('[role="slider"]');
      const thumb = slider.querySelector('[data-effort-thumb]');
      const fill = slider.querySelector('[data-effort-fill]');
      let max = 0; const start = performance.now();
      function sample() {
        const t = thumb.getBoundingClientRect();
        const f = fill.getBoundingClientRect();
        max = Math.max(max, Math.abs(t.x + t.width / 2 - f.right));
        if (performance.now() - start < 220) requestAnimationFrame(sample); else resolve(max);
      }
      requestAnimationFrame(sample);
    }));
    assert.ok(maxGap < 0.5, `fill/thumb separated by ${maxGap}px`);
    await ui.capture('awaiting-save');
    await page.getByRole('button', { name: 'Complete save' }).click();
    assert.equal(await slider.getAttribute('aria-valuenow'), '2');
    await ui.capture('saved');
  },
};
