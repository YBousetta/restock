// What Restock "knows" about groceries: icons and categories guessed from a name.

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

// Sensible starting rhythm per category for new items (days, null = as needed).
export const CATEGORY_RHYTHM = {
  produce: 3,
  bakery: 2,
  meat: 5,
  dairy: 5,
  breakfast: 14,
  pantry: 14,
  sauces: 21,
  spices: 60,
  snacks: 7,
  drinks: 7,
  household: 30,
  personal: 30,
  health: null,
  other: null,
};

export const ICON_CHOICES = [
  '🥬', '🍎', '🍌', '🍋', '🍓', '🥑', '🍅', '🥔', '🧅', '🥕', '🥒', '🌶️',
  '🥖', '🍞', '🥐', '🥩', '🍗', '🐟', '🥚', '🥛', '🧀', '🧈', '🥣', '☕',
  '🍝', '🍚', '🥫', '🧂', '🍯', '🫒', '🍫', '🍪', '🥜', '🍦', '🥤', '💧',
  '🧃', '🍵', '🧽', '🧻', '🧺', '🧼', '🧴', '🪥', '💊', '🩹', '🐾', '📦',
];

// [pattern, icon, category]. First match wins, so specific words come first.
const RULES = [
  // fruits & vegetables
  [/rice water/, '🧴', 'personal'], [/olive oil|vegetable oil|sunflower oil|huile/, '🫒', 'pantry'], [/laughing cow|vache qui rit/, '🧀', 'dairy'], [/ice cream|glace vanille/, '🍦', 'snacks'], [/juice|\bjus\b|3asir/, '🧃', 'drinks'],
  [/tomato sauce|sauce tomate|tomato paste|pizza sauce/, '🥫', 'sauces'], [/garlic powder|onion powder|black pepper/, '🌶️', 'spices'],
  [/avoca|avocat/, '🥑', 'produce'], [/tomat/, '🍅', 'produce'], [/potato|patate|pomme de terre|btata/, '🥔', 'produce'],
  [/crispy onion/, '🧅', 'sauces'], [/onion|oignon|bsla/, '🧅', 'produce'], [/mushroom|champignon/, '🍄', 'produce'],
  [/salad|lettuce|laitue|khass/, '🥗', 'produce'], [/mint|na3na3|menthe/, '🌿', 'produce'],
  [/parsley|persil|ma3dnous|coriander|coriandre|kosbor|basil|herb/, '🌿', 'produce'],
  [/smoothie|berr|strawberr|fraise/, '🍓', 'produce'], [/banana|banane|banan/, '🍌', 'produce'], [/apple|pomme/, '🍎', 'produce'],
  [/lemon|citron|\blime\b|l7amd/, '🍋', 'produce'], [/orange|limoun/, '🍊', 'produce'], [/grape|raisin/, '🍇', 'produce'],
  [/melon|watermelon|dela7/, '🍉', 'produce'], [/carrot|carotte|khizou/, '🥕', 'produce'], [/cucumber|concombre|khiar/, '🥒', 'produce'],
  [/bell pepper|poivron|felfla/, '🫑', 'produce'], [/zucchini|courgette/, '🥒', 'produce'],
  [/garlic|\bail\b|touma/, '🧄', 'produce'], [/ginger|gingembre/, '🫚', 'produce'], [/eggplant|aubergine|broccoli|spinach|cabbage/, '🥦', 'produce'],
  [/fruit|vegetable|legume/, '🍎', 'produce'],
  // bakery
  [/croissant/, '🥐', 'bakery'], [/tortilla|\bwraps?\b|\bpita\b|msemen|harcha|batbout/, '🫓', 'bakery'],
  [/bread|baguette|brot|pain|khobz/, '🍞', 'bakery'], [/cake|muffin|donut/, '🧁', 'bakery'],
  // meat & fish
  [/chicken|poulet|djaj/, '🍗', 'meat'], [/turkey|dinde|\bham\b|jambon|bacon|sausage|saucisse|merguez/, '🥓', 'meat'],
  [/ground beef|minced|hachée|hache|kefta(?! spice)/, '🥩', 'meat'], [/beef|boeuf|steak|lamb|agneau|meat(?! seasoning| mix)|l7am/, '🥩', 'meat'],
  [/salmon|saumon|shrimp|crevette|sardine|fish|poisson|hout/, '🐟', 'meat'],
  // dairy
  [/peanut butter/, '🥜', 'breakfast'], [/egg|oeuf|\bbid\b/, '🥚', 'dairy'], [/butter|beurre|zebda/, '🧈', 'dairy'],
  [/cream cheese|cheese|fromage|jben|mozzarella|cheddar|feta/, '🧀', 'dairy'],
  [/yogurt|yoghurt|yaourt|danone|perly|raib|labneh|lben/, '🥛', 'dairy'], [/milk|lait|7lib/, '🥛', 'dairy'],
  [/cooking cream|creme|crème|cream(?! cheese)|hulala/, '🥛', 'dairy'],
  // breakfast
  [/coffee(?! cups)|café|cafe|nescafe|qahwa|kahwa/, '☕', 'breakfast'], [/\btea\b|thé|atay/, '🍵', 'breakfast'],
  [/oat|cereal|granola|muesli|corn flakes/, '🥣', 'breakfast'], [/nutella|\bjam\b|confiture|honey|miel|3sel/, '🍯', 'breakfast'],
  [/chia|flax|seed/, '🌱', 'breakfast'], [/prune|ber9o9|\bdates?\b|tmar/, '🫐', 'breakfast'],
  // pantry
  [/sushi rice|rice(?! water)|riz|rouz/, '🍚', 'pantry'], [/spaghetti|pasta|macaroni|penne|noodle|pâtes|pates|lasagn/, '🍝', 'pantry'],
  [/seaweed|nori/, '🍙', 'pantry'], [/flour|farine|dguig|semolina|semoule|couscous/, '🌾', 'pantry'],
  [/lentil|lentille|chickpea|pois chiche|bean|haricot|loubia|3dess/, '🫘', 'pantry'], [/sugar|sucre|sokar/, '🍬', 'pantry'],
  [/olive oil|huile|(?<!hair )\boil\b|\bzit\b/, '🫒', 'pantry'], [/olive|zitoun/, '🫒', 'pantry'],
  // sauces & canned
  [/soy|soja/, '🥢', 'sauces'], [/mayo/, '🥚', 'sauces'], [/ketchup|mustard|moutarde|harissa/, '🥫', 'sauces'],
  [/pizza sauce|sauce|tomato paste|concentré/, '🥫', 'sauces'], [/tuna|thon|tam\b/, '🐟', 'sauces'], [/canned|conserve/, '🥫', 'sauces'],
  // spices & baking
  [/pink salt|\bsalt\b|\bsel\b|mel7|\bmsg\b/, '🧂', 'spices'], [/paprika|cumin|kamoun|pepper|spice|epice|épice|seasoning|ras el hanout|curry|turmeric|cinnamon|cannelle|9erfa/, '🌶️', 'spices'],
  [/brownie|vanilla|vanille|mousse|baking|yeast|levure/, '🧁', 'spices'], [/pizza/, '🍕', 'spices'],
  // snacks
  [/chocolate|chocolat/, '🍫', 'snacks'], [/pistach|almond|amande|nut|cacahuète|kawkaw/, '🥜', 'snacks'],
  [/bimo|biscuit|cookie|gateau|snack|chips/, '🍪', 'snacks'], [/ice cream|glace(?! cleaner)/, '🍦', 'snacks'],
  // drinks
  [/water 5|water(?! machine)|\beau\b|sidi ali|ain saiss|\blma\b/, '💧', 'drinks'], [/cola|coke|soda|fanta|sprite|pepsi|hawai/, '🥤', 'drinks'],
  [/red bull|energy|monster/, '⚡', 'drinks'], [/juice|jus|3asir/, '🧃', 'drinks'], [/syrup|sirop/, '🍯', 'drinks'],
  // household
  [/toilet paper|papier toilette|tissue|klinex|kleenex|kitchen paper|papier cuisine|sopalin/, '🧻', 'household'],
  [/toilet|wc/, '🚽', 'household'], [/dish|fairy|vaisselle|sponge|eponge|éponge/, '🍽️', 'household'],
  [/laundry|ariel|downy|pods|lessive|tide|omo|softener/, '🧺', 'household'],
  [/bleach|javel|cleaner|wipes|lingette|nettoy|glass/, '🧽', 'household'], [/cockroach|baygon|byegon|raid|zentek|zentec|insect/, '🪳', 'household'],
  [/trash|garbage|poubelle|ziplock|bag|sac|foil|aluminium|cling|film/, '🛍️', 'household'],
  [/cups|kass|kissan|plate|assiette/, '🥤', 'household'], [/lighter|brika|briquet/, '🔥', 'household'], [/glue|colle/, '🧴', 'household'],
  [/bucket|seau/, '🪣', 'household'], [/lint|roller/, '🧹', 'household'], [/batter(y|ies)|\bpiles?\b|bulb|ampoule/, '🔋', 'household'],
  // personal care
  [/shampoo|shampooing|conditioner|apres|après|after shampoo|shower|douche|gel|hair oil|hair product|rice water/, '🧴', 'personal'],
  [/toothpaste|colgate|signal|dentifrice|toothbrush|brosse à dents|oral|mouthwash/, '🪥', 'personal'],
  [/soap|savon|sabon|dove|protex/, '🧼', 'personal'], [/deodor|diodor|narta|nivea|rexona|lotion/, '🧴', 'personal'],
  [/razor|rasoir|shav|gillette/, '🪒', 'personal'], [/\bear\b|coton|cotton|q-?tip/, '👂', 'personal'], [/hairbrush|brush|peigne/, '🪮', 'personal'],
  [/\bpads?\b|always|tampon|diaper|couche/, '🧴', 'personal'],
  // health
  [/pill|medic|doliprane|paracetamol|vitamin|ibuprofen|sanitizer/, '💊', 'health'], [/band|pansement|plaster/, '🩹', 'health'],
  // other
  [/sock|chaussette/, '🧦', 'other'], [/sheet|drap/, '🛏️', 'other'], [/usb|cable|charger|chargeur/, '🔌', 'other'],
  [/screwdriver|tournevis|tool/, '🪛', 'other'], [/\block\b|cadenas/, '🔒', 'other'], [/tennis|racket|raquette/, '🎾', 'other'],
];

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function match(name) {
  const n = name.toLowerCase();
  const nn = norm(name);
  for (const r of RULES) if (r[0].test(n) || r[0].test(nn)) return r;
  return null;
}

export function guessItemIcon(name) {
  return match(name)?.[1] || null;
}

// Category for a new item: known keyword first, then a catalog item sharing a word.
export function guessCategory(name, items = []) {
  if (!name.trim()) return null;
  const rule = match(name);
  if (rule) return rule[2];
  const words = norm(name).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  for (const item of items) {
    const iw = norm(item.name).split(/[^a-z0-9]+/);
    if (words.some((w) => iw.includes(w))) return item.cat;
  }
  return null;
}

// ---------- meals ----------

export const MEAL_CATEGORIES = [
  ['breakfast', 'Breakfast', '🍳'],
  ['lunch', 'Lunch', '🥪'],
  ['dinner', 'Dinner', '🍲'],
  ['dessert', 'Dessert', '🍰'],
  ['soups', 'Soups', '🥣'],
  ['salads', 'Salads', '🥗'],
  ['drinks', 'Drinks', '🥤'],
];

// Categories that make sense as meal ingredients.
export const NON_FOOD = new Set(['household', 'personal', 'health', 'other']);

// Meal ideas per category. Ingredient names match the starting catalog.
export const MEAL_IDEAS = {
  breakfast: [
    ['Msemen & mint tea', ['Msemen', 'Tea', 'Mint (Na3na3)', 'Sugar', 'Honey', 'Butter']],
    ['Overnight oats', ['Oatmeal', 'Milk', 'Chia seeds', 'Bananas', 'Peanut butter']],
    ['Shakshuka', ['Eggs', 'Tomatoes', 'Onions', 'Bell peppers', 'Cumin', 'Bread']],
  ],
  lunch: [
    ['Chicken wrap', ['Chicken breast', 'Tortillas', 'Salad', 'Tomatoes', 'Mayonnaise']],
    ['Kefta tagine', ['Ground beef', 'Tomatoes', 'Onions', 'Eggs', 'Kefta spices', 'Bread']],
    ['Turkey & cheese sandwich', ['Bread', 'Turkey ham', 'Cheese', 'Salad', 'Tomatoes']],
  ],
  dinner: [
    ['Chicken tagine with olives', ['Chicken breast', 'Onions', 'Olives', 'Lemons', 'Garlic', 'Ras el hanout']],
    ['Spaghetti bolognese', ['Spaghetti', 'Ground beef', 'Tomato sauce', 'Onions', 'Garlic']],
    ['Salmon & rice', ['Salmon', 'Rice', 'Lemons', 'Salad']],
  ],
  dessert: [
    ['Brownies', ['Brownie mix', 'Eggs', 'Butter']],
    ['Fruit salad', ['Bananas', 'Apples', 'Oranges', 'Fruits for smoothies']],
    ['Chocolate mousse', ['Dark chocolate', 'Eggs', 'Sugar', 'Cooking cream']],
  ],
  soups: [
    ['Harira', ['Lentils', 'Chickpeas', 'Tomatoes', 'Onions', 'Parsley', 'Flour (Dguig)']],
    ['Lentil soup', ['Lentils', 'Carrots', 'Onions', 'Garlic', 'Cumin']],
    ['Vegetable soup', ['Potatoes', 'Carrots', 'Zucchini', 'Onions']],
  ],
  salads: [
    ['Moroccan salad', ['Tomatoes', 'Cucumbers', 'Onions', 'Parsley', 'Olive oil']],
    ['Chicken Caesar salad', ['Salad', 'Chicken breast', 'Cheese', 'Bread', 'Mayonnaise']],
    ['Tuna salad', ['Tuna', 'Salad', 'Tomatoes', 'Eggs', 'Olive oil']],
  ],
  drinks: [
    ['Mint tea', ['Tea', 'Mint (Na3na3)', 'Sugar']],
    ['Banana smoothie', ['Bananas', 'Milk', 'Oatmeal', 'Peanut butter']],
    ['Avocado juice', ['Avocados', 'Milk', 'Sugar']],
  ],
};
