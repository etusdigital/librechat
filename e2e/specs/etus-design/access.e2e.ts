import { expect, test } from '@playwright/test';
import { DesignApi, loginAs } from './support/session';
import { hubCalls } from './support/services';

test.describe('access and the proxy with the hub token (C-17, C 3.12)', () => {
  test('a person with projects.use sees Design and the proxy reaches the design-service', async ({
    page,
  }) => {
    await loginAs(page, 'ana');
    const api = new DesignApi(page.context());
    const me = await api.json<{ permissions: string[] }>('GET', 'me');
    expect(me.permissions).toContain('projects.use');
    await page.goto('/design');
    await expect(page.getByRole('heading', { name: 'Design', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Design', exact: true }).first()).toBeVisible();
  });

  test('a person without any design permission gets design_not_allowed and the no access text', async ({
    page,
  }) => {
    await loginAs(page, 'davi');
    const api = new DesignApi(page.context());
    const response = await api.raw('GET', 'me');
    expect(response.status()).toBe(403);
    expect((await response.json()).error.code).toBe('design_not_allowed');
    await page.goto('/design');
    await expect(
      page.getByText('Você não tem acesso ao Etus Design. Fale com a administração do hub'),
    ).toBeVisible();
  });

  test('the forward token is asked with the chat key and the id token, at most once per 45 s', async ({
    page,
  }) => {
    await loginAs(page, 'bia');
    const api = new DesignApi(page.context());
    const before = Date.now();
    for (let index = 0; index < 5; index += 1) {
      await api.json('GET', 'me');
    }
    const calls = (await hubCalls()).filter(
      (call) =>
        call.kind === 'forward-token' && call.persona === 'bia' && call.at >= before - 50_000,
    );
    expect(calls.length).toBeLessThanOrEqual(1);
    for (const call of calls) {
      expect(call).toMatchObject({ chatKey: true, idToken: true, appKey: 'design' });
    }
  });
});
