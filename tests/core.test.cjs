const test = require('node:test');
const assert = require('node:assert/strict');
const original = require('./fixtures/original-training.json');
const { plain, loadDomain, richState } = require('./helpers.cjs');
const { FitCore: C, FitData: D, FitCook: Cook } = loadDomain();
const baseCooking = () => ({ ingredients: '鸡胸肉、洋葱、鸡蛋、杂粮馒头', tools: ['wok', 'airfryer'], servings: 1, oil: 5, favorites: [] });
const favorite = () => ({ key: 'favorite-1', title: '鸡胸肉洋葱炒菜', recipeId: 'wok-meal', config: { ingredients: '鸡胸肉、洋葱、鸡蛋、杂粮馒头', tools: ['wok', 'airfryer'], servings: 1, oil: 5 } });

test('all 12 weekly plans retain every original session, set, rep range and rest interval', () => {
  assert.deepEqual(plain(Array.from({ length: 12 }, (_, i) => C.plan(i + 1))), original.plans);
});

test('all 17 independent exercise videos and coaching cues remain unchanged', () => {
  assert.equal(Object.keys(D.exercises).length, 17);
  assert.equal(new Set(Object.values(D.exercises).map(e => e.video)).size, 17);
  assert.deepEqual(plain(D.exercises), original.exercises);
});

test('training, body, meals, recovery, active work and video replacements survive backup validation', () => {
  const source = richState(C);
  const clean = plain(C.validateBackup(source));
  for (const key of ['schema', 'profile', 'history', 'active', 'body', 'meals', 'recovery', 'videoOverrides']) assert.deepEqual(clean[key], source[key], key);
  assert.equal(clean.timer, null, 'Import intentionally clears an old countdown');
});

test('new state includes separate cooking defaults', () => {
  assert.deepEqual(plain(C.defaults('2026-11-01').cooking), baseCooking());
  assert.equal(typeof Cook?.defaults, 'function');
  assert.deepEqual(plain(Cook.defaults()), baseCooking());
});

test('schema 1 legacy backup without cooking migrates without changing existing records', () => {
  const old = richState(C);
  delete old.cooking;
  const clean = plain(C.validateBackup(JSON.parse(JSON.stringify(old))));
  assert.deepEqual(clean.cooking, baseCooking());
  for (const key of ['profile', 'history', 'active', 'body', 'meals', 'recovery', 'videoOverrides']) assert.deepEqual(clean[key], old[key], key);
  assert.equal(clean.timer, null);
});

test('cooking preferences and favorites survive JSON roundtrip and validated import', () => {
  const state = richState(C);
  state.cooking = { ...baseCooking(), ingredients: '鸡蛋、土豆', tools: ['airfryer'], servings: 2, oil: 3, favorites: [favorite()] };
  const before = JSON.stringify(state);
  const clean = plain(C.validateBackup(JSON.parse(before)));
  assert.deepEqual(clean.cooking, state.cooking);
  assert.equal(JSON.stringify(state), before, 'Validation must not mutate source data');
});

for (const [label, value] of [
  ['null cooking', null],
  ['array cooking', []],
  ['unknown tool', { ...baseCooking(), tools: ['microwave'] }],
  ['no equipment', { ...baseCooking(), tools: [] }],
  ['duplicate equipment', { ...baseCooking(), tools: ['wok', 'wok'] }],
  ['invalid servings', { ...baseCooking(), servings: 0 }],
  ['fractional servings', { ...baseCooking(), servings: 1.5 }],
  ['too many servings', { ...baseCooking(), servings: 7 }],
  ['negative oil', { ...baseCooking(), oil: -1 }],
  ['excess oil', { ...baseCooking(), oil: 21 }],
  ['infinite oil', { ...baseCooking(), oil: Infinity }],
  ['oversized ingredients', { ...baseCooking(), ingredients: '鸡'.repeat(501) }],
  ['unknown favorite recipe', { ...baseCooking(), favorites: [{ ...favorite(), recipeId: 'unknown' }] }],
  ['bad favorite config', { ...baseCooking(), favorites: [{ ...favorite(), config: { ...favorite().config, servings: -1 } }] }],
  ['duplicate favorite IDs', { ...baseCooking(), favorites: [favorite(), favorite()] }],
  ['too many favorites', { ...baseCooking(), favorites: Array.from({ length: 101 }, (_, i) => ({ ...favorite(), key: `favorite-${i}` })) }],
]) {
  test(`malformed cooking backup is rejected: ${label}`, () => {
    const state = richState(C);
    state.cooking = value;
    assert.throws(() => C.validateBackup(state));
  });
}

test('recipe generator supports separate wok and airfryer choices', () => {
  assert.equal(typeof Cook?.generate, 'function');
  const both = plain(Cook.generate(baseCooking()));
  assert.equal(both.recipes.length, 2);
  assert.deepEqual(both.recipes.map(r => r.id).sort(), ['airfryer-meal', 'wok-meal']);
  for (const tool of ['wok', 'airfryer']) {
    const result = plain(Cook.generate({ ...baseCooking(), tools: [tool] }));
    assert.equal(result.recipes.length, 1);
    assert.equal(result.recipes[0].id, `${tool}-meal`);
    assert.ok(result.recipes[0].steps.length >= 3);
    for (const nutrient of ['kcal', 'protein', 'fat', 'carbs']) assert.ok(Number.isFinite(result.recipes[0].nutrition[nutrient]));
  }
});

test('changing portion count scales shopping totals while preserving per-person nutrition', () => {
  assert.equal(typeof Cook?.generate, 'function');
  const one = plain(Cook.generate({ ...baseCooking(), servings: 1 })).recipes;
  const three = plain(Cook.generate({ ...baseCooking(), servings: 3 })).recipes;
  assert.equal(one.length, three.length);
  for (let i = 0; i < one.length; i++) {
    assert.deepEqual(three[i].nutrition, one[i].nutrition);
    // The engine rounds each displayed kcal to an integer, while gram totals use 0.1g.
    // Multiplying already-rounded per-person displays can therefore differ from the
    // independently rounded full-batch total by at most 2 kcal for three people.
    for (const nutrient of ['kcal', 'protein', 'fat', 'carbs']) assert.ok(Math.abs(three[i].totalNutrition[nutrient] - one[i].totalNutrition[nutrient] * 3) <= (nutrient === 'kcal' ? 2 : 0.2));
  }
  // 120g chicken + 100g onion + 50g egg + 100g steamed bun + 5g oil
  // sums to 520.5 kcal per person and 1561.5 kcal for the full three-person batch.
  assert.equal(one[0].nutrition.kcal, 521);
  assert.equal(three[0].totalNutrition.kcal, 1562);
});

test('existing nutritional aggregation and workout progress still use original records', () => {
  const state = richState(C);
  assert.deepEqual(plain(C.nutrition(state.meals, '2026-11-01')), { kcal: 702.3, protein: 44.5, carbs: 81.2, fat: 22.1 });
  assert.deepEqual(plain(C.sessionStats(state.history[0])), { done: 1, total: 10, volume: 412.5 });
  assert.deepEqual(plain(C.lastSets(state.history, 'legpress')), [{ weight: 37.5, reps: 11, rir: 2, done: true }]);
});

for (const [label, recipeId, ingredients, tools] of [
  ['airfryer recipe with only wok selected', 'airfryer-meal', '鸡胸肉', ['wok']],
  ['fresh side recipe with chicken', 'fresh-side', '鸡胸肉', ['wok']],
  ['wok meal recipe with cucumber-only fresh side', 'wok-meal', '黄瓜', ['wok']],
]) test(`semantically invalid favorite is rejected: ${label}`, () => {
  const source = richState(C);
  source.cooking.favorites = [{ key: 'invalid-semantic-favorite', title: '无法重开的收藏', recipeId, config: { ingredients, tools, servings: 1, oil: 5 } }];
  assert.throws(() => C.validateBackup(source));
});
