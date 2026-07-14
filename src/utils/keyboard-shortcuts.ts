/**
 * 键盘快捷键系统（Keyboard Shortcuts）— Task 11.3
 *
 * 此模块提供键盘快捷键的解析、匹配和冲突检测功能。
 * 支持的快捷键格式：
 *   - Ctrl/Cmd + 字母：如 "Ctrl+F"（查找）、"Ctrl+H"（滚动到 HEAD）
 *   - Ctrl/Cmd + Shift + 字母：如 "Ctrl+Shift+S"（滚动到上一个 Stash）
 *   - 单键：如 "Enter"（提交对话框）、"Escape"（关闭菜单/对话框）
 *   - 方向键组合：如 "Up"、"Down"、"Ctrl+Up"、"Ctrl+Shift+Down"
 *
 * 设计说明：
 *   - 使用 KeyboardShortcut 接口描述快捷键的结构化表示
 *   - parseShortcutString 将字符串（如 "Ctrl+Shift+S"）解析为 KeyboardShortcut
 *   - matchShortcut 比较 KeyboardEvent 和 KeyboardShortcut 是否匹配
 *   - detectConflicts 检测快捷键映射中是否有冲突（多个 action 绑定同一快捷键）
 *   - 在 macOS 上，Ctrl 键自动映射为 Cmd 键（metaKey）
 *
 * 使用方式：
 * ```typescript
 * import { parseShortcutString, matchShortcut, detectConflicts } from '../utils/keyboard-shortcuts';
 *
 * const shortcut = parseShortcutString('Ctrl+Shift+S');
 * document.addEventListener('keydown', (e) => {
 *   if (matchShortcut(e, shortcut)) {
 *     // 执行对应操作
 *   }
 * });
 *
 * const conflicts = detectConflicts({ find: 'Ctrl+F', refresh: 'Ctrl+F' });
 * if (conflicts.length > 0) {
 *   console.warn('快捷键冲突:', conflicts);
 * }
 * ```
 */

/* ========================================================================== *
 * 第一部分：类型定义
 * ========================================================================== */

/**
 * 快捷键动作类型
 *
 * 标识所有可配置的快捷键动作。每个动作对应一个特定的操作。
 * - find：打开/关闭 Find Widget 搜索框
 * - refresh：刷新提交节点图
 * - scrollToHead：滚动到 HEAD 提交
 * - scrollToStash：滚动到第一个 Stash
 * - scrollToPrevStash：滚动到上一个 Stash
 * - navigateUp：切换到上一个提交（提交详情）
 * - navigateDown：切换到下一个提交（提交详情）
 * - navigateSameBranchUp：沿同一分支向上导航
 * - navigateSameBranchDown：沿同一分支向下导航
 * - navigateAltBranchUp：沿替代分支向上导航
 * - navigateAltBranchDown：沿替代分支向下导航
 * - commitDialog：打开提交对话框
 * - closeOverlay：关闭菜单/对话框/详情视图
 * - toggleTerminal：切换终端面板显示
 */
export type ShortcutAction =
  | 'find'
  | 'refresh'
  | 'scrollToHead'
  | 'scrollToStash'
  | 'scrollToPrevStash'
  | 'navigateUp'
  | 'navigateDown'
  | 'navigateSameBranchUp'
  | 'navigateSameBranchDown'
  | 'navigateAltBranchUp'
  | 'navigateAltBranchDown'
  | 'commitDialog'
  | 'closeOverlay'
  | 'toggleTerminal';

/**
 * 快捷键结构化表示
 *
 * 描述一个键盘快捷键的完整信息，包括修饰键和主键。
 *
 * 字段说明：
 *   - ctrl：是否需要 Ctrl 键（在 macOS 上对应 Cmd 键）
 *   - alt：是否需要 Alt 键（在 macOS 上对应 Option 键）
 *   - shift：是否需要 Shift 键
 *   - key：主键（小写字母或键名，如 'f'、'arrowup'、'enter'、'escape'）
 */
export interface KeyboardShortcut {
  /** 是否需要 Ctrl 键（macOS 上为 Cmd 键） */
  ctrl: boolean;
  /** 是否需要 Alt 键（macOS 上为 Option 键） */
  alt: boolean;
  /** 是否需要 Shift 键 */
  shift: boolean;
  /** 主键（小写字母或键名，如 'f'、'arrowup'、'enter'） */
  key: string;
}

/**
 * 快捷键映射表
 *
 * 从 ShortcutAction 到快捷键字符串（如 "Ctrl+F"）的映射。
 * 值为 null 表示该动作未配置快捷键（禁用）。
 */
export type ShortcutMap = Partial<Record<ShortcutAction, string | null>>;

/* ========================================================================== *
 * 第二部分：默认快捷键配置
 * ========================================================================== */

/**
 * 默认快捷键映射
 *
 * 应用启动时使用的默认快捷键配置。用户可以在设置面板中修改。
 * 这些值对应 KeyboardShortcutsConfig 中的字段。
 */
export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string | null> = {
  /** Ctrl+F：打开/关闭 Find Widget */
  find: 'Ctrl+F',
  /** Ctrl+R：刷新节点图 */
  refresh: 'Ctrl+R',
  /** Ctrl+H：滚动到 HEAD 提交 */
  scrollToHead: 'Ctrl+H',
  /** Ctrl+S：滚动到第一个 Stash */
  scrollToStash: 'Ctrl+S',
  /** Ctrl+Shift+S：滚动到上一个 Stash */
  scrollToPrevStash: 'Ctrl+Shift+S',
  /** Up：切换到上一个提交 */
  navigateUp: 'Up',
  /** Down：切换到下一个提交 */
  navigateDown: 'Down',
  /** Ctrl+Up：沿同一分支向上导航 */
  navigateSameBranchUp: 'Ctrl+Up',
  /** Ctrl+Down：沿同一分支向下导航 */
  navigateSameBranchDown: 'Ctrl+Down',
  /** Ctrl+Shift+Up：沿替代分支向上导航 */
  navigateAltBranchUp: 'Ctrl+Shift+Up',
  /** Ctrl+Shift+Down：沿替代分支向下导航 */
  navigateAltBranchDown: 'Ctrl+Shift+Down',
  /** Enter：打开提交对话框 */
  commitDialog: 'Enter',
  /** Escape：关闭菜单/对话框/详情视图 */
  closeOverlay: 'Escape',
  /** Ctrl+`：切换终端面板 */
  toggleTerminal: 'Ctrl+`',
};

/* ========================================================================== *
 * 第三部分：快捷键解析与匹配
 * ========================================================================== */

/**
 * 解析快捷键字符串为结构化表示
 *
 * 支持的格式：
 *   - "Ctrl+F" → { ctrl: true, alt: false, shift: false, key: 'f' }
 *   - "Ctrl+Shift+S" → { ctrl: true, alt: false, shift: true, key: 's' }
 *   - "Alt+P" → { ctrl: false, alt: true, shift: false, key: 'p' }
 *   - "Up" → { ctrl: false, alt: false, shift: false, key: 'arrowup' }
 *   - "Ctrl+Up" → { ctrl: true, alt: false, shift: false, key: 'arrowup' }
 *   - "Enter" → { ctrl: false, alt: false, shift: false, key: 'enter' }
 *   - "Escape" → { ctrl: false, alt: false, shift: false, key: 'escape' }
 *   - "" 或 null → null（表示禁用）
 *
 * @param shortcutString - 快捷键字符串（如 "Ctrl+F"），null 或空字符串表示禁用
 * @returns 解析后的 KeyboardShortcut 对象，如果输入为空则返回 null
 */
export function parseShortcutString(shortcutString: string | null): KeyboardShortcut | null {
  /* 空字符串或 null 表示禁用，返回 null */
  if (!shortcutString || shortcutString.trim().length === 0) {
    return null;
  }

  /* 去除前后空格，统一为大写处理修饰键部分 */
  const trimmed: string = shortcutString.trim();

  /* 初始化修饰键状态 */
  let ctrl: boolean = false;
  let alt: boolean = false;
  let shift: boolean = false;

  /* 按加号分割字符串，最后一段是主键，前面的段是修饰键 */
  const parts: string[] = trimmed.split('+').map((p) => p.trim());

  /* 最后一段是主键 */
  const keyPart: string = parts[parts.length - 1];

  /* 遍历除最后一段外的所有段，解析修饰键 */
  for (let i = 0; i < parts.length - 1; i++) {
    const mod: string = parts[i].toLowerCase();
    if (mod === 'ctrl' || mod === 'cmd' || mod === 'meta') {
      /* Ctrl/Cmd/Meta 都视为 ctrl 修饰键（macOS 上 Ctrl 映射为 Cmd） */
      ctrl = true;
    } else if (mod === 'alt' || mod === 'option') {
      /* Alt/Option 都视为 alt 修饰键 */
      alt = true;
    } else if (mod === 'shift') {
      shift = true;
    }
    /* 忽略未知的修饰键 */
  }

  /* 将主键转为小写，并标准化键名 */
  const key: string = normalizeKeyName(keyPart);

  return { ctrl, alt, shift, key };
}

/**
 * 标准化键名
 *
 * 将不同的键名表示统一为标准形式：
 *   - 方向键：ArrowUp / ArrowDown / ArrowLeft / ArrowRight
 *   - 字母键：小写
 *   - 特殊键：Enter / Escape / Space / Tab 等（小写）
 *
 * @param keyName - 原始键名（如 "F"、"Up"、"Enter"）
 * @returns 标准化后的键名（如 "f"、"arrowup"、"enter"）
 */
function normalizeKeyName(keyName: string): string {
  const lower: string = keyName.toLowerCase();

  /* 方向键的别名映射 */
  const arrowMap: Record<string, string> = {
    'up': 'arrowup',
    'down': 'arrowdown',
    'left': 'arrowleft',
    'right': 'arrowright',
  };

  /* 特殊键的别名映射 */
  const specialMap: Record<string, string> = {
    'esc': 'escape',
    'return': 'enter',
    'space': ' ',
    'backspace': 'backspace',
    'tab': 'tab',
    'delete': 'delete',
    'home': 'home',
    'end': 'end',
    'pageup': 'pageup',
    'pagedown': 'pagedown',
  };

  /* 先查方向键映射 */
  if (arrowMap[lower]) {
    return arrowMap[lower];
  }

  /* 再查特殊键映射 */
  if (specialMap[lower]) {
    return specialMap[lower];
  }

  /* 其他键直接返回小写形式 */
  return lower;
}

/**
 * 匹配键盘事件与快捷键
 *
 * 比较 KeyboardEvent 和 KeyboardShortcut 是否匹配。
 * 在 macOS 上，ctrl 修饰键会同时匹配 ctrlKey 和 metaKey（Cmd 键）。
 *
 * @param event - 键盘事件
 * @param shortcut - 快捷键配置
 * @returns 如果匹配返回 true，否则返回 false
 */
export function matchShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
  /* 检测是否为 macOS 平台（需要匹配 Cmd 键） */
  const isMac: boolean = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

  /* 检查 Ctrl/Cmd 修饰键 */
  if (shortcut.ctrl) {
    /* 在 macOS 上，ctrl 修饰键匹配 metaKey（Cmd 键）；
       在其他平台上，匹配 ctrlKey */
    if (isMac) {
      if (!event.metaKey) return false;
    } else {
      if (!event.ctrlKey) return false;
    }
  } else {
    /* 如果快捷键不需要 Ctrl/Cmd，但事件中按下了 Ctrl/Cmd，则不匹配 */
    if (event.ctrlKey || event.metaKey) return false;
  }

  /* 检查 Alt 修饰键 */
  if (shortcut.alt) {
    if (!event.altKey) return false;
  } else {
    if (event.altKey) return false;
  }

  /* 检查 Shift 修饰键 */
  if (shortcut.shift) {
    if (!event.shiftKey) return false;
  } else {
    if (event.shiftKey) return false;
  }

  /* 检查主键（忽略大小写） */
  const eventKey: string = event.key.toLowerCase();
  return eventKey === shortcut.key;
}

/* ========================================================================== *
 * 第四部分：冲突检测
 * ========================================================================== */

/**
 * 检测快捷键映射中的冲突
 *
 * 遍历快捷键映射表，找出被多个动作绑定相同快捷键的情况。
 *
 * @param shortcuts - 快捷键映射表
 * @returns 冲突的动作列表（每个冲突项包含动作名和冲突的快捷键字符串）
 */
export function detectConflicts(shortcuts: ShortcutMap): Array<{ action: ShortcutAction; shortcut: string }> {
  /* 用于记录每个快捷键字符串被哪些动作使用 */
  const shortcutToActions: Map<string, ShortcutAction[]> = new Map();

  /* 遍历所有动作及其快捷键配置 */
  for (const [action, shortcutStr] of Object.entries(shortcuts)) {
    /* 跳过 null 或空字符串（禁用的快捷键） */
    if (!shortcutStr || shortcutStr.trim().length === 0) continue;

    /* 标准化快捷键字符串（去除空格，统一大小写）用于比较 */
    const normalized: string = shortcutStr.trim().toLowerCase();

    /* 将动作添加到对应快捷键的动作列表中 */
    if (!shortcutToActions.has(normalized)) {
      shortcutToActions.set(normalized, []);
    }
    shortcutToActions.get(normalized)!.push(action as ShortcutAction);
  }

  /* 收集所有冲突（被多个动作使用的快捷键） */
  const conflicts: Array<{ action: ShortcutAction; shortcut: string }> = [];
  for (const [shortcut, actions] of shortcutToActions) {
    if (actions.length > 1) {
      /* 该快捷键被多个动作使用，记录冲突 */
      for (const action of actions) {
        conflicts.push({ action, shortcut });
      }
    }
  }

  return conflicts;
}

/**
 * 根据 KeyboardShortcutsConfig 构建完整的快捷键映射表
 *
 * 将配置对象转换为 ShortcutMap，补全缺失的字段为默认值。
 *
 * @param config - KeyboardShortcutsConfig 配置对象
 * @returns 完整的快捷键映射表
 */
export function buildShortcutMap(config: {
  find?: string | null;
  refresh?: string | null;
  scrollToHead?: string | null;
  scrollToStash?: string | null;
  scrollToPrevStash?: string | null;
  navigateUp?: string | null;
  navigateDown?: string | null;
  navigateSameBranchUp?: string | null;
  navigateSameBranchDown?: string | null;
  navigateAltBranchUp?: string | null;
  navigateAltBranchDown?: string | null;
  commitDialog?: string | null;
  closeOverlay?: string | null;
  toggleTerminal?: string | null;
}): ShortcutMap {
  const map: ShortcutMap = {};

  /* 遍历所有动作，从 config 中取值，缺失时使用默认值 */
  for (const action of Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]) {
    const configKey: keyof typeof config = action as keyof typeof config;
    const value: string | null | undefined = config[configKey];
    /* 如果配置中未指定，使用默认值；如果显式为 null，则禁用 */
    map[action] = value !== undefined ? value : DEFAULT_SHORTCUTS[action];
  }

  return map;
}
