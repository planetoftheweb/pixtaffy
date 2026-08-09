import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const buildStudioSource = readFileSync(
  new URL('../components/BuildStudio.tsx', import.meta.url),
  'utf8'
);

test('toolbar hint is not suppressed by a cooldown after a later scroll collapse', () => {
  assert.doesNotMatch(appSource, /toolbarHintCooldownRef/);
  assert.match(
    appSource,
    /if \(isToolbarCollapsed\) \{\s*setShowToolbarHint\(true\)/
  );
  assert.match(appSource, /data-testid="toolbar-hidden-hint"/);
});

test('frame name keeps the row stable until the double-click enters rename mode', () => {
  const frameName = buildStudioSource.match(
    /<span\s+data-no-row-drag[\s\S]*?onDoubleClick=\{\(e\) => \{[\s\S]*?setRenamingId\(s\.id\);[\s\S]*?<\/span>/
  );

  assert.ok(frameName, 'frame-name interaction block was not found');
  assert.match(frameName[0], /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(frameName[0], /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
});

test('Enter commits the current frame name without relying on a later blur', () => {
  assert.match(
    buildStudioSource,
    /if \(e\.key === 'Enter'\) \{[\s\S]*?commitStepRename\(s\.id, e\.currentTarget\.value\);/
  );
});
