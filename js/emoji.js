// Icons shown at a glance: one per category, and a best guess per item for the grid view.

export const CATEGORY_ICONS = {
  produce: '🥬',
  bakery: '🥖',
  meat: '🥩',
  dairy: '🥛',
  breakfast: '🥣',
  pantry: '🍝',
  sauces: '🥫',
  spices: '🧂',
  snacks: '🍫',
  drinks: '🥤',
  household: '🧽',
  personal: '🧴',
  health: '💊',
  other: '📦',
};

export const ICON_CHOICES = ['🥬', '🍎', '🥖', '🥩', '🐟', '🥛', '🧀', '🥣', '🍝', '🥫', '🧂', '🍫', '🥤', '☕', '🧊', '🧽', '🧺', '🧴', '💊', '👶', '🐾', '🌿', '🏠', '📦'];

// First matching keyword wins, so more specific words come first.
const ITEM_RULES = [
  [/avoca/, '🥑'], [/tomat/, '🍅'], [/potato/, '🥔'], [/onion/, '🧅'], [/mushroom/, '🍄'], [/salad|lettuce/, '🥗'],
  [/mint|na3na3/, '🌿'], [/fruit|smoothie/, '🍓'], [/banana/, '🍌'], [/apple/, '🍎'], [/lemon/, '🍋'], [/garlic/, '🧄'],
  [/croissant/, '🥐'], [/tortilla/, '🫓'], [/bread|baguette/, '🍞'],
  [/chicken/, '🍗'], [/beef|kefta|meat(?!.*mix)/, '🥩'], [/ham|turkey/, '🥓'], [/tuna|fish|thon/, '🐟'],
  [/egg/, '🥚'], [/cream cheese|cheese|fromage/, '🧀'], [/yogurt|danone|perly/, '🥛'], [/milk/, '🥛'], [/cream|creme|crème/, '🥛'],
  [/coffee(?! cups)/, '☕'], [/oat|cereal/, '🥣'], [/peanut/, '🥜'], [/chia|seed/, '🌱'], [/prune|ber9o9/, '🫐'],
  [/sushi rice|rice(?! water)/, '🍚'], [/spaghetti|pasta|macaroni/, '🍝'], [/seaweed/, '🍙'], [/flour|dguig/, '🌾'],
  [/soy/, '🥢'], [/mayo/, '🥚'], [/sauce/, '🥫'], [/crispy onion/, '🧅'],
  [/salt|msg/, '🧂'], [/paprika|spice|seasoning|garlic powder/, '🌶️'], [/brownie|vanilla|mousse/, '🧁'], [/pizza/, '🍕'],
  [/chocolate/, '🍫'], [/pistach|nut/, '🥜'], [/bimo|biscuit|cookie|snack/, '🍪'],
  [/water(?! machine)/, '💧'], [/cola|coke|soda/, '🥤'], [/red bull|energy/, '⚡'], [/syrup|sirop/, '🍯'],
  [/toilet paper|tissue|klinex|kitchen paper/, '🧻'], [/toilet/, '🚽'], [/dish|fairy/, '🍽️'],
  [/laundry|ariel|downy|pods/, '🧺'], [/bleach|javel|cleaner|wipes/, '🧽'], [/cockroach|baygon|raid|zentek/, '🪳'],
  [/ziplock|bag/, '🛍️'], [/cups/, '🥤'], [/lighter|brika/, '🔥'], [/glue/, '🧴'], [/bucket/, '🪣'], [/lint/, '🧹'],
  [/shampoo|conditioner|shower|gel|hair oil|hair product|rice water/, '🧴'], [/toothpaste|colgate|toothbrush|oral/, '🪥'],
  [/soap/, '🧼'], [/deodor|narta|nivea/, '🧴'], [/ear/, '👂'], [/hairbrush|brush/, '🪮'],
  [/pill|medic/, '💊'], [/band/, '🩹'], [/sock/, '🧦'], [/sheet/, '🛏️'], [/usb|cable/, '🔌'], [/screwdriver|tool/, '🪛'], [/lock/, '🔒'],
];

export function guessItemIcon(name) {
  const n = name.toLowerCase();
  for (const [re, icon] of ITEM_RULES) if (re.test(n)) return icon;
  return null;
}
