import './styles.css';
import {
  createFavoriteFromEntry,
  deepClone,
  FavoriteEntry,
  getContentLength,
  insertPromptFromEntry,
  listPromptEntries,
  materializePreset,
  movePrompt,
  movePromptToIndex,
  Preset,
  PromptEntry,
  removePrompt,
  setPromptEnabled,
  validatePreset,
} from './core';

const HELPER_BUTTON_NAME = '预设缝合';
const STORAGE_NAMESPACE = 'preset-manager';
const FAVORITES_TABLE = 'favorites';
const FAVORITES_KEY = 'v1';
const HOST_ROOT_ID = 'tt-preset-stitcher-host';
const ROOT_ID = 'tt-preset-stitcher-root';
const OPEN_MANAGER_EVENT = 'preset-manager:open';
const DEBUG_STORAGE_KEY = 'preset-manager:debug:v1';
const DEBUG_VARIABLE_KEY = 'presetManagerDebugLogV1';
const DEBUG_ENTRY_LIMIT = 80;
const BUTTON_REGISTRATION_RETRY_LIMIT = 20;
const BUTTON_REGISTRATION_RETRY_DELAY_MS = 250;
const OPEN_REQUEST_DEBOUNCE_MS = 250;

type MobileTab = 'source' | 'target' | 'favorites' | 'preview';
type EntryKind = 'source' | 'target' | 'favorite';
type FilterValue = 'all' | 'enabled' | 'disabled' | 'system' | 'user' | 'assistant';
type RuntimeFunction = (...args: any[]) => unknown;
type RuntimeHost = Record<string, unknown> & {
  TavernHelper?: Record<string, unknown>;
};
type RuntimeCreateOrReplacePreset = (
  presetName: string,
  preset: unknown,
  options?: { render?: 'debounced' | 'immediate' | 'none' },
) => Promise<boolean>;

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
  index: number;
  row: HTMLElement | null;
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
  saving: boolean;
  notice: string;
  error: string;
  selectedSourceId: string;
  selectedTargetId: string;
  selectedFavoriteId: string;
  targetOriginal: Preset | null;
  targetDraft: Preset | null;
  backedUpTargets: Record<string, string>;
  favorites: FavoriteEntry[];
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
  saving: false,
  notice: '',
  error: '',
  selectedSourceId: '',
  selectedTargetId: '',
  selectedFavoriteId: '',
  targetOriginal: null,
  targetDraft: null,
  backedUpTargets: {},
  favorites: [],
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
  state.ready = true;
  diagnose('boot-runtime-success', { favorites: state.favorites.length });
}

async function openManager(): Promise<void> {
  diagnose('open-start');
  await ensureRuntimeReady();
  clearMessage();
  state.targetDraft = null;
  state.targetOriginal = null;
  state.dirty = false;
  hydratePresetList();
  state.isOpen = true;
  render();
  diagnose('open-success', { presets: state.presetNames.length, source: state.sourceName, target: state.targetName });
}

function hydratePresetList(): void {
  state.presetNames = helperGetPresetNames()
    .filter(name => name !== 'in_use')
    .sort((lhs, rhs) => lhs.localeCompare(rhs, 'zh-Hans-CN'));
  diagnose('preset-list-loaded', {
    count: state.presetNames.length,
    sample: state.presetNames.slice(0, 6),
  });

  if (!state.sourceName || !state.presetNames.includes(state.sourceName)) {
    state.sourceName = state.presetNames[0] ?? '';
  }

  if (!state.targetName || !state.presetNames.includes(state.targetName)) {
    state.targetName = state.presetNames.find(name => name !== state.sourceName) ?? state.sourceName;
    resetTargetDraft();
  }

  if (!state.targetDraft) {
    resetTargetDraft();
  }
}

function resetTargetDraft(): void {
  const targetPreset = getPresetByName(state.targetName);
  state.targetOriginal = targetPreset ? deepClone(targetPreset) : null;
  state.targetDraft = targetPreset ? deepClone(targetPreset) : null;
  state.dirty = false;
  state.selectedTargetId = '';
}

function getPresetByName(name: string): Preset | null {
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
  const selected = getPreviewEntry();
  const favoriteEntries = getFilteredFavorites();
  const validation = state.targetDraft ? validatePreset(state.targetDraft) : null;

  return `
    <div class="pm-backdrop" data-action="backdrop-close"></div>
    <section class="pm-panel" role="dialog" aria-modal="true" aria-label="预设缝合管理器" data-active-tab="${state.activeTab}">
      <header class="pm-header">
        <div class="pm-title-block">
          <div class="pm-title">预设缝合管理器</div>
          <div class="pm-subtitle">${escapeHtml(getStatusText(sourceEntries.length, targetEntries.length, favoriteEntries.length))}</div>
        </div>
        <div class="pm-header-actions">
          <button class="pm-icon-button" type="button" data-action="refresh" title="刷新预设"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button>
          <button class="pm-icon-button" type="button" data-action="close" title="关闭"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>
      </header>

      <nav class="pm-mobile-tabs" aria-label="移动端视图">
        ${renderTab('source', '来源')}
        ${renderTab('target', '目标')}
        ${renderTab('favorites', '收藏')}
        ${renderTab('preview', '预览')}
      </nav>

      ${renderMessage()}

      <main class="pm-body">
        ${renderPresetPane('source', '来源预设', state.sourceName, state.sourceQuery, state.sourceFilter, sourceEntries)}
        ${renderTransferColumn()}
        ${renderPresetPane('target', '目标预设', state.targetName, state.targetQuery, state.targetFilter, targetEntries)}
        <aside class="pm-side-pane" data-pane="favorites">
          ${renderFavorites(favoriteEntries)}
          ${renderInspector(selected, validation)}
        </aside>
        <section class="pm-preview-pane" data-pane="preview">
          ${renderInspector(selected, validation)}
        </section>
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
        <h2>${title}</h2>
        <span class="pm-count">${entries.length}</span>
      </div>
      <div class="pm-controls">
        <label class="pm-field">
          <span>预设</span>
          <select name="${selectName}" data-action="${action}">
            ${state.presetNames.map(name => `<option value="${escapeAttr(name)}" ${name === selectedPreset ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
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
  const rowActions = kind === 'source'
    ? `
      <button class="pm-row-action" type="button" data-action="favorite-source" data-id="${escapeAttr(entry.id)}" title="收藏条目"><i class="fa-regular fa-star" aria-hidden="true"></i></button>
      <button class="pm-row-action" type="button" data-action="copy-source" data-id="${escapeAttr(entry.id)}" title="复制到目标"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
    `
    : `
      <button class="pm-row-action" type="button" data-action="target-toggle" data-id="${escapeAttr(entry.id)}" title="${entry.enabled ? '设为禁用' : '设为启用'}"><i class="fa-solid ${entry.enabled ? 'fa-toggle-on' : 'fa-toggle-off'}" aria-hidden="true"></i></button>
      <button class="pm-row-action" type="button" data-action="target-up" data-id="${escapeAttr(entry.id)}" title="上移"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
      <button class="pm-row-action" type="button" data-action="target-down" data-id="${escapeAttr(entry.id)}" title="下移"><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button>
      <button class="pm-row-action" type="button" data-action="favorite-target" data-id="${escapeAttr(entry.id)}" title="收藏条目"><i class="fa-regular fa-star" aria-hidden="true"></i></button>
      <button class="pm-row-action pm-danger" type="button" data-action="target-remove" data-id="${escapeAttr(entry.id)}" title="从目标预设移除"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
    `;

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
      <div class="pm-row-actions">${rowActions}</div>
    </div>
  `;
}

function renderTransferColumn(): string {
  return `
    <section class="pm-transfer" aria-label="条目操作">
      <button class="pm-transfer-button" type="button" data-action="copy-selected" title="复制选中的来源条目到目标"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i><span>复制</span></button>
      <button class="pm-transfer-button" type="button" data-action="favorite-selected" title="收藏选中的来源条目"><i class="fa-regular fa-star" aria-hidden="true"></i><span>收藏</span></button>
      <button class="pm-transfer-button" type="button" data-action="insert-favorite" title="把选中的收藏插入目标"><i class="fa-solid fa-bookmark" aria-hidden="true"></i><span>插入</span></button>
    </section>
  `;
}

function renderFavorites(favorites: FavoriteEntry[]): string {
  return `
    <div class="pm-favorites">
      <div class="pm-pane-head">
        <h2>收藏夹</h2>
        <span class="pm-count">${favorites.length}</span>
      </div>
      <label class="pm-field">
        <span>搜索</span>
        <input name="favoriteQuery" value="${escapeAttr(state.favoriteQuery)}" placeholder="收藏名或来源" autocomplete="off" />
      </label>
      <div class="pm-list pm-list-compact" data-drop-zone="favorite">
        ${favorites.length ? favorites.map(renderFavoriteRow).join('') : renderEmpty('favorite')}
      </div>
    </div>
  `;
}

function renderFavoriteRow(favorite: FavoriteEntry): string {
  const selected = state.selectedFavoriteId === favorite.id ? 'is-selected' : '';
  return `
    <div class="pm-row pm-row-favorite ${selected}" role="button" tabindex="0" data-entry-kind="favorite" data-id="${escapeAttr(favorite.id)}">
      <div class="pm-row-grip" data-drag-handle="true" aria-hidden="true" title="拖拽条目"><i class="fa-solid fa-bookmark"></i></div>
      <div class="pm-row-main">
        <div class="pm-row-title">${escapeHtml(favorite.name)}</div>
        <div class="pm-row-meta">
          <span>${escapeHtml(favorite.sourcePreset)}</span>
          <span>${favorite.enabled ? '启用' : '禁用'}</span>
          <span>${getContentLength(favorite.prompt)} 字</span>
        </div>
      </div>
      <div class="pm-row-actions">
        <button class="pm-row-action" type="button" data-action="insert-favorite-id" data-id="${escapeAttr(favorite.id)}" title="插入目标"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
        <button class="pm-row-action pm-danger" type="button" data-action="delete-favorite" data-id="${escapeAttr(favorite.id)}" title="删除收藏"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </div>
    </div>
  `;
}

function renderInspector(entry: PromptEntry | FavoriteEntry | null, validation: ReturnType<typeof validatePreset> | null): string {
  const name = entry ? ('prompt' in entry ? entry.name : '未命名条目') : '未选择条目';
  const prompt = entry?.prompt;
  const content = prompt && typeof prompt.content === 'string' ? prompt.content : '';
  const role = prompt && typeof prompt.role === 'string' ? prompt.role : 'system';
  const identifier = prompt && typeof prompt.identifier === 'string' ? prompt.identifier : '';

  return `
    <div class="pm-inspector">
      <div class="pm-pane-head">
        <h2>预览</h2>
        <span class="pm-count">${content.length} 字</span>
      </div>
      <div class="pm-inspector-fields">
        <div><span>名称</span><strong>${escapeHtml(name)}</strong></div>
        <div><span>角色</span><strong>${escapeHtml(role)}</strong></div>
        <div><span>ID</span><code>${escapeHtml(identifier)}</code></div>
      </div>
      <textarea readonly spellcheck="false">${escapeHtml(content)}</textarea>
      ${renderValidation(validation)}
    </div>
  `;
}

function renderValidation(validation: ReturnType<typeof validatePreset> | null): string {
  if (!validation || validation.ok) {
    return '';
  }

  const parts: string[] = [];
  if (validation.duplicateIdentifiers.length) {
    parts.push(`重复 ID ${validation.duplicateIdentifiers.length}`);
  }
  if (validation.missingOrderReferences.length) {
    parts.push(`缺失引用 ${validation.missingOrderReferences.length}`);
  }
  if (validation.promptsWithoutIdentifiers) {
    parts.push(`无 ID 条目 ${validation.promptsWithoutIdentifiers}`);
  }

  return `<div class="pm-structure-warning"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>${escapeHtml(parts.join('，'))}</div>`;
}

function renderMessage(): string {
  if (state.error) {
    return `<div class="pm-message pm-message-error">${escapeHtml(state.error)}</div>`;
  }
  if (state.notice) {
    return `<div class="pm-message">${escapeHtml(state.notice)}</div>`;
  }
  return '';
}

function renderEmpty(kind: string): string {
  const label = kind === 'favorite' ? '暂无收藏' : '没有匹配条目';
  return `<div class="pm-empty">${label}</div>`;
}

function getStatusText(sourceCount: number, targetCount: number, favoriteCount: number): string {
  if (!state.presetNames.length) {
    return '未发现 OpenAI 预设';
  }
  return `来源 ${sourceCount} 条，目标 ${targetCount} 条，收藏 ${favoriteCount} 条`;
}

function getSourceEntries(): PromptEntry[] {
  const preset = getPresetByName(state.sourceName);
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

function getFilteredFavorites(): FavoriteEntry[] {
  const query = state.favoriteQuery.trim().toLocaleLowerCase();
  if (!query) {
    return state.favorites;
  }
  return state.favorites.filter(item => `${item.name}\n${item.sourcePreset}\n${item.prompt.content ?? ''}`.toLocaleLowerCase().includes(query));
}

function getPreviewEntry(): PromptEntry | FavoriteEntry | null {
  const source = getSourceEntries().find(entry => entry.id === state.selectedSourceId);
  if (source) {
    return source;
  }
  const target = getTargetEntries().find(entry => entry.id === state.selectedTargetId);
  if (target) {
    return target;
  }
  return state.favorites.find(entry => entry.id === state.selectedFavoriteId) ?? null;
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
    state.sourceName = target.value;
    state.selectedSourceId = '';
  }

  if (target.name === 'targetName') {
    if (state.dirty && target.value !== state.targetName && !window.confirm('切换目标预设会放弃当前未保存修改。继续切换？')) {
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

  render();
}

function onRootInput(event: Event): void {
  const target = toInputElement(event.target);
  if (!target) {
    return;
  }

  updateInputState(target);

  if (isComposingInput || ('isComposing' in event && Boolean((event as InputEvent).isComposing))) {
    return;
  }

  renderPreservingInput(target);
}

function onCompositionStart(event: CompositionEvent): void {
  const target = toInputElement(event.target);
  if (target && isManagedInput(target)) {
    isComposingInput = true;
  }
}

function onCompositionEnd(event: CompositionEvent): void {
  const target = toInputElement(event.target);
  if (!target || !isManagedInput(target)) {
    isComposingInput = false;
    return;
  }

  isComposingInput = false;
  updateInputState(target);
  renderPreservingInput(target);
}

function updateInputState(target: HTMLInputElement): void {
  if (target.name === 'sourceQuery') {
    state.sourceQuery = target.value;
  }
  if (target.name === 'targetQuery') {
    state.targetQuery = target.value;
  }
  if (target.name === 'favoriteQuery') {
    state.favoriteQuery = target.value;
  }
}

function isManagedInput(target: HTMLInputElement): boolean {
  return ['sourceQuery', 'targetQuery', 'favoriteQuery'].includes(target.name);
}

function renderPreservingInput(target: HTMLInputElement): void {
  const name = target.name;
  const selectionStart = target.selectionStart;
  const selectionEnd = target.selectionEnd;
  const targetDocument = target.ownerDocument ?? getMountDocument();

  render();

  const replacement = targetDocument.querySelector<HTMLInputElement>(`#${ROOT_ID} input[name="${CSS.escape(name)}"]`);
  if (!replacement) {
    return;
  }

  replacement.focus();
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
      hydratePresetList();
      state.notice = '已刷新预设列表';
      render();
      return;
    case 'tab':
      state.activeTab = (element.dataset.tab as MobileTab | undefined) ?? 'source';
      render();
      return;
    case 'select-source':
    case 'select-target':
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
    resetTargetDraft();
  }

  state.isOpen = false;
  render();
}

function selectRow(row: HTMLElement): void {
  const kind = row.dataset.entryKind as EntryKind | undefined;
  const id = row.dataset.id ?? '';
  if (kind === 'source') {
    state.selectedSourceId = id;
    state.activeTab = state.activeTab === 'preview' ? 'preview' : 'source';
  }
  if (kind === 'target') {
    state.selectedTargetId = id;
    state.activeTab = state.activeTab === 'preview' ? 'preview' : 'target';
  }
  if (kind === 'favorite') {
    state.selectedFavoriteId = id;
    state.activeTab = state.activeTab === 'preview' ? 'preview' : 'favorites';
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
  state.dirty = true;
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

  state.favorites = [createFavoriteFromEntry(entry, kind === 'source' ? state.sourceName : state.targetName), ...state.favorites];
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
  state.dirty = true;
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
  }
  render();
}

function toggleTarget(id: string): void {
  const entry = getTargetEntries().find(item => item.id === id);
  if (!entry || !state.targetDraft) {
    return;
  }
  setPromptEnabled(state.targetDraft, id, !entry.enabled);
  state.dirty = true;
  render();
}

function moveTarget(id: string, direction: -1 | 1): void {
  if (!state.targetDraft) {
    return;
  }
  movePrompt(state.targetDraft, id, direction);
  state.dirty = true;
  render();
}

function removeTarget(id: string): void {
  if (!state.targetDraft) {
    return;
  }
  removePrompt(state.targetDraft, id);
  state.selectedTargetId = '';
  state.dirty = true;
  render();
}

async function saveTargetDraft(): Promise<void> {
  if (!state.targetDraft || !state.targetName || state.saving) {
    return;
  }

  const validation = validatePreset(state.targetDraft);
  if (!validation.ok) {
    state.error = '目标预设存在结构问题，请先处理重复 ID 或缺失引用';
    render();
    return;
  }

  state.saving = true;
  render();

  try {
    if (state.targetOriginal && !state.backedUpTargets[state.targetName]) {
      const backupName = `${state.targetName}.bak-preset-manager-${formatBackupTimestamp(new Date())}`;
      const savedBackupName = await persistPreset(backupName, state.targetOriginal, false);
      state.backedUpTargets[state.targetName] = savedBackupName;
    }

    const savedName = await persistPreset(state.targetName, state.targetDraft, true);
    state.targetName = savedName;
    state.targetOriginal = deepClone(state.targetDraft);
    state.dirty = false;
    state.notice = `已保存预设。备份：${state.backedUpTargets[savedName] ?? state.backedUpTargets[state.targetName] ?? '本次未新建'}`;
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
  if (!state.targetDraft) {
    return;
  }

  const location = getTargetDropLocation(clientX, clientY);
  if (!location) {
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

  state.dirty = true;
  state.activeTab = 'target';
  render();
}

function getTargetDropLocation(clientX: number, clientY: number): DropLocation | null {
  const target = getMountDocument().elementFromPoint(clientX, clientY);
  const targetRow = target?.closest<HTMLElement>('.pm-row[data-entry-kind="target"]') ?? null;
  const targetList = target?.closest<HTMLElement>('.pm-list[data-drop-zone="target"]') ?? null;
  if (!targetRow && !targetList) {
    return null;
  }

  if (!targetRow) {
    return {
      index: state.targetDraft ? listPromptEntries(state.targetDraft).length : 0,
      row: null,
    };
  }

  return {
    index: getDropIndex(targetRow, clientY),
    row: targetRow,
  };
}

function getDropIndex(row: HTMLElement, clientY: number): number {
  const rowIndex = Number(row.dataset.index);
  if (!Number.isFinite(rowIndex)) {
    return state.targetDraft ? listPromptEntries(state.targetDraft).length : 0;
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

function updateDropMarker(clientX: number, clientY: number): void {
  clearDropMarkers();
  const location = getTargetDropLocation(clientX, clientY);
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
