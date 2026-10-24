import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const waitFor = async (description, fn, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`Timed out waiting for ${description}`);
};
export default async function ({ page, context, baseUrl, env, step, requests, responses, protect }) {
  const key = env.WALKTHROUGH_GEMINI_KEY || `AIza${randomBytes(18).toString('hex').slice(0,35)}`;
  protect(key);
  let owner, server;
  const authResult = () => responses.filter(r => /accounts:(signUp|signInWithPassword|update)/.test(r.url)).map(r => { try { return JSON.parse(r.body); } catch { return {}; } }).findLast(r => r.idToken && r.email);
  const dismissOverlays = async () => {
    const spotlight = page.locator('[role="dialog"][aria-labelledby="whats-new-spotlight-title"]');
    // Quick Start (z-140) can cover the spotlight. Its accessible close label
    // is defined in App.tsx; the container itself has no dialog role.
    const dismissButtons = [
      page.getByRole('button', { name: 'Close setup instructions', exact: true }),
      spotlight.getByRole('button', { name: 'Got it', exact: true }),
    ];
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      let visible = false;
      for (const button of dismissButtons) {
        if (!await button.isVisible()) continue;
        visible = true;
        try {
          await button.click({ timeout: 500 });
          await button.waitFor({ state: 'hidden', timeout: 500 });
          break; // Recheck the stack after each dismissal.
        } catch (error) {
          if (error.name !== 'TimeoutError') throw error;
          // A different overlay may have appeared above this one.
        }
      }
      if (!visible) return;
    }
    throw new Error('Timed out dismissing setup and announcement overlays');
  };
  // Announcements can arrive after auth/profile hydration. Retry actionability
  // while dismissing those known overlays, keeping the final selector error.
  const clickNavigation = async locator => {
    const end = Date.now() + 30000;
    while (true) {
      await dismissOverlays();
      try { await locator.click({ timeout: 1000 }); return; }
      catch (error) { if (error.name !== 'TimeoutError' || Date.now() >= end) throw error; }
    }
  };
  const settingsPage = page.locator('[data-key-storage-mode]');
  const openSettings = async () => {
    await page.getByRole('button', { name: 'Open account menu', exact: true }).waitFor();
    await dismissOverlays();
    if (!await settingsPage.isVisible()) {
      const menu = page.getByRole('menu', { name: 'Account menu', exact: true });
      if (!await menu.isVisible()) await clickNavigation(page.getByRole('button', { name: 'Open account menu', exact: true }));
      await menu.waitFor();
      await clickNavigation(menu.getByRole('menuitem', { name: 'Settings', exact: true }));
    }
    await settingsPage.waitFor();
    await dismissOverlays();
  };
  await step('Owner signs in through UI', async () => {
    await page.goto(baseUrl);
    await page.getByRole('button', { name: /^(Log in|Sign in)$/i }).first().click();
    if (!env.WALKTHROUGH_EMAIL) {
      await page.getByRole('button', { name: 'Sign up', exact: true }).click();
      await page.getByPlaceholder('John Doe').fill('Walkthrough Owner');
      await page.getByPlaceholder('johndoe', { exact: true }).fill(`walk${randomBytes(6).toString('hex')}`);
    }
    await page.locator('input[type="email"], input[placeholder*="john@example.com"]').fill(env.WALKTHROUGH_EMAIL || `walk-${randomBytes(8).toString('hex')}@example.com`);
    const password = env.WALKTHROUGH_PASSWORD || randomBytes(24).toString('hex');
    protect(password);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: env.WALKTHROUGH_EMAIL ? 'Sign In' : 'Create Account', exact: true }).click();
    owner = await waitFor('owner sign-up/sign-in response with idToken and email', authResult);
    protect(owner.idToken);
    protect(owner.refreshToken);
    // The submit label disappears during loading, before registration finishes.
    await page.locator('input[type="password"]').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Open account menu', exact: true }).waitFor();
    if (env.onOwnerSignedUp) { await env.onOwnerSignedUp(owner.localId); await page.reload(); }
    await openSettings();
  });
  await step('Detect storage mode', async () => {
    server = await page.locator('[data-key-storage-mode]').getAttribute('data-key-storage-mode') === 'server';
    if (env.WALKTHROUGH_EXPECT_MODE && env.WALKTHROUGH_EXPECT_MODE !== 'any') assert.ok(server === (env.WALKTHROUGH_EXPECT_MODE === 'server'));
  });
  await step('Save Gemini key', async () => {
    const input = page.locator('[data-key-slot="gemini"]');
    await input.fill(key);
    await input.blur();
    await page.getByText('Settings saved successfully!', { exact: true }).waitFor();
    if (server) {
      await waitFor('Gemini key input to clear and show its saved suffix', async () => await input.inputValue() === '' && (await input.getAttribute('placeholder'))?.endsWith(key.slice(-4)));
      assert.ok(!responses.some(r => r.body.includes(key)));
    } else {
      await waitFor('legacy Firestore save request', () => requests.some(r => /firestore/.test(r.url)));
      await page.reload(); await openSettings();
      assert.ok(await page.locator('[data-key-slot="gemini"]').inputValue() === key);
    }
  });
  await step('Generate with own Gemini key', async () => {
    await clickNavigation(settingsPage.locator('../..').getByRole('button', { name: 'Back to studio', exact: true }));
    await settingsPage.waitFor({ state: 'hidden' });
    // Choose the direct Gemini provider in the model picker.
    await clickNavigation(page.getByRole('button', { name: /^Model:/i }));
    await clickNavigation(page.getByRole('button', { name: /^Nano Banana Pro(?: \d+ PixTaffy credits)?$/ }));
    const start = requests.length;
    await page.locator('textarea[placeholder^="Prompt,"]').fill('A simple blue circle on white');
    await clickNavigation(page.getByRole('button', { name: 'Generate image', exact: true }));
    await waitFor(server ? 'generateWithUserKey request after Generate image' : 'Gemini provider request after Generate image', () => requests.slice(start).some(r => server ? r.url.includes('generateWithUserKey') : /generativelanguage.googleapis.com/.test(r.url)), 60000);
    if (server) {
      if (env.WALKTHROUGH_GEMINI_KEY) await page.locator('img[src^="data:image"], img[src*="firebasestorage"]').first().waitFor({ timeout: 180000 });
      else await page.getByText('The provider could not complete this request. Check your key and model access.', { exact: false }).first().waitFor({ timeout: 180000 });
      assert.ok(!requests.some(r => /generativelanguage.googleapis.com|api.openai.com|openrouter.ai/.test(r.url)));
      assert.ok(!responses.some(r => r.body.includes(key)));
    } else assert.ok(!requests.slice(start).some(r => r.url.includes('generateWithUserKey')));
  });
  await step('Stranger cannot read owner profile or encrypted store', async () => {
    const signup = responses.find(r => /accounts:(signUp|signInWithPassword)/.test(r.url));
    const endpoint = signup.url.replace(/accounts:(signUp|signInWithPassword)/, 'accounts:signUp');
    const response = await context.request.post(endpoint, { data: { email: `stranger-${randomBytes(8).toString('hex')}@example.com`, password: randomBytes(24).toString('hex'), returnSecureToken: true } });
    assert.ok(response.ok());
    const stranger = await response.json();
    protect(stranger.idToken);
    protect(stranger.refreshToken);
    const firestore = requests.find(r => /firestore.*projects(%2F|\/)/.test(r.url));
    assert.ok(firestore);
    const decoded = decodeURIComponent(firestore.url);
    const project = decoded.match(/projects\/([^/]+)\/databases/)[1];
    const origin = new URL(firestore.url).origin;
    for (const collection of ['users', 'userApiKeys']) {
      const read = await context.request.get(`${origin}/v1/projects/${project}/databases/(default)/documents/${collection}/${owner.localId}`, { headers: { Authorization: `Bearer ${stranger.idToken}` } });
      assert.ok(read.status() === 403);
      assert.ok(!(await read.text()).includes(key.slice(-4)));
    }
    const callable = requests.find(r => r.url.includes(server ? 'generateWithUserKey' : 'getKeyStorageMode'));
    assert.ok(callable, 'Key callable endpoint was observed');
    const attempt = await context.request.post(callable.url.replace('getKeyStorageMode', 'generateWithUserKey'), {
      headers: { Authorization: `Bearer ${stranger.idToken}` },
      data: { data: { uid: owner.localId, model: 'gemini', prompt: 'A blue circle' } },
    });
    const denied = await attempt.json();
    assert.equal(attempt.status(), 400, 'Stranger generation must be rejected');
    assert.equal(denied.error?.status, 'FAILED_PRECONDITION');
    assert.ok(['Configure a provider key in Settings.', 'server-side keys are not enabled for this account'].includes(denied.error?.message), 'Stranger must fail before calling the provider');
    assert.ok(!JSON.stringify(denied).includes(key));
  });
  await step('Delete Gemini key', async () => {
    await openSettings();
    const row = page.locator('[data-key-row="gemini"]');
    const input = row.locator('[data-key-slot="gemini"]');
    const deleteButton = row.getByRole('button', { name: 'Delete key', exact: true });
    await deleteButton.click();
    await row.getByRole('button', { name: 'Confirm delete', exact: true }).click();
    await page.getByText('Gemini key deleted', { exact: true }).waitFor();
    await row.getByText('Not set', { exact: true }).waitFor();
    await waitFor('Gemini key input to clear after deletion', async () => await input.inputValue() === '');
    if (server) assert.equal(await input.getAttribute('placeholder'), 'AIza...');
    await page.reload();
    await openSettings();
    await row.getByText('Not set', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), '');
  });
}
