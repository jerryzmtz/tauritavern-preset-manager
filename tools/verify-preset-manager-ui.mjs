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
    // eslint-disable-next-line import-x/no-unresolved -- Optional dependency; fall back to playwright-core below.
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

const compareScrollBody = Array.from({ length: 220 }, (_, index) => `共同滚动占位 ${index + 1}`).join('\n');

const fixturePresets = [
  {
    name: '雪月agent_v1（自改）',
    preset: {
      prompts: [
        { identifier: 'source-novel', name: '📔小说', role: 'system', content: '基调：叙事性小说\n特化：保持真实感。' },
        { identifier: 'source-light', name: '📕轻小说', role: 'system', content: '基调：日式轻文学\n人称：第一人称。' },
        { identifier: 'shared-same', name: '共同正文相同', role: 'system', content: '共同第一行\n共同第二行' },
        {
          identifier: 'shared-diff',
          name: '共同正文不同',
          role: 'system',
          content: `共同第一行 {{random::红玫瑰::蓝月亮}}\n${compareScrollBody}\n共同第二行`,
        },
        { identifier: 'shared-meta', name: '来源标题不同', role: 'system', content: '辅助差异正文相同' },
        { identifier: 'source-name-match', name: '唯一同名条目', role: 'system', content: '来源同名正文' },
        { identifier: 'source-only-entry', name: '仅来源条目', role: 'user', content: '只在来源出现' },
        { identifier: 'shared-low-confidence', name: '双人成行', role: 'system', content: '双人成行故事开始' },
        { identifier: 'duplicate-source-a', name: '重复同名条目', role: 'system', content: '来源重复 A' },
        { identifier: 'duplicate-source-b', name: '重复同名条目', role: 'system', content: '来源重复 B' },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'source-novel', enabled: true },
            { identifier: 'source-light', enabled: false },
            { identifier: 'shared-same', enabled: true },
            { identifier: 'shared-diff', enabled: true },
            { identifier: 'shared-meta', enabled: true },
            { identifier: 'source-name-match', enabled: true },
            { identifier: 'source-only-entry', enabled: true },
            { identifier: 'shared-low-confidence', enabled: true },
            { identifier: 'duplicate-source-a', enabled: true },
            { identifier: 'duplicate-source-b', enabled: true },
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
        {
          identifier: 'target-default',
          name: '🖋️默认',
          role: 'user',
          content: '{{setvar::writingstyle::writing_style_1}}',
        },
        { identifier: 'shared-same', name: '共同正文相同', role: 'system', content: '共同第一行\n共同第二行' },
        {
          identifier: 'shared-diff',
          name: '共同正文不同',
          role: 'system',
          content: `共同第一行 {{random::红玫瑰}}\n${compareScrollBody}\n共同第二行`,
        },
        { identifier: 'shared-meta', name: '目标标题不同', role: 'user', content: '辅助差异正文相同' },
        { identifier: 'target-name-match', name: '唯一同名条目', role: 'system', content: '目标同名正文' },
        { identifier: 'target-only-entry', name: '仅目标条目', role: 'assistant', content: '只在目标出现' },
        { identifier: 'shared-low-confidence', name: '今天是满月哦', role: 'system', content: '今天是满月哦' },
        { identifier: 'duplicate-target-a', name: '重复同名条目', role: 'system', content: '目标重复 A' },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'target-style-heading', enabled: true },
            { identifier: 'target-default', enabled: true },
            { identifier: 'shared-same', enabled: true },
            { identifier: 'shared-diff', enabled: true },
            { identifier: 'shared-meta', enabled: false },
            { identifier: 'target-name-match', enabled: true },
            { identifier: 'target-only-entry', enabled: true },
            { identifier: 'shared-low-confidence', enabled: true },
            { identifier: 'duplicate-target-a', enabled: true },
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

fixturePresets[0].preset.prompts.push({
  identifier: 'deep-shared-match',
  name: '深层共同条目',
  role: 'system',
  content: '来源深层共同条目的正文不同',
});
fixturePresets[0].preset.prompt_order[0].order.push({ identifier: 'deep-shared-match', enabled: true });
fixturePresets[1].preset.prompts.push({
  identifier: 'deep-shared-match',
  name: '深层共同条目',
  role: 'system',
  content: '目标深层共同条目的正文不同',
});
fixturePresets[1].preset.prompt_order[0].order.push({ identifier: 'deep-shared-match', enabled: true });

function renderPresetManagerFixtureHostScript() {
  const fixtureJson = JSON.stringify(fixturePresets).replaceAll('</script', '<\\/script');
  const versionTagsJson = JSON.stringify([
    'v2.21',
    'v2.20',
    'v2.12',
    'v2.11',
    'v2.00',
    'v1.32',
    'v1.31',
    'v1.30',
    'v1.19',
  ]);

  return `
    const presetManagerFixturePresets = ${fixtureJson};
    const presetManagerVersionTags = ${versionTagsJson};
    const presetManagerImportContent = "import 'https://cdn.jsdelivr.net/gh/jerryzmtz/tauritavern-preset-manager@v2.21/dist/preset-manager/index.js';";
    const clonePreset = value => JSON.parse(JSON.stringify(value));
    const makeRuntimePreset = data => {
      const cloned = clonePreset(data);
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
    const createPresetManagerScriptTrees = scriptId => ({
      global: [{
        type: 'script',
        enabled: true,
        name: '预设管理',
        id: scriptId,
        content: presetManagerImportContent,
        info: '',
        button: { enabled: true, buttons: [] },
        data: {},
      }],
      preset: [],
      character: [],
    });
    const installPresetFixtureStore = host => {
      host.__clonePreset = clonePreset;
      host.__makeRuntimePreset = makeRuntimePreset;
      if (!host.__presetFixtureStore) {
        host.__presetFixtureStore = new Map(presetManagerFixturePresets.map(item => [item.name, item.preset]));
      }
      if (!host.__inUsePreset) {
        host.__inUsePreset = clonePreset(host.__presetFixtureStore.get('夏瑾二改（自用）'));
      }
    };
    const installPresetManagerTestHost = (host, options = {}) => {
      const storeHost = options.storeHost ?? host;
      const buttonDocument = options.buttonDocument ?? host.document;
      installPresetFixtureStore(storeHost);
      host.__clonePreset = clonePreset;
      host.__makeRuntimePreset = makeRuntimePreset;
      host.__scriptButtons = [];
      host.__registeredEvents = [];
      host.__scriptButtonEventsEnabled = true;
      host.__updateScriptButtonsWithCalls = 0;
      host.__replaceScriptButtonsCalls = 0;
      host.__versionScriptTrees = createPresetManagerScriptTrees(options.scriptId);
      host.__scriptVariables = {};
      const nativeFetch = host.fetch.bind(host);
      host.fetch = (input, init) => {
        const href = String(input);
        if (href === 'https://api.github.com/repos/jerryzmtz/tauritavern-preset-manager/releases/latest') {
          return Promise.resolve(new host.Response(JSON.stringify({ tag_name: 'v2.21' }), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          }));
        }
        if (href === 'https://api.github.com/repos/jerryzmtz/tauritavern-preset-manager/tags?per_page=20') {
          return Promise.resolve(new host.Response(JSON.stringify(presetManagerVersionTags.map(name => ({ name }))), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          }));
        }
        return nativeFetch(input, init);
      };
      host.$ = value => {
        const api = {
          on(event, callback) {
            const target = value === host ? host : host.document;
            target.addEventListener(event, callback);
            return api;
          },
        };
        if (typeof value === 'function') {
          if (host.document.readyState === 'loading') {
            host.document.addEventListener('DOMContentLoaded', value, { once: true });
          } else {
            host.queueMicrotask(value);
          }
        }
        return api;
      };
      host.getButtonEvent = name => 'helper-button:' + name;
      host.eventOn = (event, callback) => {
        host.__registeredEvents.push(event);
        host.addEventListener(event, callback);
        return { stop: () => host.removeEventListener(event, callback) };
      };
      host.updateScriptButtonsWith = updater => {
        host.__updateScriptButtonsWithCalls += 1;
        host.__scriptButtons = updater(host.__scriptButtons.map(button => ({ ...button }))).map(button => ({ ...button }));
        const buttonHost = buttonDocument.getElementById('script-buttons');
        if (buttonHost) {
          buttonHost.innerHTML = '';
          for (const button of host.__scriptButtons.filter(item => item.visible)) {
            const element = buttonDocument.createElement('button');
            element.type = 'button';
            element.textContent = button.name;
            element.dataset.buttonName = button.name;
            element.dataset.scriptButton = button.name;
            element.setAttribute('aria-label', button.name);
            element.addEventListener('click', () => {
              if (!options.respectButtonEventToggle || host.__scriptButtonEventsEnabled) {
                host.dispatchEvent(new host.Event(host.getButtonEvent(button.name)));
              }
            });
            buttonHost.appendChild(element);
          }
        }
        return host.__scriptButtons;
      };
      host.replaceScriptButtons = () => {
        host.__replaceScriptButtonsCalls += 1;
        throw new Error('replaceScriptButtons 不应被预设管理器入口使用');
      };
      host.getPresetNames = () => Array.from(storeHost.__presetFixtureStore.keys());
      host.getLoadedPresetName = () => '夏瑾二改（自用）';
      host.getPreset = name => host.__makeRuntimePreset(name === 'in_use' ? storeHost.__inUsePreset : storeHost.__presetFixtureStore.get(name));
      host.getScriptId = () => options.scriptId;
      host.getScriptTrees = ({ type }) => host.__versionScriptTrees[type] ?? [];
      host.updateScriptTreesWith = (updater, { type }) => {
        host.__versionScriptTrees[type] = updater(host.__versionScriptTrees[type] ?? []);
        return host.__versionScriptTrees[type];
      };
      host.getVariables = () => host.__scriptVariables;
      host.updateVariablesWith = updater => {
        host.__scriptVariables = updater(host.__scriptVariables);
        return host.__scriptVariables;
      };
      host.deleteVariable = variablePath => {
        delete host.__scriptVariables[variablePath];
        return { variables: host.__scriptVariables, delete_occurred: true };
      };
      host.insertOrAssignVariables = variables => {
        host.__scriptVariables = { ...(host.__scriptVariables ?? {}), ...variables };
        return host.__scriptVariables;
      };
      host.createOrReplacePreset = async (name, preset, createOptions = {}) => {
        if (name === 'in_use') {
          storeHost.__inUsePreset = clonePreset(preset);
        } else {
          storeHost.__presetFixtureStore.set(name, clonePreset(preset));
        }
        return options.savePreset ? options.savePreset(name, preset, createOptions) : true;
      };
      host.deletePreset = async name => storeHost.__presetFixtureStore.delete(name);
      host.renamePreset = async (name, newName) => {
        if (!storeHost.__presetFixtureStore.has(name)) {
          return false;
        }
        const preset = storeHost.__presetFixtureStore.get(name);
        storeHost.__presetFixtureStore.delete(name);
        storeHost.__presetFixtureStore.set(newName, preset);
        return true;
      };
      host.TavernHelper = {
        getPresetNames: host.getPresetNames,
        getLoadedPresetName: host.getLoadedPresetName,
        getPreset: host.getPreset,
        createOrReplacePreset: host.createOrReplacePreset,
        deletePreset: host.deletePreset,
        renamePreset: host.renamePreset,
      };
    };
  `;
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
  <title>预设管理测试</title>
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
  <main>中文测试：预设管理</main>
  <div id="script-buttons"></div>
  <script>
    ${renderPresetManagerFixtureHostScript()}
    installPresetManagerTestHost(window, {
      scriptId: 'preset-manager-script-id',
      respectButtonEventToggle: true,
      savePreset: async (name, preset, options = {}) => {
        const response = await fetch('/api/presets/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiId: 'openai', name, preset, options }),
        });
        if (!response.ok) {
          throw new Error('保存预设失败：HTTP ' + response.status);
        }
        return true;
      },
    });
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
  <main>父页面中文测试：预设管理</main>
  <div id="script-buttons"></div>
  <iframe id="script-frame" title="zero-sized-script-frame" src="/zero-frame-child" style="width:0;height:0;border:0;display:block"></iframe>
  <script>
    ${renderPresetManagerFixtureHostScript()}
    installPresetFixtureStore(window);
    const frame = document.getElementById('script-frame');
    frame.addEventListener('load', () => {
      const child = frame.contentWindow;
      installPresetManagerTestHost(child, {
        scriptId: 'zero-frame-script-id',
        storeHost: window,
        buttonDocument: document,
      });
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

  const targetY =
    placement === 'after'
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
  const originalTitles = await targetTitles.evaluateAll(nodes =>
    nodes.slice(0, 3).map(node => node.textContent?.trim()),
  );
  if (originalTitles.length < 3) {
    throw new Error(`${viewportName}: 目标列表条目不足，无法验证拖拽排序`);
  }

  await dragBetween(
    page,
    page.locator('.pm-pane-target .pm-row').first().locator('.pm-row-grip'),
    page.locator('.pm-pane-target .pm-row').nth(1),
    'after',
  );

  const reorderedTitles = await targetTitles.evaluateAll(nodes =>
    nodes.slice(0, 3).map(node => node.textContent?.trim()),
  );
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
  await page.getByRole('button', { name: /^预设管理$/ }).click();
  await page.locator('.pm-panel').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    window.__scriptButtonEventsEnabled = true;
  });

  const reopenedTitles = await targetTitles.evaluateAll(nodes =>
    nodes.slice(0, 3).map(node => node.textContent?.trim()),
  );
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
  await page.waitForFunction(
    count => document.querySelectorAll('.pm-pane-target .pm-row').length > count,
    targetCountBefore,
  );
  const targetTitleTexts = await targetTitles.evaluateAll(nodes => nodes.map(node => node.textContent?.trim()));
  if (!targetTitleTexts.includes(sourceTitle?.trim())) {
    throw new Error(`${viewportName}: 来源条目无法直接拖入目标预设`);
  }
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 拖拽目标预设操作不应触发保存接口`);
  }

  const reverseDragTitle = '仅目标条目';
  const sourceCountBeforeReverseDrag = await page.locator('.pm-pane-source .pm-row').count();
  await dragBetween(
    page,
    rowByTitle(page, '.pm-pane-target', reverseDragTitle).first().locator('.pm-row-grip'),
    page.locator('.pm-pane-source .pm-list'),
    'end',
  );
  await page.waitForFunction(
    count => document.querySelectorAll('.pm-pane-source .pm-row').length > count,
    sourceCountBeforeReverseDrag,
  );
  const sourceTitleTexts = await page
    .locator('.pm-pane-source .pm-row-title')
    .evaluateAll(nodes => nodes.map(node => node.textContent?.trim()));
  if (!sourceTitleTexts.includes(reverseDragTitle)) {
    throw new Error(`${viewportName}: 目标条目无法直接拖入来源预设`);
  }
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 拖拽来源预设操作不应触发保存接口`);
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
  await page.waitForFunction(
    count => document.querySelectorAll('.pm-pane-source .pm-row').length === count - 1,
    before,
  );
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
  if ((await detailContent.getAttribute('readonly')) !== null || (await detailRole.isDisabled())) {
    throw new Error(`${viewportName}: 来源条目被选中后条目详情仍不可编辑`);
  }

  await detailContent.fill('来源条目的详情编辑只停留在页面草稿里');
  await detailRole.selectOption('user');
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 编辑来源条目详情不应在点击保存前调用保存接口`);
  }

  await page.getByRole('button', { name: '放弃修改' }).click();
  await page.waitForFunction(
    () => document.querySelector('textarea[name="detailContent"]')?.value !== '来源条目的详情编辑只停留在页面草稿里',
  );
}

async function verifyEntryToggleDraft(page, fixture, viewportName) {
  await page.locator('select[name="sourceName"]').selectOption('雪月agent_v1（自改）');
  await page.locator('select[name="targetName"]').selectOption('夏瑾二改（自用）');
  fixture.clearSavedPreset();

  const sourceToggle = page.locator('.pm-pane-source .pm-row').first().locator('.pm-row-toggle');
  if ((await sourceToggle.getAttribute('aria-pressed')) !== 'true') {
    throw new Error(`${viewportName}: 来源首条开关初始状态应为启用`);
  }
  await sourceToggle.click();
  await page.waitForFunction(
    () => document.querySelector('.pm-pane-source .pm-row .pm-row-toggle')?.getAttribute('aria-pressed') === 'false',
  );
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 来源条目开关不应在点击保存前调用保存接口`);
  }
  const dirtyText = await page.locator('.pm-footer-status').innerText();
  if (!dirtyText.includes('未保存')) {
    throw new Error(`${viewportName}: 来源条目开关后没有进入未保存状态`);
  }
  await page.getByRole('button', { name: '放弃修改' }).click();
  await page.waitForFunction(
    () => document.querySelector('.pm-pane-source .pm-row .pm-row-toggle')?.getAttribute('aria-pressed') === 'true',
  );

  fixture.clearSavedPreset();
  const targetToggle = page.locator('.pm-pane-target .pm-row').first().locator('.pm-row-toggle');
  if ((await targetToggle.getAttribute('aria-pressed')) !== 'true') {
    throw new Error(`${viewportName}: 目标首条开关初始状态应为启用`);
  }
  await targetToggle.click();
  await page.waitForFunction(
    () => document.querySelector('.pm-pane-target .pm-row .pm-row-toggle')?.getAttribute('aria-pressed') === 'false',
  );
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 目标条目开关不应在点击保存前调用保存接口`);
  }
  await page.getByRole('button', { name: /保存预设/ }).click();
  await page.waitForFunction(() =>
    document.querySelector('.pm-footer-status')?.textContent?.includes('暂无未保存修改'),
  );
  const savedDisabled = fixture.getSavedPreset();
  const disabledPrompt = savedDisabled?.preset?.prompts?.find(prompt => prompt.id === 'target-style-heading');
  const namedDisabled = await page.evaluate(() =>
    window.__presetFixtureStore.get('夏瑾二改（自用）')?.prompts?.find(prompt => prompt.id === 'target-style-heading'),
  );
  if (
    !savedDisabled ||
    savedDisabled.name !== 'in_use' ||
    disabledPrompt?.enabled !== false ||
    namedDisabled?.enabled !== false
  ) {
    throw new Error(`${viewportName}: 保存后目标条目开关状态没有同时写入命名预设和 in_use`);
  }
  await verifyNoPresetManagerBackups(page, viewportName);

  fixture.clearSavedPreset();
  await targetToggle.click();
  await page.waitForFunction(
    () => document.querySelector('.pm-pane-target .pm-row .pm-row-toggle')?.getAttribute('aria-pressed') === 'true',
  );
  await page.getByRole('button', { name: /保存预设/ }).click();
  await page.waitForFunction(() =>
    document.querySelector('.pm-footer-status')?.textContent?.includes('暂无未保存修改'),
  );
  const savedEnabled = fixture.getSavedPreset();
  const enabledPrompt = savedEnabled?.preset?.prompts?.find(prompt => prompt.id === 'target-style-heading');
  const namedEnabled = await page.evaluate(() =>
    window.__presetFixtureStore.get('夏瑾二改（自用）')?.prompts?.find(prompt => prompt.id === 'target-style-heading'),
  );
  if (
    !savedEnabled ||
    savedEnabled.name !== 'in_use' ||
    enabledPrompt?.enabled !== true ||
    namedEnabled?.enabled !== true
  ) {
    throw new Error(`${viewportName}: 目标条目开关恢复启用后没有同时保存到命名预设和 in_use`);
  }
  await verifyNoPresetManagerBackups(page, viewportName);
}

async function verifyCompareMode(page, fixture, viewportName) {
  await page.locator('select[name="sourceName"]').selectOption('雪月agent_v1（自改）');
  await page.locator('select[name="targetName"]').selectOption('夏瑾二改（自用）');
  fixture.clearSavedPreset();

  const compareButton = page.locator('[data-action="toggle-compare"]');
  await compareButton.click();
  await page.waitForFunction(
    () => document.querySelector('[data-action="toggle-compare"]')?.getAttribute('aria-pressed') === 'true',
  );
  const summaryText = await page.locator('.pm-compare-summary').innerText();
  for (const expected of ['正文不同', '仅来源', '仅目标', '辅助差异']) {
    if (!summaryText.includes(expected)) {
      throw new Error(`${viewportName}: 比对摘要缺少 ${expected}`);
    }
  }
  const compareCounts = await page
    .locator('.pm-compare-filter')
    .evaluateAll(buttons =>
      Object.fromEntries(
        buttons.map(button => [
          button.getAttribute('data-compare-filter'),
          button.textContent?.trim().replace(/\s+/g, ' '),
        ]),
      ),
    );
  if (
    compareCounts.content !== '正文不同 3' ||
    compareCounts.source_only !== '仅来源 24' ||
    compareCounts.target_only !== '仅目标 23'
  ) {
    throw new Error(
      `${viewportName}: 低置信同 ID 条目没有从正文不同拆分到仅来源/仅目标 ${JSON.stringify(compareCounts)}`,
    );
  }

  const sourceDiff = rowByTitle(page, '.pm-pane-source', '共同正文不同').first();
  const targetDiff = rowByTitle(page, '.pm-pane-target', '共同正文不同').first();
  await assertRowClass(sourceDiff, 'is-compare-content-different', `${viewportName}: 来源正文差异未高亮`);
  await assertRowClass(targetDiff, 'is-compare-content-different', `${viewportName}: 目标正文差异未高亮`);
  if (!(await sourceDiff.innerText()).includes('正文不同') || !(await targetDiff.innerText()).includes('正文不同')) {
    throw new Error(`${viewportName}: 正文不同条目没有显示徽标`);
  }

  const sourceSame = rowByTitle(page, '.pm-pane-source', '共同正文相同').first();
  await assertRowNotClass(sourceSame, 'is-compare-content-different', `${viewportName}: 正文相同条目不应强高亮`);

  const metadataOnly = rowByTitle(page, '.pm-pane-source', '来源标题不同').first();
  await assertRowNotClass(metadataOnly, 'is-compare-content-different', `${viewportName}: 仅辅助差异不应强高亮`);
  const metadataText = await metadataOnly.innerText();
  if (!metadataText.includes('标题') || !metadataText.includes('角色') || !metadataText.includes('开关')) {
    throw new Error(`${viewportName}: 辅助差异没有显示标题/角色/开关徽标`);
  }

  const sourceNameMatch = rowByTitle(page, '.pm-pane-source', '唯一同名条目').first();
  const targetNameMatch = rowByTitle(page, '.pm-pane-target', '唯一同名条目').first();
  await assertRowClass(sourceNameMatch, 'is-compare-content-different', `${viewportName}: 同名匹配来源差异未高亮`);
  await assertRowClass(targetNameMatch, 'is-compare-content-different', `${viewportName}: 同名匹配目标差异未高亮`);
  if (!(await sourceNameMatch.innerText()).includes('同名匹配')) {
    throw new Error(`${viewportName}: 同名匹配条目没有提示匹配方式`);
  }

  await assertRowClass(
    rowByTitle(page, '.pm-pane-source', '仅来源条目').first(),
    'is-compare-only',
    `${viewportName}: 仅来源条目未高亮`,
  );
  await assertRowClass(
    rowByTitle(page, '.pm-pane-target', '仅目标条目').first(),
    'is-compare-only',
    `${viewportName}: 仅目标条目未高亮`,
  );

  const duplicateSourceRows = rowByTitle(page, '.pm-pane-source', '重复同名条目');
  const duplicateTargetRows = rowByTitle(page, '.pm-pane-target', '重复同名条目');
  if ((await duplicateSourceRows.count()) !== 2 || (await duplicateTargetRows.count()) !== 1) {
    throw new Error(`${viewportName}: 重复同名测试夹具数量不正确`);
  }
  await assertRowClass(
    duplicateSourceRows.nth(0),
    'is-compare-only',
    `${viewportName}: 重复同名来源条目不应被强行匹配`,
  );
  await assertRowClass(
    duplicateSourceRows.nth(1),
    'is-compare-only',
    `${viewportName}: 重复同名来源条目不应被强行匹配`,
  );
  await assertRowClass(
    duplicateTargetRows.first(),
    'is-compare-only',
    `${viewportName}: 重复同名目标条目不应被强行匹配`,
  );
  if ((await duplicateSourceRows.first().innerText()).includes('同名匹配')) {
    throw new Error(`${viewportName}: 重复同名条目被错误标成同名匹配`);
  }

  await page.locator('[data-compare-filter="content"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-compare-filter="content"]')?.getAttribute('aria-pressed') === 'true',
  );
  if ((await rowByTitle(page, '.pm-pane-source', '共同正文相同').count()) !== 0) {
    throw new Error(`${viewportName}: 正文不同过滤不应显示正文相同条目`);
  }
  if ((await rowByTitle(page, '.pm-pane-source', '共同正文不同').count()) !== 1) {
    throw new Error(`${viewportName}: 正文不同过滤应保留来源正文差异条目`);
  }
  if (
    (await rowByTitle(page, '.pm-pane-source', '双人成行').count()) !== 0 ||
    (await rowByTitle(page, '.pm-pane-target', '今天是满月哦').count()) !== 0
  ) {
    throw new Error(`${viewportName}: 低置信同 ID 条目不应进入正文不同过滤`);
  }
  await page.locator('select[name="targetFilter"]').selectOption('assistant');
  if ((await rowByTitle(page, '.pm-pane-source', '共同正文不同').count()) !== 1) {
    throw new Error(`${viewportName}: 比对配对关系不应被目标侧普通过滤重新判定`);
  }
  await page.locator('select[name="targetFilter"]').selectOption('all');
  await page.locator('select[name="sourceFilter"]').selectOption('user');
  if ((await page.locator('.pm-pane-source .pm-row').count()) !== 0) {
    throw new Error(`${viewportName}: 比对过滤应与来源现有过滤保持且关系`);
  }
  await page.locator('select[name="sourceFilter"]').selectOption('all');

  await page.locator('[data-compare-filter="source_only"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-compare-filter="source_only"]')?.getAttribute('aria-pressed') === 'true',
  );
  if (
    (await rowByTitle(page, '.pm-pane-source', '仅来源条目').count()) !== 1 ||
    (await rowByTitle(page, '.pm-pane-source', '双人成行').count()) !== 1 ||
    (await page.locator('.pm-pane-target .pm-row').count()) !== 0
  ) {
    throw new Error(`${viewportName}: 仅来源过滤没有只保留来源侧独有条目`);
  }
  await page.locator('[data-compare-filter="source_only"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-compare-filter="source_only"]')?.getAttribute('aria-pressed') === 'false',
  );

  await page.locator('[data-compare-filter="target_only"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-compare-filter="target_only"]')?.getAttribute('aria-pressed') === 'true',
  );
  if (
    (await rowByTitle(page, '.pm-pane-target', '今天是满月哦').count()) !== 1 ||
    (await page.locator('.pm-pane-source .pm-row').count()) !== 0
  ) {
    throw new Error(`${viewportName}: 仅目标过滤没有只保留低置信目标侧条目`);
  }
  await page.locator('[data-compare-filter="target_only"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-compare-filter="target_only"]')?.getAttribute('aria-pressed') === 'false',
  );

  if (await targetDiff.locator('.pm-row-toggle').isDisabled()) {
    throw new Error(`${viewportName}: 比对模式下应允许修改条目开关`);
  }
  if (!(await page.getByRole('button', { name: /保存预设/ }).isDisabled())) {
    throw new Error(`${viewportName}: 比对模式下没有改动时保存按钮应禁用`);
  }

  await targetDiff.click();
  await page.locator('.pm-compare-detail').waitFor({ state: 'visible' });
  const detailText = await page.locator('.pm-compare-detail').innerText();
  if (!detailText.includes('正文不同')) {
    throw new Error(`${viewportName}: 比对详情缺少正文不同状态`);
  }
  const sourceCompareText = page.locator('[data-compare-content="compareSourceContent"]');
  const targetCompareText = page.locator('[data-compare-content="compareTargetContent"]');
  if (
    !(await sourceCompareText.innerText()).includes('共同第一行') ||
    !(await targetCompareText.innerText()).includes('共同第一行') ||
    (await sourceCompareText.getAttribute('aria-readonly')) !== 'false' ||
    (await targetCompareText.getAttribute('aria-readonly')) !== 'false'
  ) {
    throw new Error(`${viewportName}: 比对详情没有在来源/目标窗口里直接提供可编辑正文`);
  }
  const sourceDiffMarks = await page
    .locator('[data-compare-highlight="compareSourceContent"] .pm-compare-token')
    .allInnerTexts();
  const targetDiffMarks = await page
    .locator('[data-compare-highlight="compareTargetContent"] .pm-compare-token')
    .allInnerTexts();
  if (!sourceDiffMarks.join('').includes('蓝月亮') && !targetDiffMarks.join('').includes('蓝月亮')) {
    throw new Error(`${viewportName}: 比对详情没有高亮 prompt 内部差异片段`);
  }
  const highlightStyle = await page
    .locator('[data-compare-highlight="compareSourceContent"] .pm-compare-token')
    .first()
    .evaluate(element => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, boxShadow: style.boxShadow };
    });
  if (highlightStyle.backgroundColor === 'rgba(0, 0, 0, 0)' || highlightStyle.boxShadow === 'none') {
    throw new Error(`${viewportName}: 比对详情差异片段的高亮视觉强度不足`);
  }
  if (await page.locator('.pm-compare-edit, textarea[name="detailContent"]').count()) {
    throw new Error(`${viewportName}: 比对模式不应额外增加独立编辑窗口`);
  }
  const targetScrollBeforeSourceEdit = await targetCompareText.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  if (targetScrollBeforeSourceEdit <= 0) {
    throw new Error(`${viewportName}: 目标对比窗口测试内容不足，无法验证滚动保持`);
  }
  const editedSourceCompareContent = `${await sourceCompareText.innerText()}\n来源侧即时编辑行`;
  await sourceCompareText.fill(editedSourceCompareContent);
  await page.waitForTimeout(320);
  const targetScrollAfterSourceEdit = await targetCompareText.evaluate(element => element.scrollTop);
  if (targetScrollAfterSourceEdit < targetScrollBeforeSourceEdit - 4) {
    throw new Error(`${viewportName}: 修改来源正文时目标对比窗口不应回顶`);
  }
  const sourceScrollBeforeTargetEdit = await sourceCompareText.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    return {
      top: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      textLength: element.textContent?.length ?? 0,
    };
  });
  if (sourceScrollBeforeTargetEdit.top <= 0) {
    throw new Error(
      `${viewportName}: 来源对比窗口测试内容不足，无法验证滚动保持 ${JSON.stringify(sourceScrollBeforeTargetEdit)}`,
    );
  }
  const editedCompareContent = '共同第一行 {{random::红玫瑰::白山茶}}\n共同第二行';
  await targetCompareText.fill(editedCompareContent);
  await page.waitForTimeout(320);
  const sourceScrollAfterTargetEdit = await sourceCompareText.evaluate(element => element.scrollTop);
  if (sourceScrollAfterTargetEdit < sourceScrollBeforeTargetEdit.top - 4) {
    throw new Error(`${viewportName}: 修改目标正文时来源对比窗口不应回顶`);
  }
  await page.locator('select[name="compareTargetRole"]').selectOption('assistant');
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 比对模式详情编辑不应在点击保存前调用保存接口`);
  }
  if (await page.getByRole('button', { name: /保存预设/ }).isDisabled()) {
    throw new Error(`${viewportName}: 比对模式编辑后应允许直接保存`);
  }
  await targetDiff.locator('.pm-row-toggle').click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.pm-pane-target .pm-row')]
        .find(row => row.textContent?.includes('共同正文不同'))
        ?.querySelector('.pm-row-toggle')
        ?.getAttribute('aria-pressed') === 'false',
  );
  await page.getByRole('button', { name: /保存预设/ }).click();
  await page.waitForFunction(() =>
    document.querySelector('.pm-footer-status')?.textContent?.includes('暂无未保存修改'),
  );
  const savedFromCompare = fixture.getSavedPreset();
  const savedComparePrompt = savedFromCompare?.preset?.prompts?.find(prompt => prompt.id === 'shared-diff');
  if (
    !savedFromCompare ||
    savedFromCompare.name !== 'in_use' ||
    savedComparePrompt?.content !== editedCompareContent ||
    savedComparePrompt?.role !== 'assistant' ||
    savedComparePrompt?.enabled !== false
  ) {
    throw new Error(
      `${viewportName}: 比对模式下编辑、开关和保存没有正确写入目标预设 ${JSON.stringify({
        name: savedFromCompare?.name,
        content: savedComparePrompt?.content,
        role: savedComparePrompt?.role,
        enabled: savedComparePrompt?.enabled,
      })}`,
    );
  }
  await verifyNoPresetManagerBackups(page, viewportName);

  await page.locator('input[name="sourceQuery"]').fill('共同');
  await page.locator('select[name="sourceFilter"]').selectOption('system');
  fixture.clearSavedPreset();
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 比对模式搜索或过滤不应调用保存接口`);
  }
  await page.locator('input[name="sourceQuery"]').fill('');
  await page.locator('select[name="sourceFilter"]').selectOption('all');

  await compareButton.click();
  await page.waitForFunction(
    () => document.querySelector('[data-action="toggle-compare"]')?.getAttribute('aria-pressed') === 'false',
  );
  const selectedNormalTarget = await rowByTitle(page, '.pm-pane-target', '共同正文不同').first().getAttribute('class');
  if (!selectedNormalTarget?.split(/\s+/).includes('is-selected')) {
    throw new Error(`${viewportName}: 比对模式中选中的条目应继承到普通模式`);
  }
  if ((await page.locator('textarea[name="detailContent"]').inputValue()) !== editedCompareContent) {
    throw new Error(`${viewportName}: 回到普通模式后详情区没有保持选中条目的编辑内容`);
  }

  await compareButton.click();
  await page.waitForFunction(
    () => document.querySelector('[data-action="toggle-compare"]')?.getAttribute('aria-pressed') === 'true',
  );
  const deepTargetRow = rowByTitle(page, '.pm-pane-target', '深层共同条目').first();
  await deepTargetRow.scrollIntoViewIfNeeded();
  await page.locator('.pm-pane-source .pm-list').evaluate(element => {
    element.scrollTop = 0;
  });
  await deepTargetRow.click();
  await page.waitForFunction(() => {
    const list = document.querySelector('.pm-pane-source .pm-list');
    const row = [...document.querySelectorAll('.pm-pane-source .pm-row')].find(element =>
      element.textContent?.includes('深层共同条目'),
    );
    if (!list || !row) return false;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return row.classList.contains('is-selected') && rowRect.bottom > listRect.top && rowRect.top < listRect.bottom;
  });
  await page.locator('.pm-pane-source .pm-list, .pm-pane-target .pm-list').evaluateAll(elements => {
    for (const element of elements) {
      element.scrollTop = 0;
    }
  });
  await compareButton.click();
  await page.waitForFunction(
    () => document.querySelector('[data-action="toggle-compare"]')?.getAttribute('aria-pressed') === 'false',
  );
  const deepRowsVisible = await page.evaluate(() => {
    return ['.pm-pane-source', '.pm-pane-target'].every(paneSelector => {
      const list = document.querySelector(`${paneSelector} .pm-list`);
      const row = [...document.querySelectorAll(`${paneSelector} .pm-row`)].find(element =>
        element.textContent?.includes('深层共同条目'),
      );
      if (!list || !row) return false;
      const listRect = list.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return row.classList.contains('is-selected') && rowRect.bottom > listRect.top && rowRect.top < listRect.bottom;
    });
  });
  if (!deepRowsVisible) {
    throw new Error(`${viewportName}: 关闭比对模式后来源和目标都应自动滚动到配对条目`);
  }

  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 开关比对模式不应调用保存接口`);
  }
}

async function verifyTutorial(page, fixture, viewportName) {
  if (await page.locator('[data-action="refresh"]').count()) {
    throw new Error(`${viewportName}: 顶部不应再提供无实际用途的刷新按钮`);
  }

  fixture.clearSavedPreset();
  await page.getByTitle('打开教程').click();
  await page.locator('.pm-tutorial-overlay').waitFor({ state: 'visible' });
  const firstStepText = await page.locator('.pm-tutorial-popover').innerText();
  if (!firstStepText.includes('预设管理') || !firstStepText.includes('保存预设') || firstStepText.includes('????')) {
    throw new Error(`${viewportName}: 教程首屏中文内容异常`);
  }

  const highlightBox = await page.locator('.pm-tutorial-highlight').boundingBox();
  if (!highlightBox || highlightBox.width < 100 || highlightBox.height < 100) {
    throw new Error(`${viewportName}: 教程没有高亮当前步骤目标`);
  }

  await page.locator('[data-pm-tutorial-action="next"]').click();
  await page.waitForFunction(() => document.querySelector('.pm-tutorial-progress')?.textContent?.startsWith('2 /'));
  const secondStepText = await page.locator('.pm-tutorial-popover').innerText();
  if (!secondStepText.includes('来源预设')) {
    throw new Error(`${viewportName}: 教程下一步没有定位到来源预设`);
  }

  await page.waitForTimeout(260);
  for (let index = 0; index < 3; index += 1) {
    await page.locator('[data-pm-tutorial-action="next"]').click();
    await page.waitForTimeout(260);
  }
  await page.waitForFunction(() => document.querySelector('.pm-tutorial-progress')?.textContent?.startsWith('5 /'));
  const toggleStepText = await page.locator('.pm-tutorial-popover').innerText();
  if (!toggleStepText.includes('条目开关')) {
    throw new Error(`${viewportName}: 教程没有进入条目开关步骤`);
  }
  const overlap = await page.evaluate(() => {
    const popover = document.querySelector('.pm-tutorial-popover')?.getBoundingClientRect();
    const highlight = document.querySelector('.pm-tutorial-highlight')?.getBoundingClientRect();
    if (!popover || !highlight) return true;
    return !(
      popover.right <= highlight.left ||
      popover.left >= highlight.right ||
      popover.bottom <= highlight.top ||
      popover.top >= highlight.bottom
    );
  });
  if (overlap) {
    throw new Error(`${viewportName}: 条目开关步骤的教程窗口不应遮住高亮按钮`);
  }

  await page.locator('[data-pm-tutorial-action="dismiss"]').click();
  await page.locator('.pm-tutorial-overlay').waitFor({ state: 'detached' });
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 打开或关闭教程不应调用保存接口`);
  }
}

function rowByTitle(page, paneSelector, title) {
  return page.locator(`${paneSelector} .pm-row`).filter({ hasText: title });
}

async function assertRowClass(row, className, message) {
  const classValue = (await row.getAttribute('class')) ?? '';
  if (!classValue.split(/\s+/).includes(className)) {
    throw new Error(message);
  }
}

async function assertRowNotClass(row, className, message) {
  const classValue = (await row.getAttribute('class')) ?? '';
  if (classValue.split(/\s+/).includes(className)) {
    throw new Error(message);
  }
}

async function verifyNoPresetManagerBackups(page, viewportName) {
  const backupNames = await page.evaluate(() =>
    Array.from(window.__presetFixtureStore.keys()).filter(name => name.includes('.bak-preset-manager-')),
  );
  if (backupNames.length) {
    throw new Error(`${viewportName}: 保存普通草稿时不应生成备份预设：${backupNames.join(', ')}`);
  }
}

async function verifyMultiSelectOperations(page, fixture, viewportName) {
  await page.locator('select[name="sourceName"]').selectOption('雪月agent_v1（自改）');
  await page.locator('select[name="targetName"]').selectOption('夏瑾二改（自用）');
  fixture.clearSavedPreset();

  const sourceRows = page.locator('.pm-pane-source .pm-row');
  const targetRows = page.locator('.pm-pane-target .pm-row');
  const selectedSourceTitles = await sourceRows.evaluateAll(nodes =>
    nodes.slice(0, 2).map(node => node.querySelector('.pm-row-title')?.textContent?.trim()),
  );
  if (selectedSourceTitles.length < 2 || selectedSourceTitles.some(title => !title)) {
    throw new Error(`${viewportName}: 来源列表条目不足，无法验证多选`);
  }

  const sourcePresetActionsBefore = await page.locator('.pm-pane-source .pm-preset-action').count();
  await page.locator('.pm-pane-source [data-action="entry-multi-toggle"]').click();
  const sourcePresetActionsAfter = await page.locator('.pm-pane-source .pm-preset-action').count();
  if (sourcePresetActionsBefore !== 3 || sourcePresetActionsAfter !== 3) {
    throw new Error(`${viewportName}: 条目多选操作混入了预设级操作区`);
  }
  if ((await page.locator('.pm-pane-source .pm-entry-selection-toolbar.is-active').count()) !== 1) {
    throw new Error(`${viewportName}: 条目多选没有使用独立工具条`);
  }

  await sourceRows.nth(0).locator('.pm-row-select').click();
  await sourceRows.nth(1).locator('.pm-row-select').click();
  if (await page.locator('.pm-pane-source .pm-selection-count').count()) {
    throw new Error(`${viewportName}: 多选工具条不应显示已选条数`);
  }
  const toolbarLabels = await page
    .locator('.pm-pane-source .pm-selection-action')
    .evaluateAll(nodes => nodes.map(node => node.textContent?.trim()));
  if (
    !toolbarLabels.includes('收藏') ||
    !toolbarLabels.includes('删除') ||
    toolbarLabels.some(label => label?.includes('选中'))
  ) {
    throw new Error(`${viewportName}: 批量收藏和删除按钮文案应保持精简`);
  }

  const favoritesBefore = await page.evaluate(
    () => JSON.parse(localStorage.getItem('preset-manager:favorites:v1') ?? '[]').length,
  );
  await page.locator('.pm-pane-source [data-action="entry-batch-favorite"]').click();
  await page.waitForFunction(
    count => JSON.parse(localStorage.getItem('preset-manager:favorites:v1') ?? '[]').length === count + 2,
    favoritesBefore,
  );
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 批量收藏不应调用预设保存接口`);
  }

  const targetCountBeforeDrag = await targetRows.count();
  await dragBetween(page, sourceRows.first().locator('.pm-row-grip'), page.locator('.pm-pane-target .pm-list'), 'end');
  await page.waitForFunction(
    count => document.querySelectorAll('.pm-pane-target .pm-row').length === count + 2,
    targetCountBeforeDrag,
  );
  const targetTitlesAfterDrag = await page
    .locator('.pm-pane-target .pm-row-title')
    .evaluateAll(nodes => nodes.map(node => node.textContent?.trim()));
  const insertedAt = targetTitlesAfterDrag.findIndex(title => title === selectedSourceTitles[0]);
  if (insertedAt < 0 || targetTitlesAfterDrag[insertedAt + 1] !== selectedSourceTitles[1]) {
    throw new Error(`${viewportName}: 多选拖拽没有按来源顺序插入目标预设`);
  }
  const targetSelectedTitlesAfterDrag = await page
    .locator('.pm-pane-target .pm-row.is-multi-selected .pm-row-title')
    .evaluateAll(nodes => nodes.map(node => node.textContent?.trim()));
  for (const title of selectedSourceTitles) {
    if (!targetSelectedTitlesAfterDrag.includes(title)) {
      throw new Error(`${viewportName}: 多选拖拽后目标预设没有高亮整组选中条目`);
    }
  }
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 多选拖拽不应调用预设保存接口`);
  }

  await page.getByRole('button', { name: '放弃修改' }).click();
  await page.waitForFunction(
    count => document.querySelectorAll('.pm-pane-target .pm-row').length === count,
    targetCountBeforeDrag,
  );

  if ((await page.locator('.pm-pane-target .pm-row-select').count()) === 0) {
    await page.locator('.pm-pane-target [data-action="entry-multi-toggle"]').click();
  }
  const targetCountBeforeDelete = await targetRows.count();
  await targetRows.nth(0).locator('.pm-row-select').click();
  await targetRows.nth(1).locator('.pm-row-select').click();
  await page.locator('.pm-pane-target [data-action="entry-batch-delete"]').click();
  await page.waitForFunction(
    count => document.querySelectorAll('.pm-pane-target .pm-row').length === count - 2,
    targetCountBeforeDelete,
  );
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 批量删除不应在点击保存前调用保存接口`);
  }

  await page.getByRole('button', { name: '放弃修改' }).click();
  await page.waitForFunction(
    count => document.querySelectorAll('.pm-pane-target .pm-row').length === count,
    targetCountBeforeDelete,
  );
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
  await page.waitForFunction(name => document.querySelector('select[name="sourceName"]')?.value === name, copyName);
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
  await page.waitForFunction(name => document.querySelector('select[name="sourceName"]')?.value === name, renamedName);
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
    name =>
      ![...(document.querySelector('select[name="sourceName"]')?.options ?? [])].some(option => option.value === name),
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

  const sourceTitlesBefore = await page
    .locator('.pm-pane-source .pm-row-title')
    .evaluateAll(nodes => nodes.slice(0, 2).map(node => node.textContent?.trim()));
  await dragBetween(
    page,
    page.locator('.pm-pane-source .pm-row').first().locator('.pm-row-grip'),
    page.locator('.pm-pane-source .pm-row').nth(1),
    'after',
  );
  const sourceTitlesAfter = await page
    .locator('.pm-pane-source .pm-row-title')
    .evaluateAll(nodes => nodes.slice(0, 2).map(node => node.textContent?.trim()));
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
  await dragBetween(page, sourceRows.first().locator('.pm-row-grip'), page.locator('.pm-pane-target .pm-list'), 'end');
  await page.waitForFunction(() => document.querySelectorAll('.pm-pane-target .pm-row').length > 0);
  await dragBetween(page, sourceRows.nth(1).locator('.pm-row-grip'), page.locator('.pm-pane-target .pm-list'), 'end');
  await page.waitForFunction(() => document.querySelectorAll('.pm-pane-target .pm-row').length > 1);

  const titlesBefore = await page
    .locator('.pm-pane-target .pm-row-title')
    .evaluateAll(nodes => nodes.slice(0, 2).map(node => node.textContent?.trim()));
  await dragBetween(page, targetRows.first().locator('.pm-row-grip'), targetRows.nth(1), 'after');
  const titlesAfter = await page
    .locator('.pm-pane-target .pm-row-title')
    .evaluateAll(nodes => nodes.slice(0, 2).map(node => node.textContent?.trim()));
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
    return child?.__registeredEvents?.includes('helper-button:预设管理');
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
  if (
    frameMetrics.frameWidth !== 0 ||
    frameMetrics.frameHeight !== 0 ||
    frameMetrics.childWidth !== 0 ||
    frameMetrics.childHeight !== 0
  ) {
    throw new Error('zero-frame: 测试夹具没有形成 0x0 脚本 iframe');
  }

  await page.getByRole('button', { name: /^预设管理$/ }).click();
  await page
    .locator('body > #tt-preset-stitcher-host #tt-preset-stitcher-root .pm-panel')
    .waitFor({ state: 'visible' });

  const mountInfo = await page.evaluate(() => {
    const frame = document.getElementById('script-frame');
    const childDocument = frame.contentWindow.document;
    const panel = document.querySelector('#tt-preset-stitcher-root .pm-panel');
    return {
      inParent: Boolean(panel),
      inChild: Boolean(childDocument.querySelector('#tt-preset-stitcher-root')),
      panelBox: panel
        ? {
            width: Math.round(panel.getBoundingClientRect().width),
            height: Math.round(panel.getBoundingClientRect().height),
          }
        : null,
      debugLog: JSON.parse(frame.contentWindow.localStorage.getItem('preset-manager:debug:v1') ?? '[]'),
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
const executablePath =
  process.env.PRESET_MANAGER_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath });

try {
  await verifyZeroSizedIframeParentMount(browser, fixture);
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    await page.goto(fixture.url);
    await page.waitForFunction(() => window.__registeredEvents?.includes('helper-button:预设管理'));
    const buttonApiStats = await page.evaluate(() => ({
      updateCalls: window.__updateScriptButtonsWithCalls,
      replaceCalls: window.__replaceScriptButtonsCalls,
    }));
    if (buttonApiStats.updateCalls < 1 || buttonApiStats.replaceCalls !== 0) {
      throw new Error(`${viewport.name}: 脚本按钮没有通过 updateScriptButtonsWith 注册`);
    }
    await page.getByRole('button', { name: /^预设管理$/ }).click();
    await page.locator('.pm-panel').waitFor({ state: 'visible' });

    const bodyText = await page.locator('body').innerText();
    if (!bodyText.includes('预设管理') || bodyText.includes('????')) {
      throw new Error(`${viewport.name}: 中文 DOM 文本验证失败`);
    }
    if (!bodyText.includes('条目详情') || bodyText.includes('草稿') || bodyText.includes('结构正常')) {
      throw new Error(`${viewport.name}: 出现了应移除的旧文案`);
    }
    if (await page.locator('[data-action="refresh"]').count()) {
      throw new Error(`${viewport.name}: 顶部刷新按钮应该已删除`);
    }
    const versionText = await page.locator('.pm-version-chip').textContent();
    if (versionText?.trim() !== 'v2.22') {
      throw new Error(`${viewport.name}: 标题旁没有显示当前版本号`);
    }

    const panelBox = await page.locator('.pm-panel').boundingBox();
    if (!panelBox || panelBox.width > viewport.width + 1 || panelBox.height > viewport.height + 1) {
      throw new Error(`${viewport.name}: 面板超出视口`);
    }

    const saveButton = page.getByRole('button', { name: /保存预设/ });
    await saveButton.scrollIntoViewIfNeeded();
    const saveBox = await saveButton.boundingBox();
    if (
      !saveBox ||
      saveBox.x < 0 ||
      saveBox.y < 0 ||
      saveBox.x + saveBox.width > viewport.width + 1 ||
      saveBox.y + saveBox.height > viewport.height + 1
    ) {
      throw new Error(`${viewport.name}: 保存按钮不可达`);
    }
    const isTabbedLayout = viewport.width <= 900;
    const initialTargetName = await page.locator('select[name="targetName"]').inputValue();
    if (initialTargetName !== '夏瑾二改（自用）') {
      throw new Error(`${viewport.name}: 目标预设没有默认使用当前 TT 预设`);
    }
    if (viewport.name === 'desktop-wide') {
      await verifyTutorial(page, fixture, viewport.name);
      await page.locator('.pm-version-button').click();
      await page.locator('.pm-version-box').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.body.innerText.includes('v2.21'));
      if (await page.locator('.pm-version-row[data-version="v0.99"]').count()) {
        throw new Error(`${viewport.name}: 版本列表不应显示 v1.0.0 以前的版本`);
      }
      await page.locator('.pm-version-row[data-version="v1.19"]').click();
      const versionConfirmText = await page.locator('.pm-version-confirm').innerText();
      if (!versionConfirmText.includes('可回退') || !versionConfirmText.includes('回退')) {
        throw new Error(`${viewport.name}: 选择旧版本后没有显示回退语义`);
      }
      await page.getByTitle('关闭版本管理').click();
      await page.locator('.pm-version-box').waitFor({ state: 'detached' });
    }
    await page.locator('select[name="sourceName"]').selectOption('雪月agent_v1（自改）');
    const firstSourceActionCount = await page
      .locator('.pm-pane-source .pm-row')
      .first()
      .locator('.pm-row-action')
      .count();
    const firstTargetActionCount = await page
      .locator('.pm-pane-target .pm-row')
      .first()
      .locator('.pm-row-action')
      .count();
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
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 't',
          inputType: 'insertCompositionText',
          isComposing: true,
        }),
      );
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
      await verifyEntryToggleDraft(page, fixture, viewport.name);
      await verifyCompareMode(page, fixture, viewport.name);
      await verifyPresetActions(page, fixture, viewport.name);
      await verifySourceDeleteDraft(page, fixture, viewport.name);
      await verifyMultiSelectOperations(page, fixture, viewport.name);
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
        title =>
          [...document.querySelectorAll('.pm-pane-target .pm-row-title')].some(
            node => node.textContent?.trim() === title,
          ),
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
    const accentColor = await page
      .locator('.pm-pane-target .pm-row.is-selected')
      .evaluate(element => getComputedStyle(element).borderColor);
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
