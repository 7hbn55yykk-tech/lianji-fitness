'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDomain } = require('./helpers.cjs');
const engine = loadDomain().FitCook;
const cfg = changes => ({...engine.defaults(), ...changes});
const plain = value => JSON.parse(JSON.stringify(value));

test('default ingredients create both usable methods with honest serving totals', () => {
  const result = engine.generate(engine.defaults());
  assert.equal(result.recipes.length, 2);
  assert.deepEqual(plain(result.unknown), []);
  assert.deepEqual(plain(result.recognized), ['鸡胸肉', '洋葱', '鸡蛋', '杂粮馒头']);
  for (const recipe of result.recipes) {
    assert.ok(recipe.items.some(i => i.name === '食用油' && i.grams === 5));
    assert.ok(recipe.nutrition.kcal > 400 && recipe.nutrition.kcal < 650);
    assert.ok(recipe.nutrition.protein > 30);
    assert.ok(recipe.steps.length >= 4);
    assert.match(recipe.notes.join(''), /估算/);
    assert.deepEqual(plain(recipe.totalNutrition), plain(recipe.nutrition));
  }
});

test('servings scale all ingredients and batch nutrition, oil stays per person', () => {
  const single = engine.generate(cfg({servings:1})).recipes[0];
  const triple = engine.generate(cfg({servings:3})).recipes[0];
  assert.deepEqual(plain(triple.nutrition), plain(single.nutrition));
  single.items.forEach((item, n) => assert.equal(triple.items[n].grams, item.grams * 3));
  Object.keys(single.nutrition).forEach(k => assert.ok(Math.abs(triple.totalNutrition[k] - single.nutrition[k]*3) <= 1));
  assert.equal(triple.items.find(i=>i.name==='食用油').grams, 15);
});

test('oil affects calories and fat and never protein or carbs', () => {
  const none = engine.generate(cfg({oil:0})).recipes[0];
  const more = engine.generate(cfg({oil:10})).recipes[0];
  assert.equal(more.nutrition.kcal - none.nutrition.kcal, 90);
  assert.equal(more.nutrition.fat - none.nutrition.fat, 10);
  assert.equal(more.nutrition.protein, none.nutrition.protein);
  assert.equal(more.nutrition.carbs, none.nutrition.carbs);
});

test('chicken steps include thawing, cut size and a thermometer check for every method', () => {
  for (const recipe of engine.generate(engine.defaults()).recipes) {
    const instructions = recipe.steps.join('');
    assert.match(instructions, /完全解冻/);
    assert.match(instructions, /1\.5[–-]2\s*cm/);
    assert.match(instructions, /温度计/);
    assert.match(instructions, /74℃/);
    assert.match(instructions, /最厚/);
    assert.match(instructions, /时间.*参考/);
    if (recipe.id === 'airfryer-meal') assert.match(instructions, /180℃.*12[–-]16/);
  }
});

test('partial lists do not introduce absent food and missing meal components are explained', () => {
  const result = engine.generate(cfg({ingredients:'番茄、鸡蛋', tools:['wok']}));
  assert.equal(result.recipes.length, 1);
  assert.deepEqual(plain(result.recipes[0].items.map(i=>i.name).sort()), ['番茄','食用油','鸡蛋'].sort());
  assert.match(result.recipes[0].steps.join(''), /蛋液.*凝固/);
  assert.match(result.recipes[0].notes.join(''), /主食/);
  const veg = engine.generate(cfg({ingredients:'西兰花'})).recipes;
  for (const recipe of veg) assert.match(recipe.notes.join(''), /蛋白质/);
});

test('unknown names and quantities are visible, unknown-only produces a useful empty result', () => {
  const mixed = engine.generate(cfg({ingredients:'鸡胸肉200g、洋葱、火龙果'}));
  assert.deepEqual(plain(mixed.recognized), ['洋葱']);
  assert.deepEqual(plain(mixed.unknown), ['鸡胸肉200g','火龙果']);
  assert.match(mixed.notices.join(''), /数量|克数/);
  const unknown = engine.generate(cfg({ingredients:'生猪肉、200g鸡胸肉'}));
  assert.equal(unknown.recipes.length, 0);
  assert.ok(unknown.notices.length > 0);
});

test('aliases deduplicate without changing unsupported raw rice into cooked rice', () => {
  const result = engine.generate(cfg({ingredients:'鸡胸，鸡胸肉；熟米饭\n大米'}));
  assert.deepEqual(plain(result.recognized), ['鸡胸肉','米饭']);
  assert.deepEqual(plain(result.unknown), ['大米']);
  result.recipes.forEach(recipe => assert.match(recipe.items.find(i=>i.name==='米饭').note, /熟/));
});

test('single cold vegetable creates one honest side and does not invent heating', () => {
  const result = engine.generate(cfg({ingredients:'黄瓜'}));
  assert.equal(result.recipes.length, 1);
  assert.match(result.recipes[0].title, /黄瓜/);
  assert.match(result.recipes[0].temp, /无需/);
  assert.deepEqual(plain(result.recipes[0].items.map(i=>i.name)), ['黄瓜','食用油']);
});

test('all supported food has a method, coherent weights and cooked/raw notes', () => {
  const result = engine.generate(cfg({ingredients:'鸡胸肉、洋葱、鸡蛋、杂粮馒头、西兰花、胡萝卜、土豆、番茄、黄瓜、豆腐、米饭、红薯', servings:6}));
  assert.equal(result.recognized.length, 12);
  for (const recipe of result.recipes) {
    assert.equal(recipe.items.length, 13);
    recipe.items.forEach(item=>{assert.ok(item.grams>0); assert.ok(item.note);});
    assert.match(recipe.steps.join(''), /米饭/);
    assert.match(recipe.notes.join(''), /妥善冷藏/);
    Object.values(recipe.nutrition).forEach(n=>assert.ok(Number.isFinite(n)&&n>=0));
  }
});

test('invalid input and absent tools fail clearly instead of guessing', () => {
  for (const bad of [null,[],{},cfg({ingredients:'  '}),cfg({ingredients:'、，；'}),cfg({tools:[]}),cfg({tools:['oven']}),cfg({tools:['wok','wok']}),cfg({servings:0}),cfg({servings:7}),cfg({servings:1.5}),cfg({servings:'2'}),cfg({oil:-1}),cfg({oil:21}),cfg({oil:NaN}),cfg({ingredients:'a'.repeat(501)}),cfg({unexpected:1})]) {
    assert.throws(()=>engine.validate(bad));
  }
  assert.throws(()=>engine.generate(cfg({tools:[]})), /工具/);
  assert.throws(()=>engine.generate(cfg({ingredients:''})), /食材/);
});

test('favorite backups validate nested snapshots, uniqueness and length without mutation', () => {
  const saved = {key:'fav-001',title:'鸡胸肉午餐',recipeId:'wok-meal',config:{ingredients:'鸡胸肉、洋葱',tools:['wok'],servings:2,oil:5}};
  const original = cfg({favorites:[saved]});
  const result = engine.validate(original);
  assert.equal(result.favorites.length,1);
  result.favorites[0].config.tools.push('airfryer');
  assert.equal(original.favorites[0].config.tools.length,1);
  assert.deepEqual(plain(engine.validate({ingredients:'鸡蛋',tools:['wok'],servings:1,oil:0}).favorites), []);
  for (const favorites of [[saved,saved],[{...saved,recipeId:'unsafe'}],[{...saved,config:{...saved.config,oil:100}}],[{...saved,key:''}],Array.from({length:101},(_,i)=>({...saved,key:'f'+i})),['bad']]) {
    assert.throws(()=>engine.validate(cfg({favorites})));
  }
});
