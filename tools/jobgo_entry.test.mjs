import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
test('homepage separates the existing trial from the fixed school login', () => {
  for (const name of ['vocational.html', 'learning-app.html']) {
    const html = read(name);
    assert.ok(html.includes('공개체험 해보기'));
    assert.ok(html.includes('href="https://app.gyo6.kr/"'));
    assert.ok(html.includes('href="https://app.gyo6.kr/school-access.html"'));
    assert.ok(html.includes('학교용 최신 화면과 일부 다름'));
    assert.ok(html.includes('체험 기록 저장 안 됨'));
    assert.ok(html.includes('연결 점검 중'));
    assert.ok(!html.includes('?entry=member'));
    assert.ok(!/<input[^>]+type=["']password/i.test(html));
  }
});
test('trial iframe and role launch protocol are preserved without school-account bridging', () => {
  const html = read('learning-app.html');
  assert.ok(html.includes('src="apps/sugar-salt/"'));
  assert.ok(html.includes('PUBLIC TRIAL · v4.8.23'));
  assert.ok(html.includes('실제 학교 계정을 입력하지 마세요'));
  assert.ok(html.includes('event.origin !== window.location.origin'));
  assert.ok(html.includes('event.source !== frame.contentWindow'));
  assert.ok(html.includes('?trial=${role}&trial_nonce=${Date.now()}'));
});
test('entry style selectors remain scoped to the two JOBgo pages', () => {
  const css = read('assets/jobgo-entry.css');
  for (const line of css.split('\n').filter((line) => line.includes('{') && !line.trim().startsWith('@'))) {
    assert.match(line.trim(), /^\.(vocational-renewal-page|learning-trial-page) /);
  }
});
