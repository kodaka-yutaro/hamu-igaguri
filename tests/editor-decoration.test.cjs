const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('course parts form a scrollable strip with the real in-course graphics beneath the map', () => {
  const stage = html.indexOf('id="ed-stage"');
  const palette = html.indexOf('class="tools editor-palette"');
  const decorations = html.indexOf('id="ed-decor-panel"');
  assert.ok(stage > 0 && stage < palette && palette < decorations);
  assert.match(html, /\.editor-palette\{[^}]*flex-wrap:nowrap;overflow-x:auto/);
  const strip = html.slice(palette, html.indexOf('</div>', palette));
  const buttons = [...strip.matchAll(/<button[^>]+data-t="([^"]+)"[^>]*><\/button>/g)];
  assert.equal(buttons.length, 10);
  assert.deepEqual(buttons.map(([,tile])=>tile),['#','*','A','O','C','S','G','warp-in','warp-out','L']);
  for (const name of ['地面', 'イガグリ', 'どんぐり', 'ボール', '大砲', 'スタート', 'ゴールライン','ワープ入口','ワープ出口','ランチャー']) {
    assert.ok(strip.includes(`aria-label="${name}"`));
  }
  assert.match(html,/function renderEditorPaletteIcons\(\)[\s\S]*?drawCourse\(context,rows,0,0,\{viewW:3\*T,showStart:true,look\}\)/);
  assert.match(html,/\.editor-palette \.tool canvas\{width:40px;height:40px/);
});

test('eraser is overlaid at the top right of the map and selects delete', () => {
  const stageStart = html.indexOf('id="ed-stage"');
  const stageEnd = html.indexOf('</div>', stageStart);
  assert.ok(html.slice(stageStart, stageEnd).includes('id="ed-eraser"'));
  assert.match(html, /\.editor-eraser\{[^}]*top:8px;right:8px/);
  assert.match(html, /\$\('ed-eraser'\)\.onclick = \(\) => \{ editor\.tool = '\.';[\s\S]*syncEditorTools\(\); \};/);
});

test('decoration mode swaps the lower palette, sizes images, and fades course parts', () => {
  assert.match(html, /id="ed-mode-course" aria-pressed="true"/);
  assert.match(html, /id="ed-mode-decor" aria-pressed="false"/);
  assert.match(html, /id="ed-decor-panel" hidden/);
  assert.match(html, /data-decor-size="1"/);
  assert.match(html, /data-decor-size="3"/);
  assert.match(html, /data-decor-size="5"/);
  assert.match(html, /function setEditorMode\(mode\)/);
  assert.match(html, /drawCourse\(edCtx, editor\.rows[\s\S]*fadeCourse: editor\.mode==='decor'/);
  assert.match(html, /function paintDecor\([\s\S]*?ctx\.drawImage\(img,x\+1,y\+1,span-2,span-2\)/);
  assert.match(html, /class:'tool'[^\n]+aria-label[^\n]+\n\s*el\('img'/);
  for (const asset of ['flower','mushroom','grass','butterfly','lantern','streamer','balloon','star','rainbow','tree','flag','trophy','fireworks','crown']) {
    assert.ok(fs.existsSync(path.join(root, 'decor', `${asset}.png`)), `Missing sprite: ${asset}`);
  }
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');
  assert.ok(workflow.includes('cp -R decor gimmick _site/'));
  assert.ok(workflow.includes('decorations.js'));
});

test('numbered warp pair and launcher are selectable beneath the map', () => {
  for(const kind of ['warp-in','warp-out','L'])assert.ok(html.includes(`data-t="${kind}"`));
  assert.match(html, /id="ed-warp-controls" hidden/);
  const picker=html.slice(html.indexOf('id="ed-warp-num"'),html.indexOf('</select>',html.indexOf('id="ed-warp-num"')));
  assert.deepEqual([...picker.matchAll(/<option value="(\d)"/g)].map(m=>m[1]),['1','2','3','4','5']);
  assert.ok(html.includes("const WARP_ENTRIES='pqrst', WARP_EXITS='uvwxy'"));
  for(const asset of ['warp-entry','launcher']) assert.ok(fs.existsSync(path.join(root,'gimmick',`${asset}.png`)));
  assert.ok(html.includes("if(exit)ctx.globalAlpha=.48"),'exit is the same purple portal with lower opacity');
  assert.ok(html.includes('id="pl-launcher"'));
  assert.match(html,/\.launcher-fire\{[^}]*left:50%;bottom:14px;transform:translateX\(-50%\)/);
  assert.match(html,/\.launcher-fire:active\{transform:translateX\(-50%\) scale\(\.96\)\}/);
});
