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

export type PromptCompareSide = 'source' | 'target';
export type PromptCompareMatchKind = 'identifier' | 'name';
export type PromptCompareStatus = 'matched' | 'source_only' | 'target_only';
export type PromptCompareChangedField = 'content' | 'name' | 'role' | 'enabled';
export type PromptContentDiffKind = 'same' | 'source' | 'target' | 'changed-source' | 'changed-target';

export interface PromptContentDiffLine {
  kind: PromptContentDiffKind;
  sourceLine?: string;
  targetLine?: string;
}

export interface PromptComparePair {
  key: string;
  status: PromptCompareStatus;
  matchKind?: PromptCompareMatchKind;
  sourceEntry?: PromptEntry;
  targetEntry?: PromptEntry;
  changedFields: PromptCompareChangedField[];
  contentDiff: PromptContentDiffLine[];
}

export interface PromptCompareResult {
  pairs: PromptComparePair[];
  sourceById: Map<string, PromptComparePair>;
  targetById: Map<string, PromptComparePair>;
  summary: {
    same: number;
    contentChanged: number;
    sourceOnly: number;
    targetOnly: number;
    metadataChanged: number;
  };
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

export function movePromptsToIndex(targetPreset: Preset, identifiers: string[], nextIndex: number): void {
  const shaped = ensurePresetShape(targetPreset);
  const movingIds = new Set(dedupeIdentifiers(identifiers));
  if (!movingIds.size) {
    return;
  }

  if (isRuntimePresetShape(shaped)) {
    const prompts = shaped.prompts ?? [];
    const normalizedIndex = normalizeInsertIndex(nextIndex, prompts.length);
    const moving = prompts.filter(prompt => movingIds.has(getPromptIdentifier(prompt)));
    if (!moving.length) {
      return;
    }
    const selectedBeforeDrop = prompts.slice(0, normalizedIndex)
      .filter(prompt => movingIds.has(getPromptIdentifier(prompt))).length;
    const remaining = prompts.filter(prompt => !movingIds.has(getPromptIdentifier(prompt)));
    const insertIndex = normalizeInsertIndex(normalizedIndex - selectedBeforeDrop, remaining.length);
    shaped.prompts = [
      ...remaining.slice(0, insertIndex),
      ...moving,
      ...remaining.slice(insertIndex),
    ];
    return;
  }

  const order = getPrimaryPromptOrder(shaped, true)?.order ?? [];
  const normalizedIndex = normalizeInsertIndex(nextIndex, order.length);
  const moving = order.filter(entry => movingIds.has(entry.identifier));
  if (!moving.length) {
    return;
  }
  const selectedBeforeDrop = order.slice(0, normalizedIndex).filter(entry => movingIds.has(entry.identifier)).length;
  const remaining = order.filter(entry => !movingIds.has(entry.identifier));
  const insertIndex = normalizeInsertIndex(normalizedIndex - selectedBeforeDrop, remaining.length);
  order.splice(0, order.length, ...remaining.slice(0, insertIndex), ...moving, ...remaining.slice(insertIndex));
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

export function setPromptContent(targetPreset: Preset, identifier: string, content: string): void {
  const prompt = findPrompt(targetPreset, identifier);
  if (prompt) {
    prompt.content = content;
  }
}

export function setPromptRole(targetPreset: Preset, identifier: string, role: string): void {
  const prompt = findPrompt(targetPreset, identifier);
  if (prompt) {
    prompt.role = role || 'system';
  }
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

export function comparePromptEntries(sourceEntries: PromptEntry[], targetEntries: PromptEntry[]): PromptCompareResult {
  const pairs: PromptComparePair[] = [];
  const sourceById = new Map<string, PromptComparePair>();
  const targetById = new Map<string, PromptComparePair>();
  const matchedSourceIds = new Set<string>();
  const matchedTargetIds = new Set<string>();
  const sourceByIdentifier = groupEntries(sourceEntries, entry => entry.id);
  const targetByIdentifier = groupEntries(targetEntries, entry => entry.id);

  for (const [identifier, sources] of sourceByIdentifier) {
    const targets = targetByIdentifier.get(identifier);
    if (sources.length !== 1 || targets?.length !== 1) {
      continue;
    }
    addMatchedPair(pairs, sourceById, targetById, sources[0], targets[0], 'identifier');
    matchedSourceIds.add(sources[0].id);
    matchedTargetIds.add(targets[0].id);
  }

  const unmatchedSources = sourceEntries.filter(entry => !matchedSourceIds.has(entry.id));
  const unmatchedTargets = targetEntries.filter(entry => !matchedTargetIds.has(entry.id));
  const sourceByName = groupEntries(unmatchedSources, entry => normalizeCompareName(entry.name));
  const targetByName = groupEntries(unmatchedTargets, entry => normalizeCompareName(entry.name));

  for (const [name, sources] of sourceByName) {
    const targets = targetByName.get(name);
    if (!name || sources.length !== 1 || targets?.length !== 1) {
      continue;
    }
    addMatchedPair(pairs, sourceById, targetById, sources[0], targets[0], 'name');
    matchedSourceIds.add(sources[0].id);
    matchedTargetIds.add(targets[0].id);
  }

  for (const entry of sourceEntries) {
    if (matchedSourceIds.has(entry.id)) {
      continue;
    }
    const pair = createOnlyPair('source', entry);
    pairs.push(pair);
    sourceById.set(entry.id, pair);
  }

  for (const entry of targetEntries) {
    if (matchedTargetIds.has(entry.id)) {
      continue;
    }
    const pair = createOnlyPair('target', entry);
    pairs.push(pair);
    targetById.set(entry.id, pair);
  }

  return {
    pairs,
    sourceById,
    targetById,
    summary: summarizeComparePairs(pairs),
  };
}

export function diffPromptContent(sourceContent: string, targetContent: string): PromptContentDiffLine[] {
  const sourceLines = normalizeCompareContent(sourceContent).split('\n');
  const targetLines = normalizeCompareContent(targetContent).split('\n');
  const maxLength = Math.max(sourceLines.length, targetLines.length);
  const diff: PromptContentDiffLine[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const hasSource = index < sourceLines.length;
    const hasTarget = index < targetLines.length;
    const sourceLine = sourceLines[index] ?? '';
    const targetLine = targetLines[index] ?? '';
    if (hasSource && hasTarget && sourceLine === targetLine) {
      diff.push({ kind: 'same', sourceLine, targetLine });
    } else if (hasSource && hasTarget) {
      diff.push({ kind: 'changed-source', sourceLine, targetLine });
      diff.push({ kind: 'changed-target', sourceLine, targetLine });
    } else if (hasSource) {
      diff.push({ kind: 'source', sourceLine });
    } else if (hasTarget) {
      diff.push({ kind: 'target', targetLine });
    }
  }

  return diff;
}

function findPrompt(targetPreset: Preset, identifier: string): Prompt | undefined {
  const shaped = ensurePresetShape(targetPreset);
  return (shaped.prompts ?? []).find(prompt => getPromptIdentifier(prompt) === identifier);
}

function addMatchedPair(
  pairs: PromptComparePair[],
  sourceById: Map<string, PromptComparePair>,
  targetById: Map<string, PromptComparePair>,
  sourceEntry: PromptEntry,
  targetEntry: PromptEntry,
  matchKind: PromptCompareMatchKind,
): void {
  const changedFields = getChangedFields(sourceEntry, targetEntry);
  const pair: PromptComparePair = {
    key: `${sourceEntry.id}::${targetEntry.id}`,
    status: 'matched',
    matchKind,
    sourceEntry,
    targetEntry,
    changedFields,
    contentDiff: changedFields.includes('content') ? diffPromptContent(sourceEntry.content, targetEntry.content) : [],
  };
  pairs.push(pair);
  sourceById.set(sourceEntry.id, pair);
  targetById.set(targetEntry.id, pair);
}

function createOnlyPair(side: PromptCompareSide, entry: PromptEntry): PromptComparePair {
  return {
    key: `${side}:${entry.id}`,
    status: side === 'source' ? 'source_only' : 'target_only',
    sourceEntry: side === 'source' ? entry : undefined,
    targetEntry: side === 'target' ? entry : undefined,
    changedFields: ['content'],
    contentDiff: [],
  };
}

function getChangedFields(sourceEntry: PromptEntry, targetEntry: PromptEntry): PromptCompareChangedField[] {
  const changedFields: PromptCompareChangedField[] = [];
  if (normalizeCompareContent(sourceEntry.content) !== normalizeCompareContent(targetEntry.content)) {
    changedFields.push('content');
  }
  if (sourceEntry.name !== targetEntry.name) {
    changedFields.push('name');
  }
  if (sourceEntry.role !== targetEntry.role) {
    changedFields.push('role');
  }
  if (sourceEntry.enabled !== targetEntry.enabled) {
    changedFields.push('enabled');
  }
  return changedFields;
}

function summarizeComparePairs(pairs: PromptComparePair[]): PromptCompareResult['summary'] {
  return pairs.reduce(
    (summary, pair) => {
      if (pair.status === 'source_only') {
        summary.sourceOnly += 1;
      } else if (pair.status === 'target_only') {
        summary.targetOnly += 1;
      } else if (pair.changedFields.includes('content')) {
        summary.contentChanged += 1;
      } else if (pair.changedFields.length) {
        summary.metadataChanged += 1;
      } else {
        summary.same += 1;
      }
      return summary;
    },
    { same: 0, contentChanged: 0, sourceOnly: 0, targetOnly: 0, metadataChanged: 0 },
  );
}

function groupEntries(entries: PromptEntry[], getKey: (entry: PromptEntry) => string): Map<string, PromptEntry[]> {
  const grouped = new Map<string, PromptEntry[]>();
  for (const entry of entries) {
    const key = getKey(entry);
    if (!key) {
      continue;
    }
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }
  return grouped;
}

function normalizeCompareName(name: string): string {
  return name.trim();
}

function normalizeCompareContent(content: string): string {
  return content.replace(/\r\n?/g, '\n');
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

function dedupeIdentifiers(identifiers: string[]): string[] {
  const seen = new Set<string>();
  return identifiers.filter(identifier => {
    if (!identifier || seen.has(identifier)) {
      return false;
    }
    seen.add(identifier);
    return true;
  });
}

function normalizeInsertIndex(index: number | undefined, length: number): number {
  if (typeof index !== 'number' || Number.isNaN(index)) {
    return length;
  }
  return Math.max(0, Math.min(index, length));
}
