# Restock

A shared grocery list for two iPhones that learns how often you buy things.
No App Store, no install: it's a web app you add to your home screen.

## How it works

- **Items** each have a rhythm: *Learn* (starts from a guess and adapts), *Fixed*, or *As needed*.
- **Shopping List** fills itself with items that are due, plus anything you add.
  Tap the circle when it's in the cart: that records the purchase and teaches the app.
- **Coming up** shows what runs out in the next few days, so you can grab it now and skip a trip.
- **Still have some** hides an item for a while without counting it as bought.
- **Meals**: open a meal and add its missing ingredients in one tap.
- **Grid view** by default: tap a tile when it's in the cart, hold it for details. List and Compact views via the top-right button.
- **Adding**: tap "Add an item" for one-tap chips (running low, staples), search your items, or create a new one.
  New items get a guessed icon, category and rhythm from their name (`js/knowledge.js`).
- **Item details**: stock meter, add/bought/still-have actions, rhythm settings, learned insight, purchase history.
- **Settings**: name, list style, look-ahead, aisle order (drag to reorder), partner sync, backup.

### Learning
Each "Learn" item starts from its guessed interval. Every time you buy it, the gap since the last
purchase moves the estimate (weighted moving average, recent buys count more). Single odd gaps such
as a vacation are clamped so they can't wreck the estimate, but repeated evidence still wins.
Taps within 12 hours count as one trip. See `js/predict.js`.

### Sync
Data lives in `data.json` in a **private** GitHub repo. Each phone pulls, merges per record
(newest edit wins, deletes are tombstones), and pushes. If both phones push at once, GitHub rejects
the stale one, which re-pulls and merges. Syncs every 15 s while open and a few seconds after each change.
Works offline; changes sync when back online.

## Install on iPhone

1. Open the app URL in **Safari** → Share → **Add to Home Screen**.
2. Open **Restock** from the home screen (it has its own storage, separate from Safari).
3. Settings → *Your name*.

### First phone: set up sync (once)
1. Create a private repo, e.g. `restock-data` (empty is fine).
2. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token.
   - Repository access: **Only select repositories** → `restock-data`
   - Permissions → Repository → **Contents: Read and write**
   - Expiration: the longest available. When it expires, the app shows a sync error; make a new one.
3. In the app: Settings → **Set up sync**, paste the token.

### Second phone: join
On the first phone: Settings → **Invite partner** → share the link privately (it contains the token).
On the second phone: open the link in Safari, add to home screen, open the app, **I have a code** → paste.

## Development

Plain HTML/CSS/JS modules, no build step.

```bash
npm start   # http://localhost:8080
npm test    # unit tests for learning and merge
```

Starting catalog and meals: `js/seed.js`. After changing app files, bump `CACHE` in `sw.js`.
