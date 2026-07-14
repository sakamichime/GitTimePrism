/*
 * 状态持久化服务模块
 *
 * 负责 WebViewState（前端视图状态）的持久化存储与加载。
 * 采用双层存储策略：
 *   1. localStorage（主存储）：用于前端快速读写，保证响应速度
 *   2. Tauri Store 插件（磁盘持久化）：用于将状态持久化到磁盘文件
 *      （~/.gittimeprism/state.json），保证应用重启后状态不丢失
 *
 * 工作流程：
 *   - 启动时：从 Tauri Store（磁盘）加载状态到 localStorage（initStateService）
 *   - 读取时：直接从 localStorage 读取（快速）
 *   - 保存时：先写 localStorage（立即生效），再异步写 Tauri Store（持久化到磁盘）
 *
 * 降级策略：
 *   如果 Tauri Store 插件未安装（npm 依赖缺失）或未注册（后端未配置），
 *   动态 import 会失败，此时自动降级为仅使用 localStorage，
 *   功能仍然可用（但应用重启后状态可能丢失，因为 localStorage 在 Tauri WebView
 *   中通常不持久化）。
 *
 * 如何启用完整的 Tauri Store 持久化：
 *   1. 在 src-tauri/Cargo.toml 添加依赖：tauri-plugin-store = "2"
 *   2. 在 src-tauri/src/lib.rs 注册插件：.plugin(tauri_plugin_store::Builder::default().build())
 *   3. 在 package.json 添加依赖：@tauri-apps/plugin-store
 *   4. 运行 npm install 和 cargo build
 *
 * 使用方式：
 *   import { stateService } from './services/state-service';
 *   const state = stateService.loadState(repoPath);
 *   state.columnWidths.graph = 200;
 *   stateService.saveState(repoPath, state);
 */

// 导入 CodeReview 类型：描述一次代码审查的状态
// （来自 git-types.ts，与 gitgraph 项目的类型定义对齐）
import type { CodeReview } from '../utils/git-types.js';


/**
 * ============================================================
 * 状态类型定义
 * ============================================================
 */

/**
 * 查找窗口的状态
 *
 * 记录用户在提交图中查找提交时的查找状态，包括查找文本、当前匹配项、
 * 窗口可见性以及查找选项（大小写敏感、正则表达式）。
 */
export interface FindWidgetState {
  /** 查找文本（用户输入的搜索关键字） */
  text: string;
  /** 当前匹配到的提交哈希；如果没有匹配项则为 null */
  currentHash: string | null;
  /** 查找窗口是否可见 */
  visible: boolean;
  /** 是否区分大小写 */
  isCaseSensitive: boolean;
  /** 是否使用正则表达式匹配 */
  isRegex: boolean;
}

/**
 * 设置窗口的状态
 */
export interface SettingsWidgetState {
  /** 设置窗口是否可见 */
  visible: boolean;
}

/**
 * 单个仓库的代码审查状态
 *
 * 记录该仓库中所有代码审查会话及其活跃状态。
 */
export interface CodeReviewState {
  /** 当前活跃的代码审查 ID；如果没有活跃审查则为 null */
  activeReviewId: string | null;
  /** 所有代码审查会话，以审查 ID 为键 */
  reviews: { [id: string]: CodeReview };
}

/**
 * WebView 视图状态
 *
 * 描述前端 UI 的完整状态，包括列宽、分隔位置、显示选项、
 * 滚动位置、查找窗口、设置窗口和代码审查状态。
 * 这些状态会按仓库路径分别持久化，以便用户下次打开同一仓库时恢复。
 */
export interface WebViewState {
  /** 各列的宽度配置（像素）：graph=节点图列, date=日期列, author=作者列, commit=提交列 */
  columnWidths: { graph: number; date: number; author: number; commit: number };
  /** 提交详情视图（CDV）的分隔位置（百分比，0-100） */
  cdvDivider: number;
  /** 隐藏的远程仓库名列表（如 ['upstream']，这些 remote 的分支不显示） */
  hideRemotes: string[];
  /** 是否显示远程分支 */
  showRemoteBranches: boolean;
  /** 是否显示 stash（暂存）记录 */
  showStashes: boolean;
  /** 是否显示标签 */
  showTags: boolean;
  /** 提交列表的垂直滚动位置（像素） */
  scrollTop: number;
  /** 查找窗口状态 */
  findWidget: FindWidgetState;
  /** 设置窗口状态 */
  settingsWidget: SettingsWidgetState;
  /** 代码审查状态（按仓库路径索引） */
  codeReview: { [repoPath: string]: CodeReviewState };
}

/**
 * 全局状态
 *
 * 描述应用级别的全局配置，不与特定仓库绑定。
 * 包括主题、所有仓库的状态快照、最后打开的仓库等。
 */
export interface GlobalState {
  /** 当前主题（'dark' 暗色或 'light' 亮色） */
  theme: 'dark' | 'light';
  /** 所有仓库的视图状态（以仓库路径为键） */
  repoStates: { [repoPath: string]: WebViewState };
  /** 最后打开的仓库路径；如果没有则为 null */
  lastOpenedRepo: string | null;
}


/**
 * ============================================================
 * 默认值定义
 * ============================================================
 */

/**
 * localStorage 键名前缀
 *
 * 所有 GitTimePrism 的 localStorage 键都以这个前缀开头，避免与其他应用冲突。
 */
const STORAGE_KEY_PREFIX = 'gittimeprism';

/**
 * 仓库状态的 localStorage 键前缀
 *
 * 完整键格式：gittimeprism:repo:<repoPath>
 */
const REPO_STATE_KEY_PREFIX = `${STORAGE_KEY_PREFIX}:repo`;

/**
 * 全局状态的 localStorage 键
 *
 * 完整键：gittimeprism:global
 */
const GLOBAL_STATE_KEY = `${STORAGE_KEY_PREFIX}:global`;

/**
 * Tauri Store 的文件名
 *
 * 状态会持久化到此文件（位于 Tauri 的 app data 目录下）。
 */
const TAURI_STORE_FILE = 'state.json';

/**
 * 创建默认的 WebViewState（用于新仓库或重置状态时）
 *
 * 所有字段都使用合理的默认值，确保新用户开箱即用。
 *
 * @returns 默认的 WebViewState 实例
 */
function createDefaultWebViewState(): WebViewState {
  return {
    // 各列默认宽度（像素）
    columnWidths: {
      graph: 80,    // 节点图列宽度
      date: 120,    // 日期列宽度
      author: 150,  // 作者列宽度
      commit: 300,  // 提交列宽度
    },
    // 提交详情视图默认分隔位置（50% 表示上下各半）
    cdvDivider: 50,
    // 默认不隐藏任何远程仓库
    hideRemotes: [],
    // 默认显示远程分支
    showRemoteBranches: true,
    // 默认显示 stash
    showStashes: true,
    // 默认显示标签
    showTags: true,
    // 默认滚动位置在顶部
    scrollTop: 0,
    // 查找窗口默认状态：隐藏，空文本，不区分大小写，非正则
    findWidget: {
      text: '',
      currentHash: null,
      visible: false,
      isCaseSensitive: false,
      isRegex: false,
    },
    // 设置窗口默认状态：隐藏
    settingsWidget: {
      visible: false,
    },
    // 代码审查默认状态：无活跃审查
    codeReview: {},
  };
}

/**
 * 创建默认的 GlobalState
 *
 * @returns 默认的 GlobalState 实例
 */
function createDefaultGlobalState(): GlobalState {
  return {
    // 默认暗色主题
    theme: 'dark',
    // 无仓库状态
    repoStates: {},
    // 无最后打开的仓库
    lastOpenedRepo: null,
  };
}


/**
 * ============================================================
 * Tauri Store 磁盘持久化辅助函数
 * ============================================================
 *
 * 以下函数通过动态 import 加载 Tauri Store 插件。
 * 如果插件未安装或未注册，import 或调用会失败，
 * 此时函数返回 null，调用方降级为仅使用 localStorage。
 */

/**
 * Tauri Store 实例的缓存
 *
 * 首次成功加载后缓存 Store 实例，避免重复初始化。
 * 如果加载失败（插件不可用），缓存 null 以避免重复尝试。
 */
let tauriStoreInstance: { set: (key: string, value: unknown) => Promise<void>; get: (key: string) => Promise<unknown>; save: () => Promise<void> } | null | undefined = undefined;

/**
 * 加载 Tauri Store 实例
 *
 * 通过动态 import 加载 @tauri-apps/plugin-store 插件，并创建 Store 实例。
 * 如果插件不可用（未安装或未注册），返回 null。
 *
 * 使用动态 import 而非静态 import 的原因：
 *   - 静态 import 在插件未安装时会导致整个模块加载失败
 *   - 动态 import 允许在插件不可用时优雅降级
 *
 * @returns Tauri Store 实例；如果不可用则返回 null
 */
async function loadTauriStore(): Promise<{ set: (key: string, value: unknown) => Promise<void>; get: (key: string) => Promise<unknown>; save: () => Promise<void> } | null> {
  // 如果已经尝试加载过，直接返回缓存结果
  if (tauriStoreInstance !== undefined) {
    return tauriStoreInstance;
  }

  try {
    // 动态 import Tauri Store 插件（如果未安装会抛错）
    // @ts-ignore - 此模块可能未安装（降级方案），忽略类型检查避免编译失败
    const storeModule = await import('@tauri-apps/plugin-store');
    // 创建 Store 实例，指定文件名为 state.json
    const store = await storeModule.Store.load(TAURI_STORE_FILE);
    tauriStoreInstance = store;
    return store;
  } catch (err) {
    // 插件不可用（未安装或后端未注册），降级为 null
    console.warn('[state-service] Tauri Store 插件不可用，降级为仅使用 localStorage。如需启用磁盘持久化，请参见 state-service.ts 顶部说明。', err);
    tauriStoreInstance = null;
    return null;
  }
}

/**
 * 将键值对异步持久化到 Tauri Store（磁盘）
 *
 * 此函数是非阻塞的，调用后立即返回，磁盘写入在后台进行。
 * 如果 Tauri Store 不可用，静默失败（不影响 localStorage 的数据）。
 *
 * @param key - 存储键
 * @param value - 要存储的值（会被 JSON 序列化）
 */
async function persistToDisk(key: string, value: unknown): Promise<void> {
  try {
    const store = await loadTauriStore();
    if (store === null) return; // Tauri Store 不可用，跳过
    // 写入键值对
    await store.set(key, value);
    // 保存到磁盘文件
    await store.save();
  } catch (err) {
    // 磁盘写入失败不影响功能（localStorage 已有数据）
    console.warn('[state-service] 持久化到磁盘失败（不影响 localStorage 数据）:', err);
  }
}

/**
 * 从 Tauri Store（磁盘）读取值
 *
 * @param key - 存储键
 * @returns 存储的值；如果 Tauri Store 不可用或键不存在则返回 null
 */
async function loadFromDisk<T>(key: string): Promise<T | null> {
  try {
    const store = await loadTauriStore();
    if (store === null) return null; // Tauri Store 不可用，返回 null
    // 读取键值对
    const value = await store.get<T>(key);
    return value ?? null;
  } catch (err) {
    console.warn('[state-service] 从磁盘加载失败:', err);
    return null;
  }
}


/**
 * ============================================================
 * localStorage 辅助函数
 * ============================================================
 */

/**
 * 从 localStorage 读取 JSON 数据
 *
 * @param key - localStorage 键
 * @returns 解析后的对象；如果键不存在或解析失败则返回 null
 */
function loadFromLocalStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[state-service] 从 localStorage 读取 ${key} 失败:`, err);
    return null;
  }
}

/**
 * 将对象以 JSON 格式写入 localStorage
 *
 * @param key - localStorage 键
 * @param value - 要存储的对象（会被 JSON 序列化）
 */
function saveToLocalStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[state-service] 写入 localStorage ${key} 失败:`, err);
  }
}

/**
 * 从 localStorage 删除指定键
 *
 * @param key - localStorage 键
 */
function removeFromLocalStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn(`[state-service] 删除 localStorage ${key} 失败:`, err);
  }
}


/**
 * ============================================================
 * 状态服务对象
 * ============================================================
 */

/**
 * 状态持久化服务
 *
 * 提供仓库状态和全局状态的加载、保存、重置功能。
 * 所有方法都是同步的（基于 localStorage），磁盘持久化在后台异步进行。
 *
 * 使用方式：
 *   // 加载仓库状态
 *   const state = stateService.loadState('C:/projects/my-repo');
 *   // 修改状态
 *   state.scrollTop = 500;
 *   // 保存状态
 *   stateService.saveState('C:/projects/my-repo', state);
 */
export const stateService = {
  /**
   * 初始化状态服务
   *
   * 在应用启动时调用，从磁盘（Tauri Store）加载状态到 localStorage。
   * 如果 Tauri Store 不可用，跳过此步骤（直接使用 localStorage 现有数据）。
   *
   * 此方法是异步的，应在应用初始化阶段调用。
   */
  async initStateService(): Promise<void> {
    console.log('[state-service] 初始化状态服务...');
    // 尝试从磁盘加载全局状态
    const diskGlobalState = await loadFromDisk<GlobalState>(GLOBAL_STATE_KEY);
    if (diskGlobalState !== null) {
      // 磁盘有全局状态，同步到 localStorage
      saveToLocalStorage(GLOBAL_STATE_KEY, diskGlobalState);
      console.log('[state-service] 已从磁盘加载全局状态到 localStorage');

      // 同时同步各仓库状态到 localStorage
      if (diskGlobalState.repoStates) {
        for (const [repoPath, state] of Object.entries(diskGlobalState.repoStates)) {
          const repoKey = `${REPO_STATE_KEY_PREFIX}:${repoPath}`;
          saveToLocalStorage(repoKey, state);
        }
        console.log(`[state-service] 已同步 ${Object.keys(diskGlobalState.repoStates).length} 个仓库状态到 localStorage`);
      }
    } else {
      console.log('[state-service] 磁盘无全局状态，使用 localStorage 现有数据');
    }
  },

  /**
   * 加载仓库状态
   *
   * 从 localStorage 读取指定仓库的视图状态。
   * 如果该仓库没有保存过状态，返回默认状态。
   *
   * @param repoPath - 仓库路径
   * @returns 该仓库的 WebViewState（如无保存状态则返回默认值）
   */
  loadState(repoPath: string): WebViewState {
    const key = `${REPO_STATE_KEY_PREFIX}:${repoPath}`;
    const saved = loadFromLocalStorage<WebViewState>(key);
    if (saved === null) {
      // 没有保存过状态，返回默认值
      return createDefaultWebViewState();
    }
    // 合并默认值和已保存的状态（确保新增字段有默认值，避免旧数据缺字段）
    return { ...createDefaultWebViewState(), ...saved };
  },

  /**
   * 保存仓库状态
   *
   * 先同步写入 localStorage（立即生效），再异步持久化到磁盘（Tauri Store）。
   *
   * @param repoPath - 仓库路径
   * @param state - 要保存的 WebViewState
   */
  saveState(repoPath: string, state: WebViewState): void {
    const key = `${REPO_STATE_KEY_PREFIX}:${repoPath}`;
    // 第一步：同步写入 localStorage（保证读取时能立即看到最新值）
    saveToLocalStorage(key, state);
    // 第二步：异步持久化到磁盘（不阻塞，失败不影响功能）
    void persistToDisk(key, state);
  },

  /**
   * 获取全局状态
   *
   * 从 localStorage 读取全局状态。
   * 如果没有保存过全局状态，返回默认状态。
   *
   * @returns GlobalState（如无保存状态则返回默认值）
   */
  getGlobalState(): GlobalState {
    const saved = loadFromLocalStorage<GlobalState>(GLOBAL_STATE_KEY);
    if (saved === null) {
      // 没有保存过全局状态，返回默认值
      return createDefaultGlobalState();
    }
    // 合并默认值和已保存的状态
    return { ...createDefaultGlobalState(), ...saved };
  },

  /**
   * 保存全局状态
   *
   * 先同步写入 localStorage，再异步持久化到磁盘。
   *
   * @param state - 要保存的 GlobalState
   */
  saveGlobalState(state: GlobalState): void {
    // 第一步：同步写入 localStorage
    saveToLocalStorage(GLOBAL_STATE_KEY, state);
    // 第二步：异步持久化到磁盘
    void persistToDisk(GLOBAL_STATE_KEY, state);
  },

  /**
   * 重置仓库状态
   *
   * 删除指定仓库的保存状态，下次加载时将返回默认状态。
   * 同时从 localStorage 和磁盘（Tauri Store）中删除。
   *
   * @param repoPath - 仓库路径
   */
  resetState(repoPath: string): void {
    const key = `${REPO_STATE_KEY_PREFIX}:${repoPath}`;
    // 从 localStorage 删除
    removeFromLocalStorage(key);
    // 异步从磁盘删除（设置默认值，因为 Tauri Store 没有 delete 方法时用 set null 替代）
    void persistToDisk(key, null);
  },
};
