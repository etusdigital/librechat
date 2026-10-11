import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export async function seriousViolations(page: Page, include: string, exclude: string[] = []) {
  let builder = new AxeBuilder({ page }).include(include).withTags(TAGS);
  for (const selector of exclude) builder = builder.exclude(selector);
  const result = await builder.analyze();
  return result.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.slice(0, 4).map((node) => ({
        target: node.target.join(' '),
        detail: node.any.map((check) => check.message).join('; '),
      })),
    }));
}

export async function useTheme(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.addInitScript((theme) => {
    if (location.hostname === 'chat.etus.test') localStorage.setItem('color-theme', theme);
  }, scheme);
}

export async function expectTheme(page: Page, scheme: 'light' | 'dark') {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(scheme === 'dark');
}

export async function expectNoRawKeys(page: Page, selector: string) {
  const text = await page.locator(selector).first().innerText();
  expect(text).not.toMatch(/etus-design:|\b(plan|jury|workspace)\.[a-z]+[._][a-z_.]+\b/);
}
