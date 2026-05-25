import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const presetDir = process.env.PRESET_MANAGER_FIXTURE_DIR
  ?? 'I:\\TauriTavern\\data\\default-user\\OpenAI Settings';

const GLOBAL_PROMPT_ORDER_ID = 100001;

function clone(value) {
  return structuredClone(value);
}

function getPrimaryOrder(preset) {
  if (!Array.isArray(preset.prompt_order)) {
    preset.prompt_order = [];
  }
  let promptOrder = preset.prompt_order.find(item => String(item.character_id) === String(GLOBAL_PROMPT_ORDER_ID))
    ?? preset.prompt_order.find(item => Array.isArray(item.order));
  if (!promptOrder) {
    promptOrder = { character_id: GLOBAL_PROMPT_ORDER_ID, order: [] };
    preset.prompt_order.push(promptOrder);
  }
  if (!Array.isArray(promptOrder.order)) {
    promptOrder.order = [];
  }
  return promptOrder;
}

function listEntries(preset) {
  const prompts = Array.isArray(preset.prompts) ? preset.prompts : [];
  const order = getPrimaryOrder(preset).order;
  const promptById = new Map(prompts.filter(prompt => prompt.identifier).map(prompt => [prompt.identifier, prompt]));
  const seen = new Set();
  const ordered = [];

  for (const orderEntry of order) {
    const prompt = promptById.get(orderEntry.identifier);
    if (!prompt) {
      continue;
    }
    seen.add(orderEntry.identifier);
    ordered.push({ prompt, enabled: orderEntry.enabled !== false });
  }

  for (const prompt of prompts) {
    if (prompt.identifier && !seen.has(prompt.identifier)) {
      ordered.push({ prompt, enabled: true });
    }
  }

  return ordered;
}

function validatePreset(preset) {
  const prompts = Array.isArray(preset.prompts) ? preset.prompts : [];
  const order = getPrimaryOrder(preset).order;
  const ids = prompts.map(prompt => prompt.identifier).filter(Boolean);
  const idSet = new Set(ids);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const missing = order.map(entry => entry.identifier).filter(identifier => !idSet.has(identifier));
  return {
    ok: duplicates.length === 0 && missing.length === 0 && ids.length === prompts.length,
    duplicates: [...new Set(duplicates)],
    missing: [...new Set(missing)],
    noId: prompts.length - ids.length,
  };
}

function makeId(existing) {
  let id = crypto.randomUUID();
  while (existing.has(id)) {
    id = crypto.randomUUID();
  }
  return id;
}

function insertEntry(target, sourceEntry) {
  const prompts = Array.isArray(target.prompts) ? target.prompts : (target.prompts = []);
  const existing = new Set(prompts.map(prompt => prompt.identifier).filter(Boolean));
  const prompt = clone(sourceEntry.prompt);
  if (!prompt.identifier || existing.has(prompt.identifier)) {
    prompt.identifier = makeId(existing);
  }
  prompts.push(prompt);
  getPrimaryOrder(target).order.push({ identifier: prompt.identifier, enabled: sourceEntry.enabled !== false });
  return prompt;
}

async function readPresets() {
  const files = (await readdir(presetDir)).filter(file => file.endsWith('.json'));
  const presets = [];
  for (const file of files) {
    const fullPath = path.join(presetDir, file);
    const raw = await readFile(fullPath, 'utf8');
    presets.push({ file, data: JSON.parse(raw) });
  }
  return presets;
}

function findEntry(presets, pattern) {
  for (const preset of presets) {
    const entry = listEntries(preset.data).find(item => pattern.test(String(item.prompt.name ?? '')));
    if (entry) {
      return { preset, entry };
    }
  }
  return null;
}

const presets = await readPresets();
if (!presets.length) {
  throw new Error(`没有找到预设 JSON：${presetDir}`);
}

const existingProblems = presets
  .map(preset => ({ file: preset.file, validation: validatePreset(clone(preset.data)) }))
  .filter(item => !item.validation.ok);

if (existingProblems.length) {
  throw new Error(`真实预设已有结构问题：${JSON.stringify(existingProblems, null, 2)}`);
}

const sourceNovel = findEntry(presets, /小说/);
const sourceLightNovel = findEntry(presets, /轻小说/);
const target = presets.find(preset => listEntries(preset.data).some(item => /夏瑾的文风/.test(String(item.prompt.name ?? ''))))
  ?? presets[presets.length - 1];

if (!sourceNovel || !sourceLightNovel || !target) {
  throw new Error('缺少用于预设管理验证的 小说 / 轻小说 / 夏瑾目标预设条目');
}

const draft = clone(target.data);
const beforeCount = listEntries(draft).length;
const insertedNovel = insertEntry(draft, sourceNovel.entry);
const insertedLightNovel = insertEntry(draft, sourceLightNovel.entry);
const afterEntries = listEntries(draft);
const validation = validatePreset(draft);

if (!validation.ok) {
  throw new Error(`预设管理后结构无效：${JSON.stringify(validation, null, 2)}`);
}

if (afterEntries.length !== beforeCount + 2) {
  throw new Error(`条目数量不符合预期：${beforeCount} -> ${afterEntries.length}`);
}

if (String(insertedNovel.content ?? '') !== String(sourceNovel.entry.prompt.content ?? '')) {
  throw new Error('小说条目正文没有原样保留');
}

if (String(insertedLightNovel.content ?? '') !== String(sourceLightNovel.entry.prompt.content ?? '')) {
  throw new Error('轻小说条目正文没有原样保留');
}

console.log(JSON.stringify({
  ok: true,
  presetCount: presets.length,
  sourceNovel: sourceNovel.preset.file,
  sourceLightNovel: sourceLightNovel.preset.file,
  target: target.file,
  beforeCount,
  afterCount: afterEntries.length,
}, null, 2));
