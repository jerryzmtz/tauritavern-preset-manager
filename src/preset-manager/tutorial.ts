type TutorialPlacement = 'top' | 'right' | 'bottom' | 'left' | 'center';
type TutorialAction = 'prev' | 'next' | 'dismiss';

type TutorialStep = {
  selector?: string | readonly string[];
  title: string;
  content: string;
  placement?: TutorialPlacement;
};

type TutorialState = {
  version: 1;
  revision: number;
  disabled: boolean;
  completed: boolean;
};

type TutorialOptions = {
  manual?: boolean;
  interrupt?: boolean;
};

type TutorialRootSource = ParentNode | (() => ParentNode | null | undefined);

type PresetManagerTutorialOptions = {
  root?: TutorialRootSource;
};

export type PresetManagerTutorial = {
  maybeStart(options?: { interrupt?: boolean }): void;
  start(options?: TutorialOptions): void;
  close(): void;
};

type ActiveTutorial = {
  steps: TutorialStep[];
  index: number;
  targetCache: Map<number, HTMLElement | null>;
};

type TutorialRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

const STORAGE_KEY = 'preset-manager:tutorial:v1';
const STYLE_ID = 'pm-tutorial-style';
const OVERLAY_CLASS = 'pm-tutorial-overlay';
const STATE_REVISION = 1;
const TUTORIAL_Z_INDEX = 30020;
const DEFAULT_STATE: TutorialState = {
  version: 1,
  revision: STATE_REVISION,
  disabled: false,
  completed: false,
};

const PRESET_MANAGER_STEPS: TutorialStep[] = [
  {
    selector: '.pm-panel',
    title: '预设管理',
    content:
      '这里用左右两栏管理预设里的提示词条目。复制、删除、排序、开关和编辑都会先停留在页面里，只有点击底部保存预设才会真正写入。',
    placement: 'center',
  },
  {
    selector: '[data-pm-tutorial="source-pane"]',
    title: '来源预设',
    content: '左侧选择要参考的预设。搜索和过滤只改变显示结果，不会修改预设。',
    placement: 'right',
  },
  {
    selector: '[data-pm-tutorial="target-pane"]',
    title: '目标预设',
    content: '中间选择要保存到的预设。复制过来的条目、顺序和开关状态都会先作为未保存修改等待确认。',
    placement: 'left',
  },
  {
    selector: '[data-pm-tutorial="entry-row"]',
    title: '条目行',
    content: '点击条目可以在右侧查看正文。桌面端可以拖拽排序，也可以使用行内按钮收藏或删除。',
    placement: 'right',
  },
  {
    selector: '[data-pm-tutorial="entry-toggle"]',
    title: '条目开关',
    content: '这个开关只改变页面草稿。你可以连续调整多个条目，最后统一保存，或者用放弃修改回到原状态。',
    placement: 'right',
  },
  {
    selector: '[data-pm-tutorial="compare-bar"]',
    title: '比对模式',
    content:
      '开启后会高亮来源和目标的正文差异，也可以点摘要徽标过滤不同类型的条目。选中条目后，仍然可以编辑当前选中的那一侧。',
    placement: 'bottom',
  },
  {
    selector: '[data-pm-tutorial="detail-pane"]',
    title: '条目详情',
    content: '右侧显示当前条目的角色和正文。比对模式会并排显示两边正文，直接在两边正文框里编辑即可。',
    placement: 'left',
  },
  {
    selector: '[data-pm-tutorial="save-bar"]',
    title: '保存和放弃',
    content: '底部会提示是否有未保存修改。保存预设才会真正写入，放弃修改会丢掉当前页面草稿。',
    placement: 'top',
  },
  {
    selector: '[data-pm-tutorial="version-manager"]',
    title: '版本管理',
    content: '标题旁的版本按钮用于检查脚本版本、切换到最新版或回退旧版本。它不会保存或丢弃预设草稿。',
    placement: 'bottom',
  },
];

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const normalizeState = (raw: unknown): TutorialState => {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE };
  const data = raw as Partial<TutorialState>;
  if (typeof data.revision !== 'number' || data.revision < STATE_REVISION) return { ...DEFAULT_STATE };
  return {
    version: 1,
    revision: STATE_REVISION,
    disabled: data.disabled === true,
    completed: data.completed === true,
  };
};

const getSelectors = (step: TutorialStep): readonly string[] => {
  if (!step.selector) return [];
  return Array.isArray(step.selector) ? step.selector : [step.selector];
};

const isTutorialAction = (action: string | undefined): action is TutorialAction =>
  action === 'prev' || action === 'next' || action === 'dismiss';

export function createPresetManagerTutorial(options: PresetManagerTutorialOptions = {}): PresetManagerTutorial {
  let activeTutorial: ActiveTutorial | null = null;
  let overlay: HTMLElement | null = null;
  let blocker: HTMLElement | null = null;
  let highlight: HTMLElement | null = null;
  let popover: HTMLElement | null = null;
  let maskSvg: SVGSVGElement | null = null;
  let maskPath: SVGPathElement | null = null;
  let repositionRaf: number | null = null;
  let scrollRaf: number | null = null;
  let lastActionAt = 0;

  const getConfiguredRoot = (): ParentNode | null | undefined => {
    return typeof options.root === 'function' ? options.root() : options.root;
  };

  const getDoc = (): Document => {
    const root = getConfiguredRoot();
    if (root && root.nodeType === 9) return root as Document;
    if (root && 'ownerDocument' in root && root.ownerDocument) return root.ownerDocument;
    return document;
  };

  const getWin = (): Window => getDoc().defaultView || window;

  const getState = (): TutorialState => {
    try {
      return normalizeState(JSON.parse(getWin().localStorage.getItem(STORAGE_KEY) || 'null'));
    } catch {
      return { ...DEFAULT_STATE };
    }
  };

  const saveState = (state: TutorialState): void => {
    try {
      getWin().localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 教程完成状态只是体验优化，localStorage 不可用时直接跳过。
    }
  };

  const getQueryRoots = (): ParentNode[] => {
    const roots: ParentNode[] = [];
    const addRoot = (root: ParentNode | null | undefined): void => {
      if (root && !roots.includes(root)) roots.push(root);
    };
    addRoot(getConfiguredRoot());
    addRoot(getDoc());
    return roots;
  };

  const injectStyles = (): void => {
    const doc = getDoc();
    const existingStyle = doc.getElementById(STYLE_ID);
    const style =
      existingStyle?.tagName.toLowerCase() === 'style'
        ? (existingStyle as HTMLStyleElement)
        : doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${OVERLAY_CLASS} {
        position: fixed;
        inset: 0;
        z-index: ${TUTORIAL_Z_INDEX};
        pointer-events: auto;
        isolation: isolate;
        color: var(--SmartThemeBodyColor, #e7e1d0);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      }
      .pm-tutorial-blocker {
        position: fixed;
        inset: 0;
        z-index: 0;
        background: rgba(0, 0, 0, 0.001);
        pointer-events: auto;
        touch-action: none;
        -webkit-tap-highlight-color: transparent;
      }
      .pm-tutorial-mask {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        z-index: 1;
        pointer-events: none;
        contain: layout paint style;
      }
      .pm-tutorial-mask path {
        fill: color-mix(in srgb, var(--SmartThemeShadowColor, #141713) 72%, transparent);
      }
      .pm-tutorial-highlight {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 2;
        border: 2px solid var(--SmartThemeQuoteColor, #b9c49a);
        border-radius: 10px;
        box-shadow: 0 0 0 5px color-mix(in srgb, var(--SmartThemeQuoteColor, #b9c49a) 25%, transparent);
        pointer-events: none;
        opacity: 0;
        transition: transform 170ms ease-out, width 170ms ease-out, height 170ms ease-out, opacity 120ms ease-out;
        will-change: transform, width, height;
        contain: layout paint style;
      }
      .pm-tutorial-popover {
        position: fixed;
        z-index: 3;
        width: min(360px, calc(100vw - 24px));
        color: var(--SmartThemeBodyColor, #e7e1d0);
        background: color-mix(in srgb, var(--SmartThemeBlurTintColor, #102021) 96%, var(--SmartThemeBodyColor, #e7e1d0) 4%);
        border: 1px solid var(--SmartThemeBorderColor, #7c8170);
        border-radius: 10px;
        box-shadow: 0 18px 48px color-mix(in srgb, var(--SmartThemeShadowColor, #141713) 50%, transparent);
        overflow: hidden;
        backdrop-filter: blur(var(--SmartThemeBlurStrength, 12px));
        -webkit-backdrop-filter: blur(var(--SmartThemeBlurStrength, 12px));
      }
      .pm-tutorial-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 13px;
        border-bottom: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor, #7c8170) 62%, transparent);
        background: color-mix(in srgb, var(--SmartThemeBlurTintColor, #102021) 84%, transparent);
        font-size: 14px;
        font-weight: 700;
      }
      .pm-tutorial-head i {
        color: var(--SmartThemeQuoteColor, #b9c49a);
      }
      .pm-tutorial-close {
        display: inline-grid;
        place-items: center;
        width: 32px;
        height: 32px;
        margin: -5px -6px -5px auto;
        padding: 0;
        color: color-mix(in srgb, var(--SmartThemeBodyColor, #e7e1d0) 72%, transparent);
        background: transparent;
        border: 1px solid transparent;
        border-radius: 8px;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
      }
      .pm-tutorial-close:hover,
      .pm-tutorial-close:focus-visible {
        color: var(--SmartThemeBodyColor, #e7e1d0);
        border-color: color-mix(in srgb, var(--SmartThemeBorderColor, #7c8170) 62%, transparent);
        background: color-mix(in srgb, var(--SmartThemeQuoteColor, #b9c49a) 12%, transparent);
      }
      .pm-tutorial-body {
        padding: 13px 14px 11px;
        color: color-mix(in srgb, var(--SmartThemeBodyColor, #e7e1d0) 86%, transparent);
        font-size: 13px;
        line-height: 1.65;
      }
      .pm-tutorial-progress {
        margin-top: 10px;
        color: color-mix(in srgb, var(--SmartThemeBodyColor, #e7e1d0) 58%, transparent);
        font-size: 11px;
      }
      .pm-tutorial-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        padding: 10px 12px;
        border-top: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor, #7c8170) 62%, transparent);
        background: color-mix(in srgb, var(--SmartThemeBlurTintColor, #102021) 72%, transparent);
      }
      .pm-tutorial-btn {
        width: 100%;
        min-width: 0;
        min-height: 34px;
        padding: 6px 10px;
        color: var(--SmartThemeBodyColor, #e7e1d0);
        background: color-mix(in srgb, var(--SmartThemeBlurTintColor, #102021) 84%, transparent);
        border: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor, #7c8170) 62%, transparent);
        border-radius: 8px;
        cursor: pointer;
        font-size: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
      }
      .pm-tutorial-btn:hover:not(:disabled),
      .pm-tutorial-btn:focus-visible:not(:disabled) {
        border-color: var(--SmartThemeQuoteColor, #b9c49a);
        background: color-mix(in srgb, var(--SmartThemeQuoteColor, #b9c49a) 14%, var(--SmartThemeBlurTintColor, #102021) 86%);
      }
      .pm-tutorial-btn.primary {
        color: color-mix(in srgb, var(--SmartThemeQuoteColor, #b9c49a) 35%, var(--SmartThemeBodyColor, #e7e1d0) 65%);
        border-color: color-mix(in srgb, var(--SmartThemeQuoteColor, #b9c49a) 66%, var(--SmartThemeBorderColor, #7c8170) 34%);
        background: color-mix(in srgb, var(--SmartThemeQuoteColor, #b9c49a) 16%, var(--SmartThemeBlurTintColor, #102021) 84%);
        font-weight: 700;
      }
      .pm-tutorial-btn:disabled {
        opacity: 0.46;
        cursor: not-allowed;
      }
      @media (prefers-reduced-motion: reduce) {
        .pm-tutorial-highlight {
          transition: none;
        }
      }
      @media (max-width: 640px) {
        .pm-tutorial-popover {
          width: calc(100vw - 20px);
          max-height: var(--pm-tutorial-mobile-max-height, min(380px, 42dvh));
          display: flex;
          flex-direction: column;
          border-radius: 10px;
        }
        .pm-tutorial-highlight {
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--SmartThemeQuoteColor, #b9c49a) 25%, transparent);
        }
        .pm-tutorial-body {
          overflow-y: auto;
        }
        .pm-tutorial-btn {
          min-height: 40px;
        }
      }
    `;
    if (!existingStyle) doc.head.appendChild(style);
  };

  const isVisibleElement = (element: HTMLElement): boolean => {
    if (!element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getWin().getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };

  const queryVisibleElement = (selector: string): HTMLElement | null => {
    for (const root of getQueryRoots()) {
      const candidates = root.querySelectorAll<HTMLElement>(selector);
      for (const element of candidates) {
        if (isVisibleElement(element)) return element;
      }
    }
    return null;
  };

  const findTarget = (tutorial: ActiveTutorial, index: number): HTMLElement | null => {
    const cached = tutorial.targetCache.get(index);
    if (cached && isVisibleElement(cached)) return cached;
    if (tutorial.targetCache.has(index)) tutorial.targetCache.delete(index);

    for (const selector of getSelectors(tutorial.steps[index])) {
      const target = queryVisibleElement(selector);
      if (target) {
        tutorial.targetCache.set(index, target);
        return target;
      }
    }
    tutorial.targetCache.set(index, null);
    return null;
  };

  const getViewportRect = (): TutorialRect => {
    const win = getWin();
    const visual = win.visualViewport;
    const left = visual?.offsetLeft ?? 0;
    const top = visual?.offsetTop ?? 0;
    const width = visual?.width ?? win.innerWidth;
    const height = visual?.height ?? win.innerHeight;
    return { left, top, width, height, right: left + width, bottom: top + height };
  };

  const getElementRect = (element: HTMLElement | null): TutorialRect => {
    const viewport = getViewportRect();
    if (!element) {
      return {
        left: viewport.left + viewport.width / 2 - 1,
        top: viewport.top + viewport.height / 2 - 1,
        right: viewport.left + viewport.width / 2 + 1,
        bottom: viewport.top + viewport.height / 2 + 1,
        width: 2,
        height: 2,
      };
    }
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  };

  const positionFor = (
    target: TutorialRect,
    popoverRect: DOMRect,
    placement: TutorialPlacement,
  ): { left: number; top: number } => {
    const viewport = getViewportRect();
    const gap = 12;
    const margin = 12;
    const centerLeft = target.left + target.width / 2 - popoverRect.width / 2;
    const centerTop = target.top + target.height / 2 - popoverRect.height / 2;
    let left = centerLeft;
    let top = target.bottom + gap;

    if (placement === 'top') top = target.top - popoverRect.height - gap;
    if (placement === 'left') {
      left = target.left - popoverRect.width - gap;
      top = centerTop;
    }
    if (placement === 'right') {
      left = target.right + gap;
      top = centerTop;
    }
    if (placement === 'center') {
      left = viewport.left + viewport.width / 2 - popoverRect.width / 2;
      top = viewport.top + viewport.height / 2 - popoverRect.height / 2;
    }

    if (placement !== 'center') {
      const hasRoomTop = target.top - viewport.top >= popoverRect.height + gap + margin;
      const hasRoomBottom = viewport.bottom - target.bottom >= popoverRect.height + gap + margin;
      if (top < viewport.top + margin && hasRoomBottom) top = target.bottom + gap;
      if (top + popoverRect.height > viewport.bottom - margin && hasRoomTop)
        top = target.top - popoverRect.height - gap;
    }

    return {
      left: clamp(
        left,
        viewport.left + margin,
        Math.max(viewport.left + margin, viewport.right - popoverRect.width - margin),
      ),
      top: clamp(
        top,
        viewport.top + margin,
        Math.max(viewport.top + margin, viewport.bottom - popoverRect.height - margin),
      ),
    };
  };

  const isMobileTutorialViewport = (): boolean => {
    const viewport = getViewportRect();
    const win = getWin();
    const coarsePointer = win.matchMedia?.('(pointer: coarse)').matches === true;
    return viewport.width <= 640 || (coarsePointer && viewport.width <= 820);
  };

  const getMobilePopoverPosition = (target: TutorialRect, popoverRect: DOMRect): { left: number; top: number } => {
    const viewport = getViewportRect();
    const gap = 12;
    const margin = 10;
    const minLeft = viewport.left + margin;
    const minTop = viewport.top + margin;
    const maxLeft = Math.max(minLeft, viewport.right - popoverRect.width - margin);
    const maxTop = Math.max(minTop, viewport.bottom - popoverRect.height - margin);
    const left = clamp(viewport.left + (viewport.width - popoverRect.width) / 2, minLeft, maxLeft);

    const targetInUpperHalf = target.top + target.height / 2 < viewport.top + viewport.height / 2;
    const preferredTop = targetInUpperHalf ? maxTop : minTop;
    const fallbackTop = targetInUpperHalf ? minTop : maxTop;
    const hasVerticalGap = (top: number): boolean =>
      top + popoverRect.height <= target.top - gap || top >= target.bottom + gap;

    if (hasVerticalGap(preferredTop)) return { left, top: preferredTop };
    if (hasVerticalGap(fallbackTop)) return { left, top: fallbackTop };

    const spaceAbove = Math.max(0, target.top - viewport.top);
    const spaceBelow = Math.max(0, viewport.bottom - target.bottom);
    const top = spaceBelow >= spaceAbove ? target.bottom + gap : target.top - popoverRect.height - gap;
    return { left, top: clamp(top, minTop, maxTop) };
  };

  const getTargetSafeRect = (popoverRect?: TutorialRect | null): TutorialRect => {
    const viewport = getViewportRect();
    const margin = 10;
    const gap = 12;
    let top = viewport.top + margin;
    let bottom = viewport.bottom - margin;

    if (popoverRect && popoverRect.bottom > viewport.top && popoverRect.top < viewport.bottom) {
      const popoverCenterY = popoverRect.top + popoverRect.height / 2;
      if (popoverCenterY < viewport.top + viewport.height / 2) {
        top = Math.max(top, popoverRect.bottom + gap);
      } else {
        bottom = Math.min(bottom, popoverRect.top - gap);
      }
    }

    if (bottom - top < 120) {
      top = viewport.top + margin;
      bottom = viewport.bottom - margin;
    }

    return {
      left: viewport.left + margin,
      top,
      right: viewport.right - margin,
      bottom,
      width: Math.max(0, viewport.width - margin * 2),
      height: Math.max(0, bottom - top),
    };
  };

  const getCurrentPopoverRect = (): TutorialRect | null => {
    if (!popover || popover.style.visibility === 'hidden') return null;
    const rect = popover.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  };

  const requestReposition = (): void => {
    const win = getWin();
    if (repositionRaf !== null) win.cancelAnimationFrame(repositionRaf);
    repositionRaf = win.requestAnimationFrame(() => {
      repositionRaf = null;
      positionElements();
    });
  };

  const getScrollParent = (element: HTMLElement): HTMLElement | null => {
    const doc = getDoc();
    let current = element.parentElement;
    while (current && current !== doc.body) {
      const style = getWin().getComputedStyle(current);
      const canScroll =
        /(auto|scroll|overlay)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 1;
      if (canScroll) return current;
      current = current.parentElement;
    }
    return (doc.scrollingElement as HTMLElement | null) || doc.documentElement;
  };

  const scrollElementBy = (element: HTMLElement, deltaY: number): boolean => {
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const nextScrollTop = clamp(element.scrollTop + deltaY, 0, maxScrollTop);
    if (Math.abs(nextScrollTop - element.scrollTop) < 1) return false;
    element.scrollTop = nextScrollTop;
    return true;
  };

  const scrollTargetIntoSafeRect = (target: HTMLElement, avoidPopover: boolean): boolean => {
    const safeRect = getTargetSafeRect(avoidPopover ? getCurrentPopoverRect() : null);
    const rect = target.getBoundingClientRect();
    let deltaY = 0;

    if (rect.height > safeRect.height) {
      if (rect.top > safeRect.top) {
        deltaY = rect.top - safeRect.top;
      } else if (rect.bottom < safeRect.bottom) {
        deltaY = rect.bottom - safeRect.bottom;
      }
    } else if (rect.top < safeRect.top) {
      deltaY = rect.top - safeRect.top;
    } else if (rect.bottom > safeRect.bottom) {
      deltaY = rect.bottom - safeRect.bottom;
    }

    if (Math.abs(deltaY) < 1) return false;
    const scrollParent = getScrollParent(target);
    if (scrollParent && scrollElementBy(scrollParent, deltaY)) return true;
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  };

  const isTargetInsideSafeRect = (target: HTMLElement, avoidPopover: boolean): boolean => {
    const safeRect = getTargetSafeRect(avoidPopover ? getCurrentPopoverRect() : null);
    const rect = target.getBoundingClientRect();
    const horizontalMargin = 4;
    const hasHorizontalPresence =
      rect.right >= safeRect.left + horizontalMargin && rect.left <= safeRect.right - horizontalMargin;
    const hasVerticalPresence =
      rect.height > safeRect.height
        ? rect.bottom >= safeRect.top && rect.top <= safeRect.bottom
        : rect.top >= safeRect.top && rect.bottom <= safeRect.bottom;
    return hasHorizontalPresence && hasVerticalPresence;
  };

  const scheduleTargetIntoView = (): void => {
    if (!activeTutorial) return;
    const win = getWin();
    if (scrollRaf !== null) {
      win.cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }

    const tutorial = activeTutorial;
    const index = tutorial.index;
    const target = findTarget(tutorial, index);
    if (!target) {
      requestReposition();
      return;
    }

    const mobile = isMobileTutorialViewport();
    if (isTargetInsideSafeRect(target, mobile)) {
      requestReposition();
      return;
    }

    scrollTargetIntoSafeRect(target, mobile);
    scrollRaf = win.requestAnimationFrame(() => {
      scrollRaf = win.requestAnimationFrame(() => {
        scrollRaf = null;
        if (activeTutorial === tutorial && activeTutorial.index === index) requestReposition();
      });
    });
  };

  function positionElements(): void {
    if (!activeTutorial || !highlight || !popover) return;
    const step = activeTutorial.steps[activeTutorial.index];
    const target = findTarget(activeTutorial, activeTutorial.index);
    const viewport = getViewportRect();
    const mobile = isMobileTutorialViewport();
    if (mobile) {
      const mobileMaxHeight = Math.max(160, Math.min(360, viewport.height * 0.42));
      popover.style.setProperty('--pm-tutorial-mobile-max-height', `${Math.round(mobileMaxHeight)}px`);
    } else {
      popover.style.removeProperty('--pm-tutorial-mobile-max-height');
    }

    const rect = getElementRect(target);
    const padding = target ? 6 : 0;
    const popoverRect = popover.getBoundingClientRect();
    const pos =
      mobile && target
        ? getMobilePopoverPosition(rect, popoverRect)
        : positionFor(rect, popoverRect, step.placement || 'bottom');
    const futurePopoverRect: TutorialRect = {
      left: pos.left,
      top: pos.top,
      right: pos.left + popoverRect.width,
      bottom: pos.top + popoverRect.height,
      width: popoverRect.width,
      height: popoverRect.height,
    };
    const safeRect = getTargetSafeRect(mobile && target ? futurePopoverRect : null);
    const left = clamp(rect.left - padding, safeRect.left, safeRect.right);
    const top = clamp(rect.top - padding, safeRect.top, safeRect.bottom);
    const right = clamp(rect.right + padding, safeRect.left, safeRect.right);
    const bottom = clamp(rect.bottom + padding, safeRect.top, safeRect.bottom);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);

    highlight.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    highlight.style.width = `${Math.round(width)}px`;
    highlight.style.height = `${Math.round(height)}px`;
    highlight.style.opacity = target && width > 1 && height > 1 ? '1' : '0';
    positionMask({ left, top, width, height, visible: Boolean(target && width > 1 && height > 1), viewport });

    popover.style.left = `${Math.round(pos.left)}px`;
    popover.style.top = `${Math.round(pos.top)}px`;
    popover.style.visibility = 'visible';
  }

  const positionMask = (rect: {
    left: number;
    top: number;
    width: number;
    height: number;
    visible: boolean;
    viewport: TutorialRect;
  }): void => {
    if (!maskSvg || !maskPath) return;
    const viewportWidth = Math.max(0, Math.round(rect.viewport.width));
    const viewportHeight = Math.max(0, Math.round(rect.viewport.height));
    maskSvg.setAttribute('viewBox', `0 0 ${viewportWidth} ${viewportHeight}`);
    maskSvg.setAttribute('width', `${viewportWidth}`);
    maskSvg.setAttribute('height', `${viewportHeight}`);

    const outerPath = `M0 0H${viewportWidth}V${viewportHeight}H0Z`;
    if (!rect.visible) {
      maskPath.setAttribute('d', outerPath);
      return;
    }

    const relativeLeft = rect.left - rect.viewport.left;
    const relativeTop = rect.top - rect.viewport.top;
    const left = Math.round(clamp(relativeLeft, 0, viewportWidth));
    const top = Math.round(clamp(relativeTop, 0, viewportHeight));
    const right = Math.round(clamp(relativeLeft + rect.width, 0, viewportWidth));
    const bottom = Math.round(clamp(relativeTop + rect.height, 0, viewportHeight));
    maskPath.setAttribute('d', `${outerPath}M${left} ${top}H${right}V${bottom}H${left}Z`);
  };

  const collectVisibleSteps = (): TutorialStep[] => {
    const steps: TutorialStep[] = [];
    for (const step of PRESET_MANAGER_STEPS) {
      if (!step.selector || getSelectors(step).some(selector => queryVisibleElement(selector))) steps.push(step);
    }
    return steps;
  };

  const closeInternal = (complete: boolean): void => {
    if (complete) saveState({ ...getState(), completed: true, disabled: false });
    removeListeners();
    if (repositionRaf !== null) {
      getWin().cancelAnimationFrame(repositionRaf);
      repositionRaf = null;
    }
    if (scrollRaf !== null) {
      getWin().cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }
    overlay?.remove();
    overlay = null;
    blocker = null;
    highlight = null;
    popover = null;
    maskSvg = null;
    maskPath = null;
    activeTutorial = null;
  };

  const goTo = (direction: 1 | -1): void => {
    if (!activeTutorial) return;
    const nextIndex = activeTutorial.index + direction;
    if (nextIndex < 0) return;
    if (nextIndex >= activeTutorial.steps.length) {
      closeInternal(true);
      return;
    }
    activeTutorial.index = nextIndex;
    activeTutorial.targetCache.clear();
    render();
  };

  const runAction = (action: TutorialAction): void => {
    if (action === 'prev') goTo(-1);
    if (action === 'next') goTo(1);
    if (action === 'dismiss') {
      saveState({ ...getState(), completed: true, disabled: true });
      closeInternal(false);
    }
  };

  const isPopoverEventTarget = (target: EventTarget | null): boolean => {
    if (!target || !popover) return false;
    return target instanceof getWin().Node && popover.contains(target);
  };

  const blockOutsideTutorialEvent = (event: Event): void => {
    if (!activeTutorial || !overlay || isPopoverEventTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const blockedEventNames = [
    'pointerdown',
    'pointerup',
    'pointercancel',
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'touchstart',
    'touchmove',
    'touchend',
    'wheel',
    'contextmenu',
  ] as const;

  const addListeners = (): void => {
    const win = getWin();
    const doc = getDoc();
    win.addEventListener('resize', requestReposition, { passive: true });
    win.addEventListener('scroll', requestReposition, { passive: true });
    win.visualViewport?.addEventListener('resize', requestReposition, { passive: true });
    win.visualViewport?.addEventListener('scroll', requestReposition, { passive: true });
    blockedEventNames.forEach(eventName => {
      doc.addEventListener(eventName, blockOutsideTutorialEvent, { capture: true, passive: false });
    });
  };

  const removeListeners = (): void => {
    const win = getWin();
    const doc = getDoc();
    win.removeEventListener('resize', requestReposition);
    win.removeEventListener('scroll', requestReposition);
    win.visualViewport?.removeEventListener('resize', requestReposition);
    win.visualViewport?.removeEventListener('scroll', requestReposition);
    blockedEventNames.forEach(eventName => {
      doc.removeEventListener(eventName, blockOutsideTutorialEvent, true);
    });
  };

  const handleClick = (event: Event): void => {
    const win = getWin();
    const element =
      event.target instanceof win.Element ? event.target.closest<HTMLElement>('[data-pm-tutorial-action]') : null;
    if (!element) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (element instanceof win.HTMLButtonElement && element.disabled) return;
    const action = element.dataset.pmTutorialAction;
    if (!isTutorialAction(action)) return;

    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    if (action !== 'dismiss' && now - lastActionAt < 220) return;
    lastActionAt = now;
    runAction(action);
  };

  const createOverlay = (): void => {
    const doc = getDoc();
    const svgNamespace = 'http://www.w3.org/2000/svg';
    overlay = doc.createElement('div');
    overlay.className = OVERLAY_CLASS;
    overlay.style.zIndex = String(TUTORIAL_Z_INDEX);
    blocker = doc.createElement('div');
    blocker.className = 'pm-tutorial-blocker';
    maskSvg = doc.createElementNS(svgNamespace, 'svg');
    maskSvg.classList.add('pm-tutorial-mask');
    maskSvg.setAttribute('aria-hidden', 'true');
    maskPath = doc.createElementNS(svgNamespace, 'path');
    maskPath.setAttribute('fill-rule', 'evenodd');
    maskSvg.appendChild(maskPath);
    highlight = doc.createElement('div');
    highlight.className = 'pm-tutorial-highlight';
    popover = doc.createElement('div');
    popover.className = 'pm-tutorial-popover';
    popover.style.visibility = 'hidden';
    overlay.append(blocker, maskSvg, highlight, popover);
    overlay.addEventListener('click', handleClick);
    overlay.addEventListener('touchend', handleClick, { passive: false });
    doc.body.appendChild(overlay);
  };

  function render(): void {
    if (!activeTutorial || !popover) return;
    const step = activeTutorial.steps[activeTutorial.index];
    const isFirst = activeTutorial.index === 0;
    const isLast = activeTutorial.index === activeTutorial.steps.length - 1;
    popover.innerHTML = `
      <div class="pm-tutorial-head">
        <i class="fa-solid fa-circle-question"></i>
        <span>${escapeHtml(step.title)}</span>
        <button
          class="pm-tutorial-close"
          type="button"
          title="关闭教程"
          aria-label="关闭教程"
          data-pm-tutorial-action="dismiss"
        >×</button>
      </div>
      <div class="pm-tutorial-body">
        <div>${escapeHtml(step.content)}</div>
        <div class="pm-tutorial-progress">${activeTutorial.index + 1} / ${activeTutorial.steps.length}</div>
      </div>
      <div class="pm-tutorial-actions">
        <button class="pm-tutorial-btn" type="button" data-pm-tutorial-action="prev" ${isFirst ? 'disabled' : ''}>上一步</button>
        <button class="pm-tutorial-btn primary" type="button" data-pm-tutorial-action="next">${isLast ? '完成' : '下一步'}</button>
      </div>
    `;
    scheduleTargetIntoView();
  }

  const start = (options: TutorialOptions = {}): void => {
    const manual = options.manual === true;
    if (activeTutorial && !manual && options.interrupt !== true) return;
    const state = getState();
    if (!manual && (state.disabled || state.completed)) return;
    const steps = collectVisibleSteps();
    if (steps.length === 0) {
      console.warn('[预设管理教程] 没有找到可播放的教程步骤。');
      return;
    }

    closeInternal(false);
    injectStyles();
    activeTutorial = { steps, index: 0, targetCache: new Map() };
    createOverlay();
    addListeners();
    render();
  };

  const maybeStart = (options: { interrupt?: boolean } = {}): void => {
    const state = getState();
    if (state.disabled || state.completed) return;
    getWin().setTimeout(() => start({ interrupt: options.interrupt === true }), 260);
  };

  return {
    maybeStart,
    start,
    close: () => closeInternal(false),
  };
}
