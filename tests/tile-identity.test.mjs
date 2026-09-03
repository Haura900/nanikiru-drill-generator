import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}
const context = vm.createContext({});
vm.runInContext(['calculateAnswerGaps','rankedDiscardRows','calculateAnswerConditions', 'parseMpsz', 'parseAnswerTiles'].map(extract).join('\n'), context);
const simulation = { rows: [
  {tile:'5m',metric:200,expected_score:200},
  {tile:'0m',metric:100,expected_score:100},
  {tile:'9p',metric:50,expected_score:50}
]};
test('red discard has its own EV gap and rank', () => {
  const gaps = context.calculateAnswerGaps(simulation, ['0m']);
  assert.equal(gaps['0m'], 50);
  const conditions = context.calculateAnswerConditions(simulation, ['0m']);
  assert.equal(conditions.max_rank, 2);
});
test('a missing exact red discard does not substitute an ordinary five', () => {
  assert.throws(() => context.calculateAnswerGaps({rows:[simulation.rows[0]]}, ['0m']), /打牌候補/);
});

test('answer input preserves red and ordinary fives as separate choices', () => {
  assert.equal(JSON.stringify(context.parseAnswerTiles('05m 0m')), JSON.stringify(['0m', '5m']));
});
