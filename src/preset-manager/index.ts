import './styles.css';
import { createPresetManagerTutorial } from './tutorial';
import {
  APP_VERSION,
  compareVersionTags,
  createScriptImportUrl,
  CUSTOM_VERSION_IMPORT_SOURCE_ID,
  DEFAULT_VERSION_IMPORT_TEMPLATE,
  fetchVersionCatalog,
  getKnownVersionImportSourceByTemplate,
  inspectCurrentScriptVersion,
  replaceCurrentScriptVersion,
  validateVersionImportTemplate,
  VERSION_IMPORT_SOURCES,
  versionRelation,
  VersionCatalog,
  VersionImportSourceId,
  VersionRelation,
  ScriptVersionSource,
} from './version-manager';
import {
  comparePromptEntries,
  createFavoriteFromEntry,
  deepClone,
  FavoriteEntry,
  insertPromptFromEntry,
  listPromptEntries,
  materializePreset,
  movePrompt,
  movePromptsToIndex,
  Preset,
  PromptComparePair,
  PromptCompareResult,
  PromptEntry,
  removePrompt,
  setPromptContent,
  setPromptEnabled,
  setPromptRole,
  validatePreset,
} from './core';

const APP_NAME = '预设管理';
const HELPER_BUTTON_NAME = APP_NAME;
const LEGACY_HELPER_BUTTON_NAMES = ['预设缝合'];
const STORAGE_NAMESPACE = 'preset-manager';
const FAVORITES_TABLE = 'favorites';
const FAVORITES_KEY = 'v1';
const LAST_SOURCE_KEY = 'last-source';
const HOST_ROOT_ID = 'tt-preset-stitcher-host';
const ROOT_ID = 'tt-preset-stitcher-root';
const OPEN_MANAGER_EVENT = 'preset-manager:open';
const DEBUG_STORAGE_KEY = 'preset-manager:debug:v1';
const DEBUG_VARIABLE_KEY = 'presetManagerDebugLogV1';
const DEBUG_ENTRY_LIMIT = 80;
const BUTTON_REGISTRATION_RETRY_LIMIT = 20;
const BUTTON_REGISTRATION_RETRY_DELAY_MS = 250;
const OPEN_REQUEST_DEBOUNCE_MS = 250;
const COMPARE_TEXT_RENDER_DEBOUNCE_MS = 220;
const FAVORITES_PRESET_VALUE = '__preset-manager-favorites__';
const FAVORITES_PRESET_LABEL = '收藏夹';
const VERSION_PREFERENCE_KEY = 'version-import-source';
const presetManagerTutorial = createPresetManagerTutorial({
  root: () => getMountDocument().getElementById(ROOT_ID) ?? getMountDocument(),
});

type MobileTab = 'source' | 'target' | 'preview';
type EntryKind = 'source' | 'target' | 'favorite';
type SelectableEntryKind = 'source' | 'target';
type PresetPaneKind = 'source' | 'target';
type FilterValue = 'all' | 'enabled' | 'disabled' | 'system' | 'user' | 'assistant';
type CompareFilterValue = 'all' | 'same' | 'content' | 'source_only' | 'target_only' | 'metadata';
type DetailRole = 'system' | 'user' | 'assistant';
type VersionImportSourceSelection = VersionImportSourceId | typeof CUSTOM_VERSION_IMPORT_SOURCE_ID;
type VersionMessageTone = '' | 'success' | 'warning';
type RuntimeFunction = (...args: any[]) => unknown;
type RuntimeHost = Record<string, unknown> & {
  TavernHelper?: Record<string, unknown>;
  getScriptId?: () => string;
  updateVariablesWith?: (
    updater: (variables: Record<string, unknown>) => Record<string, unknown>,
    option: { type: 'script'; script_id?: string },
  ) => Record<string, unknown>;
  deleteVariable?: (variablePath: string, option: { type: 'script'; script_id?: string }) => unknown;
  triggerSlash?: (command: string) => Promise<string | undefined>;
};
type RuntimeCreateOrReplacePreset = (
  presetName: string,
  preset: unknown,
  options?: { render?: 'debounced' | 'immediate' | 'none' },
) => Promise<boolean>;
type RuntimeDeletePreset = (presetName: string) => Promise<boolean>;
type RuntimeRenamePreset = (presetName: string, newName: string) => Promise<boolean>;

interface DebugEntry {
  at: string;
  stage: string;
  details?: Record<string, unknown>;
}

interface RenderScrollSnapshot {
  key: string;
  top: number;
  left: number;
}

interface PointerDragState {
  pointerId: number;
  kind: EntryKind;
  id: string;
  ids: string[];
  row: HTMLElement;
  startX: number;
  startY: number;
  dragging: boolean;
}

interface DropLocation {
  zone: 'source' | 'target';
  index: number;
  row: HTMLElement | null;
}

interface DetailSelection {
  kind: 'source' | 'target';
  entry: PromptEntry;
}

interface AppState {
  ready: boolean;
  isOpen: boolean;
  presetNames: string[];
  sourceName: string;
  targetName: string;
  sourceQuery: string;
  targetQuery: string;
  favoriteQuery: string;
  sourceFilter: FilterValue;
  targetFilter: FilterValue;
  activeTab: MobileTab;
  compareMode: boolean;
  compareFilter: CompareFilterValue;
  dirty: boolean;
  sourceDirty: boolean;
  targetDirty: boolean;
  saving: boolean;
  notice: string;
  error: string;
  selectedSourceId: string;
  selectedTargetId: string;
  selectedFavoriteId: string;
  sourceMultiSelect: boolean;
  targetMultiSelect: boolean;
  selectedSourceIds: string[];
  selectedTargetIds: string[];
  sourceOriginal: Preset | null;
  sourceDraft: Preset | null;
  targetOriginal: Preset | null;
  targetDraft: Preset | null;
  favorites: FavoriteEntry[];
}

interface VersionDialogState {
  open: boolean;
  checking: boolean;
  catalog: VersionCatalog | null;
  source: ScriptVersionSource | null;
  targetVersion: string;
  selectedSourceId: VersionImportSourceSelection;
  customTemplate: string;
  message: string;
  messageTone: VersionMessageTone;
}

const state: AppState = {
  ready: false,
  isOpen: false,
  presetNames: [],
  sourceName: '',
  targetName: '',
  sourceQuery: '',
  targetQuery: '',
  favoriteQuery: '',
  sourceFilter: 'all',
  targetFilter: 'all',
  activeTab: 'source',
  compareMode: false,
  compareFilter: 'all',
  dirty: false,
  sourceDirty: false,
  targetDirty: false,
  saving: false,
  notice: '',
  error: '',
  selectedSourceId: '',
  selectedTargetId: '',
  selectedFavoriteId: '',
  sourceMultiSelect: false,
  targetMultiSelect: false,
  selectedSourceIds: [],
  selectedTargetIds: [],
  sourceOriginal: null,
  sourceDraft: null,
  targetOriginal: null,
  targetDraft: null,
  favorites: [],
};

const versionState: VersionDialogState = {
  open: false,
  checking: false,
  catalog: null,
  source: null,
  targetVersion: '',
  selectedSourceId: 'jsdelivr',
  customTemplate: DEFAULT_VERSION_IMPORT_TEMPLATE,
  message: '',
  messageTone: '',
};

let isComposingInput = false;
let pointerDrag: PointerDragState | null = null;
let suppressNextClick = false;
let runtimeReadyPromise: Promise<void> | null = null;
let buttonRegistrationAttempts = 0;
let buttonEventHandle: EventOnReturn | null = null;
let styleHandle: { destroy: () => void } | null = null;
let hostRoot: HTMLElement | null = null;
let mountDocument: Document | null = null;
let isHelperButtonClickFallbackBound = false;
let lastOpenRequestAt = 0;
let pendingScrollSelectedRowIntoView = false;
let compareTextRenderTimer: number | null = null;
const compareContentScrollMemory = new Map<string, Pick<RenderScrollSnapshot, 'top' | 'left'>>();
let debugEntries: DebugEntry[] = [];

diagnose('module-evaluated', getRuntimeDiagnostics());
start();
cleanupLegacyScriptVariables();
void checkVersionCatalog({ silent: true });

function start(): void {
  diagnose('start', { readyState: document.readyState, hasJquery: typeof $ === 'function' });
  if (typeof $ === 'function') {
    $(() => {
      diagnose('jquery-ready');
      registerManagerEntry();
    });
    $(window).on('pagehide', cleanupManagerEntry);
    return;
  }

  runWhenDocumentReady(() => {
    diagnose('dom-ready');
    registerManagerEntry();
  });
  window.addEventListener('pagehide', cleanupManagerEntry, { once: true });
}

function runWhenDocumentReady(callback: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
    return;
  }
  callback();
}

function registerManagerEntry(): void {
  diagnose('register-start', getRuntimeDiagnostics());
  try {
    styleHandle ??= teleportCurrentStyles();
    ensureHostRoot();
    syncManagerButton();
    buttonEventHandle?.stop();
    buttonEventHandle = eventOn(getButtonEvent(HELPER_BUTTON_NAME), () => {
      diagnose('button-event-received');
      console.info(`[${APP_NAME}] 收到脚本按钮事件`);
      window.dispatchEvent(new CustomEvent(OPEN_MANAGER_EVENT));
    });
    window.removeEventListener(OPEN_MANAGER_EVENT, requestOpenManager);
    window.addEventListener(OPEN_MANAGER_EVENT, requestOpenManager);
    bindHelperButtonClickFallback();
    diagnose('register-success', { event: getButtonEvent(HELPER_BUTTON_NAME) });
  } catch (error) {
    buttonRegistrationAttempts += 1;
    diagnose('register-error', {
      attempt: buttonRegistrationAttempts,
      message: error instanceof Error ? error.message : String(error),
      ...getRuntimeDiagnostics(),
    });
    if (buttonRegistrationAttempts <= BUTTON_REGISTRATION_RETRY_LIMIT) {
      window.setTimeout(registerManagerEntry, BUTTON_REGISTRATION_RETRY_DELAY_MS);
      return;
    }
    console.error(`${APP_NAME}按钮注册失败`, error);
    showToast('error', error instanceof Error ? error.message : `${APP_NAME}按钮注册失败`);
  }
}

function cleanupManagerEntry(): void {
  diagnose('cleanup');
  presetManagerTutorial.close();
  buttonEventHandle?.stop();
  buttonEventHandle = null;
  styleHandle?.destroy();
  styleHandle = null;
  window.removeEventListener(OPEN_MANAGER_EVENT, requestOpenManager);
  document.removeEventListener('click', onPotentialHelperButtonClick, true);
  if (mountDocument && mountDocument !== document) {
    mountDocument.removeEventListener('click', onPotentialHelperButtonClick, true);
  }
  isHelperButtonClickFallbackBound = false;
  const activeMountDocument = mountDocument ?? document;
  activeMountDocument.getElementById(ROOT_ID)?.remove();
  document.getElementById(ROOT_ID)?.remove();
  hostRoot?.remove();
  hostRoot = null;
  mountDocument = null;
}

function scriptButton(name: string, button: Partial<ScriptButton> = {}, forceVisible = false): ScriptButton {
  const nextButton = { ...button, name } as ScriptButton;
  if (forceVisible || typeof nextButton.visible !== 'boolean') {
    nextButton.visible = true;
  }
  return nextButton;
}

function syncManagerButton(): void {
  diagnose('sync-button-start');
  updateScriptButtonsWith(buttons => {
    diagnose('sync-button-updater', {
      before: buttons.map(button => `${button.name}:${button.visible ? 'visible' : 'hidden'}`),
    });
    let insertedButton = false;
    const nextButtons: ScriptButton[] = [];

    for (const button of buttons) {
      if (isManagedHelperButtonName(button.name)) {
        if (!insertedButton) {
          nextButtons.push(scriptButton(HELPER_BUTTON_NAME, button, true));
          insertedButton = true;
        }
        continue;
      }
      nextButtons.push(button);
    }

    if (!insertedButton) {
      nextButtons.push(scriptButton(HELPER_BUTTON_NAME, {}, true));
    }

    diagnose('sync-button-next', {
      after: nextButtons.map(button => `${button.name}:${button.visible ? 'visible' : 'hidden'}`),
    });
    return nextButtons;
  });
}

function requestOpenManager(): void {
  const now = Date.now();
  if (now - lastOpenRequestAt < OPEN_REQUEST_DEBOUNCE_MS) {
    return;
  }
  lastOpenRequestAt = now;
  diagnose('open-requested');
  void openManager().catch(error => {
    const message = error instanceof Error ? error.message : `${APP_NAME}打开失败`;
    diagnose('open-error', { message });
    console.error(`${APP_NAME}打开失败`, error);
    showToast('error', message);
  });
}

function bindHelperButtonClickFallback(): void {
  if (isHelperButtonClickFallbackBound) {
    return;
  }
  document.addEventListener('click', onPotentialHelperButtonClick, true);
  const visibleDocument = getMountDocument();
  if (visibleDocument !== document) {
    visibleDocument.addEventListener('click', onPotentialHelperButtonClick, true);
  }
  isHelperButtonClickFallbackBound = true;
}

function onPotentialHelperButtonClick(event: MouseEvent): void {
  const target = toElement(event.target);
  const button = target?.closest<HTMLElement>(
    'button, [role="button"], .menu_button, [data-button-name], [data-script-button]',
  );
  if (!button || !isHelperButtonElement(button)) {
    return;
  }
  diagnose('dom-click-fallback', {
    text: button.textContent?.trim(),
    ariaLabel: button.getAttribute('aria-label'),
    title: button.getAttribute('title'),
  });
  requestOpenManager();
}

function isHelperButtonElement(button: HTMLElement): boolean {
  if (isManagedHelperButtonName(button.dataset.buttonName) || isManagedHelperButtonName(button.dataset.scriptButton)) {
    return true;
  }

  const ariaLabel = button.getAttribute('aria-label')?.trim();
  const title = button.getAttribute('title')?.trim();
  const text = button.textContent?.trim();
  return (
    isManagedHelperButtonName(ariaLabel) ||
    isManagedHelperButtonName(title) ||
    title === `打开${HELPER_BUTTON_NAME}` ||
    isManagedHelperButtonName(text)
  );
}

function isManagedHelperButtonName(name: string | undefined): boolean {
  return name === HELPER_BUTTON_NAME || LEGACY_HELPER_BUTTON_NAMES.includes(name ?? '');
}

function helperGetPresetNames(): string[] {
  return getTavernHelperFunction<() => string[]>('getPresetNames')();
}

function helperGetLoadedPresetName(): string {
  const fn = getOptionalTavernHelperFunction<() => string>('getLoadedPresetName');
  if (!fn) {
    return '';
  }
  try {
    return fn();
  } catch (error) {
    diagnose('loaded-preset-name-error', { message: error instanceof Error ? error.message : String(error) });
    return '';
  }
}

function helperGetPreset(presetName: string): unknown {
  return getTavernHelperFunction<(name: string) => unknown>('getPreset')(presetName);
}

function helperCreateOrReplacePreset(
  presetName: string,
  preset: unknown,
  options: { render: 'immediate' | 'none' },
): Promise<boolean> {
  return getTavernHelperFunction<RuntimeCreateOrReplacePreset>('createOrReplacePreset')(presetName, preset, options);
}

function helperDeletePreset(presetName: string): Promise<boolean> {
  return getTavernHelperFunction<RuntimeDeletePreset>('deletePreset')(presetName);
}

function helperRenamePreset(presetName: string, newName: string): Promise<boolean> {
  return getTavernHelperFunction<RuntimeRenamePreset>('renamePreset')(presetName, newName);
}

function getTavernHelperFunction<T extends RuntimeFunction>(name: string): T {
  const runtime = globalThis as unknown as RuntimeHost;
  const helperValue = runtime.TavernHelper?.[name];
  if (typeof helperValue === 'function') {
    return helperValue.bind(runtime.TavernHelper) as T;
  }

  const directValue = runtime[name];
  if (typeof directValue === 'function') {
    return directValue.bind(runtime) as T;
  }

  diagnose('helper-api-missing', {
    name,
    hasTavernHelper: Boolean(runtime.TavernHelper),
    tavernHelperKeys: runtime.TavernHelper ? Object.keys(runtime.TavernHelper).slice(0, 40) : [],
  });
  throw new Error(`酒馆助手接口不可用：${name}`);
}

function getOptionalTavernHelperFunction<T extends RuntimeFunction>(name: string): T | null {
  const runtime = globalThis as unknown as RuntimeHost;
  const helperValue = runtime.TavernHelper?.[name];
  if (typeof helperValue === 'function') {
    return helperValue.bind(runtime.TavernHelper) as T;
  }

  const directValue = runtime[name];
  if (typeof directValue === 'function') {
    return directValue.bind(runtime) as T;
  }
  return null;
}

async function ensureRuntimeReady(): Promise<void> {
  if (state.ready) {
    return;
  }
  runtimeReadyPromise ??= bootRuntime().catch(error => {
    runtimeReadyPromise = null;
    throw error;
  });
  await runtimeReadyPromise;
}

async function bootRuntime(): Promise<void> {
  diagnose('boot-runtime-start');
  state.favorites = await loadFavorites();
  state.sourceName = loadLastSourceName();
  state.ready = true;
  diagnose('boot-runtime-success', { favorites: state.favorites.length });
}

async function openManager(): Promise<void> {
  diagnose('open-start');
  await ensureRuntimeReady();
  clearMessage();
  state.sourceDraft = null;
  state.sourceOriginal = null;
  state.targetDraft = null;
  state.targetOriginal = null;
  state.sourceDirty = false;
  state.targetDirty = false;
  state.compareMode = false;
  state.compareFilter = 'all';
  syncDirtyState();
  hydratePresetList({ targetFromLoaded: true });
  state.isOpen = true;
  render();
  diagnose('open-success', { presets: state.presetNames.length, source: state.sourceName, target: state.targetName });
}

function hydratePresetList(options: { targetFromLoaded?: boolean } = {}): void {
  state.presetNames = helperGetPresetNames()
    .filter(name => name !== 'in_use')
    .sort((lhs, rhs) => lhs.localeCompare(rhs, 'zh-Hans-CN'));
  diagnose('preset-list-loaded', {
    count: state.presetNames.length,
    sample: state.presetNames.slice(0, 6),
  });

  if (!state.sourceName || !isSelectablePreset(state.sourceName)) {
    state.sourceName = state.presetNames[0] ?? FAVORITES_PRESET_VALUE;
  }

  const loadedTargetName = options.targetFromLoaded ? helperGetLoadedPresetName() : '';
  if (loadedTargetName && isSelectablePreset(loadedTargetName)) {
    if (state.targetName !== loadedTargetName) {
      state.targetName = loadedTargetName;
      resetTargetDraft();
    }
  }

  if (!state.targetName || !isSelectablePreset(state.targetName)) {
    state.targetName = state.presetNames.find(name => name !== state.sourceName) ?? state.sourceName;
    resetTargetDraft();
  }

  if (!state.sourceDraft) {
    resetSourceDraft();
  }

  if (!state.targetDraft) {
    resetTargetDraft();
  }
}

function resetSourceDraft(): void {
  const sourcePreset = getPresetByName(state.sourceName);
  state.sourceOriginal = sourcePreset ? deepClone(sourcePreset) : null;
  state.sourceDraft = sourcePreset ? deepClone(sourcePreset) : null;
  state.sourceDirty = false;
  state.selectedSourceId = '';
  clearEntrySelection('source');
  syncDirtyState();
}

function resetTargetDraft(): void {
  if (isFavoritesPreset(state.targetName)) {
    const favoritesDraft = createFavoritesPresetDraft();
    state.targetOriginal = deepClone(favoritesDraft);
    state.targetDraft = favoritesDraft;
    state.targetDirty = false;
    state.selectedTargetId = '';
    clearEntrySelection('target');
    syncDirtyState();
    return;
  }

  const targetPreset = getPresetByName(state.targetName);
  state.targetOriginal = targetPreset ? deepClone(targetPreset) : null;
  state.targetDraft = targetPreset ? deepClone(targetPreset) : null;
  state.targetDirty = false;
  state.selectedTargetId = '';
  clearEntrySelection('target');
  syncDirtyState();
}

function getPresetByName(name: string): Preset | null {
  if (isFavoritesPreset(name)) {
    return createFavoritesPresetDraft();
  }

  try {
    return deepClone(materializePreset(helperGetPreset(name) as Preset));
  } catch (error) {
    diagnose('preset-load-error', {
      name,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function isFavoritesPreset(name: string): boolean {
  return name === FAVORITES_PRESET_VALUE;
}

function isSelectablePreset(name: string): boolean {
  return isFavoritesPreset(name) || state.presetNames.includes(name);
}

function getPresetDisplayName(name: string): string {
  return isFavoritesPreset(name) ? FAVORITES_PRESET_LABEL : name;
}

function createFavoritesPresetDraft(): Preset {
  return {
    prompts: state.favorites.map(favorite => ({
      ...deepClone(favorite.prompt),
      id: favorite.id,
      identifier: favorite.id,
      name: favorite.name,
      enabled: favorite.enabled,
    })),
  };
}

function getEditableSourceDraft(): Preset | null {
  if (state.sourceName === state.targetName && state.targetDraft) {
    return state.targetDraft;
  }
  return state.sourceDraft;
}

function markSourceDirty(): void {
  if (state.sourceName === state.targetName && state.targetDraft) {
    state.targetDirty = true;
  } else {
    state.sourceDirty = true;
  }
  syncDirtyState();
}

function markTargetDirty(): void {
  state.targetDirty = true;
  syncDirtyState();
}

function syncDirtyState(): void {
  state.dirty = state.sourceDirty || state.targetDirty;
}

function loadLastSourceName(): string {
  try {
    return localStorage.getItem(`${STORAGE_NAMESPACE}:${LAST_SOURCE_KEY}`) ?? '';
  } catch {
    return '';
  }
}

function saveLastSourceName(): void {
  try {
    localStorage.setItem(`${STORAGE_NAMESPACE}:${LAST_SOURCE_KEY}`, state.sourceName);
  } catch {
    // ignored
  }
}

function render(): void {
  const visibleDocument = getMountDocument();
  const existing = visibleDocument.getElementById(ROOT_ID);
  if (!state.isOpen) {
    existing?.remove();
    return;
  }

  const scrollSnapshot = captureScrollSnapshot(existing);
  const mountPoint = ensureHostRoot(visibleDocument);
  const root = existing ?? createManagerRoot();
  root.id = ROOT_ID;
  root.innerHTML = renderDialog();

  if (!existing) {
    root.addEventListener('click', onRootClick);
    root.addEventListener('change', onRootChange);
    root.addEventListener('input', onRootInput);
    root.addEventListener('compositionstart', onCompositionStart);
    root.addEventListener('compositionend', onCompositionEnd);
    root.addEventListener('scroll', onRootScroll, true);
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('drop', onDrop);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerCancel);
    mountPoint.appendChild(root);
  }

  applyMobileSurfaces(root);
  restoreScrollSnapshot(root, scrollSnapshot);
  if (pendingScrollSelectedRowIntoView) {
    pendingScrollSelectedRowIntoView = false;
    requestSelectedRowsIntoView(root);
  }
  diagnoseRootLayout(root, existing ? 'render-updated' : 'render-mounted');
}

function ensureHostRoot(targetDocument = getMountDocument()): HTMLElement {
  if (hostRoot?.isConnected) {
    return hostRoot;
  }

  const existing = targetDocument.getElementById(HOST_ROOT_ID) as HTMLElement | null;
  hostRoot = existing ?? targetDocument.createElement('div');
  hostRoot.id = HOST_ROOT_ID;
  hostRoot.style.display = 'contents';

  const scriptId = getCurrentScriptId();
  if (scriptId) {
    hostRoot.setAttribute('script_id', scriptId);
  }

  if (!existing) {
    targetDocument.body.appendChild(hostRoot);
  }

  diagnose('host-root-ready', {
    hasScriptId: hostRoot.hasAttribute('script_id'),
    connected: hostRoot.isConnected,
    childCount: hostRoot.childElementCount,
    mountedInParent: targetDocument !== document,
  });
  return hostRoot;
}

function createManagerRoot(): HTMLElement {
  const targetDocument = getMountDocument();
  const root = targetDocument.createElement('div');
  const scriptId = getCurrentScriptId();
  if (scriptId) {
    root.setAttribute('script_id', scriptId);
  }
  diagnose('root-created', {
    hasScriptId: root.hasAttribute('script_id'),
    mountedInParent: targetDocument !== document,
  });
  return root;
}

function diagnoseRootLayout(root: HTMLElement, stage: string): void {
  const rootDocument = root.ownerDocument;
  const rootWindow = rootDocument.defaultView ?? window;
  const panel = root.querySelector<HTMLElement>('.pm-panel');
  const rootStyle = rootWindow.getComputedStyle(root);
  const panelStyle = panel ? rootWindow.getComputedStyle(panel) : null;
  const bodyRect = rootDocument.body.getBoundingClientRect();
  diagnose(stage, {
    rootConnected: root.isConnected,
    hostConnected: hostRoot?.isConnected ?? false,
    mountedInParent: rootDocument !== document,
    windowWidth: rootWindow.innerWidth,
    windowHeight: rootWindow.innerHeight,
    bodyWidth: roundPixel(bodyRect.width),
    bodyHeight: roundPixel(bodyRect.height),
    rootRect: rectToDiagnostics(root.getBoundingClientRect()),
    panelRect: panel ? rectToDiagnostics(panel.getBoundingClientRect()) : null,
    rootDisplay: rootStyle.display,
    panelDisplay: panelStyle?.display ?? null,
    panelVisibility: panelStyle?.visibility ?? null,
    panelZIndex: panelStyle?.zIndex ?? null,
  });
}

function rectToDiagnostics(rect: DOMRect): Record<string, number> {
  return {
    x: roundPixel(rect.x),
    y: roundPixel(rect.y),
    width: roundPixel(rect.width),
    height: roundPixel(rect.height),
  };
}

function roundPixel(value: number): number {
  return Math.round(value * 100) / 100;
}

function getMountDocument(): Document {
  if (mountDocument?.body?.isConnected) {
    return mountDocument;
  }

  mountDocument = getParentDocument() ?? document;
  return mountDocument;
}

function getParentDocument(): Document | null {
  try {
    if (window.parent && window.parent !== window && window.parent.document?.body) {
      return window.parent.document;
    }
  } catch {
    // Cross-origin parents are expected in browser fixtures and should just fall back.
  }
  return null;
}

function toElement(target: EventTarget | null): Element | null {
  if (!target || typeof (target as Element).closest !== 'function') {
    return null;
  }
  return target as Element;
}

function toInputElement(target: EventTarget | null): HTMLInputElement | null {
  const element = toElement(target);
  return element?.tagName === 'INPUT' ? (element as HTMLInputElement) : null;
}

function toTextAreaElement(target: EventTarget | null): HTMLTextAreaElement | null {
  const element = toElement(target);
  return element?.tagName === 'TEXTAREA' ? (element as HTMLTextAreaElement) : null;
}

function toSelectElement(target: EventTarget | null): HTMLSelectElement | null {
  const element = toElement(target);
  return element?.tagName === 'SELECT' ? (element as HTMLSelectElement) : null;
}

function teleportCurrentStyles(): { destroy: () => void } {
  const targetDocument = getMountDocument();
  const wrapper = targetDocument.createElement('div');
  const scriptId = getCurrentScriptId();
  if (scriptId) {
    wrapper.setAttribute('script_id', scriptId);
  }
  document.head.querySelectorAll('style').forEach(style => {
    wrapper.appendChild(style.cloneNode(true));
  });
  targetDocument.head.appendChild(wrapper);
  diagnose('styles-teleported', {
    hasScriptId: wrapper.hasAttribute('script_id'),
    styleCount: wrapper.childElementCount,
    mountedInParent: targetDocument !== document,
  });
  return {
    destroy: () => wrapper.remove(),
  };
}

function getCurrentScriptId(): string {
  try {
    return getScriptId();
  } catch {
    return '';
  }
}

function captureScrollSnapshot(root: HTMLElement | null): RenderScrollSnapshot[] {
  if (!root) {
    return [];
  }

  return [...root.querySelectorAll<HTMLElement>('.pm-body, .pm-list[data-drop-zone], .pm-compare-content-input')]
    .map(element => {
      if (isCompareContentEditor(element)) {
        rememberCompareContentScroll(element);
      }
      return {
        key: getScrollKey(element),
        top: element.scrollTop,
        left: element.scrollLeft,
      };
    })
    .filter((item): item is RenderScrollSnapshot => Boolean(item.key));
}

function restoreScrollSnapshot(root: HTMLElement, snapshot: RenderScrollSnapshot[]): void {
  const restoredKeys = new Set<string>();
  for (const item of snapshot) {
    const element = findScrollElement(root, item.key);
    if (!element) {
      continue;
    }
    restoredKeys.add(item.key);
    element.scrollTop = item.top;
    element.scrollLeft = item.left;
    if (isCompareContentEditor(element)) {
      rememberCompareContentScroll(element);
    }
  }
  restoreRememberedCompareContentScroll(root, restoredKeys);
}

function requestScrollSelectedRowOnNextRender(): void {
  pendingScrollSelectedRowIntoView = true;
}

function requestSelectedRowsIntoView(root: HTMLElement): void {
  const targetWindow = root.ownerDocument.defaultView ?? window;
  targetWindow.requestAnimationFrame(() => {
    const rows = getSelectedRowElements(root);
    for (const row of rows) {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });
}

function getSelectedRowElements(root: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  if (state.selectedSourceId) {
    const sourceRow = root.querySelector<HTMLElement>(
      `.pm-row[data-entry-kind="source"][data-id="${CSS.escape(state.selectedSourceId)}"]`,
    );
    if (sourceRow) rows.push(sourceRow);
  }
  if (state.selectedTargetId) {
    const targetRow = root.querySelector<HTMLElement>(
      `.pm-row[data-entry-kind="target"][data-id="${CSS.escape(state.selectedTargetId)}"]`,
    );
    if (targetRow) rows.push(targetRow);
  }
  return rows;
}

function getScrollKey(element: HTMLElement): string {
  if (element.classList.contains('pm-body')) {
    return 'body';
  }
  if (isCompareContentEditor(element)) {
    return getCompareContentScrollKey(element);
  }
  const dropZone = element.dataset.dropZone;
  return dropZone ? `drop:${dropZone}` : '';
}

function findScrollElement(root: HTMLElement, key: string): HTMLElement | null {
  if (key === 'body') {
    return root.querySelector<HTMLElement>('.pm-body');
  }
  if (key === 'drop:source') {
    return root.querySelector<HTMLElement>('.pm-list[data-drop-zone="source"]');
  }
  if (key === 'drop:target') {
    return root.querySelector<HTMLElement>('.pm-list[data-drop-zone="target"]');
  }
  if (key === 'drop:favorite') {
    return root.querySelector<HTMLElement>('.pm-list[data-drop-zone="favorite"]');
  }
  if (key === 'compare:source') {
    return root.querySelector<HTMLElement>('[data-compare-content="compareSourceContent"]');
  }
  if (key === 'compare:target') {
    return root.querySelector<HTMLElement>('[data-compare-content="compareTargetContent"]');
  }
  if (key.startsWith('compare:source:')) {
    const id = key.slice('compare:source:'.length);
    return (
      root.querySelector<HTMLElement>(
        `[data-compare-content="compareSourceContent"][data-entry-id="${CSS.escape(id)}"]`,
      ) ?? root.querySelector<HTMLElement>('[data-compare-content="compareSourceContent"]')
    );
  }
  if (key.startsWith('compare:target:')) {
    const id = key.slice('compare:target:'.length);
    return (
      root.querySelector<HTMLElement>(
        `[data-compare-content="compareTargetContent"][data-entry-id="${CSS.escape(id)}"]`,
      ) ?? root.querySelector<HTMLElement>('[data-compare-content="compareTargetContent"]')
    );
  }
  return null;
}

function isCompareContentEditor(element: HTMLElement): boolean {
  return (
    element.classList.contains('pm-compare-content-input') && isCompareContentName(element.dataset.compareContent ?? '')
  );
}

function isCompareContentName(name: string): boolean {
  return name === 'compareSourceContent' || name === 'compareTargetContent';
}

function getCompareContentScrollKey(element: HTMLElement): string {
  const side = element.dataset.compareContent === 'compareSourceContent' ? 'source' : 'target';
  const id = element.dataset.entryId ?? '';
  return id ? `compare:${side}:${id}` : `compare:${side}`;
}

function rememberCompareContentScroll(element: HTMLElement): void {
  compareContentScrollMemory.set(getCompareContentScrollKey(element), {
    top: element.scrollTop,
    left: element.scrollLeft,
  });
}

function restoreRememberedCompareContentScroll(root: HTMLElement, restoredKeys: Set<string>): void {
  root.querySelectorAll<HTMLElement>('.pm-compare-content-input').forEach(element => {
    if (!isCompareContentEditor(element)) {
      return;
    }
    const key = getCompareContentScrollKey(element);
    if (restoredKeys.has(key)) {
      return;
    }
    const remembered = compareContentScrollMemory.get(key);
    if (!remembered) {
      return;
    }
    element.scrollTop = remembered.top;
    element.scrollLeft = remembered.left;
    rememberCompareContentScroll(element);
  });
}

function applyMobileSurfaces(root: HTMLElement): void {
  const backdrop = root.querySelector('.pm-backdrop');
  const panel = root.querySelector('.pm-panel');
  backdrop?.setAttribute('data-tt-mobile-surface', 'backdrop');
  panel?.setAttribute('data-tt-mobile-surface', 'fullscreen-window');
}

function renderDialog(): string {
  const sourceCompareEntries = getSourceCompareEntries();
  const targetCompareEntries = getTargetCompareEntries();
  const sourceEntries = getSourceEntries();
  const targetEntries = getTargetEntries();
  const comparison = state.compareMode ? comparePromptEntries(sourceCompareEntries, targetCompareEntries) : null;
  pruneEntrySelections();
  const selected = getDetailSelection();
  const validation = state.targetDraft ? validatePreset(state.targetDraft) : null;

  return `
    <div class="pm-backdrop" data-action="backdrop-close"></div>
    <section class="pm-panel" role="dialog" aria-modal="true" aria-label="${APP_NAME}" data-active-tab="${state.activeTab}" data-compare-mode="${state.compareMode ? 'true' : 'false'}" data-pm-tutorial="panel">
      <header class="pm-header">
        <div class="pm-title-block">
          <div class="pm-title-line">
            <div class="pm-title">${APP_NAME}</div>
            <span class="pm-version-chip">${APP_VERSION}</span>
            <button class="pm-version-button ${getVersionButtonClass()}" type="button" data-action="open-version-manager" data-pm-tutorial="version-manager" title="${escapeAttr(getVersionButtonTitle())}" aria-label="${escapeAttr(getVersionButtonTitle())}">
              <i class="fa-solid ${getVersionButtonIcon()}" aria-hidden="true"></i>
              ${isVersionUpdateAvailable() ? '<span class="pm-update-dot" aria-hidden="true"></span>' : ''}
            </button>
          </div>
          <div class="pm-subtitle">${escapeHtml(getStatusText(sourceEntries.length, targetEntries.length))}</div>
        </div>
        <div class="pm-header-actions">
          <button class="pm-icon-button" type="button" data-action="start-tutorial" title="打开教程" aria-label="打开教程"><i class="fa-solid fa-circle-question" aria-hidden="true"></i></button>
          <button class="pm-icon-button" type="button" data-action="close" title="关闭"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>
      </header>

      ${renderCompareBar(comparison)}

      <nav class="pm-mobile-tabs" aria-label="移动端视图">
        ${renderTab('source', '来源')}
        ${renderTab('target', '目标')}
        ${renderTab('preview', '条目详情')}
      </nav>

      <main class="pm-body">
        ${renderPresetPane('source', '来源预设', state.sourceName, state.sourceQuery, state.sourceFilter, sourceEntries, comparison)}
        ${renderPresetPane('target', '目标预设', state.targetName, state.targetQuery, state.targetFilter, targetEntries, comparison)}
        ${renderDetail(selected, comparison)}
      </main>

      <footer class="pm-footer" data-pm-tutorial="save-bar">
        <div class="pm-footer-status">
          ${state.dirty ? '<span class="pm-dot pm-dot-dirty"></span>有未保存的修改' : '<span class="pm-dot"></span>暂无未保存修改'}
          ${state.compareMode ? '<span class="pm-validation">比对模式可编辑当前条目</span>' : ''}
          ${validation && !validation.ok ? `<span class="pm-validation">结构警告 ${validation.duplicateIdentifiers.length + validation.missingOrderReferences.length + validation.promptsWithoutIdentifiers}</span>` : ''}
        </div>
        <div class="pm-footer-actions">
          <button class="pm-button" type="button" data-action="reset-draft" ${state.dirty ? '' : 'disabled'}>放弃修改</button>
          <button class="pm-button pm-button-primary" type="button" data-action="save" ${state.dirty && !state.saving ? '' : 'disabled'}>
            <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
            ${state.saving ? '保存中' : '保存预设'}
          </button>
        </div>
      </footer>
    </section>
    ${renderVersionDialog()}
  `;
}

function renderVersionDialog(): string {
  if (!versionState.open) {
    return '';
  }

  const latestVersion = getLatestVersion();
  const source = versionState.source;
  const sourceLabel = source ? formatScriptVersionSource(source) : '尚未读取当前脚本';
  const templateValidation = validateSelectedVersionImportTemplate();
  const targetVersion = versionState.targetVersion;
  const targetRelation = targetVersion ? versionRelation(targetVersion, APP_VERSION) : null;
  const targetImportStatement = targetVersion ? createVersionImportStatement(targetVersion) : '';

  return `
    <div class="pm-version-overlay" data-action="close-version-manager">
      <section class="pm-version-box" role="dialog" aria-modal="true" aria-label="版本管理" data-version-dialog="true">
        <header class="pm-version-header">
          <div>
            <h2>版本管理</h2>
            <p>选择脚本版本，或切换导入来源。</p>
          </div>
          <button class="pm-icon-button" type="button" data-action="close-version-manager" title="关闭版本管理" aria-label="关闭版本管理">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </header>

        <div class="pm-version-summary">
          <div><span>当前内置</span><strong>${APP_VERSION}</strong></div>
          <div><span>检测最新</span><strong>${escapeHtml(latestVersion ?? '未检测到')}</strong></div>
          <div><span>脚本来源</span><strong>${escapeHtml(sourceLabel)}</strong></div>
        </div>

        ${renderVersionHint()}

        <section class="pm-version-source">
          <label class="pm-field">
            <span>导入来源</span>
            <select name="versionImportSource">
              ${renderVersionImportSourceOptions()}
            </select>
          </label>
          ${
            versionState.selectedSourceId === CUSTOM_VERSION_IMPORT_SOURCE_ID
              ? `
            <label class="pm-field pm-version-custom-source">
              <span>自定义模板</span>
              <input name="versionCustomTemplate" value="${escapeAttr(versionState.customTemplate)}" placeholder="https://.../{version}/dist/preset-manager/index.js" autocomplete="off" />
            </label>
          `
              : ''
          }
          <p>${escapeHtml(getSelectedVersionImportSourceDescription())}</p>
          ${templateValidation.ok ? '' : `<p class="pm-version-error">${escapeHtml(templateValidation.message)}</p>`}
        </section>

        <div class="pm-version-actions">
          <button class="pm-button pm-button-primary" type="button" data-action="version-latest" ${latestVersion && latestVersion !== APP_VERSION ? '' : 'disabled'}>
            <i class="fa-solid fa-arrow-up" aria-hidden="true"></i>
            更新到最新版
          </button>
          <button class="pm-button" type="button" data-action="refresh-version-manager" ${versionState.checking ? 'disabled' : ''}>
            <i class="fa-solid fa-rotate ${versionState.checking ? 'pm-spin' : ''}" aria-hidden="true"></i>
            ${versionState.checking ? '检测中' : '刷新版本'}
          </button>
        </div>

        ${
          targetVersion
            ? `
          <section class="pm-version-confirm">
            <div class="pm-version-target">
              <span>目标版本</span>
              <strong>${escapeHtml(targetVersion)}</strong>
              <em>${escapeHtml(formatVersionRelation(targetRelation))}</em>
            </div>
            ${state.dirty ? '<p class="pm-version-warning">当前有未保存预设修改。脚本版本切换不会保存或丢弃它们，但刷新页面会丢失页面内草稿。</p>' : ''}
            <code>${escapeHtml(targetImportStatement)}</code>
            <div class="pm-version-target-actions">
              <button class="pm-button" type="button" data-action="copy-version-import">
                <i class="fa-solid fa-copy" aria-hidden="true"></i>
                复制
              </button>
              <button class="pm-button" type="button" data-action="clear-version-target">取消</button>
              <button class="pm-button pm-button-primary" type="button" data-action="confirm-version-switch" ${templateValidation.ok ? '' : 'disabled'}>
                ${escapeHtml(formatVersionSwitchAction(targetRelation))}
              </button>
            </div>
          </section>
        `
            : ''
        }

        ${
          versionState.message
            ? `
          <section class="pm-version-result ${versionState.messageTone}">
            <div>${escapeHtml(versionState.message)}</div>
            ${
              versionState.messageTone === 'success'
                ? `
              <button class="pm-button" type="button" data-action="reload-page">
                <i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>
                刷新页面
              </button>
            `
                : ''
            }
          </section>
        `
            : ''
        }

        <div class="pm-version-list" data-version-list="true">
          ${getVersionRows().map(renderVersionRow).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderVersionHint(): string {
  if (versionState.checking) {
    return '<div class="pm-version-hint">正在检查脚本版本。</div>';
  }
  if (versionState.catalog?.errorMessage) {
    return `<div class="pm-version-hint warning">${escapeHtml(versionState.catalog.errorMessage)}</div>`;
  }
  if (isVersionUpdateAvailable()) {
    return `<div class="pm-version-hint success">发现新版本 ${escapeHtml(getLatestVersion())}。</div>`;
  }
  return '<div class="pm-version-hint">当前内置版本没有检测到更新。</div>';
}

function renderVersionImportSourceOptions(): string {
  const options = [
    ...VERSION_IMPORT_SOURCES.map(source => [source.id, source.label] as const),
    [CUSTOM_VERSION_IMPORT_SOURCE_ID, '自定义模板'] as const,
  ];
  return options
    .map(
      ([id, label]) =>
        `<option value="${id}" ${versionState.selectedSourceId === id ? 'selected' : ''}>${escapeHtml(label)}</option>`,
    )
    .join('');
}

function renderVersionRow(version: string): string {
  const relation = versionRelation(version, APP_VERSION);
  return `
    <button class="pm-version-row ${relation}" type="button" data-action="version-select" data-version="${escapeAttr(version)}">
      <span>${escapeHtml(version)}</span>
      <em>${escapeHtml(formatVersionRelation(relation))}</em>
    </button>
  `;
}

function renderCompareBar(comparison: PromptCompareResult | null): string {
  const pressed = state.compareMode ? 'true' : 'false';
  const summary = comparison?.summary;
  return `
    <div class="pm-compare-bar" data-pm-tutorial="compare-bar">
      <button class="pm-selection-mode-button pm-compare-toggle" type="button" data-action="toggle-compare" aria-pressed="${pressed}" title="开启后只高亮来源和目标预设的条目正文差异">
        <i class="fa-solid fa-code-compare" aria-hidden="true"></i>
        <span>比对模式</span>
      </button>
      ${
        summary
          ? `
        <div class="pm-compare-summary" aria-label="比对摘要">
          ${renderCompareFilterButton('same', '相同', summary.same, false)}
          ${renderCompareFilterButton('content', '正文不同', summary.contentChanged, true)}
          ${renderCompareFilterButton('source_only', '仅来源', summary.sourceOnly, true)}
          ${renderCompareFilterButton('target_only', '仅目标', summary.targetOnly, true)}
          ${renderCompareFilterButton('metadata', '辅助差异', summary.metadataChanged, false)}
        </div>
      `
          : '<div class="pm-compare-summary is-muted">开启后高亮两个预设的正文差异</div>'
      }
    </div>
  `;
}

function renderCompareFilterButton(
  filter: CompareFilterValue,
  label: string,
  count: number,
  important: boolean,
): string {
  const active = state.compareFilter === filter;
  const classes = ['pm-compare-filter', important && count ? 'is-different' : '', active ? 'is-active' : '']
    .filter(Boolean)
    .join(' ');
  return `
    <button class="${classes}" type="button" data-action="set-compare-filter" data-compare-filter="${filter}" aria-pressed="${active ? 'true' : 'false'}">
      ${escapeHtml(label)} ${count}
    </button>
  `;
}

function renderTab(tab: MobileTab, label: string): string {
  const selected = state.activeTab === tab ? 'aria-selected="true"' : 'aria-selected="false"';
  return `<button class="pm-tab" type="button" data-action="tab" data-tab="${tab}" ${selected}>${label}</button>`;
}

function renderPresetPane(
  kind: 'source' | 'target',
  title: string,
  selectedPreset: string,
  query: string,
  filter: FilterValue,
  entries: PromptEntry[],
  comparison: PromptCompareResult | null,
): string {
  const isSource = kind === 'source';
  const visibleEntries = filterEntriesByCompare(entries, comparison, kind);
  const selectName = isSource ? 'sourceName' : 'targetName';
  const queryName = isSource ? 'sourceQuery' : 'targetQuery';
  const filterName = isSource ? 'sourceFilter' : 'targetFilter';
  const action = isSource ? 'select-source' : 'select-target';

  return `
    <section class="pm-pane pm-pane-${kind}" data-pane="${kind}" data-pm-tutorial="${kind}-pane">
      <div class="pm-pane-head">
        <div class="pm-pane-title">
          <h2>${title}</h2>
          <span class="pm-count">${visibleEntries.length}</span>
        </div>
        ${renderPresetActions(kind, selectedPreset)}
      </div>
      <div class="pm-controls">
        <label class="pm-field">
          <span>预设</span>
          <select name="${selectName}" data-action="${action}">
            ${renderPresetOptions(selectedPreset)}
          </select>
        </label>
        <label class="pm-field">
          <span>搜索</span>
          <input name="${queryName}" value="${escapeAttr(query)}" placeholder="名称或正文" autocomplete="off" />
        </label>
        <label class="pm-field">
          <span>过滤</span>
          <select name="${filterName}">
            ${renderFilterOptions(filter)}
          </select>
        </label>
      </div>
      ${renderEntrySelectionToolbar(kind, selectedPreset, visibleEntries)}
      <div class="pm-list" data-drop-zone="${kind}">
        ${
          visibleEntries.length
            ? visibleEntries
                .map((entry, index) =>
                  renderEntryRow(kind, entry, index, getComparePairForEntry(comparison, kind, entry.id)),
                )
                .join('')
            : renderEmpty(kind)
        }
      </div>
    </section>
  `;
}

function renderEntrySelectionToolbar(
  kind: SelectableEntryKind,
  selectedPreset: string,
  entries: PromptEntry[],
): string {
  const enabled = isMultiSelectEnabled(kind);
  const selectedCount = getSelectedEntryIds(kind).filter(id => entries.some(entry => entry.id === id)).length;
  const hasRows = entries.length > 0 && !state.compareMode;
  const favoriteDisabled = selectedCount === 0 || isFavoritesPreset(selectedPreset) ? 'disabled' : '';
  const deleteDisabled = selectedCount === 0 ? 'disabled' : '';
  const activeClass = enabled ? 'is-active' : '';
  const pressed = enabled ? 'true' : 'false';

  return `
    <div class="pm-entry-selection-toolbar ${activeClass}" data-entry-selection-kind="${kind}">
      <button class="pm-selection-mode-button" type="button" data-action="entry-multi-toggle" data-entry-kind="${kind}" aria-pressed="${pressed}" ${hasRows ? '' : 'disabled'}>
        <i class="fa-solid fa-list-check" aria-hidden="true"></i>
        <span>条目多选</span>
      </button>
      ${
        enabled
          ? `
        <button class="pm-selection-action" type="button" data-action="entry-select-all" data-entry-kind="${kind}" ${hasRows ? '' : 'disabled'}>
          全选
        </button>
        <button class="pm-selection-action" type="button" data-action="entry-clear-selection" data-entry-kind="${kind}" ${selectedCount ? '' : 'disabled'}>
          清空
        </button>
        <button class="pm-selection-action" type="button" data-action="entry-batch-favorite" data-entry-kind="${kind}" title="${isFavoritesPreset(selectedPreset) ? '收藏夹里的条目已是收藏' : '收藏选中条目'}" ${favoriteDisabled}>
          <i class="fa-regular fa-star" aria-hidden="true"></i>
          收藏
        </button>
        <button class="pm-selection-action pm-danger" type="button" data-action="entry-batch-delete" data-entry-kind="${kind}" ${deleteDisabled}>
          <i class="fa-solid fa-trash" aria-hidden="true"></i>
          删除
        </button>
      `
          : ''
      }
    </div>
  `;
}

function renderPresetActions(kind: 'source' | 'target', selectedPreset: string): string {
  const label = kind === 'source' ? '来源预设' : '目标预设';
  const disabled = isFavoritesPreset(selectedPreset) ? 'disabled' : '';
  const disabledTitle = isFavoritesPreset(selectedPreset) ? '收藏夹不是磁盘预设' : '';

  return `
    <div class="pm-preset-actions" aria-label="${label}操作">
      <button class="pm-preset-action" type="button" data-action="preset-copy" data-preset-pane="${kind}" title="${disabledTitle || `复制${label}`}" aria-label="复制${label}" ${disabled}>
        <i class="fa-solid fa-copy" aria-hidden="true"></i>
      </button>
      <button class="pm-preset-action" type="button" data-action="preset-rename" data-preset-pane="${kind}" title="${disabledTitle || `重命名${label}`}" aria-label="重命名${label}" ${disabled}>
        <i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>
      </button>
      <button class="pm-preset-action pm-danger" type="button" data-action="preset-delete" data-preset-pane="${kind}" title="${disabledTitle || `删除${label}`}" aria-label="删除${label}" ${disabled}>
        <i class="fa-solid fa-trash" aria-hidden="true"></i>
      </button>
    </div>
  `;
}

function renderPresetOptions(selectedPreset: string): string {
  const favoritesOption = `<option value="${FAVORITES_PRESET_VALUE}" ${isFavoritesPreset(selectedPreset) ? 'selected' : ''}>${FAVORITES_PRESET_LABEL}</option>`;
  const presetOptions = state.presetNames
    .map(
      name =>
        `<option value="${escapeAttr(name)}" ${name === selectedPreset ? 'selected' : ''}>${escapeHtml(name)}</option>`,
    )
    .join('');
  return `${favoritesOption}${presetOptions}`;
}

function renderFilterOptions(active: FilterValue): string {
  const options: Array<[FilterValue, string]> = [
    ['all', '全部'],
    ['enabled', '启用'],
    ['disabled', '禁用'],
    ['system', '系统'],
    ['user', '用户'],
    ['assistant', '助手'],
  ];

  return options
    .map(([value, label]) => `<option value="${value}" ${active === value ? 'selected' : ''}>${label}</option>`)
    .join('');
}

function renderEntryRow(
  kind: 'source' | 'target',
  entry: PromptEntry,
  index: number,
  comparePair: PromptComparePair | null,
): string {
  const selectedId = kind === 'source' ? state.selectedSourceId : state.selectedTargetId;
  const selected = selectedId === entry.id ? 'is-selected' : '';
  const multiSelectEnabled = isMultiSelectEnabled(kind);
  const multiSelected = isEntrySelected(kind, entry.id);
  const multiClass = multiSelectEnabled ? 'has-multi-select' : '';
  const multiSelectedClass = multiSelected ? 'is-multi-selected' : '';
  const compareClass = state.compareMode ? getCompareRowClass(comparePair) : '';
  const enabled = entry.enabled ? '启用' : '禁用';
  const contentLength = entry.content.length;
  const actions = renderRowActions(kind, entry);
  const draggable = state.compareMode ? 'false' : 'true';

  return `
    <div class="pm-row ${selected} ${multiClass} ${multiSelectedClass} ${compareClass}" role="button" tabindex="0" data-entry-kind="${kind}" data-id="${escapeAttr(entry.id)}" data-index="${index}" data-pm-tutorial="entry-row" draggable="${draggable}">
      <div class="pm-row-grip" data-drag-handle="true" aria-hidden="true" title="拖拽条目"><i class="fa-solid fa-grip-lines"></i></div>
      ${multiSelectEnabled ? renderEntrySelectionButton(kind, entry, multiSelected) : ''}
      <div class="pm-row-main">
        <div class="pm-row-title">${escapeHtml(entry.name)}</div>
        <div class="pm-row-meta">
          <span>${escapeHtml(entry.role)}</span>
          <span>${enabled}</span>
          <span>${contentLength} 字</span>
          ${renderCompareBadges(comparePair, kind)}
        </div>
      </div>
      ${renderRowToggle(kind, entry)}
      <div class="pm-row-actions" data-pm-tutorial="entry-actions">${actions}</div>
    </div>
  `;
}

function getComparePairForEntry(
  comparison: PromptCompareResult | null,
  kind: 'source' | 'target',
  id: string,
): PromptComparePair | null {
  if (!comparison) {
    return null;
  }
  return (kind === 'source' ? comparison.sourceById.get(id) : comparison.targetById.get(id)) ?? null;
}

function getCompareRowClass(pair: PromptComparePair | null): string {
  if (!pair) {
    return '';
  }
  if (pair.status === 'source_only' || pair.status === 'target_only') {
    return 'is-compare-only';
  }
  return pair.changedFields.includes('content') ? 'is-compare-content-different' : '';
}

interface CompareBadge {
  label: string;
  tone: 'strong' | 'soft';
}

interface CompareBadgeOptions {
  kind?: 'source' | 'target';
  includeSameContent?: boolean;
  emptyLabel?: string;
}

function renderCompareBadges(pair: PromptComparePair | null, kind: 'source' | 'target'): string {
  if (!state.compareMode) {
    return '';
  }
  return renderCompareStatusBadges(pair, { kind });
}

function renderCompareDetailBadges(pair: PromptComparePair | null): string {
  return renderCompareStatusBadges(pair, { includeSameContent: true, emptyLabel: '未选择' });
}

function renderCompareStatusBadges(pair: PromptComparePair | null, options: CompareBadgeOptions = {}): string {
  return getCompareStatusBadges(pair, options)
    .map(badge => renderCompareBadge(badge.label, badge.tone))
    .join('');
}

function getCompareStatusBadges(pair: PromptComparePair | null, options: CompareBadgeOptions): CompareBadge[] {
  if (!pair) {
    return options.emptyLabel ? [{ label: options.emptyLabel, tone: 'soft' }] : [];
  }

  if (pair.status === 'source_only') {
    return [{ label: options.kind === 'target' ? '未匹配' : '仅来源', tone: 'strong' }];
  }
  if (pair.status === 'target_only') {
    return [{ label: options.kind === 'source' ? '未匹配' : '仅目标', tone: 'strong' }];
  }

  const badges: CompareBadge[] = [];
  if (pair.matchKind === 'name') {
    badges.push({ label: '同名匹配', tone: 'soft' });
  }
  if (pair.changedFields.includes('content')) {
    badges.push({ label: '正文不同', tone: 'strong' });
  } else if (options.includeSameContent) {
    badges.push({ label: '正文相同', tone: 'soft' });
  }
  if (pair.changedFields.includes('name')) {
    badges.push({ label: '标题', tone: 'soft' });
  }
  if (pair.changedFields.includes('role')) {
    badges.push({ label: '角色', tone: 'soft' });
  }
  if (pair.changedFields.includes('enabled')) {
    badges.push({ label: '开关', tone: 'soft' });
  }
  return badges;
}

function renderCompareBadge(label: string, tone: 'strong' | 'soft'): string {
  return `<span class="pm-compare-badge ${tone}">${escapeHtml(label)}</span>`;
}

function filterEntriesByCompare(
  entries: PromptEntry[],
  comparison: PromptCompareResult | null,
  kind: 'source' | 'target',
): PromptEntry[] {
  if (!state.compareMode || state.compareFilter === 'all') {
    return entries;
  }
  return entries.filter(entry => passesCompareFilter(getComparePairForEntry(comparison, kind, entry.id), kind));
}

function passesCompareFilter(pair: PromptComparePair | null, kind: 'source' | 'target'): boolean {
  if (!pair) {
    return false;
  }
  if (state.compareFilter === 'same') {
    return pair.status === 'matched' && pair.changedFields.length === 0;
  }
  if (state.compareFilter === 'content') {
    return pair.status === 'matched' && pair.changedFields.includes('content');
  }
  if (state.compareFilter === 'source_only') {
    return kind === 'source' && pair.status === 'source_only';
  }
  if (state.compareFilter === 'target_only') {
    return kind === 'target' && pair.status === 'target_only';
  }
  if (state.compareFilter === 'metadata') {
    return pair.status === 'matched' && pair.changedFields.length > 0 && !pair.changedFields.includes('content');
  }
  return true;
}

function renderRowToggle(kind: 'source' | 'target', entry: PromptEntry): string {
  const nextState = entry.enabled ? '禁用' : '启用';
  const title = `当前${entry.enabled ? '启用' : '禁用'}，点击暂存为${nextState}，底部保存后生效`;
  const icon = entry.enabled ? 'fa-toggle-on' : 'fa-toggle-off';

  return `
    <button class="pm-row-toggle" type="button" data-action="entry-toggle-enabled" data-entry-kind="${kind}" data-id="${escapeAttr(entry.id)}" data-pm-tutorial="entry-toggle" aria-pressed="${entry.enabled ? 'true' : 'false'}" title="${title}" aria-label="${title}">
      <i class="fa-solid ${icon}" aria-hidden="true"></i>
    </button>
  `;
}

function renderEntrySelectionButton(kind: SelectableEntryKind, entry: PromptEntry, selected: boolean): string {
  const title = selected ? '取消选择条目' : '选择条目';
  const icon = selected ? 'fa-square-check' : 'fa-square';
  return `
    <button class="pm-row-select" type="button" data-action="entry-select-toggle" data-entry-kind="${kind}" data-id="${escapeAttr(entry.id)}" aria-pressed="${selected ? 'true' : 'false'}" title="${title}" aria-label="${title}">
      <i class="fa-regular ${icon}" aria-hidden="true"></i>
    </button>
  `;
}

function renderRowActions(kind: 'source' | 'target', entry: PromptEntry): string {
  const isFavoritesRow = kind === 'source' ? isFavoritesPreset(state.sourceName) : isFavoritesPreset(state.targetName);
  const favoriteAction = kind === 'source' ? 'favorite-source' : 'favorite-target';
  const deleteAction = kind === 'target' ? 'target-remove' : 'source-remove';
  const favoriteDisabled = isFavoritesRow || state.compareMode ? 'disabled' : '';
  const deleteDisabled = state.compareMode ? 'disabled' : '';
  const favoriteTitle = state.compareMode ? '比对模式下不可收藏' : isFavoritesRow ? '已在收藏夹' : '收藏条目';
  const deleteTitle = state.compareMode ? '比对模式下不可删除' : '删除条目';
  const favoriteIcon = isFavoritesRow ? 'fa-solid' : 'fa-regular';

  return `
    <button class="pm-row-action" type="button" data-action="${favoriteAction}" data-id="${escapeAttr(entry.id)}" title="${favoriteTitle}" aria-label="${favoriteTitle}" ${favoriteDisabled}>
      <i class="${favoriteIcon} fa-star" aria-hidden="true"></i>
    </button>
    <button class="pm-row-action pm-danger" type="button" data-action="${deleteAction}" data-id="${escapeAttr(entry.id)}" title="${deleteTitle}" aria-label="${deleteTitle}" ${deleteDisabled}>
      <i class="fa-solid fa-trash" aria-hidden="true"></i>
    </button>
  `;
}

function renderDetail(selection: DetailSelection | null, comparison: PromptCompareResult | null): string {
  const entry = selection?.entry;
  const comparePair = selection ? getComparePairForEntry(comparison, selection.kind, selection.entry.id) : null;
  if (state.compareMode) {
    return renderCompareDetail(selection, comparePair);
  }
  const editable =
    selection?.kind === 'source'
      ? Boolean(getEditableSourceDraft())
      : selection?.kind === 'target' && Boolean(state.targetDraft);
  const name = entry?.name ?? '未选择条目';
  const content = entry?.content ?? '';
  const role = entry?.role ?? 'system';

  return `
    <section class="pm-detail-pane" data-pane="preview" data-pm-tutorial="detail-pane">
      <div class="pm-pane-head">
        <h2>条目详情</h2>
        <span class="pm-count">${content.length} 字</span>
      </div>
      <div class="pm-detail-toolbar">
        <div class="pm-detail-title">${escapeHtml(name)}</div>
        <label class="pm-role-field">
          <span>角色</span>
          <select name="detailRole" ${editable ? '' : 'disabled'}>
            ${renderRoleOptions(role)}
          </select>
        </label>
      </div>
      <textarea name="detailContent" data-entry-id="${escapeAttr(entry?.id ?? '')}" data-entry-kind="${selection?.kind ?? ''}" ${editable ? '' : 'readonly'} spellcheck="false">${escapeHtml(content)}</textarea>
    </section>
  `;
}

function renderCompareDetail(selection: DetailSelection | null, pair: PromptComparePair | null): string {
  const sourceEntry = pair?.sourceEntry ?? (selection?.kind === 'source' ? selection.entry : undefined);
  const targetEntry = pair?.targetEntry ?? (selection?.kind === 'target' ? selection.entry : undefined);
  const title = sourceEntry?.name ?? targetEntry?.name ?? '未选择条目';
  const sourceLength = sourceEntry?.content.length ?? 0;
  const targetLength = targetEntry?.content.length ?? 0;

  return `
    <section class="pm-detail-pane pm-compare-detail" data-pane="preview" data-pm-tutorial="detail-pane">
      <div class="pm-pane-head">
        <h2>条目详情</h2>
        <span class="pm-count">比对</span>
      </div>
      <div class="pm-detail-toolbar">
        <div class="pm-detail-title">${escapeHtml(title)}</div>
        <div class="pm-compare-detail-status">${renderCompareDetailBadges(pair)}</div>
      </div>
      <div class="pm-compare-columns">
        ${renderCompareContentPane('source', sourceEntry, sourceLength, pair)}
        ${renderCompareContentPane('target', targetEntry, targetLength, pair)}
      </div>
    </section>
  `;
}

function renderCompareContentPane(
  side: 'source' | 'target',
  entry: PromptEntry | undefined,
  contentLength: number,
  pair: PromptComparePair | null,
): string {
  const label = side === 'source' ? '来源' : '目标';
  const role = entry?.role ?? '-';
  const enabled = entry ? (entry.enabled ? '启用' : '禁用') : '-';
  const name = entry?.name ?? `此侧无匹配条目`;
  const contentName = `compare${side === 'source' ? 'Source' : 'Target'}Content`;
  const roleName = `compare${side === 'source' ? 'Source' : 'Target'}Role`;
  const editable = side === 'source' ? Boolean(entry && getEditableSourceDraft()) : Boolean(entry && state.targetDraft);

  return `
    <div class="pm-compare-pane" data-compare-side="${side}">
      <div class="pm-compare-pane-head">
        <strong>${label}</strong>
        <span>${enabled} · ${contentLength} 字</span>
      </div>
      <div class="pm-compare-pane-title-row">
        <div class="pm-compare-pane-title">${escapeHtml(name)}</div>
        ${
          entry
            ? `<label class="pm-compare-role-field">
          <span>角色</span>
          <select name="${roleName}" data-entry-kind="${side}" data-entry-id="${escapeAttr(entry.id)}" ${editable ? '' : 'disabled'}>
            ${renderRoleOptions(role)}
          </select>
        </label>`
            : ''
        }
      </div>
      ${
        entry
          ? `<div class="pm-compare-editor" data-compare-editor="${contentName}">
          <div class="pm-compare-text pm-compare-content-input" data-compare-content="${contentName}" data-entry-kind="${side}" data-entry-id="${escapeAttr(entry.id)}" data-compare-editable="${editable ? 'true' : 'false'}" data-compare-highlight="${contentName}" role="textbox" aria-multiline="true" aria-readonly="${editable ? 'false' : 'true'}" aria-label="${label}正文" contenteditable="${editable ? 'true' : 'false'}" spellcheck="false">${renderCompareContent(side, entry, pair)}</div>
        </div>`
          : '<div class="pm-compare-empty">无匹配条目</div>'
      }
    </div>
  `;
}

interface CompareTextSegment {
  text: string;
  changed: boolean;
}

function renderCompareContent(side: 'source' | 'target', entry: PromptEntry, pair: PromptComparePair | null): string {
  if (
    !pair ||
    pair.status !== 'matched' ||
    !pair.changedFields.includes('content') ||
    !pair.sourceEntry ||
    !pair.targetEntry
  ) {
    return escapeHtml(normalizeDisplayContent(entry.content));
  }

  const segments = diffCompareText(pair.sourceEntry.content, pair.targetEntry.content);
  const sideSegments = side === 'source' ? segments.source : segments.target;
  return sideSegments
    .map(segment => {
      const content = escapeHtml(segment.text);
      return segment.changed ? `<mark class="pm-compare-token">${content}</mark>` : content;
    })
    .join('');
}

function diffCompareText(
  sourceContent: string,
  targetContent: string,
): { source: CompareTextSegment[]; target: CompareTextSegment[] } {
  const sourceTokens = tokenizeCompareText(normalizeDisplayContent(sourceContent));
  const targetTokens = tokenizeCompareText(normalizeDisplayContent(targetContent));
  if (!sourceTokens.length && !targetTokens.length) {
    return { source: [], target: [] };
  }

  if (sourceTokens.length * targetTokens.length > 260_000) {
    return diffCompareTextByEdges(sourceTokens, targetTokens);
  }

  const rows = sourceTokens.length + 1;
  const columns = targetTokens.length + 1;
  const table = new Uint16Array(rows * columns);
  const cell = (row: number, column: number) => row * columns + column;

  for (let sourceIndex = sourceTokens.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
    for (let targetIndex = targetTokens.length - 1; targetIndex >= 0; targetIndex -= 1) {
      table[cell(sourceIndex, targetIndex)] =
        sourceTokens[sourceIndex] === targetTokens[targetIndex]
          ? table[cell(sourceIndex + 1, targetIndex + 1)] + 1
          : Math.max(table[cell(sourceIndex + 1, targetIndex)], table[cell(sourceIndex, targetIndex + 1)]);
    }
  }

  const sourceSegments: CompareTextSegment[] = [];
  const targetSegments: CompareTextSegment[] = [];
  let sourceIndex = 0;
  let targetIndex = 0;

  while (sourceIndex < sourceTokens.length || targetIndex < targetTokens.length) {
    if (
      sourceIndex < sourceTokens.length &&
      targetIndex < targetTokens.length &&
      sourceTokens[sourceIndex] === targetTokens[targetIndex]
    ) {
      pushCompareSegment(sourceSegments, sourceTokens[sourceIndex], false);
      pushCompareSegment(targetSegments, targetTokens[targetIndex], false);
      sourceIndex += 1;
      targetIndex += 1;
      continue;
    }

    if (
      targetIndex >= targetTokens.length ||
      (sourceIndex < sourceTokens.length &&
        table[cell(sourceIndex + 1, targetIndex)] >= table[cell(sourceIndex, targetIndex + 1)])
    ) {
      pushCompareSegment(sourceSegments, sourceTokens[sourceIndex], true);
      sourceIndex += 1;
      continue;
    }

    pushCompareSegment(targetSegments, targetTokens[targetIndex], true);
    targetIndex += 1;
  }

  return { source: sourceSegments, target: targetSegments };
}

function diffCompareTextByEdges(
  sourceTokens: string[],
  targetTokens: string[],
): { source: CompareTextSegment[]; target: CompareTextSegment[] } {
  let prefixLength = 0;
  while (
    prefixLength < sourceTokens.length &&
    prefixLength < targetTokens.length &&
    sourceTokens[prefixLength] === targetTokens[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < sourceTokens.length - prefixLength &&
    suffixLength < targetTokens.length - prefixLength &&
    sourceTokens[sourceTokens.length - 1 - suffixLength] === targetTokens[targetTokens.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const sourceSegments = tokensToSegments(sourceTokens, prefixLength, suffixLength);
  const targetSegments = tokensToSegments(targetTokens, prefixLength, suffixLength);
  return { source: sourceSegments, target: targetSegments };
}

function tokensToSegments(tokens: string[], prefixLength: number, suffixLength: number): CompareTextSegment[] {
  const segments: CompareTextSegment[] = [];
  tokens.forEach((token, index) => {
    pushCompareSegment(segments, token, index >= prefixLength && index < tokens.length - suffixLength);
  });
  return segments;
}

function tokenizeCompareText(content: string): string[] {
  const tokens = content.match(/\s+|[A-Za-z0-9_]+|[\u3400-\u9fff]+|[^\sA-Za-z0-9_\u3400-\u9fff]/gu);
  return tokens ?? [];
}

function pushCompareSegment(segments: CompareTextSegment[], text: string | undefined, changed: boolean): void {
  if (!text) {
    return;
  }
  const last = segments[segments.length - 1];
  if (last?.changed === changed) {
    last.text += text;
    return;
  }
  segments.push({ text, changed });
}

function normalizeDisplayContent(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

function renderRoleOptions(active: string): string {
  const labels: Record<DetailRole, string> = {
    system: 'system',
    user: 'user',
    assistant: 'assistant',
  };
  const roles = (Object.keys(labels) as DetailRole[]).includes(active as DetailRole)
    ? Object.keys(labels)
    : [active, ...Object.keys(labels)];
  return roles
    .map(
      role =>
        `<option value="${escapeAttr(role)}" ${role === active ? 'selected' : ''}>${escapeHtml(labels[role as DetailRole] ?? role)}</option>`,
    )
    .join('');
}

function renderEmpty(kind: string): string {
  const label = kind === 'favorite' ? '暂无收藏' : '没有匹配条目';
  return `<div class="pm-empty">${label}</div>`;
}

function getStatusText(sourceCount: number, targetCount: number): string {
  if (!state.presetNames.length) {
    return '未发现 OpenAI 预设';
  }
  return `来源 ${sourceCount} 条，目标 ${targetCount} 条，收藏 ${state.favorites.length} 条`;
}

function getVersionButtonClass(): string {
  return [versionState.checking ? 'is-checking' : '', isVersionUpdateAvailable() ? 'is-available' : '']
    .filter(Boolean)
    .join(' ');
}

function getVersionButtonTitle(): string {
  if (versionState.checking) {
    return '正在检查脚本版本';
  }
  const latestVersion = getLatestVersion();
  if (latestVersion && compareVersionTags(latestVersion, APP_VERSION) > 0) {
    return `发现新版本 ${latestVersion}`;
  }
  return '版本管理';
}

function getVersionButtonIcon(): string {
  return versionState.checking ? 'fa-rotate pm-spin' : 'fa-clock-rotate-left';
}

function getLatestVersion(): string | null {
  return versionState.catalog?.latestVersion ?? versionState.catalog?.versions[0] ?? null;
}

function isVersionUpdateAvailable(): boolean {
  const latestVersion = getLatestVersion();
  return latestVersion ? compareVersionTags(latestVersion, APP_VERSION) > 0 : false;
}

function getVersionRows(): string[] {
  const versions = versionState.catalog?.versions ?? [];
  return versions.includes(APP_VERSION) ? versions : [APP_VERSION, ...versions];
}

function getSelectedVersionImportTemplate(): string {
  if (versionState.selectedSourceId === CUSTOM_VERSION_IMPORT_SOURCE_ID) {
    return versionState.customTemplate;
  }
  return (
    VERSION_IMPORT_SOURCES.find(source => source.id === versionState.selectedSourceId)?.template ??
    DEFAULT_VERSION_IMPORT_TEMPLATE
  );
}

function validateSelectedVersionImportTemplate(): ReturnType<typeof validateVersionImportTemplate> {
  return validateVersionImportTemplate(getSelectedVersionImportTemplate());
}

function createVersionImportStatement(version: string): string {
  return `import '${createScriptImportUrl(version, getSelectedVersionImportTemplate())}';`;
}

function getSelectedVersionImportSourceDescription(): string {
  if (versionState.selectedSourceId === CUSTOM_VERSION_IMPORT_SOURCE_ID) {
    return '自定义模板必须包含 {version}，并指向本仓库的 dist/preset-manager/index.js。';
  }
  return VERSION_IMPORT_SOURCES.find(source => source.id === versionState.selectedSourceId)?.description ?? '';
}

function formatScriptVersionSource(source: ScriptVersionSource): string {
  if (source.status === 'versioned') {
    return `${source.specifier}，${formatScriptScope(source.scope)}`;
  }
  if (source.status === 'main') {
    return `main，${formatScriptScope(source.scope)}`;
  }
  return source.message;
}

function formatScriptScope(scope: string): string {
  if (scope === 'global') return '全局脚本';
  if (scope === 'preset') return '预设脚本';
  if (scope === 'character') return '角色脚本';
  return scope;
}

function formatVersionRelation(relation: VersionRelation | null): string {
  if (relation === 'newer') return '可更新';
  if (relation === 'older') return '可回退';
  return '当前';
}

function formatVersionSwitchAction(relation: VersionRelation | null): string {
  if (relation === 'newer') return '更新';
  if (relation === 'older') return '回退';
  return '切换为此版本';
}

function getSourceEntries(): PromptEntry[] {
  return filterEntries(getSourceCompareEntries(), state.sourceQuery, state.sourceFilter);
}

function getTargetEntries(): PromptEntry[] {
  return filterEntries(getTargetCompareEntries(), state.targetQuery, state.targetFilter);
}

function getSourceCompareEntries(): PromptEntry[] {
  const preset = getEditableSourceDraft();
  return preset ? listPromptEntries(deepClone(preset)) : [];
}

function getTargetCompareEntries(): PromptEntry[] {
  return state.targetDraft ? listPromptEntries(state.targetDraft) : [];
}

function filterEntries(entries: PromptEntry[], query: string, filter: FilterValue): PromptEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return entries.filter(entry => {
    if (filter === 'enabled' && !entry.enabled) {
      return false;
    }
    if (filter === 'disabled' && entry.enabled) {
      return false;
    }
    if (['system', 'user', 'assistant'].includes(filter) && entry.role !== filter) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return `${entry.name}\n${entry.content}\n${entry.role}`.toLocaleLowerCase().includes(normalizedQuery);
  });
}

function getDetailSelection(): DetailSelection | null {
  const target = getTargetEntries().find(entry => entry.id === state.selectedTargetId);
  if (target) {
    return { kind: 'target', entry: target };
  }
  const source = getSourceEntries().find(entry => entry.id === state.selectedSourceId);
  return source ? { kind: 'source', entry: source } : null;
}

function getEntriesForKind(kind: SelectableEntryKind): PromptEntry[] {
  return kind === 'source' ? getSourceEntries() : getTargetEntries();
}

function toggleCompareMode(): void {
  state.compareMode = !state.compareMode;
  if (state.compareMode) {
    setMultiSelectEnabled('source', false);
    setMultiSelectEnabled('target', false);
    const selectedKind = state.selectedTargetId ? 'target' : state.selectedSourceId ? 'source' : null;
    const selectedId = selectedKind === 'target' ? state.selectedTargetId : state.selectedSourceId;
    if (selectedKind && selectedId) {
      selectCompareEntryById(selectedKind, selectedId);
    }
    pointerDrag = null;
    clearDropMarkers();
    state.notice = '已开启比对模式';
  } else {
    state.compareFilter = 'all';
    state.notice = '已关闭比对模式';
  }
  requestScrollSelectedRowOnNextRender();
  render();
}

function setCompareFilter(filter: string | undefined): void {
  if (!isCompareFilterValue(filter)) {
    return;
  }
  state.compareMode = true;
  state.compareFilter = state.compareFilter === filter ? 'all' : filter;
  requestScrollSelectedRowOnNextRender();
  render();
}

function isCompareFilterValue(value: string | undefined): value is CompareFilterValue {
  return ['same', 'content', 'source_only', 'target_only', 'metadata'].includes(value ?? '');
}

function isMultiSelectEnabled(kind: SelectableEntryKind): boolean {
  return kind === 'source' ? state.sourceMultiSelect : state.targetMultiSelect;
}

function setMultiSelectEnabled(kind: SelectableEntryKind, enabled: boolean): void {
  if (kind === 'source') {
    state.sourceMultiSelect = enabled;
  } else {
    state.targetMultiSelect = enabled;
  }
  if (!enabled) {
    clearEntrySelection(kind);
  }
}

function toggleMultiSelect(kind: SelectableEntryKind): void {
  setMultiSelectEnabled(kind, !isMultiSelectEnabled(kind));
  render();
}

function getSelectedEntryIds(kind: SelectableEntryKind): string[] {
  return kind === 'source' ? state.selectedSourceIds : state.selectedTargetIds;
}

function setSelectedEntryIds(kind: SelectableEntryKind, ids: string[]): void {
  const availableIds = new Set(getEntriesForKind(kind).map(entry => entry.id));
  const nextIds = dedupeStrings(ids).filter(id => availableIds.has(id));
  if (kind === 'source') {
    state.selectedSourceIds = nextIds;
  } else {
    state.selectedTargetIds = nextIds;
  }
}

function clearEntrySelection(kind: SelectableEntryKind): void {
  if (kind === 'source') {
    state.selectedSourceIds = [];
  } else {
    state.selectedTargetIds = [];
  }
}

function pruneEntrySelections(): void {
  setSelectedEntryIds('source', state.selectedSourceIds);
  setSelectedEntryIds('target', state.selectedTargetIds);
}

function isEntrySelected(kind: SelectableEntryKind, id: string): boolean {
  return getSelectedEntryIds(kind).includes(id);
}

function toggleEntrySelection(kind: SelectableEntryKind, id: string): void {
  const selectedIds = getSelectedEntryIds(kind);
  const nextIds = selectedIds.includes(id) ? selectedIds.filter(selectedId => selectedId !== id) : [...selectedIds, id];
  setSelectedEntryIds(kind, nextIds);
  if (kind === 'source') {
    state.selectedSourceId = id;
    state.selectedTargetId = '';
  } else {
    state.selectedTargetId = id;
    state.selectedSourceId = '';
  }
}

function toggleEntrySelectionFromAction(element: HTMLElement): void {
  const kind = getEntryKindFromAction(element);
  toggleEntrySelection(kind, element.dataset.id ?? '');
  render();
}

function selectAllVisibleEntries(kind: SelectableEntryKind): void {
  const visibleIds = getVisibleEntriesForKind(kind).map(entry => entry.id);
  setSelectedEntryIds(kind, visibleIds);
  render();
}

function getVisibleEntriesForKind(kind: SelectableEntryKind): PromptEntry[] {
  return kind === 'source'
    ? filterEntries(getSourceEntries(), state.sourceQuery, state.sourceFilter)
    : filterEntries(getTargetEntries(), state.targetQuery, state.targetFilter);
}

function getSelectedEntries(kind: SelectableEntryKind): PromptEntry[] {
  const selectedIds = new Set(getSelectedEntryIds(kind));
  return getEntriesForKind(kind).filter(entry => selectedIds.has(entry.id));
}

function getDragEntryIds(kind: EntryKind, id: string): string[] {
  if (kind !== 'source' && kind !== 'target') {
    return [id];
  }
  const selectedIds = getSelectedEntryIds(kind);
  if (isMultiSelectEnabled(kind) && selectedIds.includes(id)) {
    return getEntriesForKind(kind)
      .map(entry => entry.id)
      .filter(entryId => selectedIds.includes(entryId));
  }
  return [id];
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    if (!value || seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function onRootClick(event: MouseEvent): void {
  const target = toElement(event.target);
  if (!target) {
    return;
  }

  if (suppressNextClick) {
    suppressNextClick = false;
    if (target.closest('.pm-row')) {
      event.preventDefault();
      return;
    }
  }

  const actionElement = target.closest<HTMLElement>('[data-action]');
  const row = target.closest<HTMLElement>('.pm-row');

  if (actionElement?.classList.contains('pm-version-overlay') && target.closest('.pm-version-box')) {
    return;
  }

  if (actionElement) {
    event.preventDefault();
    void handleAction(actionElement.dataset.action ?? '', actionElement);
    return;
  }

  if (row) {
    selectRow(row);
  }
}

function onRootChange(event: Event): void {
  const target = toSelectElement(event.target);
  if (!target) {
    return;
  }

  if (target.name === 'sourceName') {
    if (
      state.sourceDirty &&
      target.value !== state.sourceName &&
      !window.confirm('切换来源预设会放弃当前未保存修改。继续切换？')
    ) {
      target.value = state.sourceName;
      return;
    }
    state.sourceName = target.value;
    saveLastSourceName();
    resetSourceDraft();
  }

  if (target.name === 'targetName') {
    if (
      state.targetDirty &&
      target.value !== state.targetName &&
      !window.confirm('切换目标预设会放弃当前未保存修改。继续切换？')
    ) {
      target.value = state.targetName;
      return;
    }
    state.targetName = target.value;
    resetTargetDraft();
  }

  if (target.name === 'sourceFilter') {
    state.sourceFilter = target.value as FilterValue;
  }

  if (target.name === 'targetFilter') {
    state.targetFilter = target.value as FilterValue;
  }

  if (target.name === 'detailRole') {
    updateDetailRole(target.value);
  }

  if (target.name === 'compareSourceRole') {
    updateComparePaneRole('source', target.dataset.entryId ?? '', target.value);
  }

  if (target.name === 'compareTargetRole') {
    updateComparePaneRole('target', target.dataset.entryId ?? '', target.value);
  }

  if (target.name === 'versionImportSource') {
    updateVersionImportSource(target.value);
  }

  render();
}

function onRootInput(event: Event): void {
  const compareEditor = getCompareContentEditor(event.target);
  if (compareEditor) {
    updateCompareEditorState(compareEditor);
    if (isComposingInput || ('isComposing' in event && Boolean((event as InputEvent).isComposing))) {
      return;
    }
    scheduleCompareTextRender(compareEditor);
    return;
  }

  const target = toInputElement(event.target) ?? toTextAreaElement(event.target);
  if (!target) {
    return;
  }

  updateTextControlState(target);

  if (isComposingInput || ('isComposing' in event && Boolean((event as InputEvent).isComposing))) {
    return;
  }

  if (isCompareContentControl(target)) {
    scheduleCompareTextRender(target);
    return;
  }

  renderPreservingTextControl(target);
}

function onRootScroll(event: Event): void {
  const target = toElement(event.target);
  if (target && isCompareContentEditor(target as HTMLElement)) {
    rememberCompareContentScroll(target as HTMLElement);
  }
}

function onCompositionStart(event: CompositionEvent): void {
  if (getCompareContentEditor(event.target)) {
    isComposingInput = true;
    return;
  }

  const target = toInputElement(event.target) ?? toTextAreaElement(event.target);
  if (target && isManagedTextControl(target)) {
    isComposingInput = true;
  }
}

function onCompositionEnd(event: CompositionEvent): void {
  const compareEditor = getCompareContentEditor(event.target);
  if (compareEditor) {
    isComposingInput = false;
    updateCompareEditorState(compareEditor);
    scheduleCompareTextRender(compareEditor);
    return;
  }

  const target = toInputElement(event.target) ?? toTextAreaElement(event.target);
  if (!target || !isManagedTextControl(target)) {
    isComposingInput = false;
    return;
  }

  isComposingInput = false;
  updateTextControlState(target);
  if (isCompareContentControl(target)) {
    scheduleCompareTextRender(target);
    return;
  }
  renderPreservingTextControl(target);
}

function updateTextControlState(target: HTMLInputElement | HTMLTextAreaElement): void {
  if (target.name === 'sourceQuery') {
    state.sourceQuery = target.value;
  }
  if (target.name === 'targetQuery') {
    state.targetQuery = target.value;
  }
  if (target.name === 'favoriteQuery') {
    state.favoriteQuery = target.value;
  }
  if (target.name === 'detailContent') {
    updateDetailContent(target.value);
  }
  if (target.name === 'compareSourceContent') {
    updateComparePaneContent('source', target.dataset.entryId ?? '', target.value);
  }
  if (target.name === 'compareTargetContent') {
    updateComparePaneContent('target', target.dataset.entryId ?? '', target.value);
  }
  if (target.name === 'versionCustomTemplate') {
    versionState.customTemplate = target.value;
    persistVersionImportSourcePreference();
  }
}

function isManagedTextControl(target: HTMLInputElement | HTMLTextAreaElement): boolean {
  return [
    'sourceQuery',
    'targetQuery',
    'favoriteQuery',
    'detailContent',
    'compareSourceContent',
    'compareTargetContent',
    'versionCustomTemplate',
  ].includes(target.name);
}

function isCompareContentControl(target: HTMLInputElement | HTMLTextAreaElement): target is HTMLTextAreaElement {
  return target.tagName === 'TEXTAREA' && isCompareContentName(target.name);
}

function getCompareContentEditor(target: EventTarget | null): HTMLElement | null {
  const element = toElement(target);
  const editor = element?.closest<HTMLElement>('.pm-compare-content-input');
  return editor && isCompareContentEditor(editor) ? editor : null;
}

function updateCompareEditorState(editor: HTMLElement): void {
  const kind = editor.dataset.entryKind;
  if (kind !== 'source' && kind !== 'target') {
    return;
  }
  updateComparePaneContent(kind, editor.dataset.entryId ?? '', editor.innerText);
  rememberCompareContentScroll(editor);
}

function scheduleCompareTextRender(target: HTMLElement): void {
  const targetWindow = target.ownerDocument.defaultView ?? window;
  if (compareTextRenderTimer !== null) {
    targetWindow.clearTimeout(compareTextRenderTimer);
  }

  compareTextRenderTimer = targetWindow.setTimeout(() => {
    compareTextRenderTimer = null;
    if (target.isConnected) {
      if (isCompareContentEditor(target)) {
        renderPreservingCompareContentEditor(target);
        return;
      }
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        renderPreservingTextControl(target);
        return;
      }
      return;
    }
    render();
  }, COMPARE_TEXT_RENDER_DEBOUNCE_MS);
}

function renderPreservingCompareContentEditor(target: HTMLElement): void {
  const key = getCompareContentScrollKey(target);
  const scrollTop = target.scrollTop;
  const scrollLeft = target.scrollLeft;
  const selection = captureContentEditableSelection(target);
  const targetDocument = target.ownerDocument ?? getMountDocument();

  render();

  const root = targetDocument.getElementById(ROOT_ID);
  const replacement = root ? findScrollElement(root, key) : null;
  if (!replacement || !isCompareContentEditor(replacement)) {
    return;
  }

  replacement.focus();
  replacement.scrollTop = scrollTop;
  replacement.scrollLeft = scrollLeft;
  rememberCompareContentScroll(replacement);
  if (selection) {
    restoreContentEditableSelection(replacement, selection);
  }
}

function captureContentEditableSelection(root: HTMLElement): { start: number; end: number } | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }

  return {
    start: getTextOffset(root, range.startContainer, range.startOffset),
    end: getTextOffset(root, range.endContainer, range.endOffset),
  };
}

function getTextOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function restoreContentEditableSelection(root: HTMLElement, selection: { start: number; end: number }): void {
  const range = root.ownerDocument.createRange();
  const start = findTextPosition(root, selection.start);
  const end = findTextPosition(root, selection.end);
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);

  const activeSelection = root.ownerDocument.getSelection();
  activeSelection?.removeAllRanges();
  activeSelection?.addRange(range);
}

function findTextPosition(root: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let lastTextNode: Text | null = null;

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    lastTextNode = textNode;
    if (remaining <= textNode.data.length) {
      return { node: textNode, offset: remaining };
    }
    remaining -= textNode.data.length;
  }

  if (lastTextNode) {
    return { node: lastTextNode, offset: lastTextNode.data.length };
  }
  return { node: root, offset: 0 };
}

function renderPreservingTextControl(target: HTMLInputElement | HTMLTextAreaElement): void {
  const name = target.name;
  const selectionStart = target.selectionStart;
  const selectionEnd = target.selectionEnd;
  const scrollTop = target.scrollTop;
  const targetDocument = target.ownerDocument ?? getMountDocument();
  const selector =
    target.tagName === 'TEXTAREA'
      ? `#${ROOT_ID} textarea[name="${CSS.escape(name)}"]`
      : `#${ROOT_ID} input[name="${CSS.escape(name)}"]`;

  render();

  const replacement = targetDocument.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!replacement) {
    return;
  }

  replacement.focus();
  replacement.scrollTop = scrollTop;
  if (replacement.tagName === 'TEXTAREA') {
    replacement.scrollLeft = target.scrollLeft;
  }
  if (selectionStart !== null && selectionEnd !== null) {
    replacement.setSelectionRange(selectionStart, selectionEnd);
  }
}

function onKeyDown(event: KeyboardEvent): void {
  const target = toElement(event.target);
  const row = target?.closest<HTMLElement>('.pm-row');
  if (!row || !['Enter', ' '].includes(event.key)) {
    return;
  }
  event.preventDefault();
  selectRow(row);
}

async function handleAction(action: string, element: HTMLElement): Promise<void> {
  clearMessage();

  if (state.compareMode && isCompareReadOnlyBlockedAction(action)) {
    state.notice = '比对模式下不支持这个操作';
    render();
    return;
  }

  switch (action) {
    case 'backdrop-close':
    case 'close':
      closeManager();
      return;
    case 'start-tutorial':
      presetManagerTutorial.start({ manual: true, interrupt: true });
      return;
    case 'open-version-manager':
      openVersionManager();
      return;
    case 'close-version-manager':
      closeVersionManager();
      return;
    case 'refresh-version-manager':
      await refreshVersionManager();
      return;
    case 'version-latest':
      requestVersionSwitch(getLatestVersion() ?? '');
      return;
    case 'version-select':
      requestVersionSwitch(element.dataset.version ?? '');
      return;
    case 'clear-version-target':
      versionState.targetVersion = '';
      versionState.message = '';
      versionState.messageTone = '';
      render();
      return;
    case 'confirm-version-switch':
      await confirmVersionSwitch();
      return;
    case 'copy-version-import':
      await copyVersionImportStatement();
      return;
    case 'reload-page':
      reloadPageForVersionChange();
      return;
    case 'tab':
      state.activeTab = (element.dataset.tab as MobileTab | undefined) ?? 'source';
      render();
      return;
    case 'toggle-compare':
      toggleCompareMode();
      return;
    case 'set-compare-filter':
      setCompareFilter(element.dataset.compareFilter);
      return;
    case 'select-source':
    case 'select-target':
      return;
    case 'preset-copy':
      await copySelectedPreset(getPresetPaneFromAction(element));
      return;
    case 'preset-rename':
      await renameSelectedPreset(getPresetPaneFromAction(element));
      return;
    case 'preset-delete':
      await deleteSelectedPreset(getPresetPaneFromAction(element));
      return;
    case 'entry-multi-toggle':
      toggleMultiSelect(getEntryKindFromAction(element));
      return;
    case 'entry-select-toggle':
      toggleEntrySelectionFromAction(element);
      return;
    case 'entry-select-all':
      selectAllVisibleEntries(getEntryKindFromAction(element));
      return;
    case 'entry-clear-selection':
      clearEntrySelection(getEntryKindFromAction(element));
      render();
      return;
    case 'entry-batch-favorite':
      await favoriteSelectedEntries(getEntryKindFromAction(element));
      return;
    case 'entry-batch-delete':
      removeSelectedEntries(getEntryKindFromAction(element));
      return;
    case 'entry-toggle-enabled':
      toggleEntryEnabled(getEntryKindFromAction(element), element.dataset.id ?? '');
      return;
    case 'source-remove':
      removeSource(element.dataset.id ?? '');
      return;
    case 'copy-source':
      copySourceById(element.dataset.id ?? '');
      return;
    case 'copy-selected':
      copySourceById(state.selectedSourceId);
      return;
    case 'favorite-source':
      await favoriteEntryById('source', element.dataset.id ?? '');
      return;
    case 'favorite-target':
      await favoriteEntryById('target', element.dataset.id ?? '');
      return;
    case 'favorite-selected':
      await favoriteEntryById('source', state.selectedSourceId);
      return;
    case 'target-up':
      moveTarget(element.dataset.id ?? '', -1);
      return;
    case 'target-down':
      moveTarget(element.dataset.id ?? '', 1);
      return;
    case 'target-remove':
      removeTarget(element.dataset.id ?? '');
      return;
    case 'insert-favorite':
      insertFavoriteById(state.selectedFavoriteId);
      return;
    case 'insert-favorite-id':
      insertFavoriteById(element.dataset.id ?? '');
      return;
    case 'delete-favorite':
      await deleteFavorite(element.dataset.id ?? '');
      return;
    case 'reset-draft':
      resetSourceDraft();
      resetTargetDraft();
      state.notice = '已放弃修改';
      render();
      return;
    case 'save':
      await saveTargetDraft();
      return;
    default:
      return;
  }
}

function isCompareReadOnlyBlockedAction(action: string): boolean {
  return [
    'preset-copy',
    'preset-rename',
    'preset-delete',
    'entry-multi-toggle',
    'entry-select-toggle',
    'entry-select-all',
    'entry-clear-selection',
    'entry-batch-favorite',
    'entry-batch-delete',
    'source-remove',
    'copy-source',
    'copy-selected',
    'favorite-source',
    'favorite-target',
    'favorite-selected',
    'target-up',
    'target-down',
    'target-remove',
    'insert-favorite',
    'insert-favorite-id',
    'delete-favorite',
  ].includes(action);
}

function closeManager(): void {
  if (state.dirty && !window.confirm('关闭会放弃当前未保存修改。继续关闭？')) {
    render();
    return;
  }

  if (state.dirty) {
    resetSourceDraft();
    resetTargetDraft();
  }

  presetManagerTutorial.close();
  state.isOpen = false;
  render();
}

function openVersionManager(): void {
  loadVersionImportSourcePreference();
  refreshScriptVersionSource();
  versionState.open = true;
  versionState.message = '';
  versionState.messageTone = '';
  render();
  if (!versionState.catalog) {
    void checkVersionCatalog({ silent: false });
  }
}

function closeVersionManager(): void {
  versionState.open = false;
  versionState.targetVersion = '';
  versionState.message = '';
  versionState.messageTone = '';
  render();
}

async function refreshVersionManager(): Promise<void> {
  refreshScriptVersionSource();
  await checkVersionCatalog({ silent: false, force: true });
}

async function checkVersionCatalog(options: { silent: boolean; force?: boolean }): Promise<void> {
  if (versionState.checking && !options.force) {
    return;
  }

  versionState.checking = true;
  if (versionState.open && !options.silent) {
    render();
  }

  try {
    versionState.catalog = await fetchVersionCatalog({ currentVersion: APP_VERSION, limit: 20 });
  } catch (error) {
    versionState.catalog = {
      latestVersion: null,
      versions: [APP_VERSION],
      checkedAt: Date.now(),
      errorMessage: error instanceof Error ? error.message : '版本检查失败。',
    };
  } finally {
    versionState.checking = false;
  }

  if (versionState.open || !options.silent) {
    render();
  }
}

function refreshScriptVersionSource(): void {
  const source = inspectCurrentScriptVersion();
  versionState.source = source;
  syncVersionImportSourceFromScript(source);
}

function syncVersionImportSourceFromScript(source: ScriptVersionSource): void {
  if (source.status !== 'versioned' && source.status !== 'main') {
    return;
  }

  const knownSource = getKnownVersionImportSourceByTemplate(source.importTemplate);
  if (knownSource) {
    versionState.selectedSourceId = knownSource.id;
    versionState.customTemplate = source.importTemplate;
    return;
  }

  versionState.selectedSourceId = CUSTOM_VERSION_IMPORT_SOURCE_ID;
  versionState.customTemplate = source.importTemplate;
}

function updateVersionImportSource(value: string): void {
  if (value === CUSTOM_VERSION_IMPORT_SOURCE_ID) {
    versionState.selectedSourceId = CUSTOM_VERSION_IMPORT_SOURCE_ID;
    if (!versionState.customTemplate) {
      versionState.customTemplate = versionState.source?.importTemplate ?? DEFAULT_VERSION_IMPORT_TEMPLATE;
    }
  } else if (VERSION_IMPORT_SOURCES.some(source => source.id === value)) {
    versionState.selectedSourceId = value as VersionImportSourceId;
  }
  versionState.message = '';
  versionState.messageTone = '';
  persistVersionImportSourcePreference();
}

function requestVersionSwitch(version: string): void {
  if (!version) {
    return;
  }
  versionState.targetVersion = version;
  versionState.message = '';
  versionState.messageTone = '';
  render();
}

async function confirmVersionSwitch(): Promise<void> {
  const targetVersion = versionState.targetVersion;
  if (!targetVersion) {
    return;
  }

  const validation = validateSelectedVersionImportTemplate();
  if (!validation.ok) {
    versionState.message = validation.message;
    versionState.messageTone = 'warning';
    showToast('error', validation.message);
    render();
    return;
  }

  const result = await replaceCurrentScriptVersion(targetVersion, { importTemplate: validation.template });
  if (result.ok) {
    versionState.source = inspectCurrentScriptVersion();
    versionState.message = `已切换到 ${result.targetVersion}，刷新页面后生效。`;
    versionState.messageTone = 'success';
    persistVersionImportSourcePreference();
    showToast('success', versionState.message);
  } else {
    versionState.source = result.source;
    versionState.message = `${result.reason} 可复制导入语句手动替换。`;
    versionState.messageTone = 'warning';
    showToast('error', result.reason);
  }
  render();
}

async function copyVersionImportStatement(): Promise<void> {
  if (!versionState.targetVersion) {
    return;
  }

  const statement = createVersionImportStatement(versionState.targetVersion);
  try {
    await navigator.clipboard.writeText(statement);
    versionState.message = '已复制导入语句。';
    versionState.messageTone = 'success';
    showToast('success', versionState.message);
  } catch {
    versionState.message = `复制失败，请手动复制：${statement}`;
    versionState.messageTone = 'warning';
    showToast('error', '复制失败');
  }
  render();
}

function reloadPageForVersionChange(): void {
  const runtime = globalThis as unknown as RuntimeHost;
  if (typeof runtime.triggerSlash === 'function') {
    void runtime.triggerSlash('/reload-page').catch(() => window.location.reload());
    return;
  }
  window.location.reload();
}

function loadVersionImportSourcePreference(): void {
  const preference = readVersionImportSourcePreference();
  if (!preference) {
    return;
  }

  if (
    preference.sourceId === CUSTOM_VERSION_IMPORT_SOURCE_ID ||
    VERSION_IMPORT_SOURCES.some(source => source.id === preference.sourceId)
  ) {
    versionState.selectedSourceId = preference.sourceId;
  }
  if (preference.customTemplate) {
    versionState.customTemplate = preference.customTemplate;
  }
}

function readVersionImportSourcePreference(): {
  sourceId: VersionImportSourceSelection;
  customTemplate: string;
} | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_NAMESPACE}:${VERSION_PREFERENCE_KEY}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isVersionImportSourcePreference(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persistVersionImportSourcePreference(): void {
  const preference = {
    sourceId: versionState.selectedSourceId,
    customTemplate: versionState.customTemplate,
  };

  try {
    localStorage.setItem(`${STORAGE_NAMESPACE}:${VERSION_PREFERENCE_KEY}`, JSON.stringify(preference));
  } catch {
    // ignored
  }
}

function isVersionImportSourcePreference(
  value: unknown,
): value is { sourceId: VersionImportSourceSelection; customTemplate: string } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  const sourceId = record.sourceId;
  const customTemplate = record.customTemplate;
  return (
    typeof sourceId === 'string' &&
    (sourceId === CUSTOM_VERSION_IMPORT_SOURCE_ID || VERSION_IMPORT_SOURCES.some(source => source.id === sourceId)) &&
    typeof customTemplate === 'string'
  );
}

function getPresetPaneFromAction(element: HTMLElement): PresetPaneKind {
  return element.dataset.presetPane === 'target' ? 'target' : 'source';
}

function getEntryKindFromAction(element: HTMLElement): SelectableEntryKind {
  return element.dataset.entryKind === 'target' ? 'target' : 'source';
}

function getPresetNameForPane(kind: PresetPaneKind): string {
  return kind === 'source' ? state.sourceName : state.targetName;
}

function getPresetDraftForPane(kind: PresetPaneKind): Preset | null {
  return kind === 'source' ? getEditableSourceDraft() : state.targetDraft;
}

function setPresetNameForPane(kind: PresetPaneKind, name: string): void {
  if (kind === 'source') {
    state.sourceName = name;
    saveLastSourceName();
    return;
  }
  state.targetName = name;
}

function resetPresetDraftForPane(kind: PresetPaneKind): void {
  if (kind === 'source') {
    resetSourceDraft();
    return;
  }
  resetTargetDraft();
}

async function copySelectedPreset(kind: PresetPaneKind): Promise<void> {
  const sourceName = getPresetNameForPane(kind);
  if (!ensurePresetFileActionAllowed(sourceName)) {
    return;
  }

  const draft = getPresetDraftForPane(kind) ?? getPresetByName(sourceName);
  if (!draft) {
    setPresetActionError('当前预设不可复制');
    return;
  }

  const nextName = promptPresetName('复制预设为', getAvailablePresetName(`${sourceName} 副本`));
  if (!nextName) {
    return;
  }

  try {
    await persistPreset(nextName, draft, false);
    setPresetNameForPane(kind, nextName);
    hydratePresetList();
    resetPresetDraftForPane(kind);
    state.notice = `已复制预设：${nextName}`;
    showToast('success', state.notice);
    render();
  } catch (error) {
    setPresetActionError(error instanceof Error ? error.message : '复制预设失败');
  }
}

async function renameSelectedPreset(kind: PresetPaneKind): Promise<void> {
  const oldName = getPresetNameForPane(kind);
  if (!ensurePresetFileActionAllowed(oldName)) {
    return;
  }

  const nextName = promptPresetName('重命名预设为', oldName, oldName);
  if (!nextName || nextName === oldName) {
    return;
  }

  try {
    const renamed = await helperRenamePreset(oldName, nextName);
    if (!renamed) {
      throw new Error('酒馆助手未能重命名该预设');
    }

    const sourceWasRenamed = state.sourceName === oldName;
    const targetWasRenamed = state.targetName === oldName;
    if (sourceWasRenamed) {
      state.sourceName = nextName;
      saveLastSourceName();
    }
    if (targetWasRenamed) {
      state.targetName = nextName;
    }
    hydratePresetList();
    state.notice = `已重命名预设：${nextName}`;
    showToast('success', state.notice);
    render();
  } catch (error) {
    setPresetActionError(error instanceof Error ? error.message : '重命名预设失败');
  }
}

async function deleteSelectedPreset(kind: PresetPaneKind): Promise<void> {
  const name = getPresetNameForPane(kind);
  if (!ensurePresetFileActionAllowed(name)) {
    return;
  }

  if (!window.confirm(`确认删除预设“${name}”？此操作会立即生效。`)) {
    return;
  }

  try {
    const deleted = await helperDeletePreset(name);
    if (!deleted) {
      throw new Error('酒馆助手未能删除该预设');
    }

    const remainingNames = state.presetNames.filter(presetName => presetName !== name);
    const sourceWasDeleted = state.sourceName === name;
    const targetWasDeleted = state.targetName === name;

    if (sourceWasDeleted) {
      state.sourceName = chooseFallbackPresetName(remainingNames, state.targetName);
      state.sourceDraft = null;
      state.sourceOriginal = null;
      state.sourceDirty = false;
      state.selectedSourceId = '';
      saveLastSourceName();
    }
    if (targetWasDeleted) {
      state.targetName = chooseFallbackPresetName(remainingNames, state.sourceName);
      state.targetDraft = null;
      state.targetOriginal = null;
      state.targetDirty = false;
      state.selectedTargetId = '';
    }

    syncDirtyState();
    hydratePresetList();
    state.notice = `已删除预设：${name}`;
    showToast('success', state.notice);
    render();
  } catch (error) {
    setPresetActionError(error instanceof Error ? error.message : '删除预设失败');
  }
}

function ensurePresetFileActionAllowed(name: string): boolean {
  if (!name || isFavoritesPreset(name)) {
    setPresetActionError('收藏夹不是可复制、重命名或删除的磁盘预设');
    return false;
  }
  if (name === 'in_use') {
    setPresetActionError('不能直接操作 in_use 运行时预设');
    return false;
  }
  return true;
}

function promptPresetName(title: string, defaultName: string, currentName = ''): string | null {
  const value = window.prompt(title, defaultName);
  if (value === null) {
    return null;
  }

  const name = value.trim();
  if (!name) {
    setPresetActionError('预设名称不能为空');
    return null;
  }
  if (name === 'in_use' || isFavoritesPreset(name)) {
    setPresetActionError('这个名称不能作为普通预设使用');
    return null;
  }
  if (name !== currentName && state.presetNames.includes(name)) {
    setPresetActionError(`预设已存在：${name}`);
    return null;
  }
  return name;
}

function getAvailablePresetName(baseName: string): string {
  const base = baseName.trim() || '新预设副本';
  if (!state.presetNames.includes(base)) {
    return base;
  }

  let index = 2;
  let nextName = `${base} ${index}`;
  while (state.presetNames.includes(nextName)) {
    index += 1;
    nextName = `${base} ${index}`;
  }
  return nextName;
}

function chooseFallbackPresetName(names: string[], avoidName: string): string {
  return names.find(name => name !== avoidName) ?? names[0] ?? FAVORITES_PRESET_VALUE;
}

function setPresetActionError(message: string): void {
  state.error = message;
  showToast('error', message);
  render();
}

function selectRow(row: HTMLElement): void {
  const kind = row.dataset.entryKind as EntryKind | undefined;
  const id = row.dataset.id ?? '';
  if ((kind === 'source' || kind === 'target') && isMultiSelectEnabled(kind)) {
    toggleEntrySelection(kind, id);
    state.activeTab = state.activeTab === 'preview' ? 'preview' : kind;
    render();
    return;
  }
  if ((kind === 'source' || kind === 'target') && state.compareMode) {
    selectCompareEntryById(kind, id);
    state.activeTab = state.activeTab === 'preview' ? 'preview' : kind;
    requestScrollSelectedRowOnNextRender();
    render();
    return;
  }
  if (kind === 'source') {
    state.selectedSourceId = id;
    state.selectedTargetId = '';
    state.activeTab = state.activeTab === 'preview' ? 'preview' : 'source';
  }
  if (kind === 'target') {
    state.selectedTargetId = id;
    state.selectedSourceId = '';
    state.activeTab = state.activeTab === 'preview' ? 'preview' : 'target';
  }
  if (kind === 'favorite') {
    state.selectedFavoriteId = id;
    state.selectedSourceId = '';
    state.selectedTargetId = '';
    state.activeTab = state.activeTab === 'preview' ? 'preview' : 'source';
  }
  render();
}

function selectCompareEntryById(kind: SelectableEntryKind, id: string): void {
  const comparison = comparePromptEntries(getSourceCompareEntries(), getTargetCompareEntries());
  const pair = getComparePairForEntry(comparison, kind, id);
  if (pair?.sourceEntry) {
    state.selectedSourceId = pair.sourceEntry.id;
  } else if (kind === 'source') {
    state.selectedSourceId = id;
  } else {
    state.selectedSourceId = '';
  }

  if (pair?.targetEntry) {
    state.selectedTargetId = pair.targetEntry.id;
  } else if (kind === 'target') {
    state.selectedTargetId = id;
  } else {
    state.selectedTargetId = '';
  }
}

function copySourceById(id: string): void {
  const entry = getSourceEntries().find(item => item.id === id) ?? getSourceEntries()[0];
  if (!entry || !state.targetDraft) {
    state.error = '没有可复制的来源条目';
    render();
    return;
  }

  const targetEntries = listPromptEntries(state.targetDraft);
  const selectedTargetIndex = targetEntries.findIndex(item => item.id === state.selectedTargetId);
  const insertIndex = selectedTargetIndex >= 0 ? selectedTargetIndex + 1 : undefined;
  state.selectedTargetId = insertPromptFromEntry(state.targetDraft, entry, insertIndex);
  markTargetDirty();
  state.notice = `已复制：${entry.name}`;
  state.activeTab = 'target';
  render();
}

async function favoriteEntryById(kind: 'source' | 'target', id: string): Promise<void> {
  const entry =
    kind === 'source'
      ? getSourceEntries().find(item => item.id === id)
      : getTargetEntries().find(item => item.id === id);

  if (!entry) {
    state.error = '没有可收藏的条目';
    render();
    return;
  }

  const sourcePreset =
    kind === 'source' ? getPresetDisplayName(state.sourceName) : getPresetDisplayName(state.targetName);
  state.favorites = [createFavoriteFromEntry(entry, sourcePreset), ...state.favorites];
  await saveFavorites();
  state.notice = `已收藏：${entry.name}`;
  render();
}

async function favoriteSelectedEntries(kind: SelectableEntryKind): Promise<void> {
  if (isFavoritesPreset(getPresetNameForPane(kind))) {
    state.error = '收藏夹里的条目已是收藏';
    render();
    return;
  }

  const entries = getSelectedEntries(kind);
  if (!entries.length) {
    state.error = '没有选中的条目';
    render();
    return;
  }

  const sourcePreset = getPresetDisplayName(getPresetNameForPane(kind));
  state.favorites = [...entries.map(entry => createFavoriteFromEntry(entry, sourcePreset)), ...state.favorites];
  await saveFavorites();
  state.notice = `已收藏 ${entries.length} 个条目`;
  showToast('success', state.notice);
  render();
}

function insertFavoriteById(id: string): void {
  const favorite = state.favorites.find(item => item.id === id) ?? state.favorites[0];
  if (!favorite || !state.targetDraft) {
    state.error = '没有可插入的收藏';
    render();
    return;
  }

  const targetEntries = listPromptEntries(state.targetDraft);
  const selectedTargetIndex = targetEntries.findIndex(item => item.id === state.selectedTargetId);
  const insertIndex = selectedTargetIndex >= 0 ? selectedTargetIndex + 1 : undefined;
  state.selectedTargetId = insertPromptFromEntry(state.targetDraft, favorite, insertIndex);
  markTargetDirty();
  state.notice = `已从收藏插入：${favorite.name}`;
  state.activeTab = 'target';
  render();
}

async function deleteFavorite(id: string): Promise<void> {
  const before = state.favorites.length;
  state.favorites = state.favorites.filter(item => item.id !== id);
  if (state.favorites.length !== before) {
    await saveFavorites();
    state.notice = '已删除收藏';
    if (isFavoritesPreset(state.targetName) && state.targetDraft && !state.targetDirty) {
      resetTargetDraft();
    }
  }
  render();
}

function removeSource(id: string): void {
  const sourceDraft = getEditableSourceDraft();
  if (!sourceDraft) {
    return;
  }
  removePrompt(sourceDraft, id);
  state.selectedSourceId = '';
  markSourceDirty();
  render();
}

function toggleEntryEnabled(kind: SelectableEntryKind, id: string): void {
  const draft = kind === 'source' ? getEditableSourceDraft() : state.targetDraft;
  const entry = getEntriesForKind(kind).find(item => item.id === id);
  if (!entry || !draft) {
    return;
  }

  const nextEnabled = !entry.enabled;
  setPromptEnabled(draft, id, nextEnabled);
  if (kind === 'source') {
    markSourceDirty();
  } else {
    markTargetDirty();
  }
  state.notice = `已暂存${nextEnabled ? '启用' : '禁用'}：${entry.name}`;
  render();
}

function moveTarget(id: string, direction: -1 | 1): void {
  if (!state.targetDraft) {
    return;
  }
  movePrompt(state.targetDraft, id, direction);
  markTargetDirty();
  render();
}

function removeTarget(id: string): void {
  if (!state.targetDraft) {
    return;
  }
  removePrompt(state.targetDraft, id);
  state.selectedTargetId = '';
  markTargetDirty();
  render();
}

function removeSelectedEntries(kind: SelectableEntryKind): void {
  const entries = getSelectedEntries(kind);
  if (!entries.length) {
    state.error = '没有选中的条目';
    render();
    return;
  }

  const draft = kind === 'source' ? getEditableSourceDraft() : state.targetDraft;
  if (!draft) {
    return;
  }

  const selectedIds = new Set(entries.map(entry => entry.id));
  for (const id of selectedIds) {
    removePrompt(draft, id);
  }

  if (kind === 'source') {
    if (selectedIds.has(state.selectedSourceId)) {
      state.selectedSourceId = '';
    }
    clearEntrySelection('source');
    markSourceDirty();
  } else {
    if (selectedIds.has(state.selectedTargetId)) {
      state.selectedTargetId = '';
    }
    clearEntrySelection('target');
    markTargetDirty();
  }

  state.notice = `已删除 ${selectedIds.size} 个条目`;
  render();
}

function updateDetailContent(content: string): void {
  if (state.selectedSourceId) {
    updateSourceContent(content);
    return;
  }
  updateTargetContent(content);
}

function updateDetailRole(role: string): void {
  if (state.selectedSourceId) {
    updateSourceRole(role);
    return;
  }
  updateTargetRole(role);
}

function updateComparePaneContent(kind: SelectableEntryKind, id: string, content: string): void {
  updateComparePaneDraft(kind, id, draft => setPromptContent(draft, id, content));
}

function updateComparePaneRole(kind: SelectableEntryKind, id: string, role: string): void {
  updateComparePaneDraft(kind, id, draft => setPromptRole(draft, id, role));
}

function updateComparePaneDraft(kind: SelectableEntryKind, id: string, updateDraft: (draft: Preset) => void): void {
  const draft = kind === 'source' ? getEditableSourceDraft() : state.targetDraft;
  if (!draft || !id) {
    return;
  }

  updateDraft(draft);
  selectEntryById(kind, id);
  if (kind === 'source') {
    markSourceDirty();
  } else {
    markTargetDirty();
  }
}

function selectEntryById(kind: SelectableEntryKind, id: string): void {
  if (state.compareMode) {
    selectCompareEntryById(kind, id);
    return;
  }
  if (kind === 'source') {
    state.selectedSourceId = id;
    state.selectedTargetId = '';
  } else {
    state.selectedTargetId = id;
    state.selectedSourceId = '';
  }
}

function updateSourceContent(content: string): void {
  const sourceDraft = getEditableSourceDraft();
  if (!sourceDraft || !state.selectedSourceId) {
    return;
  }
  setPromptContent(sourceDraft, state.selectedSourceId, content);
  markSourceDirty();
}

function updateSourceRole(role: string): void {
  const sourceDraft = getEditableSourceDraft();
  if (!sourceDraft || !state.selectedSourceId) {
    return;
  }
  setPromptRole(sourceDraft, state.selectedSourceId, role);
  markSourceDirty();
}

function updateTargetContent(content: string): void {
  if (!state.targetDraft || !state.selectedTargetId) {
    return;
  }
  setPromptContent(state.targetDraft, state.selectedTargetId, content);
  markTargetDirty();
}

function updateTargetRole(role: string): void {
  if (!state.targetDraft || !state.selectedTargetId) {
    return;
  }
  setPromptRole(state.targetDraft, state.selectedTargetId, role);
  markTargetDirty();
}

async function saveTargetDraft(): Promise<void> {
  if (state.saving) {
    return;
  }

  const sourceValidation = state.sourceDirty && state.sourceDraft ? validatePreset(state.sourceDraft) : null;
  const targetValidation = state.targetDirty && state.targetDraft ? validatePreset(state.targetDraft) : null;
  if (sourceValidation && !sourceValidation.ok) {
    state.error = '来源预设存在结构问题，请先处理重复 ID 或缺失引用';
    showToast('error', state.error);
    render();
    return;
  }
  if (targetValidation && !targetValidation.ok) {
    state.error = '目标预设存在结构问题，请先处理重复 ID 或缺失引用';
    showToast('error', state.error);
    render();
    return;
  }

  state.saving = true;
  render();

  try {
    const savedParts: string[] = [];
    if (state.sourceDirty) {
      await saveSourceDraft();
      savedParts.push('来源');
    }

    if (state.targetDirty) {
      await saveTargetOnly();
      savedParts.push('目标');
    }

    syncDirtyState();
    state.notice = savedParts.length ? `已保存${savedParts.join('、')}` : '没有需要保存的修改';
    showToast('success', state.notice);
  } catch (error) {
    state.error = error instanceof Error ? error.message : '保存失败';
    showToast('error', state.error);
  } finally {
    state.saving = false;
    hydratePresetList();
    render();
  }
}

async function saveSourceDraft(): Promise<void> {
  if (!state.sourceDraft || !state.sourceName) {
    return;
  }

  if (isFavoritesPreset(state.sourceName)) {
    await saveFavoritesFromDraft(state.sourceDraft);
    state.sourceOriginal = deepClone(state.sourceDraft);
    state.sourceDirty = false;
    return;
  }

  const savedName = await persistPreset(state.sourceName, state.sourceDraft, true);
  state.sourceName = savedName;
  state.sourceOriginal = deepClone(state.sourceDraft);
  state.sourceDirty = false;
}

async function saveTargetOnly(): Promise<void> {
  if (!state.targetDraft || !state.targetName) {
    return;
  }

  if (isFavoritesPreset(state.targetName)) {
    await saveFavoritesFromDraft(state.targetDraft);
    state.targetOriginal = deepClone(state.targetDraft);
    state.targetDirty = false;
    return;
  }

  const savedName = await persistPreset(state.targetName, state.targetDraft, true);
  state.targetName = savedName;
  state.targetOriginal = deepClone(state.targetDraft);
  state.targetDirty = false;
}

async function saveFavoritesFromDraft(draft: Preset): Promise<void> {
  const previousById = new Map(state.favorites.map(favorite => [favorite.id, favorite]));
  const sourceLabel = getPresetDisplayName(state.sourceName) || FAVORITES_PRESET_LABEL;
  state.favorites = listPromptEntries(draft).map(entry => {
    const previous = previousById.get(entry.id);
    if (previous) {
      return {
        ...previous,
        name: entry.name,
        enabled: entry.enabled,
        prompt: deepClone(entry.prompt),
      };
    }
    return {
      id: entry.id,
      name: entry.name,
      sourcePreset: sourceLabel,
      createdAt: new Date().toISOString(),
      enabled: entry.enabled,
      prompt: deepClone(entry.prompt),
    };
  });
  await saveFavorites();
}

async function persistPreset(name: string, preset: Preset, triggerUi: boolean): Promise<string> {
  diagnose('preset-save-start', { name, triggerUi });
  await helperCreateOrReplacePreset(name, deepClone(preset), { render: 'none' });
  if (triggerUi && name === helperGetLoadedPresetName()) {
    await helperCreateOrReplacePreset('in_use', deepClone(preset), { render: 'immediate' });
  }
  diagnose('preset-save-success', { name });
  return name;
}

async function loadFavorites(): Promise<FavoriteEntry[]> {
  try {
    const raw = localStorage.getItem(`${STORAGE_NAMESPACE}:${FAVORITES_TABLE}:${FAVORITES_KEY}`);
    const parsed = raw ? JSON.parse(raw) : [];
    const favorites = Array.isArray(parsed) ? (parsed as FavoriteEntry[]) : [];
    diagnose('favorites-loaded', { count: favorites.length });
    return favorites;
  } catch (error) {
    diagnose('favorites-load-error', { message: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

async function saveFavorites(): Promise<void> {
  localStorage.setItem(`${STORAGE_NAMESPACE}:${FAVORITES_TABLE}:${FAVORITES_KEY}`, JSON.stringify(state.favorites));
  diagnose('favorites-saved', { count: state.favorites.length });
}

function diagnose(stage: string, details?: Record<string, unknown>): void {
  const entry: DebugEntry = {
    at: new Date().toISOString(),
    stage,
    ...(details ? { details } : {}),
  };
  debugEntries = [...debugEntries, entry].slice(-DEBUG_ENTRY_LIMIT);

  try {
    console.info(`[${APP_NAME}]`, stage, details ?? {});
  } catch {
    // ignored
  }

  try {
    localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(debugEntries));
  } catch {
    // ignored
  }
}

function cleanupLegacyScriptVariables(): void {
  try {
    const runtime = globalThis as unknown as RuntimeHost;
    const getScriptIdFunction = runtime.getScriptId;
    const scriptId = typeof getScriptIdFunction === 'function' ? getScriptIdFunction.call(runtime) : '';
    if (!scriptId) {
      return;
    }
    if (typeof runtime.deleteVariable === 'function') {
      runtime.deleteVariable(DEBUG_VARIABLE_KEY, { type: 'script', script_id: scriptId });
      runtime.deleteVariable(VERSION_PREFERENCE_KEY, { type: 'script', script_id: scriptId });
      return;
    }
    if (typeof runtime.updateVariablesWith === 'function') {
      runtime.updateVariablesWith(
        variables => {
          const nextVariables = { ...variables };
          delete nextVariables[DEBUG_VARIABLE_KEY];
          delete nextVariables[VERSION_PREFERENCE_KEY];
          return nextVariables;
        },
        { type: 'script', script_id: scriptId },
      );
    }
  } catch {
    // ignored
  }
}

function getRuntimeDiagnostics(): Record<string, unknown> {
  const runtime = globalThis as unknown as RuntimeHost;
  const parentDocument = getParentDocument();
  const parentWindow = parentDocument?.defaultView;
  const parentBodyRect = parentDocument?.body.getBoundingClientRect();
  return {
    href: location.href,
    readyState: document.readyState,
    iframeWindowWidth: window.innerWidth,
    iframeWindowHeight: window.innerHeight,
    parentAccessible: Boolean(parentDocument),
    parentWindowWidth: parentWindow?.innerWidth ?? null,
    parentWindowHeight: parentWindow?.innerHeight ?? null,
    parentBodyWidth: parentBodyRect ? roundPixel(parentBodyRect.width) : null,
    parentBodyHeight: parentBodyRect ? roundPixel(parentBodyRect.height) : null,
    hasJquery: typeof $ === 'function',
    hasUpdateScriptButtonsWith: typeof runtime.updateScriptButtonsWith === 'function',
    hasEventOn: typeof runtime.eventOn === 'function',
    hasGetButtonEvent: typeof runtime.getButtonEvent === 'function',
    hasGetScriptId: typeof runtime.getScriptId === 'function',
    hasUpdateVariablesWith: typeof runtime.updateVariablesWith === 'function',
    hasTavernHelper: Boolean(runtime.TavernHelper),
    hasHelperGetPresetNames: typeof runtime.TavernHelper?.getPresetNames === 'function',
    hasGlobalGetPresetNames: typeof runtime.getPresetNames === 'function',
  };
}

function onDragStart(event: DragEvent): void {
  if (state.compareMode) {
    event.preventDefault();
    return;
  }

  const target = toElement(event.target);
  const row = target?.closest<HTMLElement>('.pm-row');
  if (!row || !event.dataTransfer) {
    return;
  }

  const kind = row.dataset.entryKind;
  const id = row.dataset.id;
  if (!kind || !id) {
    return;
  }

  const ids = getDragEntryIds(kind as EntryKind, id);
  event.dataTransfer.effectAllowed = 'copyMove';
  event.dataTransfer.setData('application/x-preset-manager', JSON.stringify({ kind, id, ids }));
}

function onDragOver(event: DragEvent): void {
  if (state.compareMode) {
    return;
  }

  const target = toElement(event.target);
  if (isPresetEntryDropTarget(target)) {
    event.preventDefault();
    updateDropMarker(event.clientX, event.clientY);
  }
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  clearDropMarkers();
  if (state.compareMode) {
    return;
  }

  const raw = event.dataTransfer?.getData('application/x-preset-manager');
  if (!raw) {
    return;
  }

  const payload = JSON.parse(raw) as { kind?: EntryKind; id?: string; ids?: string[] };
  if (!payload.kind || !payload.id) {
    return;
  }

  applyDrop(payload.kind, normalizeDragIds(payload), event.clientX, event.clientY);
}

function isPresetEntryDropTarget(target: Element | null): boolean {
  return Boolean(
    target?.closest(
      '.pm-list[data-drop-zone="source"], .pm-list[data-drop-zone="target"], .pm-row[data-entry-kind="source"], .pm-row[data-entry-kind="target"]',
    ),
  );
}

function onPointerDown(event: PointerEvent): void {
  if (state.compareMode) {
    return;
  }

  if (event.button !== 0 && event.pointerType === 'mouse') {
    return;
  }

  const target = toElement(event.target);
  if (!target || target.closest('button, input, select, textarea, a')) {
    return;
  }

  const fromHandle = Boolean(target.closest('[data-drag-handle]'));
  if (event.pointerType !== 'mouse' && !fromHandle) {
    return;
  }

  const row = target.closest<HTMLElement>('.pm-row');
  if (!row) {
    return;
  }

  const kind = row.dataset.entryKind as EntryKind | undefined;
  const id = row.dataset.id;
  if (!kind || !id) {
    return;
  }

  pointerDrag = {
    pointerId: event.pointerId,
    kind,
    id,
    ids: getDragEntryIds(kind, id),
    row,
    startX: event.clientX,
    startY: event.clientY,
    dragging: false,
  };

  row.setPointerCapture?.(event.pointerId);
  if (event.pointerType === 'mouse' || fromHandle) {
    event.preventDefault();
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) {
    return;
  }

  const moved = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY);
  if (!pointerDrag.dragging && moved < 6) {
    return;
  }

  pointerDrag.dragging = true;
  pointerDrag.row.classList.add('pm-row-dragging');
  getMountDocument().getElementById(ROOT_ID)?.classList.add('pm-is-dragging');
  updateDropMarker(event.clientX, event.clientY);
  event.preventDefault();
}

function onPointerUp(event: PointerEvent): void {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) {
    return;
  }

  const drag = pointerDrag;
  pointerDrag = null;
  if (drag.row.hasPointerCapture?.(event.pointerId)) {
    drag.row.releasePointerCapture(event.pointerId);
  }
  drag.row.classList.remove('pm-row-dragging');
  getMountDocument().getElementById(ROOT_ID)?.classList.remove('pm-is-dragging');
  clearDropMarkers();

  if (!drag.dragging) {
    return;
  }

  suppressNextClick = true;
  event.preventDefault();
  applyDrop(drag.kind, drag.ids, event.clientX, event.clientY);
}

function onPointerCancel(event: PointerEvent): void {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) {
    return;
  }

  pointerDrag.row.classList.remove('pm-row-dragging');
  getMountDocument().getElementById(ROOT_ID)?.classList.remove('pm-is-dragging');
  pointerDrag = null;
  clearDropMarkers();
}

function normalizeDragIds(payload: { id?: string; ids?: string[] }): string[] {
  return dedupeStrings(Array.isArray(payload.ids) && payload.ids.length ? payload.ids : [payload.id ?? '']);
}

function applyDrop(kind: EntryKind, ids: string[], clientX: number, clientY: number): void {
  const location = getDropLocation(clientX, clientY);
  if (!location || !ids.length) {
    return;
  }

  if (location.zone === 'source') {
    applySourceDrop(kind, ids, location);
    return;
  }

  applyTargetDrop(kind, ids, location);
}

function applyTargetDrop(kind: EntryKind, ids: string[], location: DropLocation): void {
  if (!state.targetDraft) {
    return;
  }

  if (kind === 'source') {
    const sourceEntries = getEntriesByIds(getSourceEntries(), ids);
    if (!sourceEntries.length) {
      return;
    }
    const insertedIds = insertEntriesAtIndex(state.targetDraft, sourceEntries, location.index);
    selectDroppedEntries('target', insertedIds);
    state.notice =
      sourceEntries.length === 1 ? `已拖入：${sourceEntries[0].name}` : `已拖入 ${sourceEntries.length} 个条目`;
  }

  if (kind === 'favorite') {
    const favorites = getFavoritesByIds(ids);
    if (!favorites.length) {
      return;
    }
    const insertedIds = insertEntriesAtIndex(state.targetDraft, favorites, location.index);
    selectDroppedEntries('target', insertedIds);
    state.notice =
      favorites.length === 1 ? `已从收藏拖入：${favorites[0].name}` : `已从收藏拖入 ${favorites.length} 个条目`;
  }

  if (kind === 'target') {
    movePromptsToIndex(state.targetDraft, ids, location.index);
    selectDroppedEntries('target', ids);
    state.notice = ids.length === 1 ? '已重排目标预设' : `已重排 ${ids.length} 个目标条目`;
  }

  markTargetDirty();
  state.activeTab = 'target';
  render();
}

function applySourceDrop(kind: EntryKind, ids: string[], location: DropLocation): void {
  const sourceDraft = getEditableSourceDraft();
  if (!sourceDraft) {
    return;
  }

  if (kind === 'source') {
    movePromptsToIndex(sourceDraft, ids, location.index);
    selectDroppedEntries('source', ids);
    state.notice = ids.length === 1 ? '已重排来源预设' : `已重排 ${ids.length} 个来源条目`;
  }

  if (kind === 'target') {
    const targetEntries = getEntriesByIds(getTargetEntries(), ids);
    if (!targetEntries.length) {
      return;
    }
    const insertedIds = insertEntriesAtIndex(sourceDraft, targetEntries, location.index);
    selectDroppedEntries('source', insertedIds);
    state.notice = isFavoritesPreset(state.sourceName)
      ? targetEntries.length === 1
        ? `已拖入收藏夹：${targetEntries[0].name}`
        : `已拖入收藏夹 ${targetEntries.length} 个条目`
      : targetEntries.length === 1
        ? `已拖入来源：${targetEntries[0].name}`
        : `已拖入来源 ${targetEntries.length} 个条目`;
  }

  if (kind === 'favorite') {
    const favorites = getFavoritesByIds(ids);
    if (!favorites.length) {
      return;
    }
    const insertedIds = insertEntriesAtIndex(sourceDraft, favorites, location.index);
    selectDroppedEntries('source', insertedIds);
    state.notice =
      favorites.length === 1 ? `已从收藏拖入：${favorites[0].name}` : `已从收藏拖入 ${favorites.length} 个条目`;
  }

  markSourceDirty();
  state.activeTab = 'source';
  render();
}

function getEntriesByIds(entries: PromptEntry[], ids: string[]): PromptEntry[] {
  const selectedIds = new Set(ids);
  return entries.filter(entry => selectedIds.has(entry.id));
}

function getFavoritesByIds(ids: string[]): FavoriteEntry[] {
  const selectedIds = new Set(ids);
  return state.favorites.filter(entry => selectedIds.has(entry.id));
}

function insertEntriesAtIndex(
  targetPreset: Preset,
  entries: Array<PromptEntry | FavoriteEntry>,
  index: number,
): string[] {
  const insertedIds: string[] = [];
  entries.forEach((entry, offset) => {
    insertedIds.push(insertPromptFromEntry(targetPreset, entry, index + offset));
  });
  return insertedIds;
}

function selectDroppedEntries(kind: SelectableEntryKind, ids: string[]): void {
  const nextIds = dedupeStrings(ids);
  if (kind === 'source') {
    state.selectedSourceId = nextIds[0] ?? '';
    state.selectedTargetId = '';
    if (nextIds.length > 1) {
      state.sourceMultiSelect = true;
      setSelectedEntryIds('source', nextIds);
    }
    return;
  }

  state.selectedTargetId = nextIds[0] ?? '';
  state.selectedSourceId = '';
  if (nextIds.length > 1) {
    state.targetMultiSelect = true;
    setSelectedEntryIds('target', nextIds);
  }
}

function getDropLocation(clientX: number, clientY: number): DropLocation | null {
  const target = getMountDocument().elementFromPoint(clientX, clientY);
  const row =
    target?.closest<HTMLElement>('.pm-row[data-entry-kind="source"], .pm-row[data-entry-kind="target"]') ?? null;
  const list =
    target?.closest<HTMLElement>('.pm-list[data-drop-zone="source"], .pm-list[data-drop-zone="target"]') ?? null;
  const zone = getDropZone(row, list);
  if (!zone) {
    return null;
  }

  if (!row) {
    return {
      zone,
      index: getDropZoneLength(zone),
      row: null,
    };
  }

  return {
    zone,
    index: getDropIndex(row, clientY),
    row,
  };
}

function getDropZone(row: HTMLElement | null, list: HTMLElement | null): 'source' | 'target' | null {
  const rowKind = row?.dataset.entryKind;
  if (rowKind === 'source' || rowKind === 'target') {
    return rowKind;
  }
  const listZone = list?.dataset.dropZone;
  return listZone === 'source' || listZone === 'target' ? listZone : null;
}

function getDropZoneLength(zone: 'source' | 'target'): number {
  if (zone === 'source') {
    const sourceDraft = getEditableSourceDraft();
    return sourceDraft ? listPromptEntries(sourceDraft).length : 0;
  }
  return state.targetDraft ? listPromptEntries(state.targetDraft).length : 0;
}

function getDropIndex(row: HTMLElement, clientY: number): number {
  const rowIndex = Number(row.dataset.index);
  if (!Number.isFinite(rowIndex)) {
    const kind = row.dataset.entryKind === 'source' ? 'source' : 'target';
    return getDropZoneLength(kind);
  }
  const rect = row.getBoundingClientRect();
  return clientY > rect.top + rect.height / 2 ? rowIndex + 1 : rowIndex;
}

function updateDropMarker(clientX: number, clientY: number): void {
  clearDropMarkers();
  const location = getDropLocation(clientX, clientY);
  if (!location?.row) {
    return;
  }

  const rect = location.row.getBoundingClientRect();
  location.row.classList.add(clientY > rect.top + rect.height / 2 ? 'pm-row-drop-after' : 'pm-row-drop-before');
}

function clearDropMarkers(): void {
  getMountDocument()
    .querySelectorAll<HTMLElement>(
      '#tt-preset-stitcher-root .pm-row-drop-before, #tt-preset-stitcher-root .pm-row-drop-after',
    )
    .forEach(row => row.classList.remove('pm-row-drop-before', 'pm-row-drop-after'));
}

function clearMessage(): void {
  state.notice = '';
  state.error = '';
}

function showToast(type: 'success' | 'error', message: string): void {
  if (typeof toastr === 'undefined') {
    return;
  }
  if (type === 'success') {
    toastr.success(message);
  } else {
    toastr.error(message);
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
