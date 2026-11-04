// Meal readiness. Pure functions, easy to test.
//
// "Low" is the rule the Meals page already used: an ingredient is low when it is on the
// shopping list, has run out, or runs out within the Coming up window (state in_list or
// due_soon). So it means running low, not out, and the screen says "Low N".

const LOW = new Set(['in_list', 'due_soon']);

// meal: { items: [ids] }, itemsById: { id: item }, statusOf(item) -> itemStatus result.
export function mealReadiness(meal, itemsById, statusOf) {
  const ingredients = (meal.items || [])
    .map((id) => itemsById[id])
    .filter((item) => item && !item.deleted)
    .map((item) => {
      const st = statusOf(item);
      return { item, st, low: LOW.has(st.state), onList: st.state === 'in_list' };
    });
  const low = ingredients.filter((i) => i.low);
  const addable = low.filter((i) => !i.onList); // low, and not on the list yet: what "Add N" adds
  return {
    ingredients,
    total: ingredients.length,
    low,
    addable,
    ready: ingredients.length > 0 && low.length === 0,
    allListed: low.length > 0 && addable.length === 0,
  };
}

// "Bread, Cream cheese, Coffee +2": the first three names, then how many more.
export function lowNames(low, show = 3) {
  const names = low.map((i) => i.item.name);
  return names.slice(0, show).join(', ') + (names.length > show ? ` +${names.length - show}` : '');
}
