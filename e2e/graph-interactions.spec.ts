import { expect, test } from '@playwright/test';

test('minimap click selects the matching chapter formula node', async ({ page }) => {
  await page.goto('/graph/chapter/chapter11?mode=guided', { waitUntil: 'domcontentloaded' });

  const atlasNodes = page.getByTestId('graph-atlas-node');
  await expect(atlasNodes.first()).toBeVisible();

  const target = page.getByTestId('graph-atlas-node').and(page.locator('[data-formula-id="formula_11.2"]'));
  await expect(target).toBeVisible();
  await target.click();

  await expect(page).toHaveURL(/selected=formula_11\.2/);
  await expect(target).toHaveClass(/graph-atlas-map__node--active/);
  await expect(page.getByTestId('formula-node').and(page.locator('[data-formula-id="formula_11.2"]'))).toHaveClass(/selected/);
});

test('guided formula hover shows a symbol explanation callout', async ({ page }) => {
  await page.goto('/graph/formula_11.7b?chapterId=chapter11&mode=guided', { waitUntil: 'domcontentloaded' });

  const annotation = page.locator('[data-note][data-symbol]').first();
  await expect(annotation).toBeVisible();
  const note = await annotation.getAttribute('data-note');

  await annotation.hover();

  const callout = page.locator('.formula-node__callout');
  await expect(callout).toBeVisible();
  await expect(callout).toContainText(note || '');
});

test('guided landscape hint stays outside the formula card', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/graph/formula_11.7b?chapterId=chapter11&mode=guided', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.formula-node--focus')).toBeVisible();
  const hint = page.locator('.graph-onboarding-hint').first();
  if (!(await hint.isVisible({ timeout: 2_000 }).catch(() => false))) return;

  const overlaps = await page.evaluate(() => {
    const hint = document.querySelector('.graph-onboarding-hint')?.getBoundingClientRect();
    const formula = document.querySelector('.formula-node--focus')?.getBoundingClientRect();
    if (!hint || !formula) return true;
    const xOverlap = Math.max(0, Math.min(hint.right, formula.right) - Math.max(hint.left, formula.left));
    const yOverlap = Math.max(0, Math.min(hint.bottom, formula.bottom) - Math.max(hint.top, formula.top));
    return xOverlap * yOverlap > 0;
  });

  expect(overlaps).toBe(false);
});

test('concept view restores expanded symbols and formula evidence after returning from guided formula', async ({ page }) => {
  await page.goto('/graph/formula_13.11a?chapterId=chapter13', { waitUntil: 'domcontentloaded' });

  let focusNode = page.locator('[data-testid="concept-node"][data-concept-role="focus"]').first();
  await expect(focusNode).toContainText('Response');

  await focusNode.getByRole('button', { name: /本式符号/ }).click();
  await expect(page.locator('[data-testid="concept-node"][data-concept-role="introduced"]').filter({ hasText: 'Response Variable' }).first()).toBeVisible();
  await focusNode.getByRole('button', { name: /^展开$/ }).click();
  await expect(focusNode).toContainText('当前公式证据');

  await focusNode.getByRole('button', { name: '查看公式' }).click();
  await expect(page).toHaveURL(/mode=guided/);
  await page.getByRole('button', { name: /返回 Response/ }).click();

  focusNode = page.locator('[data-testid="concept-node"][data-concept-role="focus"]').first();
  await expect(page).not.toHaveURL(/mode=guided/);
  await expect(focusNode).toContainText('收起符号');
  await expect(focusNode).toContainText('当前公式证据');
  await expect(page.locator('[data-testid="concept-node"][data-concept-role="introduced"]').filter({ hasText: 'Response Variable' }).first()).toBeVisible();
});

test('concept view restores expanded state after browser back from guided formula', async ({ page }) => {
  await page.goto('/graph/formula_13.11a?chapterId=chapter13', { waitUntil: 'domcontentloaded' });

  let focusNode = page.locator('[data-testid="concept-node"][data-concept-role="focus"]').first();
  await expect(focusNode).toContainText('Response');

  await focusNode.getByRole('button', { name: /本式符号/ }).click();
  await focusNode.getByRole('button', { name: /^展开$/ }).click();
  await expect(focusNode).toContainText('当前公式证据');

  await focusNode.getByRole('button', { name: '查看公式' }).click();
  await expect(page).toHaveURL(/mode=guided/);
  await page.goBack();

  focusNode = page.locator('[data-testid="concept-node"][data-concept-role="focus"]').first();
  await expect(page).not.toHaveURL(/mode=guided/);
  await expect(focusNode).toContainText('收起符号');
  await expect(focusNode).toContainText('当前公式证据');
  await expect(page.locator('[data-testid="concept-node"][data-concept-role="introduced"]').filter({ hasText: 'Response Variable' }).first()).toBeVisible();
});

test('concept search groups repeated concept occurrences into one readable result', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('combobox').fill('heterozygosity');

  const firstExactConcept = page.locator('[role="option"]').filter({ hasText: /^Heterozygosity/ }).first();
  await expect(firstExactConcept).toBeVisible();
  await expect(firstExactConcept).toContainText('出现在');
  await expect(firstExactConcept).toContainText('代表公式');

  const exactConceptCount = await page.locator('[role="option"]').evaluateAll((options) =>
    options.filter((option) => {
      const text = option.textContent?.trim() || '';
      return text.startsWith('Heterozygosity') && !text.startsWith('Sweep-Linked Heterozygosity');
    }).length,
  );
  expect(exactConceptCount).toBe(1);
});
