import './styles.css';
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
  createFavoriteFromEntry,
  deepClone,
  FavoriteEntry,
  insertPromptFromEntry,
  listPromptEntries,
  materializePreset,
  movePrompt,
  movePromptToIndex,
  Preset,
  PromptEntry,
  removePrompt,
  setPromptContent,
  setPromptEnabled,
  setPromptRole,
  validatePreset,
} from './core';

const HELPER_BUTTON_NAME = '预设缝合';
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
const FAVORITES_PRESET_VALUE = '__preset-manager-favorites__';
const FAVORITES_PRESET_LABEL = '收藏夹';
const VERSION_PREFERENCE_KEY = 'version-import-source';

type MobileTab = 'source' | 'target' | 'preview';
type EntryKind = 'source' | 'target' | 'favorite';
type PresetPaneKind = 'source' | 'target';
type FilterValue = 'all' | 'enabled' | 'disabled' | 'system' | 'user' | 'assistant';
type DetailRole = 'system' | 'user' | 'assistant';
type VersionImportSourceSelection = VersionImportSourceId | typeof CUSTOM_VERSION_IMPORT_SOURCE_ID;
type VersionMessageTone = '' | 'success' | 'warning';
type RuntimeFunction = (...args: any[]) => unknown;
type RuntimeHost = Record<string, unknown> & {
  TavernHelper?: Record<string, unknown>;
  getScriptId?: () => string;
  getVariables?: (option: { type: 'script'; script_id?: string }) => Record<string, unknown>;
  updateVariablesWith?: (
    updater: (variables: Record<string, unknown>) => Record<string, unknown>,
    option: { type: 'script'; script_id?: string },
  ) => Record<string, unknown>;
  insertOrAssignVariables?: (
    variables: Record<string, unknown>,
    option: { type: 'script'; script_id?: string },
  ) => Record<string, unknown>;
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
  dirty: boolean;
  sourceDirty: boolean;
  targetDirty: boolean;
  saving: boolean;
  notice: string;
  error: string;
  selectedSourceId: string;
  selectedTargetId: string;
  selectedFavoriteId: string;
  sourceOriginal: Preset | null;
  sourceDraft: Preset | null;
  targetOriginal: Preset | null;
  targetDraft: Preset | null;
  backedUpTargets: Record<string, string>;
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
  dirty: false,
  sourceDirty: false,
  targetDirty: false,
  saving: false,
  notice: '',
  error: '',
  selectedSourceId: '',
  selectedTargetId: '',
  selectedFavoriteId: '',
  sourceOriginal: null,
  sourceDraft: null,
  targetOriginal: null,
  targetDraft: null,
  backedUpTargets: {},
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
let debugEntries: DebugEntry[] = [];

diagnose('module-evaluated', getRuntimeDiagnostics());
start();
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
      console.info('[预设缝合管理器] 收到脚本按钮事件');
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
    console.error('预设缝合按钮注册失败', error);
    showToast('error', error instanceof Error ? error.message : '预设缝合按钮注册失败');
  }
}

function cleanupManagerEntry(): void {
  diagnose('cleanup');
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
      if (button.name === HELPER_BUTTON_NAME) {
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
    const message = error instanceof Error ? error.message : '预设缝合管理器打开失败';
    diagnose('open-error', { message });
    console.error('预设缝合管理器打开失败', error);
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
  const button = target?.closest<HTMLElement>('button, [role="button"], .menu_button, [data-button-name], [data-script-button]');
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
  if (button.dataset.buttonName === HELPER_BUTTON_NAME || button.dataset.scriptButton === HELPER_BUTTON_NAME) {
    return true;
  }

  const ariaLabel = button.getAttribute('aria-label')?.trim();
  const title = button.getAttribute('title')?.trim();
  const text = button.textContent?.trim();
  return ariaLabel === HELPER_BUTTON_NAME
    || title === HELPER_BUTTON_NAME
    || title === `打开${HELPER_BUTTON_NAME}管理器`
    || text === HELPER_BUTTON_NAME;
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
  syncDirtyState();
}

function resetTargetDraft(): void {
  if (isFavoritesPreset(state.targetName)) {
    const favoritesDraft = createFavoritesPresetDraft();
    state.targetOriginal = deepClone(favoritesDraft);
    state.targetDraft = favoritesDraft;
    state.targetDirty = false;
    state.selectedTargetId = '';
    syncDirtyState();
    return;
  }

  const targetPreset = getPresetByName(state.targetName);
  state.targetOriginal = targetPreset ? deepClone(targetPreset) : null;
  state.targetDraft = targetPreset ? deepClone(targetPreset) : null;
  state.targetDirty = false;
  state.selectedTargetId = '';
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
  diagnose('root-created', { hasScriptId: root.hasAttribute('script_id'), mountedInParent: targetDocument !== document });
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
  return element?.tagName === 'INPUT' ? element as HTMLInputElement : null;
}

function toTextAreaElement(target: EventTarget | null): HTMLTextAreaElement | null {
  const element = toElement(target);
  return element?.tagName === 'TEXTAREA' ? element as HTMLTextAreaElement : null;
}

function toSelectElement(target: EventTarget | null): HTMLSelectElement | null {
  const element = toElement(target);
  return element?.tagName === 'SELECT' ? element as HTMLSelectElement : null;
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

  return [...root.querySelectorAll<HTMLElement>('.pm-body, .pm-list[data-drop-zone]')]
    .map(element => ({
      key: getScrollKey(element),
      top: element.scrollTop,
      left: element.scrollLeft,
    }))
    .filter((item): item is RenderScrollSnapshot => Boolean(item.key));
}

function restoreScrollSnapshot(root: HTMLElement, snapshot: RenderScrollSnapshot[]): void {
  for (const item of snapshot) {
    const element = findScrollElement(root, item.key);
    if (!element) {
      continue;
    }
    element.scrollTop = item.top;
    element.scrollLeft = item.left;
  }
}

function getScrollKey(element: HTMLElement): string {
  if (element.classList.contains('pm-body')) {
    return 'body';
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
  return null;
}

function applyMobileSurfaces(root: HTMLElement): void {
  const backdrop = root.querySelector('.pm-backdrop');
  const panel = root.querySelector('.pm-panel');
  backdrop?.setAttribute('data-tt-mobile-surface', 'backdrop');
  panel?.setAttribute('data-tt-mobile-surface', 'fullscreen-window');
}

function renderDialog(): string {
  const sourceEntries = getSourceEntries();
  const targetEntries = getTargetEntries();
  const selected = getDetailSelection();
  const validation = state.targetDraft ? validatePreset(state.targetDraft) : null;

  return `
    <div class="pm-backdrop" data-action="backdrop-close"></div>
    <section class="pm-panel" role="dialog" aria-modal="true" aria-label="预设缝合管理器" data-active-tab="${state.activeTab}">
      <header class="pm-header">
        <div class="pm-title-block">
          <div class="pm-title-line">
            <div class="pm-title">预设缝合管理器</div>
            <span class="pm-version-chip">${APP_VERSION}</span>
            <button class="pm-version-button ${getVersionButtonClass()}" type="button" data-action="open-version-manager" title="${escapeAttr(getVersionButtonTitle())}" aria-label="${escapeAttr(getVersionButtonTitle())}">
              <i class="fa-solid ${getVersionButtonIcon()}" aria-hidden="true"></i>
              ${isVersionUpdateAvailable() ? '<span class="pm-update-dot" aria-hidden="true"></span>' : ''}
            </button>
          </div>
          <div class="pm-subtitle">${escapeHtml(getStatusText(sourceEntries.length, targetEntries.length))}</div>
        </div>
        <div class="pm-header-actions">
          <button class="pm-icon-button" type="button" data-action="refresh" title="刷新预设"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button>
          <button class="pm-icon-button" type="button" data-action="close" title="关闭"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>
      </header>

      <nav class="pm-mobile-tabs" aria-label="移动端视图">
        ${renderTab('source', '来源')}
        ${renderTab('target', '目标')}
        ${renderTab('preview', '条目详情')}
      </nav>

      <main class="pm-body">
        ${renderPresetPane('source', '来源预设', state.sourceName, state.sourceQuery, state.sourceFilter, sourceEntries)}
        ${renderPresetPane('target', '目标预设', state.targetName, state.targetQuery, state.targetFilter, targetEntries)}
        ${renderDetail(selected)}
      </main>

      <footer class="pm-footer">
        <div class="pm-footer-status">
          ${state.dirty ? '<span class="pm-dot pm-dot-dirty"></span>有未保存的修改' : '<span class="pm-dot"></span>暂无未保存修改'}
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
          ${versionState.selectedSourceId === CUSTOM_VERSION_IMPORT_SOURCE_ID ? `
            <label class="pm-field pm-version-custom-source">
              <span>自定义模板</span>
              <input name="versionCustomTemplate" value="${escapeAttr(versionState.customTemplate)}" placeholder="https://.../{version}/dist/preset-manager/index.js" autocomplete="off" />
            </label>
          ` : ''}
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

        ${targetVersion ? `
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
        ` : ''}

        ${versionState.message ? `
          <section class="pm-version-result ${versionState.messageTone}">
            <div>${escapeHtml(versionState.message)}</div>
            ${versionState.messageTone === 'success' ? `
              <button class="pm-button" type="button" data-action="reload-page">
                <i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>
                刷新页面
              </button>
            ` : ''}
          </section>
        ` : ''}

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
    .map(([id, label]) => `<option value="${id}" ${versionState.selectedSourceId === id ? 'selected' : ''}>${escapeHtml(label)}</option>`)
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

function renderTab(tab: MobileTab, label: string): string {
  const selected = state.activeTab === tab ? 'aria-selected="true"' : 'aria-selected="false"';
  return `<button class="pm-tab" type="button" data-action="tab" data-tab="${tab}" ${selected}>${label}</button>`;
}

function renderPresetPane(kind: 'source' | 'target', title: string, selectedPreset: string, query: string, filter: FilterValue, entries: PromptEntry[]): string {
  const isSource = kind === 'source';
  const selectName = isSource ? 'sourceName' : 'targetName';
  const queryName = isSource ? 'sourceQuery' : 'targetQuery';
  const filterName = isSource ? 'sourceFilter' : 'targetFilter';
  const action = isSource ? 'select-source' : 'select-target';

  return `
    <section class="pm-pane pm-pane-${kind}" data-pane="${kind}">
      <div class="pm-pane-head">
        <div class="pm-pane-title">
          <h2>${title}</h2>
          <span class="pm-count">${entries.length}</span>
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
      <div class="pm-list" data-drop-zone="${kind}">
        ${entries.length ? entries.map((entry, index) => renderEntryRow(kind, entry, index)).join('') : renderEmpty(kind)}
      </div>
    </section>
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
    .map(name => `<option value="${escapeAttr(name)}" ${name === selectedPreset ? 'selected' : ''}>${escapeHtml(name)}</option>`)
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

  return options.map(([value, label]) => `<option value="${value}" ${active === value ? 'selected' : ''}>${label}</option>`).join('');
}

function renderEntryRow(kind: 'source' | 'target', entry: PromptEntry, index: number): string {
  const selectedId = kind === 'source' ? state.selectedSourceId : state.selectedTargetId;
  const selected = selectedId === entry.id ? 'is-selected' : '';
  const enabled = entry.enabled ? '启用' : '禁用';
  const contentLength = entry.content.length;
  const actions = renderRowActions(kind, entry);

  return `
    <div class="pm-row ${selected}" role="button" tabindex="0" data-entry-kind="${kind}" data-id="${escapeAttr(entry.id)}" data-index="${index}">
      <div class="pm-row-grip" data-drag-handle="true" aria-hidden="true" title="拖拽条目"><i class="fa-solid fa-grip-lines"></i></div>
      <div class="pm-row-main">
        <div class="pm-row-title">${escapeHtml(entry.name)}</div>
        <div class="pm-row-meta">
          <span>${escapeHtml(entry.role)}</span>
          <span>${enabled}</span>
          <span>${contentLength} 字</span>
        </div>
      </div>
      <div class="pm-row-actions">${actions}</div>
    </div>
  `;
}

function renderRowActions(kind: 'source' | 'target', entry: PromptEntry): string {
  const isFavoritesRow = kind === 'source' ? isFavoritesPreset(state.sourceName) : isFavoritesPreset(state.targetName);
  const favoriteAction = kind === 'source' ? 'favorite-source' : 'favorite-target';
  const deleteAction = kind === 'target'
    ? 'target-remove'
    : 'source-remove';
  const favoriteDisabled = isFavoritesRow ? 'disabled' : '';
  const deleteDisabled = '';
  const favoriteTitle = isFavoritesRow ? '已在收藏夹' : '收藏条目';
  const deleteTitle = '删除条目';
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

function renderDetail(selection: DetailSelection | null): string {
  const entry = selection?.entry;
  const editable = selection?.kind === 'source'
    ? Boolean(getEditableSourceDraft())
    : selection?.kind === 'target' && Boolean(state.targetDraft);
  const name = entry?.name ?? '未选择条目';
  const content = entry?.content ?? '';
  const role = entry?.role ?? 'system';

  return `
    <section class="pm-detail-pane" data-pane="preview">
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
    .map(role => `<option value="${escapeAttr(role)}" ${role === active ? 'selected' : ''}>${escapeHtml(labels[role as DetailRole] ?? role)}</option>`)
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
  return [
    versionState.checking ? 'is-checking' : '',
    isVersionUpdateAvailable() ? 'is-available' : '',
  ].filter(Boolean).join(' ');
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
  return VERSION_IMPORT_SOURCES.find(source => source.id === versionState.selectedSourceId)?.template ?? DEFAULT_VERSION_IMPORT_TEMPLATE;
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
  const preset = getEditableSourceDraft();
  return preset ? filterEntries(listPromptEntries(deepClone(preset)), state.sourceQuery, state.sourceFilter) : [];
}

function getTargetEntries(): PromptEntry[] {
  return state.targetDraft ? filterEntries(listPromptEntries(state.targetDraft), state.targetQuery, state.targetFilter) : [];
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
    if (state.sourceDirty && target.value !== state.sourceName && !window.confirm('切换来源预设会放弃当前未保存修改。继续切换？')) {
      target.value = state.sourceName;
      return;
    }
    state.sourceName = target.value;
    saveLastSourceName();
    resetSourceDraft();
  }

  if (target.name === 'targetName') {
    if (state.targetDirty && target.value !== state.targetName && !window.confirm('切换目标预设会放弃当前未保存修改。继续切换？')) {
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

  if (target.name === 'versionImportSource') {
    updateVersionImportSource(target.value);
  }

  render();
}

function onRootInput(event: Event): void {
  const target = toInputElement(event.target) ?? toTextAreaElement(event.target);
  if (!target) {
    return;
  }

  updateTextControlState(target);

  if (isComposingInput || ('isComposing' in event && Boolean((event as InputEvent).isComposing))) {
    return;
  }

  renderPreservingTextControl(target);
}

function onCompositionStart(event: CompositionEvent): void {
  const target = toInputElement(event.target) ?? toTextAreaElement(event.target);
  if (target && isManagedTextControl(target)) {
    isComposingInput = true;
  }
}

function onCompositionEnd(event: CompositionEvent): void {
  const target = toInputElement(event.target) ?? toTextAreaElement(event.target);
  if (!target || !isManagedTextControl(target)) {
    isComposingInput = false;
    return;
  }

  isComposingInput = false;
  updateTextControlState(target);
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
  if (target.name === 'versionCustomTemplate') {
    versionState.customTemplate = target.value;
    persistVersionImportSourcePreference();
  }
}

function isManagedTextControl(target: HTMLInputElement | HTMLTextAreaElement): boolean {
  return ['sourceQuery', 'targetQuery', 'favoriteQuery', 'detailContent', 'versionCustomTemplate'].includes(target.name);
}

function renderPreservingTextControl(target: HTMLInputElement | HTMLTextAreaElement): void {
  const name = target.name;
  const selectionStart = target.selectionStart;
  const selectionEnd = target.selectionEnd;
  const scrollTop = target.scrollTop;
  const targetDocument = target.ownerDocument ?? getMountDocument();
  const selector = target.tagName === 'TEXTAREA'
    ? `#${ROOT_ID} textarea[name="${CSS.escape(name)}"]`
    : `#${ROOT_ID} input[name="${CSS.escape(name)}"]`;

  render();

  const replacement = targetDocument.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!replacement) {
    return;
  }

  replacement.focus();
  replacement.scrollTop = scrollTop;
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

  switch (action) {
    case 'backdrop-close':
    case 'close':
      closeManager();
      return;
    case 'refresh':
      hydratePresetList({ targetFromLoaded: true });
      state.notice = '已刷新预设列表';
      render();
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
    case 'target-toggle':
      toggleTarget(element.dataset.id ?? '');
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

function closeManager(): void {
  if (state.dirty && !window.confirm('关闭会放弃当前未保存修改。继续关闭？')) {
    render();
    return;
  }

  if (state.dirty) {
    resetSourceDraft();
    resetTargetDraft();
  }

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

  if (preference.sourceId === CUSTOM_VERSION_IMPORT_SOURCE_ID || VERSION_IMPORT_SOURCES.some(source => source.id === preference.sourceId)) {
    versionState.selectedSourceId = preference.sourceId;
  }
  if (preference.customTemplate) {
    versionState.customTemplate = preference.customTemplate;
  }
}

function readVersionImportSourcePreference(): { sourceId: VersionImportSourceSelection; customTemplate: string } | null {
  const runtime = globalThis as unknown as RuntimeHost;
  try {
    const scriptId = getCurrentScriptId();
    const variables = runtime.getVariables?.({ type: 'script', script_id: scriptId });
    const value = variables?.[VERSION_PREFERENCE_KEY];
    if (isVersionImportSourcePreference(value)) {
      return value;
    }
  } catch {
    // Fall back to localStorage below.
  }

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
  const runtime = globalThis as unknown as RuntimeHost;
  try {
    const scriptId = getCurrentScriptId();
    if (typeof runtime.updateVariablesWith === 'function') {
      runtime.updateVariablesWith(variables => ({ ...variables, [VERSION_PREFERENCE_KEY]: preference }), { type: 'script', script_id: scriptId });
      return;
    }
    if (typeof runtime.insertOrAssignVariables === 'function') {
      runtime.insertOrAssignVariables({ [VERSION_PREFERENCE_KEY]: preference }, { type: 'script', script_id: scriptId });
      return;
    }
  } catch {
    // Fall back to localStorage below.
  }

  try {
    localStorage.setItem(`${STORAGE_NAMESPACE}:${VERSION_PREFERENCE_KEY}`, JSON.stringify(preference));
  } catch {
    // ignored
  }
}

function isVersionImportSourcePreference(value: unknown): value is { sourceId: VersionImportSourceSelection; customTemplate: string } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  const sourceId = record.sourceId;
  const customTemplate = record.customTemplate;
  return typeof sourceId === 'string'
    && (sourceId === CUSTOM_VERSION_IMPORT_SOURCE_ID || VERSION_IMPORT_SOURCES.some(source => source.id === sourceId))
    && typeof customTemplate === 'string';
}

function getPresetPaneFromAction(element: HTMLElement): PresetPaneKind {
  return element.dataset.presetPane === 'target' ? 'target' : 'source';
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
    if (state.backedUpTargets[oldName]) {
      state.backedUpTargets[nextName] = state.backedUpTargets[oldName];
      delete state.backedUpTargets[oldName];
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
  const entry = kind === 'source'
    ? getSourceEntries().find(item => item.id === id)
    : getTargetEntries().find(item => item.id === id);

  if (!entry) {
    state.error = '没有可收藏的条目';
    render();
    return;
  }

  const sourcePreset = kind === 'source' ? getPresetDisplayName(state.sourceName) : getPresetDisplayName(state.targetName);
  state.favorites = [createFavoriteFromEntry(entry, sourcePreset), ...state.favorites];
  await saveFavorites();
  state.notice = `已收藏：${entry.name}`;
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

function toggleTarget(id: string): void {
  const entry = getTargetEntries().find(item => item.id === id);
  if (!entry || !state.targetDraft) {
    return;
  }
  setPromptEnabled(state.targetDraft, id, !entry.enabled);
  markTargetDirty();
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

  if (state.sourceOriginal && !state.backedUpTargets[state.sourceName]) {
    const backupName = `${state.sourceName}.bak-preset-manager-${formatBackupTimestamp(new Date())}`;
    const savedBackupName = await persistPreset(backupName, state.sourceOriginal, false);
    state.backedUpTargets[state.sourceName] = savedBackupName;
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

  if (state.targetOriginal && !state.backedUpTargets[state.targetName]) {
    const backupName = `${state.targetName}.bak-preset-manager-${formatBackupTimestamp(new Date())}`;
    const savedBackupName = await persistPreset(backupName, state.targetOriginal, false);
    state.backedUpTargets[state.targetName] = savedBackupName;
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
  await helperCreateOrReplacePreset(name, deepClone(preset), { render: triggerUi ? 'immediate' : 'none' });
  diagnose('preset-save-success', { name });
  return name;
}

async function loadFavorites(): Promise<FavoriteEntry[]> {
  try {
    const raw = localStorage.getItem(`${STORAGE_NAMESPACE}:${FAVORITES_TABLE}:${FAVORITES_KEY}`);
    const parsed = raw ? JSON.parse(raw) : [];
    const favorites = Array.isArray(parsed) ? parsed as FavoriteEntry[] : [];
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
    console.info('[预设缝合管理器]', stage, details ?? {});
  } catch {
    // ignored
  }

  try {
    localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(debugEntries));
  } catch {
    // ignored
  }

  persistDiagnosticVariables();
}

function persistDiagnosticVariables(): void {
  try {
    const runtime = globalThis as unknown as RuntimeHost;
    const getScriptIdFunction = runtime.getScriptId;
    const insertOrAssignVariablesFunction = runtime.insertOrAssignVariables;
    if (typeof getScriptIdFunction !== 'function' || typeof insertOrAssignVariablesFunction !== 'function') {
      return;
    }
    insertOrAssignVariablesFunction.call(
      runtime,
      { [DEBUG_VARIABLE_KEY]: debugEntries },
      { type: 'script', script_id: getScriptIdFunction.call(runtime) },
    );
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
    hasInsertOrAssignVariables: typeof runtime.insertOrAssignVariables === 'function',
    hasTavernHelper: Boolean(runtime.TavernHelper),
    hasHelperGetPresetNames: typeof runtime.TavernHelper?.getPresetNames === 'function',
    hasGlobalGetPresetNames: typeof runtime.getPresetNames === 'function',
  };
}

function onDragStart(event: DragEvent): void {
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

  event.dataTransfer.effectAllowed = 'copyMove';
  event.dataTransfer.setData('application/x-preset-manager', JSON.stringify({ kind, id }));
}

function onDragOver(event: DragEvent): void {
  const target = toElement(event.target);
  if (target?.closest('[data-drop-zone], .pm-row[data-entry-kind="target"]')) {
    event.preventDefault();
    updateDropMarker(event.clientX, event.clientY);
  }
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  clearDropMarkers();
  const raw = event.dataTransfer?.getData('application/x-preset-manager');
  if (!raw || !state.targetDraft) {
    return;
  }

  const payload = JSON.parse(raw) as { kind?: EntryKind; id?: string };
  if (!payload.kind || !payload.id) {
    return;
  }

  applyDrop(payload.kind, payload.id, event.clientX, event.clientY);
}

function onPointerDown(event: PointerEvent): void {
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
  applyDrop(drag.kind, drag.id, event.clientX, event.clientY);
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

function applyDrop(kind: EntryKind, id: string, clientX: number, clientY: number): void {
  const location = getDropLocation(clientX, clientY);
  if (!location) {
    return;
  }

  if (location.zone === 'source') {
    applySourceDrop(kind, id, location);
    return;
  }

  applyTargetDrop(kind, id, location);
}

function applyTargetDrop(kind: EntryKind, id: string, location: DropLocation): void {
  if (!state.targetDraft) {
    return;
  }

  if (kind === 'source') {
    const sourceEntry = getSourceEntries().find(entry => entry.id === id);
    if (!sourceEntry) {
      return;
    }
    state.selectedTargetId = insertPromptFromEntry(state.targetDraft, sourceEntry, location.index);
    state.notice = `已拖入：${sourceEntry.name}`;
  }

  if (kind === 'favorite') {
    const favorite = state.favorites.find(entry => entry.id === id);
    if (!favorite) {
      return;
    }
    state.selectedTargetId = insertPromptFromEntry(state.targetDraft, favorite, location.index);
    state.notice = `已从收藏拖入：${favorite.name}`;
  }

  if (kind === 'target') {
    movePromptToIndex(state.targetDraft, id, getAdjustedMoveIndex(id, location.index));
    state.selectedTargetId = id;
    state.notice = '已重排目标预设';
  }

  markTargetDirty();
  state.activeTab = 'target';
  render();
}

function applySourceDrop(kind: EntryKind, id: string, location: DropLocation): void {
  const sourceDraft = getEditableSourceDraft();
  if (!sourceDraft) {
    return;
  }

  if (kind === 'source') {
    movePromptToIndex(sourceDraft, id, getAdjustedSourceMoveIndex(id, location.index));
    state.selectedSourceId = id;
    state.notice = '已重排来源预设';
  }

  if (kind === 'target') {
    const targetEntry = getTargetEntries().find(entry => entry.id === id);
    if (!targetEntry) {
      return;
    }
    state.selectedSourceId = insertPromptFromEntry(sourceDraft, targetEntry, location.index);
    state.notice = isFavoritesPreset(state.sourceName) ? `已拖入收藏夹：${targetEntry.name}` : `已拖入来源：${targetEntry.name}`;
  }

  if (kind === 'favorite') {
    const favorite = state.favorites.find(entry => entry.id === id);
    if (!favorite) {
      return;
    }
    state.selectedSourceId = insertPromptFromEntry(sourceDraft, favorite, location.index);
    state.notice = `已从收藏拖入：${favorite.name}`;
  }

  markSourceDirty();
  state.activeTab = 'source';
  render();
}

function getDropLocation(clientX: number, clientY: number): DropLocation | null {
  const target = getMountDocument().elementFromPoint(clientX, clientY);
  const row = target?.closest<HTMLElement>('.pm-row[data-entry-kind="source"], .pm-row[data-entry-kind="target"]') ?? null;
  const list = target?.closest<HTMLElement>('.pm-list[data-drop-zone="source"], .pm-list[data-drop-zone="target"]') ?? null;
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

function getAdjustedMoveIndex(id: string, dropIndex: number): number {
  if (!state.targetDraft) {
    return dropIndex;
  }
  const currentIndex = listPromptEntries(state.targetDraft).findIndex(entry => entry.id === id);
  return currentIndex >= 0 && currentIndex < dropIndex ? dropIndex - 1 : dropIndex;
}

function getAdjustedSourceMoveIndex(id: string, dropIndex: number): number {
  const sourceDraft = getEditableSourceDraft();
  if (!sourceDraft) {
    return dropIndex;
  }
  const currentIndex = listPromptEntries(sourceDraft).findIndex(entry => entry.id === id);
  return currentIndex >= 0 && currentIndex < dropIndex ? dropIndex - 1 : dropIndex;
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
    .querySelectorAll<HTMLElement>('#tt-preset-stitcher-root .pm-row-drop-before, #tt-preset-stitcher-root .pm-row-drop-after')
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

function formatBackupTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
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
