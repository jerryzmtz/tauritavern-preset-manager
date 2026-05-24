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

const { chromium } = await importPlaywright();
const fixture = await serveFixture();
const executablePath = process.env.PRESET_MANAGER_CHROME
  ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath });

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    await page.goto(fixture.url);
    await page.getByRole('button', { name: /打开预设缝合管理器/ }).click();
    await page.locator('.pm-panel').waitFor({ state: 'visible' });

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

    if (viewport.width < 768) {
      await page.getByRole('button', { name: '来源', exact: true }).click();
      await page.getByTitle('复制到目标').first().click();
      await page.getByRole('button', { name: '目标', exact: true }).click();
    } else {
      await page.getByTitle('复制到目标').first().click();
    }

    await page.getByText('📔小说').last().waitFor();
    const accentColor = await page.locator('.pm-row.is-selected').evaluate(element => getComputedStyle(element).borderColor);
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
