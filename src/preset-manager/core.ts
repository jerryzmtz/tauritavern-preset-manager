export const GLOBAL_PROMPT_ORDER_ID = 100001;

export interface Prompt {
  identifier?: string;
  name?: string;
  content?: string;
  role?: string;
  system_prompt?: boolean;
  marker?: boolean;
  [key: string]: unknown;
}

export interface PromptOrderEntry {
  identifier: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface PromptOrder {
  character_id?: number | string;
  order?: PromptOrderEntry[];
  [key: string]: unknown;
}

export interface Preset {
  prompts?: Prompt[];
  prompt_order?: PromptOrder[];
  [key: string]: unknown;
}

export interface PromptEntry {
  id: string;
  name: string;
  content: string;
  role: string;
  enabled: boolean;
  orderIndex: number;
  prompt: Prompt;
  order?: PromptOrderEntry;
}

export interface FavoriteEntry {
  id: string;
  name: string;
  sourcePreset: string;
  createdAt: string;
  enabled: boolean;
  prompt: Prompt;
}

export interface PresetValidation {
  ok: boolean;
  duplicateIdentifiers: string[];
  missingOrderReferences: string[];
  promptsWithoutIdentifiers: number;
}

export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function getPromptName(prompt: Prompt | undefined): string {
  const name = prompt?.name;
  return typeof name === 'string' && name.trim() ? name : '未命名条目';
}

export function getPromptContent(prompt: Prompt | undefined): string {
  const content = prompt?.content;
  return typeof content === 'string' ? content : '';
}

export function getPromptRole(prompt: Prompt | undefined): string {
  const role = prompt?.role;
  return typeof role === 'string' && role.trim() ? role : 'system';
}

export function ensurePresetShape(preset: Preset): Preset {
  if (!Array.isArray(preset.prompts)) {
    preset.prompts = [];
  }
  if (!Array.isArray(preset.prompt_order)) {
    preset.prompt_order = [];
  }
  getPrimaryPromptOrder(preset, true);
  return preset;
}

export function getPrimaryPromptOrder(preset: Preset, create = false): PromptOrder | undefined {
  if (!Array.isArray(preset.prompt_order)) {
    if (!create) {
      return undefined;
    }
    preset.prompt_order = [];
  }

  const promptOrder = preset.prompt_order.find(item => String(item.character_id) === String(GLOBAL_PROMPT_ORDER_ID))
    ?? preset.prompt_order.find(item => Array.isArray(item.order));

  if (promptOrder) {
    if (!Array.isArray(promptOrder.order)) {
      promptOrder.order = [];
    }
    return promptOrder;
  }

  if (!create) {
    return undefined;
  }

  const created: PromptOrder = { character_id: GLOBAL_PROMPT_ORDER_ID, order: [] };
  preset.prompt_order.push(created);
  return created;
}

export function listPromptEntries(preset: Preset): PromptEntry[] {
  const shaped = ensurePresetShape(preset);
  const prompts = shaped.prompts ?? [];
  const order = getPrimaryPromptOrder(shaped, true)?.order ?? [];
  const promptById = new Map<string, Prompt>();

  for (const prompt of prompts) {
    if (typeof prompt.identifier === 'string' && prompt.identifier) {
      promptById.set(prompt.identifier, prompt);
    }
  }

  const entries: PromptEntry[] = [];
  const seen = new Set<string>();

  order.forEach((orderEntry, index) => {
    const prompt = promptById.get(orderEntry.identifier);
    if (!prompt) {
      return;
    }
    seen.add(orderEntry.identifier);
    entries.push(toPromptEntry(prompt, orderEntry, index));
  });

  prompts.forEach(prompt => {
    if (typeof prompt.identifier !== 'string' || !prompt.identifier || seen.has(prompt.identifier)) {
      return;
    }
    entries.push(toPromptEntry(prompt, undefined, entries.length));
  });

  return entries;
}

export function toPromptEntry(prompt: Prompt, order: PromptOrderEntry | undefined, orderIndex: number): PromptEntry {
  const id = typeof prompt.identifier === 'string' && prompt.identifier ? prompt.identifier : createId();
  if (!prompt.identifier) {
    prompt.identifier = id;
  }
  return {
    id,
    name: getPromptName(prompt),
    content: getPromptContent(prompt),
    role: getPromptRole(prompt),
    enabled: order?.enabled !== false,
    orderIndex,
    prompt,
    order,
  };
}

export function insertPromptFromEntry(targetPreset: Preset, entry: PromptEntry | FavoriteEntry, insertIndex?: number): string {
  const shaped = ensurePresetShape(targetPreset);
  const prompt = deepClone(entry.prompt);
  const identifier = getUniqueIdentifier(shaped, prompt.identifier);
  prompt.identifier = identifier;
  shaped.prompts?.push(prompt);

  const order = getPrimaryPromptOrder(shaped, true)?.order ?? [];
  const enabled = 'enabled' in entry ? entry.enabled !== false : true;
  const orderEntry: PromptOrderEntry = { identifier, enabled };
  const index = normalizeInsertIndex(insertIndex, order.length);
  order.splice(index, 0, orderEntry);
  return identifier;
}

export function removePrompt(targetPreset: Preset, identifier: string): void {
  const shaped = ensurePresetShape(targetPreset);
  shaped.prompts = (shaped.prompts ?? []).filter(prompt => prompt.identifier !== identifier);
  const order = getPrimaryPromptOrder(shaped, true)?.order ?? [];
  const index = order.findIndex(entry => entry.identifier === identifier);
  if (index >= 0) {
    order.splice(index, 1);
  }
}

export function movePrompt(targetPreset: Preset, identifier: string, direction: -1 | 1): void {
  const order = getPrimaryPromptOrder(ensurePresetShape(targetPreset), true)?.order ?? [];
  const currentIndex = order.findIndex(entry => entry.identifier === identifier);
  const nextIndex = currentIndex + direction;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= order.length) {
    return;
  }
  const [entry] = order.splice(currentIndex, 1);
  order.splice(nextIndex, 0, entry);
}

export function movePromptToIndex(targetPreset: Preset, identifier: string, nextIndex: number): void {
  const order = getPrimaryPromptOrder(ensurePresetShape(targetPreset), true)?.order ?? [];
  const currentIndex = order.findIndex(entry => entry.identifier === identifier);
  if (currentIndex < 0) {
    return;
  }
  const [entry] = order.splice(currentIndex, 1);
  order.splice(normalizeInsertIndex(nextIndex, order.length), 0, entry);
}

export function setPromptEnabled(targetPreset: Preset, identifier: string, enabled: boolean): void {
  const order = getPrimaryPromptOrder(ensurePresetShape(targetPreset), true)?.order ?? [];
  let entry = order.find(item => item.identifier === identifier);
  if (!entry) {
    entry = { identifier, enabled };
    order.push(entry);
  }
  entry.enabled = enabled;
}

export function validatePreset(preset: Preset): PresetValidation {
  const prompts = Array.isArray(preset.prompts) ? preset.prompts : [];
  const order = getPrimaryPromptOrder(preset, false)?.order ?? [];
  const ids = prompts.map(prompt => prompt.identifier).filter((id): id is string => typeof id === 'string' && id.length > 0);
  const idSet = new Set(ids);
  const duplicateIdentifiers = ids.filter((id, index) => ids.indexOf(id) !== index);
  const missingOrderReferences = order
    .map(entry => entry.identifier)
    .filter(identifier => !idSet.has(identifier));
  const promptsWithoutIdentifiers = prompts.length - ids.length;

  return {
    ok: duplicateIdentifiers.length === 0 && missingOrderReferences.length === 0 && promptsWithoutIdentifiers === 0,
    duplicateIdentifiers: [...new Set(duplicateIdentifiers)],
    missingOrderReferences: [...new Set(missingOrderReferences)],
    promptsWithoutIdentifiers,
  };
}

export function createFavoriteFromEntry(entry: PromptEntry, sourcePreset: string): FavoriteEntry {
  return {
    id: createId(),
    name: entry.name,
    sourcePreset,
    createdAt: new Date().toISOString(),
    enabled: entry.enabled,
    prompt: deepClone(entry.prompt),
  };
}

export function getContentLength(prompt: Prompt): number {
  return getPromptContent(prompt).length;
}

function getUniqueIdentifier(preset: Preset, preferred: string | undefined): string {
  const prompts = Array.isArray(preset.prompts) ? preset.prompts : [];
  const used = new Set(prompts.map(prompt => prompt.identifier).filter((id): id is string => typeof id === 'string'));
  if (preferred && !used.has(preferred)) {
    return preferred;
  }

  let id = createId();
  while (used.has(id)) {
    id = createId();
  }
  return id;
}

function normalizeInsertIndex(index: number | undefined, length: number): number {
  if (typeof index !== 'number' || Number.isNaN(index)) {
    return length;
  }
  return Math.max(0, Math.min(index, length));
}
