// Lending circles in a real browser: joining, circle-only items, removal that keeps commitments.
import { test, expect } from '@playwright/test';

async function signedIn(browser, who) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(who) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Hi ${who.split(' ')[0]}`);
  return page;
}
const plus = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('joining a circle reveals its circle-only items; removal stops new requests but keeps the request already made', async ({ browser }) => {
  const jo = await signedIn(browser, 'Jo Rivera');
  const maya = await signedIn(browser, 'Maya Chen');
  const sam = await signedIn(browser, 'Sam Okafor');
  const t = (await (await jo.request.get('/api/config')).json()).today;

  // Before joining, Sam's circle-only bike is not in Jo's catalog.
  await jo.getByRole('searchbox', { name: /search/i }).fill('bike');
  await expect(jo.getByText('Nothing matches just yet')).toBeVisible();

  // Jo has an invitation waiting (badge on Circles) and joins.
  const circlesTab = jo.getByRole('link', { name: /Circles/ });
  await expect(circlesTab).toContainText('1');
  await circlesTab.click();
  const invite = jo.getByRole('region', { name: 'Invitations' });
  await expect(invite).toContainText('Riverside Neighbours');
  await expect(invite).toContainText('Sam invited you');
  await invite.getByRole('button', { name: 'Join circle' }).click();
  await expect(jo.getByRole('heading', { level: 1 })).toHaveText('Riverside Neighbours');
  await expect(jo.getByRole('region', { name: 'Shared in this circle' })).toContainText('Single-speed city bike');

  // The bike is now in her catalog, labelled with the circle, and she asks for it.
  await jo.getByRole('link', { name: 'Explore' }).click();
  await jo.getByRole('button', { name: /From my circles/ }).click();
  const card = jo.getByRole('link', { name: /Single-speed city bike/ });
  await expect(card).toContainText('Riverside Neighbours');
  await card.click();
  await jo.getByLabel('Pick up').fill(plus(t, 10));
  await jo.getByLabel('Bring back').fill(plus(t, 11));
  await jo.getByRole('button', { name: 'Send request' }).click();
  await expect(jo.getByRole('heading', { level: 1 })).toHaveText('Waiting for Sam to reply');
  const loanUrl = jo.url();

  // Maya, the organiser, removes Jo — after confirming.
  await maya.getByRole('link', { name: /Circles/ }).click();
  await maya.getByRole('link', { name: /Riverside Neighbours/ }).click();
  await maya.getByRole('button', { name: 'Remove Jo' }).click();
  await maya.getByRole('group', { name: /Remove Jo\?/ }).getByRole('button', { name: 'Remove' }).click();
  await expect(maya.getByRole('status').filter({ hasText: 'Their existing requests and loans carry on' }).first()).toBeVisible();
  await expect(maya.getByRole('region', { name: "What's been happening" })).toContainText('removed Jo from the circle');

  // Jo's request still stands; the bike no longer takes new requests from her.
  await jo.goto(loanUrl);
  await expect(jo.getByRole('heading', { level: 1 })).toHaveText('Waiting for Sam to reply');
  await jo.getByRole('link', { name: 'Single-speed city bike' }).first().click();
  await expect(jo.getByRole('heading', { name: "Just for Sam's circles" })).toBeVisible();
  await expect(jo.getByRole('button', { name: 'Send request' })).toHaveCount(0);

  // Sam sees the request with a gentle note, and can still approve it.
  await sam.goto(loanUrl);
  await expect(sam.getByText(/no longer in one with you, but this request still stands/)).toBeVisible();
  await sam.getByRole('button', { name: 'Approve' }).click();
  await expect(sam.getByRole('status').filter({ hasText: 'Approved' }).first()).toBeVisible();
});

test('start a circle, invite a friend, and lend an item just to that circle', async ({ browser }) => {
  const priya = await signedIn(browser, 'Priya Natarajan');
  const jo = await signedIn(browser, 'Jo Rivera');

  await priya.getByRole('link', { name: /Circles/ }).click();
  await priya.getByRole('button', { name: '+ Start a circle' }).click();
  await priya.getByLabel(/Name/).fill('Board game night');
  await priya.getByLabel(/What's it about/).fill('Second Friday of the month at mine.');
  await priya.getByRole('button', { name: 'Create circle' }).click();
  await expect(priya.getByRole('heading', { level: 1 })).toHaveText('Board game night');
  await priya.getByLabel('Invite someone').selectOption({ label: 'Jo Rivera · Old Mill' });
  await priya.getByRole('button', { name: 'Send invitation' }).click();
  await expect(priya.getByRole('region', { name: 'People' })).toContainText('Invited');

  // Priya makes her board game circle-only.
  await priya.getByRole('link', { name: 'Explore' }).click();
  await priya.goto('/items/boardgame');
  const who = priya.getByRole('region', { name: 'Who can borrow it' });
  await who.getByLabel(/Just my circles/).check();
  await who.getByLabel('Board game night').check();
  await who.getByRole('button', { name: 'Save who can borrow it' }).click();
  await expect(priya.getByRole('status').filter({ hasText: 'Now just for your circles' }).first()).toBeVisible();

  // Jo cannot find it until she joins.
  await jo.getByRole('searchbox', { name: /search/i }).fill('island');
  await expect(jo.getByText('Nothing matches just yet')).toBeVisible();
  await jo.getByRole('link', { name: /Circles/ }).click();
  await jo.getByRole('region', { name: 'Invitations' }).locator('li', { hasText: 'Board game night' }).getByRole('button', { name: 'Join circle' }).click();
  await expect(jo.getByRole('region', { name: 'Shared in this circle' })).toContainText('Island-building board game');
});

test('@mobile circles work on a phone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Sam Okafor/ }).click();
  await page.getByRole('link', { name: /Circles/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Circles');
  await page.getByRole('link', { name: /Riverside Neighbours/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Riverside Neighbours');
  await expect(page.getByRole('region', { name: 'People' })).toContainText('Organiser');
  await expect(page.getByLabel('Invite someone')).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize().width);
});
