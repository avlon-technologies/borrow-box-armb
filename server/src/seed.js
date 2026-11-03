// Repeatable demo seed. Everything is created through the same services the API uses, with a
// clock moved through the recent past, so the journal and evidence look like real history.
//   node server/src/seed.js --reset     wipe data/ and seed afresh
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDatabase, inTransaction } from './db.js';
import { DEFAULT_TIME_ZONE, todayIn, addDays } from './dates.js';
import * as catalog from './catalog.js';
import * as borrowing from './borrowing.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PHOTOS = join(HERE, '..', 'seed', 'photos');

export const PEOPLE = [
  { id: 'p-maya', handle: 'maya', name: 'Maya Chen', neighborhood: 'Riverside', color: '#C8553D', bio: 'Weekend camper, occasional fixer of things. Happy to lend — just bring it back clean.' },
  { id: 'p-sam', handle: 'sam', name: 'Sam Okafor', neighborhood: 'Elm Street', color: '#3E7C6B', bio: 'Photographer and cyclist. Ask me anything about lenses.' },
  { id: 'p-jo', handle: 'jo', name: 'Jo Rivera', neighborhood: 'Old Mill', color: '#6A5ACD', bio: 'I bake far too much and own far too many pots.' },
  { id: 'p-priya', handle: 'priya', name: 'Priya Natarajan', neighborhood: 'Riverside', color: '#B8860B', bio: 'Board-game host and reader. My shelves are your shelves.' },
];

const photo = (file) => `data:image/jpeg;base64,${readFileSync(join(PHOTOS, file)).toString('base64')}`;

export const ITEMS = [
  { slug: 'tent', owner: 'p-maya', file: 'tent.jpg', title: 'Four-person dome tent', category: 'Outdoors', maxLoanDays: 7, pickupArea: 'Riverside, by the park gate',
    description: 'Roomy, bright and easy to pitch — two poles, about ten minutes. Comes with footprint, stakes and a mallet. Kept me dry through a very wet Algonquin weekend.',
    lendingRules: 'Please dry it fully before packing it away.\nNo shoes inside, no open flames nearby.\nCount the stakes back in — there are 14.' },
  { slug: 'drill', owner: 'p-maya', file: 'drill.jpg', title: 'Cordless hammer drill', category: 'Tools', maxLoanDays: 3, pickupArea: 'Riverside',
    description: '18V hammer drill with two batteries and a mixed bit set. Good for shelves, fences and the odd masonry job.',
    lendingRules: 'Return the batteries charged.\nMasonry bits are fine to use; tell me if one breaks so I can replace it.' },
  { slug: 'projector', owner: 'p-maya', file: 'projector.jpg', title: 'Vintage slide projector', category: 'Tech & Photo', maxLoanDays: 10, pickupArea: 'Riverside',
    description: 'A working 1970s carousel projector. Perfect for family slide nights or a retro party. Includes one empty carousel and a spare bulb.',
    lendingRules: 'Let it cool before moving it — the bulb is fragile when hot.\nIndoor use only.' },
  { slug: 'guitar', owner: 'p-maya', file: 'guitar.jpg', title: 'Acoustic guitar', category: 'Music', maxLoanDays: 14, pickupArea: 'Riverside',
    description: 'Warm-sounding dreadnought with a soft case, capo and spare strings. Great for learning or campfire evenings.',
    lendingRules: 'Keep it in its case when not playing.\nAway from radiators, please.' },
  { slug: 'bike', owner: 'p-sam', file: 'bike.jpg', title: 'Single-speed city bike', category: 'Bikes & Sport', maxLoanDays: 5, pickupArea: 'Elm Street, back gate',
    description: 'Light steel frame, leather saddle, 56 cm. Comes with a lock and lights. Ideal for getting around town.',
    lendingRules: 'Always lock it to something solid.\nLights on after dusk.\nMedium height riders (5\'7"–6\'0") will be most comfortable.' },
  { slug: 'camera', owner: 'p-sam', file: 'camera.jpg', title: 'Mirrorless camera + three lenses', category: 'Tech & Photo', maxLoanDays: 4, pickupArea: 'Elm Street',
    description: 'Full-frame mirrorless body with 24 mm, 40 mm and 50 mm primes. Two batteries, charger and a 64 GB card.',
    lendingRules: 'Please wipe the card or copy your photos off before returning.\nNo beach or rain without the cover — it\'s in the bag.' },
  { slug: 'mixer', owner: 'p-jo', file: 'mixer.jpg', title: 'Stand mixer', category: 'Kitchen', maxLoanDays: 4, pickupArea: 'Old Mill',
    description: 'Retro stand mixer with whisk, paddle and dough hook. Has survived a hundred loaves of bread.',
    lendingRules: 'Wash the attachments by hand, not in the dishwasher.\nIt\'s heavy — I can help carry it to your car.' },
  { slug: 'dutch-oven', owner: 'p-jo', file: 'dutch-oven.jpg', title: 'Enamelled Dutch oven pair', category: 'Kitchen', maxLoanDays: 7, pickupArea: 'Old Mill',
    description: 'Two cast-iron casseroles (4 L and 6 L) for stews, braises and no-knead bread.',
    lendingRules: 'No metal scourers on the enamel.\nLet them cool before washing.' },
  { slug: 'books', owner: 'p-priya', file: 'books.jpg', title: 'Founder bookshelf bundle', category: 'Books', maxLoanDays: 21, pickupArea: 'Riverside',
    description: 'Eight well-loved books on starting and running small ventures. Borrow the stack or ask for just one.',
    lendingRules: 'Pencil notes are welcome; pen and highlighter are not.' },
  { slug: 'boardgame', owner: 'p-priya', file: 'boardgame.jpg', title: 'Island-building board game', category: 'Games', maxLoanDays: 7, pickupArea: 'Riverside',
    description: 'The classic trade-and-build strategy game, with the 5–6 player expansion. All pieces counted and bagged.',
    lendingRules: 'Please count the pieces back into their bags — there\'s a checklist in the lid.' },
];

/** Seed into an open database. `timeZone` decides what "today" means for the relative dates. */
export function seed(db, { uploadsDir, timeZone = DEFAULT_TIME_ZONE, realNow = new Date() } = {}) {
  let clock = new Date(realNow);
  const ctx = { db, timeZone, uploadsDir, now: () => clock, today: () => todayIn(timeZone, clock) };
  const today = todayIn(timeZone, realNow);
  const at = (dayOffset, hour = 10) => {
    const d = new Date(realNow);
    d.setTime(d.getTime() + dayOffset * 86400000);
    d.setUTCHours(hour + 5, 0, 0, 0); // daytime in North American zones
    clock = d;
  };
  const day = (n) => addDays(today, n);
  const person = (id) => ({ id });
  const tx = (fn) => inTransaction(db, fn);

  tx(() => {
    const insert = db.prepare('INSERT INTO people (id, handle, name, bio, neighborhood, color) VALUES (?, ?, ?, ?, ?, ?)');
    for (const p of PEOPLE) insert.run(p.id, p.handle, p.name, p.bio, p.neighborhood, p.color);
  });
  const items = {};
  ITEMS.forEach((it, i) => {
    at(-60 + i, 9);
    tx(() => {
      const view = catalog.listItem(ctx, person(it.owner), { ...it, photo: photo(it.file) });
      db.prepare('UPDATE items SET slug = ? WHERE id = ?').run(it.slug, view.id);
      items[it.slug] = view.id;
    });
  });

  const maya = person('p-maya'), sam = person('p-sam'), jo = person('p-jo'), priya = person('p-priya');

  // 1. A finished loan with both accounts of condition and a preserved disagreement.
  at(-30, 9);
  const finished = tx(() => borrowing.requestToBorrow(ctx, maya, items.boardgame, { startDate: day(-28), endDate: day(-25), note: 'Game night for my cousins — would love the expansion too!' }));
  at(-29, 14); tx(() => borrowing.approveRequest(ctx, priya, finished, { note: 'Of course! Enjoy.' }));
  at(-28, 8); tx(() => borrowing.markReady(ctx, priya, finished, { note: "It's on the bench inside my porch." }));
  at(-28, 18); tx(() => borrowing.confirmPickup(ctx, maya, finished, { rating: 'like-new', note: 'Got it, everything bagged.' }));
  at(-25, 19); tx(() => borrowing.startReturn(ctx, maya, finished, { rating: 'good', note: 'Counted everything back in. Box corner got a little bent in my bag, sorry!' }));
  at(-24, 11); tx(() => borrowing.confirmReturn(ctx, priya, finished, { rating: 'worn', disagrees: true, note: 'Thanks! Two wheat cards are missing and the box corner is split, not just bent.' }));
  at(-24, 20); tx(() => borrowing.addConditionNote(ctx, maya, finished, { note: 'Found the two wheat cards under my sofa — dropping them off tomorrow. So sorry about the box.' }));

  // 2. An overdue loan: Jo still has Sam's camera, due yesterday.
  at(-5, 10);
  const overdue = tx(() => borrowing.requestToBorrow(ctx, jo, items.camera, { startDate: day(-4), endDate: day(-1), note: 'Shooting my sister\'s engagement photos on Saturday.' }));
  at(-5, 15); tx(() => borrowing.approveRequest(ctx, sam, overdue));
  at(-4, 9); tx(() => borrowing.markReady(ctx, sam, overdue, { note: 'Batteries charged. Bag is by the back gate.' }));
  at(-4, 12); tx(() => borrowing.confirmPickup(ctx, jo, overdue, { rating: 'like-new', note: 'All three lenses, two batteries, card is empty.' }));

  // 3. Two overlapping pending requests for Jo's stand mixer — Jo can approve only one.
  at(-2, 10);
  tx(() => borrowing.requestToBorrow(ctx, sam, items.mixer, { startDate: day(3), endDate: day(5), note: 'Bread-making weekend with my kids.' }));
  at(-1, 16);
  tx(() => borrowing.requestToBorrow(ctx, priya, items.mixer, { startDate: day(4), endDate: day(6), note: 'Birthday cake marathon 🎂' }));

  // 4. Ready for pickup: Priya is borrowing Sam's bike tomorrow.
  at(-3, 11);
  const bike = tx(() => borrowing.requestToBorrow(ctx, priya, items.bike, { startDate: day(1), endDate: day(4), note: 'Visiting the farmers market and the lake.' }));
  at(-2, 9); tx(() => borrowing.approveRequest(ctx, sam, bike));
  at(0, 8); tx(() => borrowing.markReady(ctx, sam, bike, { note: 'Tyres pumped. Lock code is on a tag under the saddle.' }));

  // 5. On loan with a pending request for more time: Maya has Priya's books.
  at(-9, 12);
  const books = tx(() => borrowing.requestToBorrow(ctx, maya, items.books, { startDate: day(-8), endDate: day(5), note: 'Reading club starts next week!' }));
  at(-9, 18); tx(() => borrowing.approveRequest(ctx, priya, books));
  at(-8, 9); tx(() => borrowing.markReady(ctx, priya, books));
  at(-8, 17); tx(() => borrowing.confirmPickup(ctx, maya, books, { rating: 'good', note: 'Eight books, a few with dog-eared corners already.' }));
  at(0, 7); tx(() => borrowing.proposeExtension(ctx, maya, books, { proposedEndDate: day(9), note: "Club moved to the following Thursday — could I keep them a few more days?" }));

  // 6. Approved, coming up: Maya is borrowing Jo's Dutch ovens next week.
  at(-1, 12);
  const ovens = tx(() => borrowing.requestToBorrow(ctx, maya, items['dutch-oven'], { startDate: day(7), endDate: day(9), note: 'Cooking for twelve at the lake house.' }));
  at(-1, 19); tx(() => borrowing.approveRequest(ctx, jo, ovens, { note: 'Yes! The big one is perfect for chili.' }));

  return { items, today };
}

export function resetAndSeed({ dataDir = process.env.BORROWBOX_DATA ?? join(ROOT, 'data'), timeZone = process.env.BORROWBOX_TZ ?? DEFAULT_TIME_ZONE } = {}) {
  const dbFile = join(dataDir, 'borrowbox.sqlite');
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) if (existsSync(f)) rmSync(f);
  rmSync(join(dataDir, 'uploads'), { recursive: true, force: true });
  const db = openDatabase(dbFile);
  const result = seed(db, { uploadsDir: join(dataDir, 'uploads'), timeZone });
  db.close();
  return { dbFile, ...result };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--reset')) {
    console.error('Usage: node server/src/seed.js --reset   (wipes data/ and seeds the demo library)');
    process.exit(2);
  }
  try {
    const { dbFile, today } = resetAndSeed();
    console.log(`Seeded ${PEOPLE.length} people and ${ITEMS.length} items into ${dbFile} (today is ${today}).`);
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') console.error('The database is in use — stop the running server first, then seed again.');
    else console.error(err);
    process.exit(1);
  }
}
