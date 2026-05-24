import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tavernRoot = process.env.TAURITAVERN_ROOT ?? 'I:\\TauriTavern';
const sourceBundle = path.join(root, 'dist', 'preset-manager', 'index.js');
const targetDir = path.join(tavernRoot, 'data', 'default-user', 'extensions', 'preset-manager');
const targetBundle = path.join(targetDir, 'index.js');
const manifestPath = path.join(targetDir, 'manifest.json');

const manifest = {
  display_name: '预设缝合管理器',
  loading_order: 26,
  requires: [],
  optional: [],
  js: 'index.js',
  author: 'StageDog template + Codex',
  version: '0.1.0',
  description: '在 TauriTavern 中复制、收藏和重排 OpenAI 预设 PromptManager 条目。',
  homePage: 'https://github.com/StageDog/tavern_helper_template',
};

await mkdir(targetDir, { recursive: true });
await copyFile(sourceBundle, targetBundle);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  ok: true,
  targetDir,
  files: [
    targetBundle,
    manifestPath,
  ],
}, null, 2));
