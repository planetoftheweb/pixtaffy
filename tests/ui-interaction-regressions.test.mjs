import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const buildStudioSource = readFileSync(
  new URL('../components/BuildStudio.tsx', import.meta.url),
  'utf8'
);
const controlPanelSource = readFileSync(
  new URL('../components/ControlPanel.tsx', import.meta.url),
  'utf8'
);
const captureDismissalSources = [
  '../components/GalleryPresetMenu.tsx',
  '../components/DownloadMenu.tsx',
  '../components/RichSelect.tsx',
  '../components/RecentGenerations.tsx',
  '../components/AdminPage.tsx',
].map((path) => [path, readFileSync(new URL(path, import.meta.url), 'utf8')]);
const recentGenerationsSource = captureDismissalSources.find(
  ([path]) => path.endsWith('RecentGenerations.tsx')
)?.[1];
const adminPageSource = captureDismissalSources.find(
  ([path]) => path.endsWith('AdminPage.tsx')
)?.[1];

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

test('toolbar menus dismiss against the active menu instead of the full toolbar', () => {
  assert.match(controlPanelSource, /target\.closest\?\.\('\.mobile-dropdown-panel'\)/);
  assert.match(controlPanelSource, /data-toolbar-dropdown-trigger=\{dropdownName\}/);
  assert.doesNotMatch(
    controlPanelSource,
    /containerRef\.current\?\.contains\(target\) return/
  );
});

test('menu families capture pointer dismissal before child controls can swallow it', () => {
  const sources = [['../components/ControlPanel.tsx', controlPanelSource], ...captureDismissalSources];
  for (const [path, source] of sources) {
    assert.match(
      source,
      /addEventListener\(['"]pointerdown['"],\s*\w+,\s*true\)/,
      `${path} must capture pointerdown for outside-menu dismissal`
    );
  }
});

test('capture-phase dismissal preserves each menu trigger as part of its widget', () => {
  assert.match(recentGenerationsSource, /data-folder-menu\s+onClick=\{\(e\) => \{/);
  assert.match(adminPageSource, /data-admin-row-menu-trigger=\{row\.id\}/);
  assert.match(adminPageSource, /data-admin-row-menu-trigger="\$\{openRowMenu\}"/);
});
