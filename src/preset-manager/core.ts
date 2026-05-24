export const GLOBAL_PROMPT_ORDER_ID = 100001;

export interface Prompt {
  id?: string;
  identifier?: string;
  name?: string;
  content?: string;
  role?: string;
  enabled?: boolean;
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

const PROMPT_FIELDS = [
  'id',
  'identifier',
  'name',
  'content',
  'role',
  'enabled',
  'system_prompt',
  'marker',
  'position',
  'extra',
  'forbid_overrides',
  'injection_position',
  'injection_depth',
  'injection_order',
  'injection_trigger',
  'attach_role',
  'attach_index',
  'attach_side',
] as const;
const PROMPT_ORDER_FIELDS = ['character_id', 'order'] as const;
const PROMPT_ORDER_ENTRY_FIELDS = ['identifier', 'enabled'] as const;

export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function materializePreset(preset: Preset): Preset {
  const materialized = materializeRecord(preset) as Preset;
  materialized.prompts = Array.isArray(preset.prompts)
    ? preset.prompts.map(prompt => materializePrompt(prompt))
    : [];
  materialized.prompt_order = Array.isArray(preset.prompt_order)
    ? preset.prompt_order.map(promptOrder => materializePromptOrder(promptOrder))
    : [];
  return materialized;
}

function materializePrompt(prompt: Prompt): Prompt {
  return materializeRecord(prompt, PROMPT_FIELDS) as Prompt;
}

function materializePromptOrder(promptOrder: PromptOrder): PromptOrder {
  const materialized = materializeRecord(promptOrder, PROMPT_ORDER_FIELDS) as PromptOrder;
  materialized.order = Array.isArray(promptOrder.order)
    ? promptOrder.order.map(entry => materializeRecord(entry, PROMPT_ORDER_ENTRY_FIELDS) as PromptOrderEntry)
    : [];
  return materialized;
}

function materializeRecord(
  value: Record<string, unknown> | null | undefined,
  knownFields: readonly string[] = [],
): Record<string, unknown> {
  const materialized: Record<string, unknown> = {};
  if (!value || typeof value !== 'object') {
    return materialized;
  }

  for (const [key, entryValue] of Object.entries(value)) {
    materialized[key] = entryValue;
  }

  for (const field of knownFields) {
    const entryValue = readRuntimeProperty(value, field);
    if (entryValue !== undefined) {
      materialized[field] = entryValue;
    }
  }

  return materialized;
}

function readRuntimeProperty(value: Record<string, unknown>, field: string): unknown {
  try {
    return value[field];
  } catch {
    return undefined;
  }
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

export function getPromptIdentifier(prompt: Prompt | undefined): string {
  if (typeof prompt?.identifier === 'string' && prompt.identifier) {
    return prompt.identifier;
  }
  if (typeof prompt?.id === 'string' && prompt.id) {
    return prompt.id;
  }
  return '';
}

export function ensurePresetShape(preset: Preset): Preset {
  if (!Array.isArray(preset.prompts)) {
    preset.prompts = [];
  }
  if (isRuntimePresetShape(preset)) {
    return preset;
  }
  if (!Array.isArray(preset.prompt_order)) {
    preset.prompt_order = [];
  }
  getPrimaryPromptOrder(preset, true);
  return preset;
}

function isRuntimePresetShape(preset: Preset): boolean {
  return Array.isArray(preset.prompts)
    && (
      !Array.isArray(preset.prompt_order)
      || preset.prompts.some(prompt => typeof prompt.id === 'string' && prompt.id)
    );
}

function assignPromptIdentifier(prompt: Prompt, identifier: string, runtimeShape: boolean): void {
  if (runtimeShape || typeof prompt.id === 'string') {
    prompt.id = identifier;
    return;
  }
  prompt.identifier = identifier;
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
  if (isRuntimePresetShape(shaped)) {
    return prompts.map((prompt, index) => toPromptEntry(prompt, undefined, index, true));
  }

  const order = getPrimaryPromptOrder(shaped, true)?.order ?? [];
  const promptById = new Map<string, Prompt>();

  for (const prompt of prompts) {
    const identifier = getPromptIdentifier(prompt);
    if (identifier) {
      promptById.set(identifier, prompt);
    }
  }

  const canRecoverIdsByOrder = prompts.length > 0
    && promptById.size === 0
    && order.length > 0;

  const entries: PromptEntry[] = [];
  const seen = new Set<string>();

  order.forEach((orderEntry, index) => {
    let prompt = promptById.get(orderEntry.identifier);
    if (!prompt && canRecoverIdsByOrder) {
      prompt = prompts[index];
      if (prompt && typeof orderEntry.identifier === 'string' && orderEntry.identifier) {
        assignPromptIdentifier(prompt, orderEntry.identifier, false);
      }
    }
    if (!prompt) {
      return;
    }
    seen.add(orderEntry.identifier);
    entries.push(toPromptEntry(prompt, orderEntry, index));
  });

  prompts.forEach(prompt => {
    const identifier = getPromptIdentifier(prompt);
    if (!identifier || seen.has(identifier)) {
      return;
    }
    entries.push(toPromptEntry(prompt, undefined, entries.length, false));
  });

  return entries;
}

export function toPromptEntry(
  prompt: Prompt,
  order: PromptOrderEntry | undefined,
  orderIndex: number,
  runtimeShape = false,
): PromptEntry {
  const id = getPromptIdentifier(prompt) || createId();
  if (!getPromptIdentifier(prompt)) {
    assignPromptIdentifier(prompt, id, runtimeShape);
  }
  return {
    id,
    name: getPromptName(prompt),
    content: getPromptContent(prompt),
    role: getPromptRole(prompt),
    enabled: order?.enabled ?? prompt.enabled ?? true,
    orderIndex,
    prompt,
    order,
  };
}

export function insertPromptFromEntry(targetPreset: Preset, entry: PromptEntry | FavoriteEntry, insertIndex?: number): string {
  const shaped = ensurePresetShape(targetPreset);
  const runtimeShape = isRuntimePresetShape(shaped);
  const prompt = deepClone(entry.prompt);
  const identifier = getUniqueIdentifier(shaped, getPromptIdentifier(prompt));
  assignPromptIdentifier(prompt, identifier, runtimeShape);
  const enabled = 'enabled' in entry ? entry.enabled !== false : true;
  if (runtimeShape) {
    prompt.enabled = enabled;
  }
  shaped.prompts?.push(prompt);

  if (runtimeShape) {
    const prompts = shaped.prompts ?? [];
    const currentIndex = prompts.length - 1;
    const index = normalizeInsertIndex(insertIndex, currentIndex);
    if (index !== currentIndex) {
      const [inserted] = prompts.splice(currentIndex, 1);
      prompts.splice(index, 0, inserted);
    }
    return identifier;
  }

  const order = getPrimaryPromptOrder(shaped, true)?.order ?? [];
  const orderEntry: PromptOrderEntry = { identifier, enabled };
  const index = normalizeInsertIndex(insertIndex, order.length);
  order.splice(index, 0, orderEntry);
  return identifier;
}

export function removePrompt(targetPreset: Preset, identifier: string): void {
  const shaped = ensurePresetShape(targetPreset);
  shaped.prompts = (shaped.prompts ?? []).filter(prompt => getPromptIdentifier(prompt) !== identifier);
  if (isRuntimePresetShape(shaped)) {
    return;
  }

  const order = getPrimaryPromptOrder(shaped, true)?.order ?? [];
  const index = order.findIndex(entry => entry.identifier === identifier);
  if (index >= 0) {
    order.splice(index, 1);
  }
}

export function movePrompt(targetPreset: Preset, identifier: string, direction: -1 | 1): void {
  const shaped = ensurePresetShape(targetPreset);
  if (isRuntimePresetShape(shaped)) {
    const prompts = shaped.prompts ?? [];
    const currentIndex = prompts.findIndex(prompt => getPromptIdentifier(prompt) === identifier);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= prompts.length) {
      return;
    }
    const [prompt] = prompts.splice(currentIndex, 1);
    prompts.splice(nextIndex, 0, prompt);
    return;
  }

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
  const shaped = ensurePresetShape(targetPreset);
  if (isRuntimePresetShape(shaped)) {
    const prompts = shaped.prompts ?? [];
    const currentIndex = prompts.findIndex(prompt => getPromptIdentifier(prompt) === identifier);
    if (currentIndex < 0) {
      return;
    }
    const [prompt] = prompts.splice(currentIndex, 1);
    prompts.splice(normalizeInsertIndex(nextIndex, prompts.length), 0, prompt);
    return;
  }

  const order = getPrimaryPromptOrder(ensurePresetShape(targetPreset), true)?.order ?? [];
  const currentIndex = order.findIndex(entry => entry.identifier === identifier);
  if (currentIndex < 0) {
    return;
  }
  const [entry] = order.splice(currentIndex, 1);
  order.splice(normalizeInsertIndex(nextIndex, order.length), 0, entry);
}

export function setPromptEnabled(targetPreset: Preset, identifier: string, enabled: boolean): void {
  const shaped = ensurePresetShape(targetPreset);
  if (isRuntimePresetShape(shaped)) {
    const prompt = (shaped.prompts ?? []).find(item => getPromptIdentifier(item) === identifier);
    if (prompt) {
      prompt.enabled = enabled;
    }
    return;
  }

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
  const order = isRuntimePresetShape(preset) ? [] : getPrimaryPromptOrder(preset, false)?.order ?? [];
  const ids = prompts.map(prompt => getPromptIdentifier(prompt)).filter((id): id is string => typeof id === 'string' && id.length > 0);
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
  const used = new Set(prompts.map(prompt => getPromptIdentifier(prompt)).filter((id): id is string => typeof id === 'string' && id.length > 0));
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
