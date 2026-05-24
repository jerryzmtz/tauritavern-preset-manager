import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(root, 'dist', 'preset-manager', 'index.js');
const viewports = [
  { name: 'desktop-wide', width: 1920, height: 1080 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'small-mobile', width: 360, height: 640 },
  { name: 'mobile-landscape', width: 844, height: 390 },
];

async function importPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    try {
      return await import('playwright-core');
    } catch {
      const nodePath = process.env.PRESET_MANAGER_NODE_MODULES || process.env.NODE_PATH;
      if (!nodePath) {
        throw error;
      }
      try {
        return await import(pathToFileURL(path.join(nodePath, 'playwright', 'index.mjs')).href);
      } catch {
        return await import(pathToFileURL(path.join(nodePath, 'playwright-core', 'index.mjs')).href);
      }
    }
  }
}

const fixturePresets = [
  {
    name: '雪月agent_v1（自改）',
    preset: {
      prompts: [
        { identifier: 'source-novel', name: '📔小说', role: 'system', content: '基调：叙事性小说\n特化：保持真实感。' },
        { identifier: 'source-light', name: '📕轻小说', role: 'system', content: '基调：日式轻文学\n人称：第一人称。' },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'source-novel', enabled: true },
            { identifier: 'source-light', enabled: false },
          ],
        },
      ],
    },
  },
  {
    name: '夏瑾二改（自用）',
    preset: {
      prompts: [
        { identifier: 'target-style-heading', name: '====夏瑾的文风====', role: 'system', content: '' },
        { identifier: 'target-default', name: '🖋️默认', role: 'user', content: '{{setvar::writingstyle::writing_style_1}}' },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'target-style-heading', enabled: true },
            { identifier: 'target-default', enabled: true },
          ],
        },
      ],
    },
  },
];

for (let index = 0; index < 18; index += 1) {
  const sourceId = `source-extra-${index}`;
  const targetId = `target-extra-${index}`;
  fixturePresets[0].preset.prompts.push({
    identifier: sourceId,
    name: `来源长列表条目 ${index + 1}`,
    role: index % 3 === 0 ? 'user' : 'system',
    content: `用于滚动与拖拽测试的来源正文 ${index + 1}\n特化：保持 UTF-8 中文。`,
  });
  fixturePresets[0].preset.prompt_order[0].order.push({ identifier: sourceId, enabled: index % 2 === 0 });

  fixturePresets[1].preset.prompts.push({
    identifier: targetId,
    name: `目标长列表条目 ${index + 1}`,
    role: 'system',
    content: `用于目标预设排序测试的正文 ${index + 1}`,
  });
  fixturePresets[1].preset.prompt_order[0].order.push({ identifier: targetId, enabled: index % 2 !== 0 });
}

function serveFixture() {
  let savedPreset = null;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'content-type');

    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }

    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>预设缝合测试</title>
  <style>
    :root {
      --SmartThemeBodyColor: #efe8d4;
      --SmartThemeBlurTintColor: #102426;
      --SmartThemeBorderColor: #7f8777;
      --SmartThemeQuoteColor: #becb9d;
      --SmartThemeShadowColor: #111512;
      --SmartThemeBlurStrength: 10px;
      --tt-inset-top: 0px;
      --tt-inset-right: 0px;
      --tt-inset-bottom: 0px;
      --tt-inset-left: 0px;
      --tt-viewport-bottom-inset: 0px;
      color: var(--SmartThemeBodyColor);
      background: #172525;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    }
  </style>
</head>
<body>
  <main>中文测试：预设缝合管理器</main>
  <div id="script-buttons"></div>
  <script>
    window.__presetFixtureStore = new Map(${JSON.stringify(fixturePresets)}.map(item => [item.name, item.preset]));
    window.__makeRuntimePreset = data => {
      const cloned = JSON.parse(JSON.stringify(data));
      const order = cloned.prompt_order?.find(item => item.character_id === 100001)?.order
        ?? cloned.prompt_order?.find(item => Array.isArray(item.order))?.order
        ?? [];
      const getPromptId = prompt => prompt.identifier ?? prompt.id;
      const promptById = new Map(cloned.prompts.map(prompt => [getPromptId(prompt), prompt]));
      const orderedPrompts = [
        ...order.map(item => ({ source: promptById.get(item.identifier), order: item })).filter(item => item.source),
        ...cloned.prompts
          .filter(prompt => !order.some(item => item.identifier === getPromptId(prompt)))
          .map(prompt => ({ source: prompt, order: { enabled: prompt.enabled !== false } })),
      ];
      const wrapReadonlyFields = value => {
        const wrapped = {};
        for (const key of Object.keys(value)) {
          Object.defineProperty(wrapped, key, {
            configurable: true,
            enumerable: false,
            get: () => value[key],
          });
        }
        return wrapped;
      };
      return {
        settings: {},
        prompts: orderedPrompts.map(({ source, order: orderEntry }) => wrapReadonlyFields({
          id: getPromptId(source),
          name: source.name,
          enabled: orderEntry.enabled !== false,
          position: { type: 'relative' },
          role: source.role,
          ...(typeof source.content === 'string' ? { content: source.content } : {}),
          extra: source,
        })),
        prompts_unused: [],
        extensions: {},
      };
    };
    window.__scriptButtons = [];
    window.__registeredEvents = [];
    window.__scriptButtonEventsEnabled = true;
    window.__updateScriptButtonsWithCalls = 0;
    window.__replaceScriptButtonsCalls = 0;
    window.$ = value => {
      const api = {
        on(event, callback) {
          const target = value === window ? window : document;
          target.addEventListener(event, callback);
          return api;
        },
      };
      if (typeof value === 'function') {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', value, { once: true });
        } else {
          queueMicrotask(value);
        }
      }
      return api;
    };
    window.getButtonEvent = name => 'helper-button:' + name;
    window.eventOn = (event, callback) => {
      window.__registeredEvents.push(event);
      window.addEventListener(event, callback);
      return { stop: () => window.removeEventListener(event, callback) };
    };
    window.updateScriptButtonsWith = updater => {
      window.__updateScriptButtonsWithCalls += 1;
      window.__scriptButtons = updater(window.__scriptButtons.map(button => ({ ...button }))).map(button => ({ ...button }));
      const host = document.getElementById('script-buttons');
      host.innerHTML = '';
      for (const button of window.__scriptButtons.filter(item => item.visible)) {
        const element = document.createElement('button');
        element.type = 'button';
        element.textContent = button.name;
        element.dataset.buttonName = button.name;
        element.dataset.scriptButton = button.name;
        element.setAttribute('aria-label', button.name);
        element.addEventListener('click', () => {
          if (window.__scriptButtonEventsEnabled) {
            window.dispatchEvent(new Event(window.getButtonEvent(button.name)));
          }
        });
        host.appendChild(element);
      }
      return window.__scriptButtons;
    };
    window.replaceScriptButtons = () => {
      window.__replaceScriptButtonsCalls += 1;
      throw new Error('replaceScriptButtons 不应被预设管理器入口使用');
    };
    window.getPresetNames = () => Array.from(window.__presetFixtureStore.keys());
    window.getLoadedPresetName = () => '夏瑾二改（自用）';
    window.getPreset = name => window.__makeRuntimePreset(window.__presetFixtureStore.get(name));
    window.createOrReplacePreset = async (name, preset, options = {}) => {
      window.__presetFixtureStore.set(name, JSON.parse(JSON.stringify(preset)));
      const response = await fetch('/api/presets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId: 'openai', name, preset, options }),
      });
      if (!response.ok) {
        throw new Error('保存预设失败：HTTP ' + response.status);
      }
      return true;
    };
    window.deletePreset = async name => window.__presetFixtureStore.delete(name);
    window.renamePreset = async (name, newName) => {
      if (!window.__presetFixtureStore.has(name)) {
        return false;
      }
      const preset = window.__presetFixtureStore.get(name);
      window.__presetFixtureStore.delete(name);
      window.__presetFixtureStore.set(newName, preset);
      return true;
    };
    window.TavernHelper = {
      getPresetNames: window.getPresetNames,
      getLoadedPresetName: window.getLoadedPresetName,
      getPreset: window.getPreset,
      createOrReplacePreset: window.createOrReplacePreset,
      deletePreset: window.deletePreset,
      renamePreset: window.renamePreset,
    };
  </script>
  <script type="module" src="/dist/preset-manager/index.js"></script>
</body>
</html>`);
      return;
    }

    if (url.pathname === '/zero-frame-host') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>零尺寸脚本宿主测试</title>
  <style>
    :root {
      --SmartThemeBodyColor: #efe8d4;
      --SmartThemeBlurTintColor: #102426;
      --SmartThemeBorderColor: #7f8777;
      --SmartThemeQuoteColor: #becb9d;
      --SmartThemeShadowColor: #111512;
      --SmartThemeBlurStrength: 10px;
      --tt-inset-top: 0px;
      --tt-inset-right: 0px;
      --tt-inset-bottom: 0px;
      --tt-inset-left: 0px;
      --tt-viewport-bottom-inset: 0px;
      color: var(--SmartThemeBodyColor);
      background: #172525;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    }
  </style>
</head>
<body>
  <main>父页面中文测试：预设缝合管理器</main>
  <div id="script-buttons"></div>
  <iframe id="script-frame" title="zero-sized-script-frame" src="/zero-frame-child" style="width:0;height:0;border:0;display:block"></iframe>
  <script>
    window.__presetFixtureStore = new Map(${JSON.stringify(fixturePresets)}.map(item => [item.name, item.preset]));
    const makeRuntimePreset = data => {
      const cloned = JSON.parse(JSON.stringify(data));
      const order = cloned.prompt_order?.find(item => item.character_id === 100001)?.order
        ?? cloned.prompt_order?.find(item => Array.isArray(item.order))?.order
        ?? [];
      const getPromptId = prompt => prompt.identifier ?? prompt.id;
      const promptById = new Map(cloned.prompts.map(prompt => [getPromptId(prompt), prompt]));
      const orderedPrompts = [
        ...order.map(item => ({ source: promptById.get(item.identifier), order: item })).filter(item => item.source),
        ...cloned.prompts
          .filter(prompt => !order.some(item => item.identifier === getPromptId(prompt)))
          .map(prompt => ({ source: prompt, order: { enabled: prompt.enabled !== false } })),
      ];
      const wrapReadonlyFields = value => {
        const wrapped = {};
        for (const key of Object.keys(value)) {
          Object.defineProperty(wrapped, key, {
            configurable: true,
            enumerable: false,
            get: () => value[key],
          });
        }
        return wrapped;
      };
      return {
        settings: {},
        prompts: orderedPrompts.map(({ source, order: orderEntry }) => wrapReadonlyFields({
          id: getPromptId(source),
          name: source.name,
          enabled: orderEntry.enabled !== false,
          position: { type: 'relative' },
          role: source.role,
          ...(typeof source.content === 'string' ? { content: source.content } : {}),
          extra: source,
        })),
        prompts_unused: [],
        extensions: {},
      };
    };
    const frame = document.getElementById('script-frame');
    frame.addEventListener('load', () => {
      const child = frame.contentWindow;
      child.__scriptButtons = [];
      child.__registeredEvents = [];
      child.__updateScriptButtonsWithCalls = 0;
      child.__replaceScriptButtonsCalls = 0;
      child.$ = value => {
        const api = {
          on(event, callback) {
            const target = value === child ? child : child.document;
            target.addEventListener(event, callback);
            return api;
          },
        };
        if (typeof value === 'function') {
          if (child.document.readyState === 'loading') {
            child.document.addEventListener('DOMContentLoaded', value, { once: true });
          } else {
            child.queueMicrotask(value);
          }
        }
        return api;
      };
      child.getButtonEvent = name => 'helper-button:' + name;
      child.eventOn = (event, callback) => {
        child.__registeredEvents.push(event);
        child.addEventListener(event, callback);
        return { stop: () => child.removeEventListener(event, callback) };
      };
      child.updateScriptButtonsWith = updater => {
        child.__updateScriptButtonsWithCalls += 1;
        child.__scriptButtons = updater(child.__scriptButtons.map(button => ({ ...button }))).map(button => ({ ...button }));
        const host = document.getElementById('script-buttons');
        host.innerHTML = '';
        for (const button of child.__scriptButtons.filter(item => item.visible)) {
          const element = document.createElement('button');
          element.type = 'button';
          element.textContent = button.name;
          element.dataset.buttonName = button.name;
          element.dataset.scriptButton = button.name;
          element.setAttribute('aria-label', button.name);
          element.addEventListener('click', () => child.dispatchEvent(new child.Event(child.getButtonEvent(button.name))));
          host.appendChild(element);
        }
        return child.__scriptButtons;
      };
      child.replaceScriptButtons = () => {
        child.__replaceScriptButtonsCalls += 1;
        throw new Error('replaceScriptButtons 不应被预设管理器入口使用');
      };
      child.getScriptId = () => 'zero-frame-script-id';
      child.insertOrAssignVariables = variables => {
        child.__scriptVariables = { ...(child.__scriptVariables ?? {}), ...variables };
      };
      child.getPresetNames = () => Array.from(window.__presetFixtureStore.keys());
      child.getLoadedPresetName = () => '夏瑾二改（自用）';
      child.getPreset = name => makeRuntimePreset(window.__presetFixtureStore.get(name));
      child.createOrReplacePreset = async (name, preset) => {
        window.__presetFixtureStore.set(name, JSON.parse(JSON.stringify(preset)));
        return true;
      };
      child.deletePreset = async name => window.__presetFixtureStore.delete(name);
      child.renamePreset = async (name, newName) => {
        if (!window.__presetFixtureStore.has(name)) {
          return false;
        }
        const preset = window.__presetFixtureStore.get(name);
        window.__presetFixtureStore.delete(name);
        window.__presetFixtureStore.set(newName, preset);
        return true;
      };
      child.TavernHelper = {
        getPresetNames: child.getPresetNames,
        getLoadedPresetName: child.getLoadedPresetName,
        getPreset: child.getPreset,
        createOrReplacePreset: child.createOrReplacePreset,
        deletePreset: child.deletePreset,
        renamePreset: child.renamePreset,
      };
      const script = child.document.createElement('script');
      script.type = 'module';
      script.src = '/dist/preset-manager/index.js';
      child.document.head.appendChild(script);
    });
  </script>
</body>
</html>`);
      return;
    }

    if (url.pathname === '/zero-frame-child') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body></body>
</html>`);
      return;
    }

    if (url.pathname === '/dist/preset-manager/index.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(await readFile(bundlePath, 'utf8'));
      return;
    }

    if (url.pathname === '/scripts/tauritavern/layout-kit.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(`export const SURFACE = { Backdrop: "backdrop", FullscreenWindow: "fullscreen-window" };
export async function waitForHostReady(){}
export function applySurface(element, surface){ element.dataset.ttMobileSurface = surface; }`);
      return;
    }

    if (url.pathname === '/api/presets/save') {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      savedPreset = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ name: savedPreset.name }));
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) {
        resolve({
          server,
          url: `http://127.0.0.1:${address.port}`,
          getSavedPreset: () => savedPreset,
          clearSavedPreset: () => {
            savedPreset = null;
          },
        });
      }
    });
  });
}

async function dragBetween(page, sourceLocator, targetLocator, placement = 'center') {
  const sourceBox = await sourceLocator.boundingBox();
  const targetBox = await targetLocator.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('拖拽测试无法取得元素位置');
  }

  const targetY = placement === 'after'
    ? targetBox.y + targetBox.height - 3
    : placement === 'end'
      ? targetBox.y + targetBox.height - 12
      : targetBox.y + targetBox.height / 2;

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetY, { steps: 10 });
  await page.mouse.up();
}

async function verifySelectionKeepsScroll(page, viewportName) {
  const sourceList = page.locator('.pm-pane-source .pm-list');
  await sourceList.evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  const before = await sourceList.evaluate(element => element.scrollTop);
  if (before < 20) {
    throw new Error(`${viewportName}: 来源列表没有形成可验证的滚动区域`);
  }

  await page.locator('.pm-pane-source .pm-row').last().click();
  await page.waitForTimeout(50);
  const after = await sourceList.evaluate(element => element.scrollTop);
  if (Math.abs(after - before) > 4) {
    throw new Error(`${viewportName}: 选择条目后列表滚动位置被重置`);
  }
}

async function verifyDirectDragAndUnsavedClose(page, fixture, viewportName) {
  const targetTitles = page.locator('.pm-pane-target .pm-row-title');
  const originalTitles = await targetTitles.evaluateAll(nodes => nodes.slice(0, 3).map(node => node.textContent?.trim()));
  if (originalTitles.length < 3) {
    throw new Error(`${viewportName}: 目标列表条目不足，无法验证拖拽排序`);
  }

  await dragBetween(
    page,
    page.locator('.pm-pane-target .pm-row').first().locator('.pm-row-grip'),
    page.locator('.pm-pane-target .pm-row').nth(1),
    'after',
  );

  const reorderedTitles = await targetTitles.evaluateAll(nodes => nodes.slice(0, 3).map(node => node.textContent?.trim()));
  if (reorderedTitles[1] !== originalTitles[0]) {
    throw new Error(`${viewportName}: 目标预设直接拖拽排序未生效`);
  }

  page.once('dialog', dialog => {
    if (!dialog.message().includes('未保存修改')) {
      throw new Error(`${viewportName}: 关闭未保存修改时没有明确提示`);
    }
    void dialog.accept();
  });
  await page.getByTitle('关闭').click();
  await page.evaluate(() => {
    window.__scriptButtonEventsEnabled = false;
  });
  await page.getByRole('button', { name: /^预设缝合$/ }).click();
  await page.locator('.pm-panel').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    window.__scriptButtonEventsEnabled = true;
  });

  const reopenedTitles = await targetTitles.evaluateAll(nodes => nodes.slice(0, 3).map(node => node.textContent?.trim()));
  if (reopenedTitles[0] !== originalTitles[0] || reopenedTitles[1] !== originalTitles[1]) {
    throw new Error(`${viewportName}: 未保存排序在关闭后仍残留到目标预设`);
  }
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 未点击保存却调用了保存接口`);
  }

  await verifyFavoritesTargetDrag(page, fixture, viewportName);

  const sourceTitle = await page.locator('.pm-pane-source .pm-row-title').first().textContent();
  const targetCountBefore = await page.locator('.pm-pane-target .pm-row').count();
  await dragBetween(
    page,
    page.locator('.pm-pane-source .pm-row').first().locator('.pm-row-grip'),
    page.locator('.pm-pane-target .pm-list'),
    'end',
  );
  await page.waitForFunction(count => document.querySelectorAll('.pm-pane-target .pm-row').length > count, targetCountBefore);
  const targetTitleTexts = await targetTitles.evaluateAll(nodes => nodes.map(node => node.textContent?.trim()));
  if (!targetTitleTexts.includes(sourceTitle?.trim())) {
    throw new Error(`${viewportName}: 来源条目无法直接拖入目标预设`);
  }
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 拖拽目标预设操作不应触发保存接口`);
  }
}

async function verifySourceDeleteDraft(page, fixture, viewportName) {
  await page.locator('select[name="sourceName"]').selectOption('雪月agent_v1（自改）');
  const sourceRows = page.locator('.pm-pane-source .pm-row');
  const before = await sourceRows.count();
  if (before < 2) {
    throw new Error(`${viewportName}: 来源列表条目不足，无法验证来源删除`);
  }

  const deleteButton = sourceRows.first().locator('.pm-row-action.pm-danger');
  if (await deleteButton.isDisabled()) {
    throw new Error(`${viewportName}: 来源条目的删除按钮不应禁用`);
  }
  await deleteButton.click();
  await page.waitForFunction(count => document.querySelectorAll('.pm-pane-source .pm-row').length === count - 1, before);
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 来源删除不应在点击保存前调用保存接口`);
  }

  await page.getByRole('button', { name: '放弃修改' }).click();
  await page.waitForFunction(count => document.querySelectorAll('.pm-pane-source .pm-row').length === count, before);
}

async function verifySourceDetailEditing(page, fixture, viewportName) {
  await page.locator('select[name="sourceName"]').selectOption('雪月agent_v1（自改）');
  await page.locator('.pm-pane-source .pm-row').first().click();

  const detailContent = page.locator('textarea[name="detailContent"]');
  const detailRole = page.locator('select[name="detailRole"]');
  if (await detailContent.getAttribute('readonly') !== null || await detailRole.isDisabled()) {
    throw new Error(`${viewportName}: 来源条目被选中后条目详情仍不可编辑`);
  }

  await detailContent.fill('来源条目的详情编辑只停留在页面草稿里');
  await detailRole.selectOption('user');
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 编辑来源条目详情不应在点击保存前调用保存接口`);
  }

  await page.getByRole('button', { name: '放弃修改' }).click();
  await page.waitForFunction(() => document.querySelector('textarea[name="detailContent"]')?.value !== '来源条目的详情编辑只停留在页面草稿里');
}

async function verifyPresetActions(page, fixture, viewportName) {
  await page.locator('select[name="sourceName"]').selectOption('雪月agent_v1（自改）');
  fixture.clearSavedPreset();

  const copyName = `复制动作测试-${viewportName}`;
  page.once('dialog', dialog => {
    if (dialog.type() !== 'prompt') {
      throw new Error(`${viewportName}: 复制预设应使用命名输入框`);
    }
    void dialog.accept(copyName);
  });
  await page.locator('.pm-pane-source [data-action="preset-copy"]').click();
  await page.waitForFunction(
    name => document.querySelector('select[name="sourceName"]')?.value === name,
    copyName,
  );
  const savedCopy = fixture.getSavedPreset();
  if (!savedCopy || savedCopy.name !== copyName) {
    throw new Error(`${viewportName}: 复制预设没有调用保存接口创建新预设`);
  }
  fixture.clearSavedPreset();

  const renamedName = `${copyName} 重命名`;
  page.once('dialog', dialog => {
    if (dialog.type() !== 'prompt') {
      throw new Error(`${viewportName}: 重命名预设应使用命名输入框`);
    }
    void dialog.accept(renamedName);
  });
  await page.locator('.pm-pane-source [data-action="preset-rename"]').click();
  await page.waitForFunction(
    name => document.querySelector('select[name="sourceName"]')?.value === name,
    renamedName,
  );
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 重命名预设不应调用内容保存接口`);
  }

  page.once('dialog', dialog => {
    if (dialog.type() !== 'confirm') {
      throw new Error(`${viewportName}: 删除预设应先确认`);
    }
    void dialog.accept();
  });
  await page.locator('.pm-pane-source [data-action="preset-delete"]').click();
  await page.waitForFunction(
    name => ![...document.querySelector('select[name="sourceName"]')?.options ?? []].some(option => option.value === name),
    renamedName,
  );
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 删除预设不应调用内容保存接口`);
  }
}

async function verifyFavoritesTargetDrag(page, fixture, viewportName) {
  await page.locator('select[name="sourceName"]').selectOption('__preset-manager-favorites__');
  const targetRowsForSource = page.locator('.pm-pane-target .pm-row');
  await dragBetween(
    page,
    targetRowsForSource.first().locator('.pm-row-grip'),
    page.locator('.pm-pane-source .pm-list'),
    'end',
  );
  await page.waitForFunction(() => document.querySelectorAll('.pm-pane-source .pm-row').length > 0);
  await dragBetween(
    page,
    targetRowsForSource.nth(1).locator('.pm-row-grip'),
    page.locator('.pm-pane-source .pm-list'),
    'end',
  );
  await page.waitForFunction(() => document.querySelectorAll('.pm-pane-source .pm-row').length > 1);

  const sourceTitlesBefore = await page.locator('.pm-pane-source .pm-row-title').evaluateAll(nodes => nodes.slice(0, 2).map(node => node.textContent?.trim()));
  await dragBetween(page, page.locator('.pm-pane-source .pm-row').first().locator('.pm-row-grip'), page.locator('.pm-pane-source .pm-row').nth(1), 'after');
  const sourceTitlesAfter = await page.locator('.pm-pane-source .pm-row-title').evaluateAll(nodes => nodes.slice(0, 2).map(node => node.textContent?.trim()));
  if (sourceTitlesAfter[1] !== sourceTitlesBefore[0]) {
    throw new Error(`${viewportName}: 收藏夹来源状态下拖拽排序未生效`);
  }
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 拖拽到收藏夹不应触发预设保存接口`);
  }

  await page.getByRole('button', { name: '放弃修改' }).click();
  await page.locator('select[name="sourceName"]').selectOption('雪月agent_v1（自改）');
  await page.locator('select[name="targetName"]').selectOption('__preset-manager-favorites__');

  const targetRows = page.locator('.pm-pane-target .pm-row');
  const sourceRows = page.locator('.pm-pane-source .pm-row');
  await dragBetween(
    page,
    sourceRows.first().locator('.pm-row-grip'),
    page.locator('.pm-pane-target .pm-list'),
    'end',
  );
  await page.waitForFunction(() => document.querySelectorAll('.pm-pane-target .pm-row').length > 0);
  await dragBetween(
    page,
    sourceRows.nth(1).locator('.pm-row-grip'),
    page.locator('.pm-pane-target .pm-list'),
    'end',
  );
  await page.waitForFunction(() => document.querySelectorAll('.pm-pane-target .pm-row').length > 1);

  const titlesBefore = await page.locator('.pm-pane-target .pm-row-title').evaluateAll(nodes => nodes.slice(0, 2).map(node => node.textContent?.trim()));
  await dragBetween(page, targetRows.first().locator('.pm-row-grip'), targetRows.nth(1), 'after');
  const titlesAfter = await page.locator('.pm-pane-target .pm-row-title').evaluateAll(nodes => nodes.slice(0, 2).map(node => node.textContent?.trim()));
  if (titlesAfter[1] !== titlesBefore[0]) {
    throw new Error(`${viewportName}: 收藏夹目标状态下拖拽排序未生效`);
  }
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 收藏夹拖拽不应触发预设保存接口`);
  }

  page.once('dialog', dialog => {
    if (!dialog.message().includes('未保存修改')) {
      throw new Error(`${viewportName}: 离开收藏夹目标时没有未保存提示`);
    }
    void dialog.accept();
  });
  await page.locator('select[name="targetName"]').selectOption('夏瑾二改（自用）');
}

async function verifyZeroSizedIframeParentMount(browser, fixture) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(`${fixture.url}/zero-frame-host`);
  await page.waitForFunction(() => {
    const child = document.getElementById('script-frame')?.contentWindow;
    return child?.__registeredEvents?.includes('helper-button:预设缝合');
  });

  const frameMetrics = await page.evaluate(() => {
    const frame = document.getElementById('script-frame');
    return {
      frameWidth: frame.getBoundingClientRect().width,
      frameHeight: frame.getBoundingClientRect().height,
      childWidth: frame.contentWindow.innerWidth,
      childHeight: frame.contentWindow.innerHeight,
    };
  });
  if (frameMetrics.frameWidth !== 0 || frameMetrics.frameHeight !== 0 || frameMetrics.childWidth !== 0 || frameMetrics.childHeight !== 0) {
    throw new Error('zero-frame: 测试夹具没有形成 0x0 脚本 iframe');
  }

  await page.getByRole('button', { name: /^预设缝合$/ }).click();
  await page.locator('body > #tt-preset-stitcher-host #tt-preset-stitcher-root .pm-panel').waitFor({ state: 'visible' });

  const mountInfo = await page.evaluate(() => {
    const frame = document.getElementById('script-frame');
    const childDocument = frame.contentWindow.document;
    const panel = document.querySelector('#tt-preset-stitcher-root .pm-panel');
    return {
      inParent: Boolean(panel),
      inChild: Boolean(childDocument.querySelector('#tt-preset-stitcher-root')),
      panelBox: panel ? {
        width: Math.round(panel.getBoundingClientRect().width),
        height: Math.round(panel.getBoundingClientRect().height),
      } : null,
      debugLog: frame.contentWindow.__scriptVariables?.presetManagerDebugLogV1 ?? [],
    };
  });

  const mountedEntry = mountInfo.debugLog.find(entry => entry.stage === 'render-mounted');
  if (!mountInfo.inParent || mountInfo.inChild || !mountedEntry?.details?.mountedInParent) {
    throw new Error('zero-frame: 面板没有挂到父页面可视层');
  }
  if (!mountInfo.panelBox || mountInfo.panelBox.width < 300 || mountInfo.panelBox.height < 300) {
    throw new Error('zero-frame: 父页面中的面板尺寸异常');
  }

  await page.close();
}

const { chromium } = await importPlaywright();
const fixture = await serveFixture();
const executablePath = process.env.PRESET_MANAGER_CHROME
  ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath });

try {
  await verifyZeroSizedIframeParentMount(browser, fixture);
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    await page.goto(fixture.url);
    await page.waitForFunction(() => window.__registeredEvents?.includes('helper-button:预设缝合'));
    const buttonApiStats = await page.evaluate(() => ({
      updateCalls: window.__updateScriptButtonsWithCalls,
      replaceCalls: window.__replaceScriptButtonsCalls,
    }));
    if (buttonApiStats.updateCalls < 1 || buttonApiStats.replaceCalls !== 0) {
      throw new Error(`${viewport.name}: 脚本按钮没有通过 updateScriptButtonsWith 注册`);
    }
    await page.getByRole('button', { name: /^预设缝合$/ }).click();
    await page.locator('.pm-panel').waitFor({ state: 'visible' });

    const bodyText = await page.locator('body').innerText();
    if (!bodyText.includes('预设缝合管理器') || bodyText.includes('????')) {
      throw new Error(`${viewport.name}: 中文 DOM 文本验证失败`);
    }
    if (!bodyText.includes('条目详情') || bodyText.includes('草稿') || bodyText.includes('结构正常')) {
      throw new Error(`${viewport.name}: 出现了应移除的旧文案`);
    }

    const panelBox = await page.locator('.pm-panel').boundingBox();
    if (!panelBox || panelBox.width > viewport.width + 1 || panelBox.height > viewport.height + 1) {
      throw new Error(`${viewport.name}: 面板超出视口`);
    }

    const saveButton = page.getByRole('button', { name: /保存预设/ });
    await saveButton.scrollIntoViewIfNeeded();
    const saveBox = await saveButton.boundingBox();
    if (!saveBox || saveBox.x < 0 || saveBox.y < 0 || saveBox.x + saveBox.width > viewport.width + 1 || saveBox.y + saveBox.height > viewport.height + 1) {
      throw new Error(`${viewport.name}: 保存按钮不可达`);
    }
    const isTabbedLayout = viewport.width <= 900;
    const initialTargetName = await page.locator('select[name="targetName"]').inputValue();
    if (initialTargetName !== '夏瑾二改（自用）') {
      throw new Error(`${viewport.name}: 目标预设没有默认使用当前 TT 预设`);
    }
    await page.locator('select[name="sourceName"]').selectOption('雪月agent_v1（自改）');
    const firstSourceActionCount = await page.locator('.pm-pane-source .pm-row').first().locator('.pm-row-action').count();
    const firstTargetActionCount = await page.locator('.pm-pane-target .pm-row').first().locator('.pm-row-action').count();
    if (firstSourceActionCount < 2 || firstTargetActionCount < 2) {
      throw new Error(`${viewport.name}: 条目行没有保留收藏和删除按钮`);
    }
    const sourcePresetActionCount = await page.locator('.pm-pane-source .pm-preset-action').count();
    const targetPresetActionCount = await page.locator('.pm-pane-target .pm-preset-action').count();
    if (sourcePresetActionCount !== 3 || targetPresetActionCount !== 3) {
      throw new Error(`${viewport.name}: 来源和目标预设没有同时提供复制、重命名、删除操作`);
    }

    const sourceSearch = page.locator('input[name="sourceQuery"]');
    await sourceSearch.focus();
    const composingState = await sourceSearch.evaluate(element => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      element.value = 't';
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: 't',
        inputType: 'insertCompositionText',
        isComposing: true,
      }));
      return {
        active: document.activeElement === element,
        connected: element.isConnected,
        value: element.value,
      };
    });
    if (!composingState.active || !composingState.connected || composingState.value !== 't') {
      throw new Error(`${viewport.name}: IME 组合输入时搜索框被重渲染替换`);
    }

    await sourceSearch.evaluate(element => {
      element.value = '特化';
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '特化' }));
    });
    const imeValue = await sourceSearch.inputValue();
    if (imeValue !== '特化') {
      throw new Error(`${viewport.name}: IME 中文输入提交失败`);
    }
    await sourceSearch.fill('');

    if (viewport.name === 'desktop-wide') {
      await verifySourceDetailEditing(page, fixture, viewport.name);
      await verifyPresetActions(page, fixture, viewport.name);
      await verifySourceDeleteDraft(page, fixture, viewport.name);
      await verifySelectionKeepsScroll(page, viewport.name);
      await verifyDirectDragAndUnsavedClose(page, fixture, viewport.name);
      await page.locator('input[name="sourceQuery"]').fill('');
    }

    if (isTabbedLayout) {
      await page.getByRole('button', { name: '目标', exact: true }).click();
      await page.locator('.pm-pane-target .pm-row').first().click();
    } else {
      const sourceTitle = await page.locator('.pm-pane-source .pm-row-title').first().textContent();
      await dragBetween(
        page,
        page.locator('.pm-pane-source .pm-row').first().locator('.pm-row-grip'),
        page.locator('.pm-pane-target .pm-list'),
        'end',
      );
      await page.waitForFunction(
        title => [...document.querySelectorAll('.pm-pane-target .pm-row-title')]
          .some(node => node.textContent?.trim() === title),
        sourceTitle?.trim(),
      );
    }

    if (isTabbedLayout) {
      await page.getByRole('button', { name: '条目详情', exact: true }).click();
    }
    await page.locator('textarea[name="detailContent"]').fill('详情编辑只停留在页面草稿里');
    await page.locator('select[name="detailRole"]').selectOption('user');
    if (fixture.getSavedPreset() !== null) {
      throw new Error(`${viewport.name}: 详情编辑不应在点击保存前调用保存接口`);
    }
    if (isTabbedLayout) {
      await page.getByRole('button', { name: '目标', exact: true }).click();
    }
    const accentColor = await page.locator('.pm-pane-target .pm-row.is-selected').evaluate(element => getComputedStyle(element).borderColor);
    if (!accentColor || accentColor === 'rgba(0, 0, 0, 0)') {
      throw new Error(`${viewport.name}: 主题色未应用到选中状态`);
    }

    await page.close();
  }
} finally {
  await browser.close();
  fixture.server.close();
}

console.log(JSON.stringify({ ok: true, viewports: viewports.map(item => item.name) }, null, 2));
