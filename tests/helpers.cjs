const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const project = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));

function loadDomain() {
  const html = fs.readFileSync(path.join(project, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const context = vm.createContext({ console, URL });
  for (const script of scripts) {
    // The app closure requires DOM APIs; only execute the pure data and domain scripts.
    if (script.includes("const C=FitCore") || script.includes('练迹 local app.')) break;
    vm.runInContext(script, context, { filename: 'index-domain.js' });
  }
  if (!context.FitCore || !context.FitData) throw new Error('Missing domain globals');
  return context;
}

function richState(C, date = '2026-11-01') {
  const state = plain(C.defaults(date));
  const done = plain(C.newSession(C.plan(1)[0], [], date));
  done.startedAt = 1793500000000;
  done.items[0].sets[0] = { weight: 37.5, reps: 11, rir: 2, done: true };
  state.history = [{ ...done, logId: 'history-1', endedAt: 1793500100000, completed: false }];
  state.active = plain(C.newSession(C.plan(1)[1], state.history, date));
  state.active.startedAt = 1793500200000;
  state.active.items[0].sets[0] = { weight: 0, reps: 14, rir: 3, done: true };
  state.body = [{ date, weight: 99.3, waist: 102.5 }];
  state.meals = [{ id: 'meal-1', date, name: '原有晚餐', kcal: 702.3, protein: 44.5, carbs: 81.2, fat: 22.1 }];
  state.recovery = [{ date, sleep: 6.5, fatigue: 3, note: '夜班后恢复' }];
  state.videoOverrides = { chest: 'https://www.bilibili.com/video/BV1cUevzTEb4/' };
  state.timer = { endAt: 1793500400000, alerted: false };
  return state;
}

module.exports = { project, plain, loadDomain, richState };
