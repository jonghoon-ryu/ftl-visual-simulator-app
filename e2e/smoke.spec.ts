import { expect, test, type Page } from '@playwright/test';

// Opens the app with the first-visit intro already dismissed unless a test
// wants it, and records every console error / uncaught exception.
async function openApp(page: Page, { skipIntro = true } = {}) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  if (skipIntro) {
    await page.addInitScript(() => localStorage.setItem('ftl-intro-seen', '1'));
  }
  await page.goto('./');
  await expect(page.locator('.sim-presets')).toBeVisible();
  return problems;
}

async function play(page: Page, ms: number) {
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await page.waitForTimeout(ms);
  // A short run (e.g. 매핑 기본) can finish by itself and flip back to ▶.
  const pause = page.getByRole('button', { name: '일시정지' });
  if (await pause.isVisible()) await pause.click();
}

const preset = (page: Page, name: string) => page.locator('.sim-presets button', { hasText: name });

test('first visit shows the "why FTL" intro and it works', async ({ page }) => {
  const problems = await openApp(page, { skipIntro: false });
  await expect(page.getByRole('heading', { name: '왜 FTL 이 필요할까?' })).toBeVisible();

  const msg = page.locator('.why-ftl-message');
  await page.getByRole('button', { name: '데이터 A 쓰기' }).click();
  await page.getByRole('button', { name: '데이터 A 쓰기' }).click();
  await expect(msg).toContainText('안 돼요');

  await page.getByText('FTL 켜기').click();
  await page.getByRole('button', { name: '데이터 A 쓰기' }).click();
  await expect(msg).toContainText('FTL 이 새 데이터');
  await expect(page.locator('.why-ftl-table')).toContainText('A → Page 1');

  await page.getByRole('button', { name: '레슨 1 시작하기' }).click();
  await expect(page.locator('.why-ftl-block')).toHaveCount(0);
  await expect(page.locator('.lesson-bar')).toContainText('레슨 1/3');
  expect(problems).toEqual([]);
});

test('lesson bar moves between presets', async ({ page }) => {
  const problems = await openApp(page);
  await page.getByRole('button', { name: '다음 ▸' }).click();
  await expect(page.locator('.lesson-bar')).toContainText('레슨 2/3');
  await expect(preset(page, 'GC 시연')).toHaveClass(/active/);
  await page.getByRole('button', { name: '다음 ▸' }).click();
  await expect(preset(page, '마모평준화 시연')).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: '다음 ▸' })).toBeDisabled();
  expect(problems).toEqual([]);
});

test('매핑 기본 plays: pages get written and logged', async ({ page }) => {
  const problems = await openApp(page);
  await play(page, 3000);
  await expect(page.locator('.cell.valid').first()).toBeVisible();
  expect(await page.locator('.cell.valid').count()).toBeGreaterThan(0);
  await expect(page.locator('.sim-mapping-col')).toContainText('Write');
  expect(problems).toEqual([]);
});

test('glossary term shows a definition on hover', async ({ page }) => {
  await openApp(page);
  const waf = page.locator('.term', { has: page.locator('.term-pop strong', { hasText: 'WAF (Write' }) }).first();
  await waf.hover();
  await expect(waf.locator('.term-pop')).toBeVisible();
  await expect(waf.locator('.term-pop')).toContainText('Write Amplification');
});

test('GC 시연 plays, TRIM turns valid pages invalid', async ({ page }) => {
  const problems = await openApp(page);
  await preset(page, 'GC 시연').click();
  await play(page, 4000);
  const valid = page.locator('.cell.valid');
  const invalid = page.locator('.cell.invalid');
  expect(await valid.count()).toBeGreaterThan(0);
  const invalidBefore = await invalid.count();

  await page.getByRole('tab', { name: '비교 실험실' }).click();
  await page.getByRole('button', { name: '지금 TRIM 하기' }).click();
  await expect(page.locator('.gc-compare', { hasText: '지금 TRIM 하기' })).toContainText('invalid 가 됐어요');
  expect(await invalid.count()).toBeGreaterThan(invalidBefore);
  expect(problems).toEqual([]);
});

test('GC 시연 comparison experiments all return results', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = await openApp(page);
  await preset(page, 'GC 시연').click();
  // 설정 · 통계 is the default tab; the experiments are one click away.
  await expect(page.getByRole('tab', { name: '설정 · 통계' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: '비교 실험실' })).toBeHidden();
  await page.getByRole('tab', { name: '비교 실험실' }).click();
  await expect(page.getByRole('tabpanel', { name: '비교 실험실' })).toBeVisible();

  // Panels are found by something that stays put while running - the button's
  // label changes to "비교 중..." as soon as it is clicked.
  const runs: { panel: string; button: string | RegExp; rows: number }[] = [
    { panel: '.gc-compare:has-text("GC 알고리즘 비교")', button: /GC 알고리즘 7개 비교하기|비교 중|다시 비교하기/, rows: 7 },
    { panel: '.gc-compare:has(.trim-controls)', button: /TRIM 효과 비교하기/, rows: 2 },
    { panel: '.gc-compare:has-text("핫/콜드 분리")', button: '핫/콜드 데이터 섞기 vs 분리 비교하기', rows: 2 },
    { panel: '.gc-compare:has-text("순차 vs 무작위")', button: '지금 설정으로 순차 / 무작위 쓰기 비교하기', rows: 2 },
  ];
  for (const { panel: sel, button, rows } of runs) {
    const panel = page.locator(sel).first();
    await panel.getByRole('button', { name: button }).click();
    await expect(panel.locator('tbody tr')).toHaveCount(rows, { timeout: 90_000 });
    await expect(panel.locator('.free-chart-empty')).toHaveCount(0);
  }
  // Hot/cold also draws a per-block composition bar for each scenario.
  await expect(page.locator('.hc-bars')).toHaveCount(2);
  expect(problems).toEqual([]);
});

test('side tabs: only GC 시연 has 비교 실험실, and 설정 · 통계 is its default', async ({ page }) => {
  const problems = await openApp(page);
  const labTab = page.getByRole('tab', { name: '비교 실험실' });

  // 매핑 기본 and 마모평준화 시연: no tab strip, just settings + stats.
  await expect(labTab).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: '설정 · 통계' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: '설정 · 통계' }).locator('.stat-row').first()).toBeVisible();
  await preset(page, '마모평준화 시연').click();
  await expect(labTab).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: '설정 · 통계' })).toBeVisible();

  // GC 시연: both tabs, settings first.
  await preset(page, 'GC 시연').click();
  await expect(labTab).toBeVisible();
  await expect(page.getByRole('tab', { name: '설정 · 통계' })).toHaveAttribute('aria-selected', 'true');
  await labTab.click();
  await expect(page.getByRole('tabpanel', { name: '비교 실험실' }).locator('.gc-compare')).toHaveCount(5);
  await expect(page.getByRole('tabpanel', { name: '설정 · 통계' })).toBeHidden();

  // The live charts sit at the bottom of the lab tab (after the five experiments),
  // not under the flash grid.
  const lab = page.getByRole('tabpanel', { name: '비교 실험실' });
  await expect(lab.locator('.free-chart-title', { hasText: '빈 block 수 변화' })).toBeVisible();
  await expect(lab.locator('.free-chart-title', { hasText: '읽기 지연' })).toBeVisible();
  await expect(page.locator('.sim-grid-panel .free-chart-title')).toHaveCount(0);
  const titles = await lab.locator('.free-chart-title').allTextContents();
  expect(titles[titles.length - 1]).toContain('읽기 지연');

  // Leaving GC 시연 while on the lab tab must not leave settings hidden elsewhere,
  // and coming back starts on settings again.
  await preset(page, '매핑 기본').click();
  await expect(labTab).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: '설정 · 통계' })).toBeVisible();
  await preset(page, 'GC 시연').click();
  await expect(page.getByRole('tab', { name: '설정 · 통계' })).toHaveAttribute('aria-selected', 'true');
  expect(problems).toEqual([]);
});

test('마모평준화 시연 plays and shows per-block erase counts', async ({ page }) => {
  const problems = await openApp(page);
  await preset(page, '마모평준화 시연').click();
  await play(page, 4000);
  await expect(page.locator('.sim-mapping-col')).not.toBeEmpty();
  expect(await page.locator('.stat-row').count()).toBeGreaterThan(0);
  expect(problems).toEqual([]);
});
