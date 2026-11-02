// Starting catalog, built from the original list plus the weekly meal rotation.
// IDs and timestamps are deterministic so two phones that seed separately
// produce identical data and merge without duplicates.

export const SEED_AT = new Date('2026-11-02T08:00:00').getTime();

export const slug = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

// Aisle order of a typical supermarket. Reorder in Settings.
const CATEGORIES = [
  ['produce', 'Fruits & Vegetables'],
  ['bakery', 'Bakery'],
  ['meat', 'Meat & Fish'],
  ['dairy', 'Dairy & Eggs'],
  ['breakfast', 'Breakfast & Spreads'],
  ['pantry', 'Pasta, Rice & Grains'],
  ['sauces', 'Sauces & Canned'],
  ['spices', 'Spices & Baking'],
  ['snacks', 'Snacks & Sweets'],
  ['drinks', 'Drinks'],
  ['household', 'Cleaning & Household'],
  ['personal', 'Personal Care'],
  ['health', 'Health'],
  ['other', 'Other'],
];

// [name, category, interval in days (null = as needed)]
const ITEMS = [
  // Every 2 to 3 days: fresh food for breakfast and daily meals
  ['Bread', 'bakery', 2],
  ['Milk', 'dairy', 3],
  ['Avocados', 'produce', 3],
  ['Tomatoes', 'produce', 3],
  ['Salad', 'produce', 3],
  ['Mint (Na3na3)', 'produce', 3],
  ['Water 5 L', 'drinks', 3],
  ['Chicken breast', 'meat', 4],
  // About weekly
  ['Eggs', 'dairy', 5],
  ['Yogurt (Danone / Perly)', 'dairy', 5],
  ['Mushrooms', 'produce', 5],
  ['Ground beef', 'meat', 5],
  ['Fruits for smoothies', 'produce', 5],
  ['Potatoes', 'produce', 7],
  ['Cheese', 'dairy', 7],
  ['Cream cheese', 'dairy', 7],
  ['Cooking cream', 'dairy', 7],
  ['Turkey ham', 'meat', 7],
  ['Tortillas', 'bakery', 7],
  ['Pasta', 'pantry', 7],
  ['Tuna', 'sauces', 7],
  ['Snacks', 'snacks', 7],
  ['Coca-Cola', 'drinks', 7],
  ['Red Bull', 'drinks', 7],
  ['Onions', 'produce', 10],
  ['Crème fraîche', 'dairy', 10],
  // About every 2 weeks
  ['Coffee', 'breakfast', 14],
  ['Oatmeal', 'breakfast', 14],
  ['Cereal', 'breakfast', 14],
  ['Rice', 'pantry', 14],
  ['Spaghetti', 'pantry', 14],
  ['Macaroni', 'pantry', 14],
  ['Tomato sauce', 'sauces', 14],
  ['Dark chocolate', 'snacks', 14],
  ['Bimo Zero', 'snacks', 14],
  ['Tissues (Klinex)', 'household', 14],
  ['Toilet paper', 'household', 14],
  ['Kitchen paper', 'household', 14],
  ['Peanut butter', 'breakfast', 21],
  ['Mayonnaise', 'sauces', 21],
  ['Fairy (dish soap)', 'household', 21],
  // About monthly
  ['Chia seeds', 'breakfast', 30],
  ['Soy sauce (dark)', 'sauces', 30],
  ['Laundry detergent (Ariel)', 'household', 30],
  ['Downy', 'household', 30],
  ['Bleach (Javel)', 'household', 30],
  ['Toilet freshener', 'household', 30],
  ['Shampoo', 'personal', 30],
  ['Conditioner', 'personal', 30],
  ['Shower gel', 'personal', 30],
  ['Toothpaste (Colgate)', 'personal', 30],
  ['Hand soap', 'personal', 30],
  ['Bar soap (Dove / Protex)', 'personal', 30],
  ['Deodorant (Narta / Nivea)', 'personal', 30],
  ['Garlic powder', 'spices', 45],
  ['Smoked paprika', 'spices', 45],
  ['Kefta spices', 'spices', 45],
  ['Salt', 'spices', 60],
  ['MSG', 'spices', 60],
  // As needed: kept in the catalog for quick adding, never predicted
  ['Croissants', 'bakery', null],
  ['Hulala cream', 'dairy', null],
  ['Melange', 'dairy', null],
  ['Prunes (Ber9o9)', 'breakfast', null],
  ['Sushi rice', 'pantry', null],
  ['Seaweed', 'pantry', null],
  ['Flour (Dguig)', 'pantry', null],
  ['Pizza sauce', 'sauces', null],
  ['Crispy onions', 'sauces', null],
  ['Pink salt', 'spices', null],
  ['Fries seasoning mix', 'spices', null],
  ['Meat seasoning mix', 'spices', null],
  ['Brownie mix', 'spices', null],
  ['Vanilla mousse', 'spices', null],
  ['Pizza stuff', 'spices', null],
  ['Pistachios', 'snacks', null],
  ['Syrup', 'drinks', null],
  ['Laundry pods', 'household', null],
  ['Glass cleaner', 'household', null],
  ['Wet alcohol wipes', 'household', null],
  ['Ziplock bags', 'household', null],
  ['Plastic cups', 'household', null],
  ['Coffee cups (Kissan)', 'household', null],
  ['Lighter (Brika)', 'household', null],
  ['Cockroach spray (Baygon / Zentek / Raid)', 'household', null],
  ['Washing machine cleaner', 'household', null],
  ['Lint roller', 'household', null],
  ['Shoe cleaner', 'household', null],
  ['Super glue', 'household', null],
  ['Bucket', 'household', null],
  ['Hair oil', 'personal', null],
  ['Hair product', 'personal', null],
  ['Rice water', 'personal', null],
  ['Toothbrush (Oral-B)', 'personal', null],
  ['Ear swabs', 'personal', null],
  ['Hairbrush', 'personal', null],
  ['Pills', 'health', null],
  ['Band-aids', 'health', null],
  ['Socks', 'other', null],
  ['Bed sheet', 'other', null],
  ['USB cable', 'other', null],
  ['Screwdriver', 'other', null],
  ['Lock', 'other', null],
  ['Kitchen stuff (Cousina)', 'other', null],
  ['Liggat dyal cousina', 'other', null],
  ['Dahmis', 'other', null],
];

// What was on the "to buy" part of the original list.
const NEEDED_NOW = [
  'Pasta',
  'Coffee',
  'Tissues (Klinex)',
  'Chicken breast',
  'Mint (Na3na3)',
  'Cream cheese',
  'Water 5 L',
  'Bread',
  'Fairy (dish soap)',
];

const MEALS = [
  ['Breakfast', ['Eggs', 'Cheese', 'Avocados', 'Tomatoes', 'Milk', 'Coffee', 'Bread']],
  ['Potatoes & minced meat', ['Potatoes', 'Ground beef', 'Onions', 'Kefta spices']],
  ['Chicken pasta, mushroom soy sauce', ['Chicken breast', 'Pasta', 'Mushrooms', 'Soy sauce (dark)', 'Cooking cream']],
  ['Tuna bowl', ['Tuna', 'Rice', 'Avocados', 'Mayonnaise']],
  ['Tuna sandwich', ['Tuna', 'Bread', 'Mayonnaise', 'Tomatoes', 'Salad']],
];

export const itemId = (name) => 'i_' + slug(name);

export function buildSeed() {
  const ts = 1; // older than any real edit, so real edits always win a merge
  const categories = {};
  CATEGORIES.forEach(([id, name], i) => {
    categories[id] = { id, name, order: i, updatedAt: ts };
  });
  const items = {};
  for (const [name, cat, interval] of ITEMS) {
    const id = itemId(name);
    items[id] = {
      id,
      name,
      cat,
      mode: interval == null ? 'none' : 'auto',
      interval: interval ?? 7,
      needed: NEEDED_NOW.includes(name),
      baselineAt: SEED_AT,
      updatedAt: ts,
    };
  }
  const meals = {};
  for (const [name, ingredients] of MEALS) {
    const id = 'm_' + slug(name);
    meals[id] = { id, name, items: ingredients.map(itemId), updatedAt: ts };
  }
  return { schema: 1, categories, items, purchases: {}, meals };
}
