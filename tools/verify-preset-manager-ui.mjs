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
    content: `用于目标草稿排序测试的正文 ${index + 1}`,
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
  <main>
    <p>中文测试：预设缝合管理器</p>
    <div id="script-buttons" aria-label="酒馆助手按钮区域"></div>
  </main>
  <script>
    window.__pmButtonHandlers = new Map();
    window.getButtonEvent = name => name;
    window.eventOn = (eventName, handler) => {
      window.__pmButtonHandlers.set(eventName, handler);
    };
    window.replaceScriptButtons = buttons => {
      const mount = document.getElementById('script-buttons');
      mount.textContent = '';
      for (const button of buttons) {
        if (!button.visible) {
          continue;
        }
        const element = document.createElement('button');
        element.type = 'button';
        element.setAttribute('aria-label', '酒馆助手按钮：' + button.name);
        element.textContent = button.name;
        element.addEventListener('click', () => window.__pmButtonHandlers.get(button.name)?.());
        mount.appendChild(element);
      }
    };
  </script>
  <script type="module" src="/dist/preset-manager/index.js"></script>
</body>
</html>`);
      return;
    }

    if (url.pathname === '/dist/preset-manager/index.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(await readFile(bundlePath, 'utf8'));
      return;
    }

    if (url.pathname === '/script.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end('export function getRequestHeaders(){return {"Content-Type":"application/json"}};');
      return;
    }

    if (url.pathname === '/scripts/openai.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(`export const openai_settings = ${JSON.stringify(fixturePresets.map(item => item.preset))};
export const openai_setting_names = ${JSON.stringify(Object.fromEntries(fixturePresets.map((item, index) => [item.name, index])))};
export const oai_settings = { preset_settings_openai: "夏瑾二改（自用）" };`);
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
        resolve({ server, url: `http://127.0.0.1:${address.port}`, getSavedPreset: () => savedPreset });
      }
    });
  });
}

async function openManagerFromHelperButton(page) {
  await page.getByRole('button', { name: /酒馆助手按钮：预设缝合/ }).click();
  await page.locator('.pm-panel').waitFor({ state: 'visible' });
  const launcherCount = await page.locator('.pm-launcher').count();
  if (launcherCount !== 0) {
    throw new Error('不应创建右下角浮动入口');
  }
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
    throw new Error(`${viewportName}: 目标草稿直接拖拽排序未生效`);
  }

  page.once('dialog', dialog => {
    if (!dialog.message().includes('未保存草稿')) {
      throw new Error(`${viewportName}: 关闭未保存草稿时没有明确提示`);
    }
    void dialog.accept();
  });
  await page.getByTitle('关闭').click();
  await openManagerFromHelperButton(page);

  const reopenedTitles = await targetTitles.evaluateAll(nodes => nodes.slice(0, 3).map(node => node.textContent?.trim()));
  if (reopenedTitles[0] !== originalTitles[0] || reopenedTitles[1] !== originalTitles[1]) {
    throw new Error(`${viewportName}: 未保存排序在关闭后仍残留到草稿`);
  }
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 未点击保存却调用了保存接口`);
  }

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
    throw new Error(`${viewportName}: 来源条目无法直接拖入目标草稿`);
  }
  if (fixture.getSavedPreset() !== null) {
    throw new Error(`${viewportName}: 拖拽草稿操作不应触发保存接口`);
  }
}

const { chromium } = await importPlaywright();
const fixture = await serveFixture();
const executablePath = process.env.PRESET_MANAGER_CHROME
  ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath });

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    await page.goto(fixture.url);
    await openManagerFromHelperButton(page);

    const bodyText = await page.locator('body').innerText();
    if (!bodyText.includes('预设缝合管理器') || bodyText.includes('????')) {
      throw new Error(`${viewport.name}: 中文 DOM 文本验证失败`);
    }

    const panelBox = await page.locator('.pm-panel').boundingBox();
    if (!panelBox || panelBox.width > viewport.width + 1 || panelBox.height > viewport.height + 1) {
      throw new Error(`${viewport.name}: 面板超出视口`);
    }

    const saveButton = page.getByRole('button', { name: /保存目标预设/ });
    await saveButton.scrollIntoViewIfNeeded();
    const saveBox = await saveButton.boundingBox();
    if (!saveBox || saveBox.x < 0 || saveBox.y < 0 || saveBox.x + saveBox.width > viewport.width + 1 || saveBox.y + saveBox.height > viewport.height + 1) {
      throw new Error(`${viewport.name}: 保存按钮不可达`);
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
      await verifySelectionKeepsScroll(page, viewport.name);
      await verifyDirectDragAndUnsavedClose(page, fixture, viewport.name);
      await page.locator('input[name="sourceQuery"]').fill('');
    }

    if (viewport.width < 768) {
      await page.getByRole('button', { name: '来源', exact: true }).click();
      await page.getByTitle('复制到目标').first().click();
      await page.getByRole('button', { name: '目标', exact: true }).click();
    } else {
      await page.getByTitle('复制到目标').first().click();
    }

    await page.getByText('📔小说').last().waitFor();
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
