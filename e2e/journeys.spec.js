// Real user journeys in a real browser, two people side by side.
import { test, expect } from '@playwright/test';

async function signedIn(browser, who) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(who) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Hi ${who.split(' ')[0]}`);
  return page;
}

async function today(page) {
  return (await (await page.request.get('/api/config')).json()).today;
}
const rate = (page, label) => page.locator('label.rating-option', { hasText: label }).click();
const plus = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('two friends complete a whole loan, with separately attributed condition and a disagreement', async ({ browser }) => {
  const sam = await signedIn(browser, 'Sam Okafor');
  const maya = await signedIn(browser, 'Maya Chen');
  const t = await today(sam);

  // Sam finds the tent and asks for it.
  await sam.getByRole('searchbox', { name: /search/i }).fill('tent');
  await sam.getByRole('link', { name: /Four-person dome tent/ }).click();
  await expect(sam.getByRole('heading', { name: "Maya's lending rules" })).toBeVisible();
  await sam.getByLabel('Pick up').fill(t);
  await sam.getByLabel('Bring back').fill(plus(t, 2));
  await sam.getByLabel(/A note for Maya/).fill('Camping at the lake!');
  await sam.getByRole('button', { name: 'Send request' }).click();
  await expect(sam.getByRole('heading', { level: 1 })).toHaveText('Waiting for Maya to reply');
  await sam.reload();
  await expect(sam.getByRole('heading', { level: 1 })).toHaveText('Waiting for Maya to reply'); // persisted

  // Maya sees it waiting for her and approves.
  await maya.getByRole('link', { name: /Loans/ }).click();
  const row = maya.getByRole('region', { name: 'Needs you' }).getByRole('link', { name: /Four-person dome tent/ });
  await expect(row).toContainText('Sam would like to borrow this');
  await row.click();
  await maya.getByRole('button', { name: 'Approve' }).click();
  await expect(maya.getByRole('status').filter({ hasText: 'Approved' }).first()).toBeVisible();
  await maya.getByLabel(/Pickup note/).fill('In a bag by my door');
  await maya.getByRole('button', { name: "It's ready for pickup" }).click();
  await expect(maya.getByRole('heading', { level: 1 })).toHaveText('Waiting for Sam to pick it up');

  // Sam picks it up and records how it looked.
  await sam.reload();
  await expect(sam.getByRole('heading', { level: 1 })).toHaveText('Ready for you to pick up');
  await expect(sam.locator('blockquote', { hasText: 'In a bag by my door' })).toBeVisible();
  await rate(sam, 'Like new');
  await sam.getByRole('button', { name: 'Confirm pickup' }).click();
  await expect(sam.getByRole('heading', { level: 1 })).toContainText('You have it until');

  // Sam starts the return.
  await rate(sam, 'Good');
  await sam.getByLabel(/Notes/).fill('All poles and 14 stakes');
  await sam.getByRole('button', { name: 'Start the return' }).click();
  await expect(sam.getByRole('heading', { level: 1 })).toHaveText("Waiting for Maya to confirm it's back");

  // Maya confirms, but sees it differently.
  await maya.reload();
  await expect(maya.locator('p', { hasText: 'Sam says:' })).toContainText('All poles and 14 stakes');
  await rate(maya, 'Some wear');
  await maya.getByLabel(/I see its condition differently/).check();
  await maya.getByRole('button', { name: "Confirm it's back" }).click();
  await expect(maya.getByRole('alert')).toContainText("Say what's different");
  await maya.getByLabel(/Notes/).fill('Small tear near the door zip');
  await maya.getByRole('button', { name: "Confirm it's back" }).click();
  await expect(maya.getByRole('heading', { level: 1 })).toHaveText('Returned — you see its condition differently');

  // Both accounts are shown side by side, attributed, and the history names who did what.
  const evidence = maya.getByRole('region', { name: 'Condition — both sides' });
  await expect(evidence.getByText('All poles and 14 stakes')).toBeVisible();
  await expect(evidence.getByText('Small tear near the door zip')).toBeVisible();
  await expect(evidence.getByText('Sees it differently')).toBeVisible();
  const history = maya.getByRole('region', { name: 'History' });
  for (const line of ['Sam asked to borrow it', 'You approved the request', 'You marked it ready for pickup', 'Sam picked it up', 'Sam started the return', 'You confirmed it is back']) {
    await expect(history).toContainText(line);
  }
  await sam.reload();
  await expect(sam.getByRole('region', { name: 'Condition — both sides' }).getByText('Small tear near the door zip')).toBeVisible();
});

test('conflicting requests: once one is approved the overlapping one cannot be', async ({ browser }) => {
  const jo = await signedIn(browser, 'Jo Rivera');
  await jo.getByRole('link', { name: /Loans/ }).click();
  const needs = jo.getByRole('region', { name: 'Needs you' });
  await needs.getByRole('link', { name: /Stand mixer.*Sam would like/ }).click();
  await expect(jo.getByText(/Priya .* also asked for some of these days/)).toBeVisible();
  await jo.getByRole('button', { name: 'Approve' }).click();
  await expect(jo.getByRole('heading', { level: 1 })).toHaveText('You said yes to Sam');

  await jo.getByRole('link', { name: 'Loans', exact: true }).first().click();
  await needs.getByRole('link', { name: /Stand mixer.*Priya would like/ }).click();
  await expect(jo.getByText(/These dates overlap Sam's booking/)).toBeVisible();
  await expect(jo.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await jo.getByLabel(/Message to Priya/).fill('Sorry — Sam has it that weekend!');
  await jo.getByRole('button', { name: 'Decline' }).click();
  await expect(jo.getByRole('heading', { level: 1 })).toHaveText("You declined Priya's request");
});

test('extension: the owner accepts more time and the due date moves', async ({ browser }) => {
  const priya = await signedIn(browser, 'Priya Natarajan');
  await priya.getByRole('link', { name: /Loans/ }).click();
  await priya.getByRole('region', { name: 'Needs you' }).getByRole('link', { name: /Founder bookshelf/ }).click();
  await expect(priya.getByRole('heading', { name: 'Maya asked for more time' })).toBeVisible();
  await priya.getByRole('button', { name: 'Say yes' }).click();
  await expect(priya.getByText(/extended from/)).toBeVisible();
  await expect(priya.getByRole('region', { name: 'History' })).toContainText('You agreed to extend until');
});

test('the borrower of an overdue loan sees it clearly and can still return it', async ({ browser }) => {
  const jo = await signedIn(browser, 'Jo Rivera');
  await jo.getByRole('link', { name: /Loans/ }).click();
  await jo.getByRole('link', { name: /Mirrorless camera/ }).click();
  await expect(jo.getByRole('heading', { level: 1 })).toContainText('Overdue');
  await expect(jo.getByRole('alert')).toContainText('No stress');
  await rate(jo, 'Like new');
  await jo.getByRole('button', { name: 'Start the return' }).click();
  await expect(jo.getByRole('heading', { level: 1 })).toHaveText("Waiting for Sam to confirm it's back");
});

test('hiding an item stops new requests but keeps the agreed reservation', async ({ browser }) => {
  const jo = await signedIn(browser, 'Jo Rivera');
  await jo.getByRole('link', { name: /My shelf/ }).click();
  await jo.getByRole('link', { name: /Enamelled Dutch oven/ }).click();
  await jo.getByRole('button', { name: 'Hide from new requests' }).click();
  await expect(jo.getByRole('button', { name: 'Show to friends again' })).toBeVisible();
  await expect(jo.getByText(/Maya .*Mon|Maya · /).first()).toBeVisible();

  const sam = await signedIn(browser, 'Sam Okafor');
  await sam.getByRole('searchbox', { name: /search/i }).fill('dutch');
  await expect(sam.getByText('Nothing matches just yet')).toBeVisible();

  const maya = await signedIn(browser, 'Maya Chen');
  await maya.getByRole('link', { name: /Loans/ }).click();
  await expect(maya.getByRole('link', { name: /Enamelled Dutch oven/ })).toContainText('Approved');
});

test('an owner lists a new item with a photo and it appears in the catalog', async ({ browser }) => {
  const priya = await signedIn(browser, 'Priya Natarajan');
  await priya.getByRole('link', { name: /My shelf/ }).click();
  await priya.getByRole('link', { name: /Lend something/ }).click();
  await priya.getByRole('button', { name: 'List it' }).click();
  await expect(priya.getByRole('alert')).toContainText('title');
  await priya.getByLabel(/Title/).fill('Folding step ladder');
  await priya.getByLabel(/Category/).selectOption('Home & Garden');
  await priya.getByLabel(/Lending rules/).fill('Fold before carrying');
  await priya.locator('input[type=file]').setInputFiles('server/seed/photos/books.jpg');
  await expect(priya.getByRole('img', { name: 'Photo 1' })).toBeVisible();
  await priya.getByRole('button', { name: 'List it' }).click();
  await expect(priya.getByRole('heading', { level: 1 })).toHaveText('Folding step ladder');
  await expect(priya.getByRole('heading', { name: 'This is yours' })).toBeVisible();

  const sam = await signedIn(browser, 'Sam Okafor');
  await expect(sam.getByRole('link', { name: /Folding step ladder/ })).toBeVisible();
});

test('a double-clicked request creates exactly one request', async ({ browser }) => {
  const sam = await signedIn(browser, 'Sam Okafor');
  const t = await today(sam);
  await sam.goto('/items/projector');
  await sam.getByLabel('Pick up').fill(plus(t, 40));
  await sam.getByLabel('Bring back').fill(plus(t, 41));
  await sam.getByRole('button', { name: 'Send request' }).dblclick();
  await expect(sam.getByRole('heading', { level: 1 })).toHaveText('Waiting for Maya to reply');
  const list = await (await sam.request.get('/api/reservations')).json();
  expect(list.filter((r) => r.item.title === 'Vintage slide projector' && r.startDate === plus(t, 40))).toHaveLength(1);
});

test('keyboard only: choose a person, search, open an item', async ({ page }) => {
  await page.goto('/');
  const jo = page.getByRole('button', { name: /Jo Rivera/ });
  await expect(jo).toBeVisible();
  for (let i = 0; i < 5 && !(await jo.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(jo).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hi Jo');
  await page.getByRole('searchbox').focus();
  await page.keyboard.type('guitar');
  await expect(page.getByRole('link', { name: /Acoustic guitar/ })).toBeVisible();
  await page.keyboard.press('Tab');
  for (let i = 0; i < 20; i++) {
    if (await page.getByRole('link', { name: /Acoustic guitar/ }).evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Acoustic guitar');
});

test('@mobile the phone layout has a bottom tab bar and a working request form', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Priya Natarajan/ }).click();
  const nav = page.getByRole('navigation', { name: 'Main' });
  const box = await nav.boundingBox();
  const viewport = page.viewportSize();
  expect(box.y + box.height).toBeGreaterThan(viewport.height - 4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: /Acoustic guitar/ }).click();
  await expect(page.getByRole('heading', { name: 'Ask to borrow' })).toBeVisible();
  await nav.getByRole('link', { name: /Loans/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Loans');
});
