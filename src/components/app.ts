/**
 * GitTimePrism 应用主框架组件
 *
 * 负责创建整体的三栏布局结构并协调各子组件。
 * 包含自定义标题栏（窗口拖拽、最小化/最大化/关闭）、
 * 壁纸功能（选择壁纸后动态变色）、暗色/亮色主题切换等。
 *
 * 三栏布局：
 * - 左侧面板：文件变更列表 + 提交输入
 * - 中间面板：提交节点图 + 提交历史
 * - 右侧面板：文件 diff 对比视图 / 提交详情
 */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { t } from '../services/i18n.js';
import { GitInstaller } from './git-installer.js';
import { TerminalPanel } from './terminal.js';
import { repoService, type RepoInfo } from '../services/repo-service.js';
// 导入 GitCommit 类型：带 heads/tags/remotes/stash 注解的提交数据
// （替代旧的 GraphCommit，与 gitgraph 项目对齐的新版节点图数据结构）
import type { GitCommit } from '../utils/git-types.js';
import { wallpaperService } from '../services/wallpaper.js';
import { themeEngine } from '../services/theme-engine.js';
import { FileList } from './file-list.js';
import { CommitInput } from './commit-input.js';
import { DiffViewer } from './diff-viewer.js';
import { CommitGraph } from './commit-graph.js';
import { CommitDetail } from './commit-detail.js';
import { BranchList } from './branch-list.js';
import { ResetDialog } from './reset-dialog.js';
import { TagManager } from './tag-manager.js';
// 导入子模块管理组件（阶段 9：Task 9.2：用于子模块的添加/更新/删除管理）
import { SubmoduleManager } from './submodule-manager.js';
// 导入 LFS 管理组件（阶段 9：Task 9.4：用于 LFS 跟踪规则/文件锁/对象拉推管理）
import { LfsManager } from './lfs-manager.js';
// 导入历史文件清理对话框全局单例（Task 5.3：用于清理 Git 历史中的大文件）
import { purgeHistoryDialog } from './purge-history-dialog.js';
// 导入设置面板组件（Task 7.4：用于编辑应用配置和 Git 仓库配置）
import { SettingsPanel } from './settings-panel.js';
import { FileHistory } from './file-history.js';
// 导入右键菜单全局单例（用于显示上下文菜单）
import { contextMenu } from './context-menu.js';
// 导入对话框全局单例（用于显示确认对话框、表单、loading、错误等）
import { dialog as dialogSingleton } from './dialog.js';
// 导入右键菜单动作生成器和 setter 函数
// setRefreshCallback/setViewCommitCallback/setRepoPath：由 app.ts 注入回调
// get*ContextMenuActions：6 类菜单的 actions 生成函数
import {
  setRefreshCallback,
  setViewCommitCallback,
  setRepoPath,
  getCommitContextMenuActions,
  getBranchContextMenuActions,
  getRemoteBranchContextMenuActions,
  getTagContextMenuActions,
  getStashContextMenuActions,
  getUncommittedChangesContextMenuActions,
} from './context-menu-actions.js';
// 导入右键菜单的菜单项类型（用于 handleContextMenu 方法的类型注解）
import type { ContextMenuActions } from './context-menu.js';
// 导入 UNCOMMITTED 常量（未提交变更节点的占位哈希 '*'）
import { UNCOMMITTED } from '../utils/git-utils.js';
// 导入 Stash 管理组件（提供 stash 操作对话框，作为 commit-graph 的辅助组件）
import { StashManager } from './stash-manager.js';
// 阶段 12：导入合并编辑器回调设置函数（用于在检测到冲突时自动打开合并编辑器）
// setMergeEditorCallbacks：注入关闭回调和保存成功回调，由 merge-editor 单例在操作完成后调用
import { setMergeEditorCallbacks } from './merge-editor.js';
// 阶段 12：导入 Blame 视图回调设置函数（用于在 Blame 视图中点击提交哈希时跳转详情）
// setBlameViewerCallbacks：注入提交点击回调和关闭回调，由 blame-viewer 单例在用户交互时调用
import { setBlameViewerCallbacks } from './blame-viewer.js';
// 导入 Find Widget 搜索框组件（Task 5.1：浮动在节点图上方的提交搜索框）
import { FindWidget } from './find-widget.js';
// 导入键盘快捷键工具（Task 11.3：用于解析和匹配快捷键）
// parseShortcutString：将快捷键字符串（如 "Ctrl+F"）解析为结构化表示
// matchShortcut：比较 KeyboardEvent 和快捷键是否匹配
import { parseShortcutString, matchShortcut } from '../utils/keyboard-shortcuts.js';
// 导入配置服务（Task 11.3：读取快捷键配置）
import { configService } from '../services/config-service.js';
// 导入状态持久化服务（阶段 10：Task 10.6 - 启动时恢复仓库状态，切换仓库时加载对应状态）
// stateService 提供 loadStateFromBackend / saveStateToBackend 等方法
// 用于通过 Tauri IPC 调用后端 state.rs 持久化仓库视图状态到 ~/.gittimeprism/state.json
import { stateService } from '../services/state-service.js';
// 导入 Tauri 事件监听函数（阶段 10：Task 10.2 - 监听后端 repo_changed 事件）
// 当文件监听器检测到 .git 目录下的文件变化时，后端会 emit 'repo_changed' 事件
// 前端通过 listen() 监听此事件并触发节点图刷新
import { listen } from '@tauri-apps/api/event';

export class App {
  /** 左侧面板引用 */
  private sidebar: HTMLElement | null = null;
  /** 右侧详情面板引用 */
  private detailPanel: HTMLElement | null = null;
  /** 底部终端面板 DOM 引用 */
  private terminalPanelEl: HTMLElement | null = null;
  /** 底部状态栏引用 */
  private statusBar: HTMLElement | null = null;
  /** 终端面板是否展开 */
  private terminalVisible: boolean = false;
  /** 当前主题（dark 或 light） */
  private currentTheme: string = 'dark';
  /** 终端面板实例（xterm.js + PTY 交互） */
  private terminalInstance: TerminalPanel | null = null;
  /** 当前是否已设置壁纸 */
  private hasWallpaper: boolean = false;
  /** 当前打开的仓库路径 */
  private currentRepoPath: string | null = null;
  /** 当前选中的提交哈希（用于返回按钮） */
  private currentCommitHash: string | null = null;
  /** 文件变更列表组件实例 */
  private fileList: FileList | null = null;
  /** 提交输入组件实例 */
  private commitInput: CommitInput | null = null;
  /** diff 视图组件实例 */
  private diffViewer: DiffViewer | null = null;
  /** 提交节点图组件实例 */
  private commitGraph: CommitGraph | null = null;
  /** 提交详情组件实例 */
  private commitDetail: CommitDetail | null = null;
  /** 分支列表组件实例 */
  private branchList: BranchList | null = null;
  /** 文件历史查看组件实例 */
  private fileHistory: FileHistory | null = null;
  /** Stash 管理组件实例（提供 stash 操作对话框） */
  private stashManager: StashManager | null = null;
  /** Find Widget 搜索框组件实例（Task 5.1：浮动在节点图上方的提交搜索框） */
  private findWidget: FindWidget | null = null;

  /**
   * repo_changed 事件取消监听函数（阶段 10：Task 10.2）
   *
   * 当文件监听器检测到 .git 目录下的文件变化时（如提交、分支切换、stash 操作等），
   * 后端会通过 Tauri 事件系统 emit 'repo_changed' 事件。
   * 前端通过 listen() 注册监听器，返回一个取消监听的函数。
   * 在切换仓库或关闭应用时调用此函数，避免重复监听和内存泄漏。
   */
  private unlistenRepoChanged: (() => void) | null = null;

  /**
   * 初始化应用
   *
   * 应用启动入口，按顺序执行以下初始化：
   *   1. 渲染基础 DOM 结构
   *   2. 初始化标题栏（窗口拖拽、最小化/最大化/关闭按钮）
   *   3. 初始化面板分隔条（可拖拽调整面板大小）
   *   4. 初始化键盘快捷键
   *   5. 初始化主题切换按钮
   *   6. 初始化壁纸功能
   *   7. 检查 Git 是否已安装
   *   8. 阶段 10：异步初始化状态服务（从后端加载全局状态到 localStorage）
   *   9. 阶段 10：注册 repo_changed 事件监听器（文件变化时刷新节点图）
   */
  init(): void {
    this.render();
    this.initTitlebar();
    this.initResizeHandles();
    this.initKeyboardShortcuts();
    this.initThemeToggle();
    this.initWallpaper();
    this.checkGitInstallation();
    // 阶段 10：异步初始化状态服务（从磁盘加载全局状态到 localStorage）
    // 使用 void 标记 fire-and-forget，不阻塞 init() 主流程
    void this.initStateService();
    // 阶段 10：注册 repo_changed 事件监听器
    // 当后端文件监听器检测到 .git 目录变化时，触发节点图刷新
    void this.setupRepoChangedListener();
    // Task 2：首次启动环境检测向导
    // 检测 Git、Python、git-filter-repo 是否已安装，缺失则自动通过终端安装
    // 只在首次启动时运行一次，完成后在 localStorage 标记，后续启动不再执行
    void this.runFirstLaunchCheck();
  }

  /**
   * 初始化状态服务（阶段 10：Task 10.6）
   *
   * 在应用启动时调用 stateService.initStateService()，
   * 从磁盘（~/.gittimeprism/state.json）加载全局状态到 localStorage。
   * 同时尝试从后端加载全局状态（主题、最近仓库列表等）。
   *
   * 此方法是异步的，但不阻塞应用启动主流程。
   * 如果加载失败，应用仍可正常使用（使用 localStorage 现有数据或默认值）。
   */
  private async initStateService(): Promise<void> {
    try {
      // 调用 state-service 的初始化方法（从 Tauri Store 加载到 localStorage）
      await stateService.initStateService();
      console.log('[App] 状态服务初始化完成');

      // 尝试从后端加载全局状态（阶段 10：通过 Rust 后端读取 state.json）
      const backendGlobalState = await stateService.loadGlobalStateFromBackend();
      if (backendGlobalState) {
        console.log('[App] 已从后端加载全局状态:', backendGlobalState);
        // 如果后端有保存的最近仓库列表，可以在这里恢复（后续 Task 12.x 集成）
        // 当前阶段仅记录日志，实际恢复在 onRepoOpened 中处理
      }
    } catch (err) {
      // 状态服务初始化失败不影响应用启动
      console.warn('[App] 状态服务初始化失败（不影响应用启动）:', err);
    }
  }

  /**
   * 设置 repo_changed 事件监听器（阶段 10：Task 10.2）
   *
   * 监听后端 emit 的 'repo_changed' 事件。
   * 当文件监听器检测到 .git 目录下的文件变化时（如提交、分支切换、stash 操作等），
   * 后端会 emit 此事件，前端收到后触发节点图刷新。
   *
   * 防抖机制：
   *   后端已实现 750ms 防抖，前端无需再次防抖。
   *   后端在 750ms 内的多次文件变化只 emit 一次事件。
   *
   * 此方法是异步的，但调用方无需 await（fire-and-forget）。
   */
  private async setupRepoChangedListener(): Promise<void> {
    try {
      // 如果已有监听器，先取消旧的（避免重复监听）
      if (this.unlistenRepoChanged) {
        this.unlistenRepoChanged();
        this.unlistenRepoChanged = null;
      }
      // 注册新的监听器
      // listen 返回一个取消监听的函数，保存以便后续清理
      this.unlistenRepoChanged = await listen('repo_changed', () => {
        console.log('[App] 收到 repo_changed 事件，刷新所有组件');
        // 触发节点图和文件列表刷新
        // 注意：refreshAllComponents 是 async 方法，这里不 await（fire-and-forget）
        void this.refreshAllComponents();
      });
      console.log('[App] repo_changed 事件监听器已注册');
    } catch (err) {
      // 监听器注册失败不影响应用启动（只是无法自动刷新）
      console.warn('[App] 注册 repo_changed 事件监听器失败:', err);
    }
  }

  /** 渲染整体布局的 DOM 结构 */
  render(): void {
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = `
      <!-- 自定义标题栏 - 替代系统窗口边框，支持拖拽移动窗口 -->
      <div class="titlebar" id="titlebar">
        <div class="titlebar-drag" id="titlebar-drag">
          <span class="titlebar-title">GitTimePrism</span>
        </div>
        <div class="titlebar-controls">
          <button class="titlebar-btn titlebar-btn-minimize" id="btn-minimize" title="最小化">─</button>
          <button class="titlebar-btn titlebar-btn-maximize" id="btn-maximize" title="最大化">□</button>
          <button class="titlebar-btn titlebar-btn-close" id="btn-close" title="关闭">✕</button>
        </div>
      </div>
      <header class="toolbar" id="toolbar">
        <!-- Task 6：移除了 toolbar-left 中的"打开仓库""克隆仓库""初始化仓库"按钮 -->
        <!-- 这些按钮已移至中央面板欢迎页，减少工具栏拥挤 -->
        <div class="toolbar-spacer"></div>
        <div class="toolbar-section" id="toolbar-right">
          <button class="btn" id="btn-tag-manager" title="标签管理">🏷 标签</button>
          <button class="btn" id="btn-submodule-manager" title="子模块管理">📦 子模块</button>
          <button class="btn" id="btn-lfs-manager" title="LFS 管理">🗃 LFS</button>
          <button class="btn" id="btn-reset-commit" title="撤销提交">↩ 撤销</button>
          <button class="btn" id="btn-stash" title="Stash 未提交的变更">📦 Stash</button>
          <button class="btn" id="btn-fetch" title="从远程仓库获取更新（不合并）">⤓ Fetch</button>
          <button class="btn" id="btn-pull" title="从远程仓库拉取更新">↓ 拉取</button>
          <button class="btn" id="btn-push" title="推送本地提交到远程仓库">↑ 推送</button>
          <button class="btn" id="btn-find" title="搜索提交 (Ctrl+F)">🔍 查找</button>
          <button class="btn" id="btn-purge-history" title="清理历史文件">🧹 清理历史</button>
          <button class="btn" id="btn-settings" title="设置">⚙ 设置</button>
          <button class="btn" id="btn-toggle-terminal" title="Ctrl+\`">${t('toolbar.toggleTerminal')}</button>
        </div>
      </header>
      <!-- 壁纸层 - 显示用户选择的壁纸图片，位于所有面板之下 -->
      <div class="wallpaper-layer" id="wallpaper-layer">
        <img id="wallpaper-img" alt="" />
      </div>
      <div class="main-content">
        <!-- 左侧面板：文件变更列表 + 提交输入 -->
        <aside class="sidebar" id="sidebar">
          <div class="panel-header"><span>文件变更</span></div>
          <div class="panel-body" id="sidebar-body">
            <p style="color: var(--text-muted); padding: 16px; text-align: center;">${t('sidebar.noRepoOpen')}</p>
          </div>
          <!-- 提交输入区域 -->
          <div class="commit-input-area" id="commit-input-area" style="display: none;">
            <div class="panel-header"><span>提交</span></div>
            <div class="panel-body" id="commit-input-body"></div>
          </div>
        </aside>
        <div class="resize-handle resize-handle-vertical" data-target="sidebar" data-direction="horizontal" data-side="left"></div>
        <!-- 中间面板：提交节点图 + 提交历史 -->
        <main class="center-panel" id="center-panel">
          <div class="panel-header"><span>提交历史</span></div>
          <div class="panel-body" id="center-body" style="flex:1; display:flex; align-items:center; justify-content:center;">
            <div style="text-align: center; color: var(--text-primary);">
              <p style="font-size: var(--font-size-2xl); margin-bottom: 8px; font-weight: 600;">GitTimePrism</p>
              <p>${t('center.welcome')}</p>
              <!-- Task 6.2：欢迎页按钮区 - 提供快捷的"打开仓库"和"克隆仓库"入口 -->
              <div style="margin-top: 24px; display: flex; gap: 12px; justify-content: center;">
                <button class="btn btn-primary" id="btn-welcome-open">${t('welcome.openRepo')}</button>
                <button class="btn" id="btn-welcome-clone">${t('welcome.cloneRepo')}</button>
              </div>
            </div>
          </div>
        </main>
        <div class="resize-handle resize-handle-vertical" data-target="detail-panel" data-direction="horizontal" data-side="right"></div>
        <!-- 右侧面板：文件 diff 对比视图 / 提交详情 -->
        <aside class="detail-panel" id="detail-panel">
          <div class="panel-header"><span>${t('detail.title')}</span></div>
          <div class="panel-body" id="detail-body">
            <p style="color: var(--text-muted); padding: 16px; text-align: center;">${t('detail.selectCommit')}</p>
          </div>
        </aside>
        <!-- 对比面板：左右分栏代码对比视图（默认隐藏，点击文件后弹出） -->
        <div class="resize-handle resize-handle-vertical diff-panel-handle" data-target="diff-panel" data-direction="horizontal" data-side="right" id="diff-panel-handle" style="display: none;"></div>
        <aside class="diff-panel" id="diff-panel" style="display: none;">
          <div class="panel-header">
            <span>代码对比</span>
            <button class="btn btn-icon" id="btn-close-diff-panel" title="关闭对比面板" style="margin-left: auto; padding: 2px 8px;">✕</button>
          </div>
          <div class="panel-body" id="diff-viewer-body"></div>
        </aside>
      </div>
      <div class="resize-handle resize-handle-horizontal" data-target="terminal" data-direction="vertical"></div>
      <div class="terminal-panel hidden" id="terminal-panel">
        <div class="terminal-header">
          <span>${t('terminal.title')}</span>
          <button class="btn" id="btn-close-terminal" style="padding: 2px 8px;">${t('terminal.close')}</button>
        </div>
        <div class="terminal-body" id="terminal-body"></div>
      </div>
      <footer class="statusbar" id="statusbar">
        <!-- Task 11.4：状态栏增强，显示 Git 版本、分支、ahead/behind、提交总数、排序方式、仓库路径 -->
        <div class="statusbar-item" id="statusbar-git-version" title="Git 版本号">Git: ${t('statusbar.checking')}</div>
        <div class="statusbar-separator">|</div>
        <div class="statusbar-item" id="statusbar-branch" title="当前分支" style="display: none;">
          <span class="statusbar-icon">⎇</span>
          <span id="statusbar-branch-name">-</span>
        </div>
        <div class="statusbar-item" id="statusbar-ahead-behind" title="领先/落后远程提交数" style="display: none;">
          <span id="statusbar-ahead-behind-text">↑0 ↓0</span>
        </div>
        <div class="statusbar-separator">|</div>
        <div class="statusbar-item" id="statusbar-commit-count" title="已加载提交总数" style="display: none;">
          <span class="statusbar-icon"> commits</span>
          <span id="statusbar-commit-count-text">0</span>
        </div>
        <div class="statusbar-item" id="statusbar-sort-order" title="提交排序方式" style="display: none;">
          <span id="statusbar-sort-order-text">date</span>
        </div>
        <div class="statusbar-separator">|</div>
        <div class="statusbar-item" id="statusbar-repo-path" title="仓库路径"></div>
        <div class="statusbar-spacer"></div>
        <div class="statusbar-item" id="statusbar-terminal">
          <button class="btn" id="btn-toggle-terminal-status" title="Ctrl+\`" style="padding: 2px 8px; font-size: var(--font-size-xs);">${t('toolbar.toggleTerminal')}</button>
        </div>
        <div class="statusbar-item" id="statusbar-theme">
          <button class="btn" id="btn-toggle-theme-status" title="${t('theme.toggle')}" style="padding: 2px 8px; font-size: var(--font-size-xs);">${t('theme.toggle')}</button>
        </div>
      </footer>
    `;
  }

  /**
   * 初始化自定义标题栏
   *
   * 因为设置了 decorations: false（无边框窗口），
   * 需要自定义标题栏来提供窗口拖拽、最小化/最大化/关闭功能。
   * 使用 Tauri 的 window API 来控制窗口行为。
   */
  private initTitlebar(): void {
    const appWindow = getCurrentWindow();

    const dragArea = document.getElementById('titlebar-drag');
    if (dragArea) {
      dragArea.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
          appWindow.startDragging();
        }
      });

      dragArea.addEventListener('dblclick', () => {
        appWindow.toggleMaximize();
      });
    }

    document.getElementById('btn-minimize')?.addEventListener('click', () => {
      appWindow.minimize();
    });

    document.getElementById('btn-maximize')?.addEventListener('click', () => {
      appWindow.toggleMaximize();
    });

    document.getElementById('btn-close')?.addEventListener('click', () => {
      appWindow.close();
    });
  }

  /**
   * 初始化壁纸功能
   *
   * 1. 尝试从 localStorage 加载之前保存的壁纸
   * 2. 如果有壁纸，应用到壁纸层并启动动态变色
   * 注意：壁纸选择/清除按钮已迁移至设置面板（settings-panel.ts 的壁纸分组）
   */
  private initWallpaper(): void {
    this.loadSavedWallpaper();
  }

  /**
   * 异步加载已保存的壁纸
   *
   * 从 localStorage 读取 base64 data URL 后应用。
   */
  private async loadSavedWallpaper(): Promise<void> {
    const saved = wallpaperService.loadWallpaper();
    if (saved && saved.dataUrl) {
      this.applyWallpaper(saved.dataUrl, saved.dominantColors);
    }
  }

  /**
   * 应用壁纸到界面
   *
   * 使用 <img> 元素显示壁纸图片，
   * 并使用动态变色引擎根据壁纸主色调更新所有UI组件的颜色。
   *
   * @param dataUrl - 壁纸图片的 base64 data URL
   * @param colors - 从壁纸中提取的主色调列表
   */
  private applyWallpaper(dataUrl: string, colors: import('../services/wallpaper.js').DominantColor[]): void {
    const img = document.getElementById('wallpaper-img') as HTMLImageElement | null;
    if (img) {
      img.onload = () => {
        console.log('[壁纸] 图片加载成功，尺寸:', img.naturalWidth, 'x', img.naturalHeight);
      };
      img.onerror = (e) => {
        console.error('[壁纸] 图片加载失败:', e);
        alert('壁纸图片加载失败！');
      };
      img.src = dataUrl;
      img.style.display = 'block';
    }
    this.hasWallpaper = true;
    // 有壁纸时：面板透明度改为 50%
    document.documentElement.style.setProperty('--glass-opacity-panel', '0.5');
    document.documentElement.style.setProperty('--glass-opacity-bar', '0.5');
    if (colors.length > 0) {
      themeEngine.applyFromWallpaper(colors);
    }
  }

  /**
   * 移除壁纸，恢复默认渐变背景
   */
  private removeWallpaper(): void {
    const img = document.getElementById('wallpaper-img') as HTMLImageElement | null;
    if (img) {
      img.style.display = 'none';
      img.src = '';
      img.onload = null;
      img.onerror = null;
    }
    this.hasWallpaper = false;
    // 无壁纸时：面板透明度恢复为 80%
    document.documentElement.style.setProperty('--glass-opacity-panel', '0.8');
    document.documentElement.style.setProperty('--glass-opacity-bar', '0.8');
    themeEngine.resetToDefault();
  }

  /** 初始化面板拖拽调整大小功能（使用事件委托） */
  private initResizeHandles(): void {
    // 使用事件委托：在 main-content 上监听 mousedown，
    // 通过 e.target 判断是否点击了拖拽手柄。
    // 这样即使 render() 重新生成 DOM，事件监听器也不会丢失。
    const mainContent = document.querySelector('.main-content') as HTMLElement;
    if (mainContent) {
      mainContent.addEventListener('mousedown', ((e: MouseEvent) => {
        const handle = (e.target as HTMLElement).closest('.resize-handle') as HTMLElement;
        if (handle && handle.dataset.target) {
          this.startResize(e, handle);
        }
      }) as EventListener);
    }

    // 终端面板的拖拽手柄在 main-content 外面，需要单独处理
    const terminalHandle = document.querySelector('.resize-handle[data-target="terminal"]') as HTMLElement;
    if (terminalHandle) {
      terminalHandle.addEventListener('mousedown', ((e: MouseEvent) => {
        this.startResize(e, terminalHandle);
      }) as EventListener);
    }

    document.addEventListener('mousemove', (e) => this.onResize(e));
    document.addEventListener('mouseup', () => this.stopResize());
  }

  /** 拖拽状态 */
  private resizing: boolean = false;
  private resizeHandle: HTMLElement | null = null;
  private resizeTarget: HTMLElement | null = null;
  /** 拖拽时分隔条另一侧需要同时调整的兄弟面板（固定面板之间此消彼长时使用） */
  private resizeSibling: HTMLElement | null = null;
  private resizeDirection: string = '';
  private resizeStartX: number = 0;
  private resizeStartY: number = 0;
  private resizeInitialSize: number = 0;
  /** 兄弟面板的初始宽度 */
  private resizeSiblingInitialSize: number = 0;
  /** 拖拽开始时 center-panel（弹性面板）的宽度，用于计算最大拖拽范围（当sibling是弹性面板时） */
  private resizeCenterStartWidth: number = 0;

  /**
   * 获取所有水平排列的可调面板（sidebar, detail-panel, diff-panel）
   * 不包括 center-panel（它是弹性的，自动填充剩余空间）
   */
  private getHorizontalPanels(): HTMLElement[] {
    const panels: HTMLElement[] = [];
    const sidebar = document.getElementById('sidebar');
    const detail = document.getElementById('detail-panel');
    const diff = document.getElementById('diff-panel');
    if (sidebar) panels.push(sidebar);
    if (detail) panels.push(detail);
    if (diff && diff.style.display !== 'none') panels.push(diff);
    return panels;
  }

  /** 开始拖拽 */
  private startResize(e: MouseEvent, handle: HTMLElement): void {
    e.preventDefault();
    this.resizing = true;
    this.resizeHandle = handle;
    this.resizeDirection = handle.dataset.direction || 'horizontal';
    this.resizeSibling = null;
    this.resizeSiblingInitialSize = 0;
    
    const targetId = handle.dataset.target || '';
    if (targetId === 'terminal') {
      this.resizeTarget = document.getElementById('terminal-panel');
    } else {
      this.resizeTarget = document.getElementById(targetId);
    }

    if (!this.resizeTarget) {
      this.resizing = false;
      return;
    }

    this.resizeStartX = e.clientX;
    this.resizeStartY = e.clientY;

    if (this.resizeDirection === 'horizontal') {
      // 记录被拖拽面板的当前渲染宽度
      this.resizeInitialSize = this.resizeTarget.offsetWidth;

      // 通过DOM遍历自动找到手柄左右相邻的元素，确定兄弟面板
      // 分隔条的标准行为：控制左右两个相邻面板之间的空间分配
      const prevEl = handle.previousElementSibling as HTMLElement | null;
      const nextEl = handle.nextElementSibling as HTMLElement | null;
      
      // 判断target在左边还是右边，从而确定sibling是哪一边
      let siblingEl: HTMLElement | null = null;
      if (prevEl && this.resizeTarget === prevEl) {
        // target是手柄左边的元素，sibling是右边的元素
        siblingEl = nextEl;
      } else if (nextEl && this.resizeTarget === nextEl) {
        // target是手柄右边的元素，sibling是左边的元素
        siblingEl = prevEl;
      }

      // 记录center-panel宽度（sibling是弹性面板时用于边界计算）
      const centerPanel = document.getElementById('center-panel');
      this.resizeCenterStartWidth = centerPanel ? centerPanel.offsetWidth : 0;

      if (siblingEl) {
        if (siblingEl.id === 'center-panel') {
          // sibling是弹性面板(center-panel)：不需要手动调整，flex自动吸收空间
          this.resizeSibling = null;
        } else if (siblingEl.style.display !== 'none' && siblingEl.id) {
          // sibling是固定面板：需要同时调整两个面板（此消彼长）
          // 例如 diff手柄(detail/diff之间)：拖diff变大时detail需要变小
          this.resizeSibling = siblingEl;
          this.resizeSiblingInitialSize = siblingEl.offsetWidth;
        }
      }

      // 拖拽开始时，锁定涉及到的面板尺寸，防止flex自动重新分配
      const panelsToLock: HTMLElement[] = [this.resizeTarget];
      if (this.resizeSibling) panelsToLock.push(this.resizeSibling);
      for (const p of panelsToLock) {
        p.style.flexShrink = '0';
        p.style.flexGrow = '0';
        // 如果面板还没有被JS设置过width（使用CSS默认值），用offsetWidth锁定当前宽度
        if (!p.style.width) {
          p.style.width = `${p.offsetWidth}px`;
        }
      }
    } else {
      this.resizeInitialSize = this.resizeTarget.offsetHeight;
    }

    handle.classList.add('active');
  }

  /** 拖拽中 */
  private onResize(e: MouseEvent): void {
    if (!this.resizing || !this.resizeTarget || !this.resizeHandle) return;
    
    const diff = this.resizeDirection === 'horizontal'
      ? e.clientX - this.resizeStartX
      : e.clientY - this.resizeStartY;

    let newSize: number;
    if (this.resizeDirection === 'horizontal') {
      // 方向计算：
      // data-side="left"：面板在手柄左边（如 sidebar）
      //   → 鼠标往右(diff>0) → 面板变大 → newSize = initialSize + diff
      // data-side="right"：面板在手柄右边（如 detail-panel, diff-panel）
      //   → 鼠标往右(diff>0) → 手柄右移挤压右边面板 → 面板变小 → newSize = initialSize - diff
      const side = this.resizeHandle.dataset.side || 'right';
      newSize = side === 'left'
        ? this.resizeInitialSize + diff
        : this.resizeInitialSize - diff;

      // 被拖拽面板的最小宽度
      let minSize = 100;
      if (this.resizeTarget.id === 'sidebar') {
        minSize = 200;
      }

      if (this.resizeSibling) {
        // ====== 情况1：sibling是固定面板（如detail和diff之间的手柄）======
        // 两个固定面板之间此消彼长：target变多少，sibling反向变多少
        // 两个面板总宽度保持不变，center-panel不受影响
        let siblingNewSize = this.resizeSiblingInitialSize - (newSize - this.resizeInitialSize);
        
        // sibling最小宽度也是100px
        const siblingMinSize = 100;
        
        // 边界检查：如果sibling被压到最小，限制target继续变大
        if (siblingNewSize < siblingMinSize) {
          const maxDelta = this.resizeSiblingInitialSize - siblingMinSize;
          // target能增加的最大量 = sibling能减少的最大量
          newSize = this.resizeInitialSize + maxDelta;
          siblingNewSize = siblingMinSize;
        }
        
        // 检查target最小宽度
        if (newSize < minSize) {
          newSize = minSize;
          // target缩到最小时，sibling相应增大
          siblingNewSize = this.resizeSiblingInitialSize + (this.resizeInitialSize - minSize);
        }
        
        // 同时设置两个面板的宽度
        this.resizeTarget.style.width = `${newSize}px`;
        this.resizeSibling.style.width = `${siblingNewSize}px`;
      } else {
        // ====== 情况2：sibling是弹性面板(center-panel)，如sidebar和detail手柄 ======
        // 只有target变化，center-panel自动吸收空间变化
        // center-panel最小保留100px空间
        const centerMinWidth = 100;
        let maxSize = this.resizeCenterStartWidth + this.resizeInitialSize - centerMinWidth;
        
        // sidebar最大宽度限制
        if (this.resizeTarget.id === 'sidebar') {
          const sidebarMax = 400;
          if (maxSize > sidebarMax) maxSize = sidebarMax;
        }

        // 应用最小/最大宽度限制
        if (newSize < minSize) newSize = minSize;
        if (newSize > maxSize) newSize = maxSize;

        // 设置target宽度，center-panel通过flex:1自动调整
        this.resizeTarget.style.width = `${newSize}px`;
      }
    } else {
      newSize = this.resizeInitialSize + diff;
      if (newSize < 100) newSize = 100;
      this.resizeTarget.style.height = `${newSize}px`;
    }
  }

  /** 停止拖拽 */
  private stopResize(): void {
    if (this.resizeHandle) {
      this.resizeHandle.classList.remove('active');
    }
    this.resizing = false;
    this.resizeHandle = null;
    this.resizeTarget = null;
  }

  /**
   * 初始化全局键盘快捷键（Task 11.3 重写）
   *
   * 从 configService 读取快捷键配置，使用 matchShortcut 进行匹配。
   * 支持的快捷键包括：
   *   - Ctrl+F：打开/关闭 Find Widget
   *   - Ctrl+R：刷新节点图
   *   - Ctrl+H：滚动到 HEAD
   *   - Ctrl+S：滚动到第一个 Stash
   *   - Ctrl+Shift+S：滚动到上一个 Stash
   *   - Up/Down：切换上/下提交
   *   - Ctrl+Up/Down：沿同一分支导航
   *   - Ctrl+Shift+Up/Down：沿替代分支导航
   *   - Enter：提交对话框
   *   - Escape：关闭菜单/对话框/详情视图
   *   - Ctrl+`：切换终端面板
   *
   * 注意：当焦点在输入框（input/textarea）中时，单键快捷键（如 Up/Down/Enter/Escape）
   * 不会触发，避免干扰用户输入。但 Ctrl 组合键仍然会触发。
   */
  private initKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      /* 从 configService 获取快捷键配置 */
      const cfg = configService.getAppConfig().keyboardShortcuts;

      /* 判断当前焦点是否在输入框中（单键快捷键在此情况下不触发） */
      const activeEl: Element | null = document.activeElement;
      const isInInput: boolean = activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        (activeEl instanceof HTMLElement && activeEl.isContentEditable);

      /* 遍历所有快捷键配置，匹配则执行对应操作 */
      /* 1. toggleTerminal：切换终端面板 */
      const toggleTerminalShortcut = parseShortcutString(cfg.toggleTerminal);
      if (toggleTerminalShortcut && matchShortcut(e, toggleTerminalShortcut)) {
        e.preventDefault();
        this.toggleTerminal();
        return;
      }

      /* 2. find：打开/关闭 Find Widget（仅在已打开仓库时响应） */
      const findShortcut = parseShortcutString(cfg.find);
      if (findShortcut && matchShortcut(e, findShortcut)) {
        e.preventDefault();
        this.toggleFindWidget();
        return;
      }

      /* 3. refresh：刷新节点图（仅在已打开仓库时响应） */
      const refreshShortcut = parseShortcutString(cfg.refresh);
      if (refreshShortcut && matchShortcut(e, refreshShortcut) && this.currentRepoPath) {
        e.preventDefault();
        this.refreshAllComponents();
        return;
      }

      /* 4. scrollToHead：滚动到 HEAD（仅在已打开仓库时响应） */
      const scrollToHeadShortcut = parseShortcutString(cfg.scrollToHead);
      if (scrollToHeadShortcut && matchShortcut(e, scrollToHeadShortcut) && this.commitGraph) {
        e.preventDefault();
        this.commitGraph.scrollToHead();
        return;
      }

      /* 5. scrollToStash：滚动到第一个 Stash */
      const scrollToStashShortcut = parseShortcutString(cfg.scrollToStash);
      if (scrollToStashShortcut && matchShortcut(e, scrollToStashShortcut) && this.commitGraph) {
        e.preventDefault();
        this.commitGraph.scrollToStash();
        return;
      }

      /* 6. scrollToPrevStash：滚动到上一个 Stash（暂未实现，打印日志） */
      const scrollToPrevStashShortcut = parseShortcutString(cfg.scrollToPrevStash);
      if (scrollToPrevStashShortcut && matchShortcut(e, scrollToPrevStashShortcut)) {
        e.preventDefault();
        console.log('[KeyboardShortcut] scrollToPrevStash（暂未实现）');
        return;
      }

      /* 7. closeOverlay：关闭菜单/对话框/详情视图（单键，输入框中不触发） */
      const closeOverlayShortcut = parseShortcutString(cfg.closeOverlay);
      if (closeOverlayShortcut && matchShortcut(e, closeOverlayShortcut) && !isInInput) {
        /* 先尝试关闭右键菜单 */
        contextMenu.close();
        /* 再尝试关闭对话框 */
        dialogSingleton.close();
        return;
      }

      /* 8. commitDialog：打开提交对话框（单键，输入框中不触发） */
      const commitDialogShortcut = parseShortcutString(cfg.commitDialog);
      if (commitDialogShortcut && matchShortcut(e, commitDialogShortcut) && !isInInput && this.commitInput) {
        e.preventDefault();
        /* 聚焦提交消息输入框 */
        const textarea: HTMLElement | null = document.getElementById('commit-message');
        if (textarea) {
          textarea.focus();
        }
        return;
      }

      /* 9. navigateUp：切换到上一个提交（单键，输入框中不触发） */
      const navigateUpShortcut = parseShortcutString(cfg.navigateUp);
      if (navigateUpShortcut && matchShortcut(e, navigateUpShortcut) && !isInInput) {
        e.preventDefault();
        this.navigateCommit(-1);
        return;
      }

      /* 10. navigateDown：切换到下一个提交（单键，输入框中不触发） */
      const navigateDownShortcut = parseShortcutString(cfg.navigateDown);
      if (navigateDownShortcut && matchShortcut(e, navigateDownShortcut) && !isInInput) {
        e.preventDefault();
        this.navigateCommit(1);
        return;
      }

      /* 11-14. 沿分支导航（暂未实现，打印日志） */
      const sameBranchUpShortcut = parseShortcutString(cfg.navigateSameBranchUp);
      if (sameBranchUpShortcut && matchShortcut(e, sameBranchUpShortcut)) {
        e.preventDefault();
        console.log('[KeyboardShortcut] navigateSameBranchUp（暂未实现）');
        return;
      }
      const sameBranchDownShortcut = parseShortcutString(cfg.navigateSameBranchDown);
      if (sameBranchDownShortcut && matchShortcut(e, sameBranchDownShortcut)) {
        e.preventDefault();
        console.log('[KeyboardShortcut] navigateSameBranchDown（暂未实现）');
        return;
      }
      const altBranchUpShortcut = parseShortcutString(cfg.navigateAltBranchUp);
      if (altBranchUpShortcut && matchShortcut(e, altBranchUpShortcut)) {
        e.preventDefault();
        console.log('[KeyboardShortcut] navigateAltBranchUp（暂未实现）');
        return;
      }
      const altBranchDownShortcut = parseShortcutString(cfg.navigateAltBranchDown);
      if (altBranchDownShortcut && matchShortcut(e, altBranchDownShortcut)) {
        e.preventDefault();
        console.log('[KeyboardShortcut] navigateAltBranchDown（暂未实现）');
        return;
      }
    });

    document.getElementById('btn-toggle-terminal')?.addEventListener('click', () => this.toggleTerminal());
    document.getElementById('btn-toggle-terminal-status')?.addEventListener('click', () => this.toggleTerminal());
    document.getElementById('btn-close-terminal')?.addEventListener('click', () => this.toggleTerminal());

    // ---- 绑定仓库操作按钮（Task 6.3：按钮已从工具栏移至欢迎页）----
    // "打开仓库"按钮 - 点击后弹出目录选择对话框，打开选定的 Git 仓库
    // 如果选择的目录不是 Git 仓库，显示"非 Git 仓库"提示 + 初始化按钮（Task 6.4 + Task 9）
    document.getElementById('btn-welcome-open')?.addEventListener('click', async () => {
      try {
        const dir = await repoService.selectDirectory();
        if (!dir) return;
        try {
          // 尝试打开仓库：如果目录不是 Git 仓库，后端会抛出错误
          const info = await repoService.openRepo(dir);
          this.onRepoOpened(info);
        } catch (openErr) {
          // Task 6.4 + Task 9：打开的目录不是 Git 仓库时，清空旧数据并显示提示 + 初始化按钮
          console.error('打开仓库失败（该目录可能不是 Git 仓库）:', openErr);
          this.showNotGitRepoPrompt(dir);
        }
      } catch (err) {
        console.error('选择目录失败:', err);
      }
    });

    // "克隆仓库"按钮 - 点击后弹出 URL 输入框和目录选择对话框，克隆远程仓库到本地
    document.getElementById('btn-welcome-clone')?.addEventListener('click', async () => {
      try {
        const url = prompt(t('repo.cloneUrlPrompt'));
        if (!url) return;
        const dir = await repoService.selectDirectory();
        if (!dir) return;
        await repoService.cloneRepo(url, dir);
        const info = await repoService.openRepo(dir);
        this.onRepoOpened(info);
      } catch (err) {
        console.error('克隆仓库失败:', err);
        alert('克隆仓库失败：' + String(err));
      }
    });

    // 撤销提交按钮 - 点击后弹出撤销对话框
    // 只有在已打开仓库的情况下才能撤销，否则提示用户先打开仓库
    document.getElementById('btn-reset-commit')?.addEventListener('click', () => {
      // 检查是否已经打开了仓库
      if (!this.currentRepoPath) {
        alert('请先打开一个仓库再进行撤销操作');
        return;
      }
      // 创建撤销对话框并显示
      // 传入当前仓库路径和成功回调（撤销成功后刷新所有组件）
      const dialog = new ResetDialog(this.currentRepoPath, () => {
        this.refreshAllComponents();
      });
      dialog.show();
    });

    // 标签管理按钮 - 点击后弹出标签管理对话框
    // 只有在已打开仓库的情况下才能管理标签，否则提示用户先打开仓库
    document.getElementById('btn-tag-manager')?.addEventListener('click', () => {
      // 检查是否已经打开了仓库
      if (!this.currentRepoPath) {
        alert('请先打开一个仓库再进行标签管理');
        return;
      }
      // 创建标签管理对话框并显示
      // 传入当前仓库路径和成功回调（标签操作成功后刷新所有组件）
      const tagManager = new TagManager(this.currentRepoPath, () => {
        this.refreshAllComponents();
      });
      tagManager.show();
    });

    // 子模块管理按钮 - 点击后弹出子模块管理对话框（阶段 9：Task 9.2）
    // 只有在已打开仓库的情况下才能管理子模块，否则提示用户先打开仓库
    document.getElementById('btn-submodule-manager')?.addEventListener('click', () => {
      // 检查是否已经打开了仓库
      if (!this.currentRepoPath) {
        alert('请先打开一个仓库再进行子模块管理');
        return;
      }
      // 创建子模块管理对话框并显示
      // 传入当前仓库路径和成功回调（子模块操作成功后刷新所有组件）
      const submoduleManager = new SubmoduleManager(this.currentRepoPath, () => {
        this.refreshAllComponents();
      });
      submoduleManager.show();
    });

    // LFS 管理按钮 - 点击后弹出 LFS 管理对话框（阶段 9：Task 9.4）
    // 只有在已打开仓库的情况下才能管理 LFS，否则提示用户先打开仓库
    document.getElementById('btn-lfs-manager')?.addEventListener('click', () => {
      // 检查是否已经打开了仓库
      if (!this.currentRepoPath) {
        alert('请先打开一个仓库再进行 LFS 管理');
        return;
      }
      // 创建 LFS 管理对话框并显示
      // 传入当前仓库路径和成功回调（LFS 操作成功后刷新所有组件）
      const lfsManager = new LfsManager(this.currentRepoPath, () => {
        this.refreshAllComponents();
      });
      lfsManager.show();
    });

    // 清理历史按钮 - 点击后弹出"清理历史文件"对话框（Task 5.2）
    // 用于扫描并删除 Git 历史中的大文件（重写 Git 历史，危险操作）
    // 只有在已打开仓库的情况下才能清理，否则提示用户先打开仓库
    document.getElementById('btn-purge-history')?.addEventListener('click', () => {
      // 检查是否已经打开了仓库
      if (!this.currentRepoPath) {
        alert('请先打开一个仓库再进行清理历史操作');
        return;
      }
      // 设置操作完成回调（清理成功后刷新所有组件，包括节点图）
      // 注意：任务描述中提到的 loadCommits 方法在 app.ts 中实际名为 refreshAllComponents
      purgeHistoryDialog.onComplete = () => {
        void this.refreshAllComponents();
      };
      // 显示清理历史文件对话框
      purgeHistoryDialog.show(this.currentRepoPath);
    });

    // Stash 按钮 - 点击后弹出"Stash 未提交的变更"对话框
    // 只有在已打开仓库的情况下才能 stash，否则提示用户先打开仓库
    // stashManager 实例在 onRepoOpened 中创建（需要仓库路径）
    document.getElementById('btn-stash')?.addEventListener('click', () => {
      // 检查是否已经打开了仓库
      if (!this.currentRepoPath) {
        alert('请先打开一个仓库再进行 Stash 操作');
        return;
      }
      // 如果 stashManager 实例不存在（理论上不会发生，因为 onRepoOpened 会创建），
      // 临时创建一个
      if (!this.stashManager) {
        this.stashManager = new StashManager(this.currentRepoPath, () => {
          this.refreshAllComponents();
        });
      }
      // 弹出 push stash 对话框（包含 Include Untracked 复选框 + Message 输入）
      this.stashManager.showPushStashDialog();
    });

    // Fetch 按钮 - 从远程仓库获取更新（不合并到当前分支）
    // 与 Pull 的区别：Fetch 只下载远程更新到远程跟踪分支，不自动合并；
    // Pull = Fetch + Merge，会自动合并到当前分支。
    // 只有在已打开仓库的情况下才能 fetch，否则提示用户先打开仓库
    document.getElementById('btn-fetch')?.addEventListener('click', async () => {
      await this.handleFetch();
    });

    // 查找按钮 - 切换 Find Widget 搜索框的显示/隐藏
    // 也可以通过 Ctrl+F 快捷键触发
    document.getElementById('btn-find')?.addEventListener('click', () => {
      this.toggleFindWidget();
    });

    // 设置按钮 - 点击后弹出设置面板（Task 7.4）
    // 只有在已打开仓库的情况下才能编辑配置，否则提示用户先打开仓库
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      // 检查是否已经打开了仓库
      if (!this.currentRepoPath) {
        alert('请先打开一个仓库再进行设置');
        return;
      }
      // 创建设置面板并显示
      // 传入当前仓库路径和成功回调（配置保存后刷新所有组件 + 重新加载壁纸）
      const settingsPanel = new SettingsPanel(this.currentRepoPath, () => {
        this.refreshAllComponents();
        // 壁纸选择/清除已迁移至设置面板，需重新加载以应用视觉变更
        this.loadSavedWallpaper();
      });
      settingsPanel.show();
    });

    // 拉取按钮 - 从远程仓库拉取最新提交并合并到当前分支
    // 只有在已打开仓库的情况下才能拉取，否则提示用户先打开仓库
    document.getElementById('btn-pull')?.addEventListener('click', async () => {
      // 检查是否已经打开了仓库
      if (!this.currentRepoPath) {
        alert('请先打开一个仓库再进行拉取操作');
        return;
      }

      // 获取当前分支名（从 branchList 组件获取）
      const currentBranch = this.branchList ? this.getCurrentBranchName() : null;
      if (!currentBranch) {
        alert('无法获取当前分支名，请确保已打开仓库');
        return;
      }

      // 阶段 12：Git 操作前静音文件监听器
      try {
        await repoService.muteWatcher();
      } catch (muteErr) {
        console.warn('[App] 静音文件监听器失败:', muteErr);
      }

      try {
        // 调用后端执行 git pull origin <branch>
        // remote 通常为 "origin"，branch 为当前分支名
        const result = await repoService.pull(this.currentRepoPath, 'origin', currentBranch);

        // 阶段 12：Git 操作完成后取消静音文件监听器
        try {
          await repoService.unmuteWatcher();
        } catch (unmuteErr) {
          console.warn('[App] 取消静音文件监听器失败:', unmuteErr);
        }

        // 显示成功信息
        alert(`拉取成功！\n\n${result}`);
        // 拉取成功后刷新所有组件（更新提交历史、文件列表等）
        await this.refreshAllComponents();

        // 阶段 12：检测合并冲突（pull = fetch + merge，可能产生冲突）
        await this.checkConflictsAfterOperation();
      } catch (err) {
        // 阶段 12：操作失败也要取消静音文件监听器
        try {
          await repoService.unmuteWatcher();
        } catch (unmuteErr) {
          console.warn('[App] 取消静音文件监听器失败:', unmuteErr);
        }

        // 显示错误信息
        console.error('拉取失败:', err);

        // 阶段 12：检测合并冲突（拉取失败可能是因为产生了冲突）
        const hasConflicts = await this.checkConflictsAfterOperation();
        if (!hasConflicts) {
          // 没有冲突，显示错误信息
          alert(`拉取失败：${err}`);
        }
      }
    });

    // 推送按钮 - 将本地分支的提交推送到远程仓库
    // 只有在已打开仓库的情况下才能推送，否则提示用户先打开仓库
    document.getElementById('btn-push')?.addEventListener('click', async () => {
      // 检查是否已经打开了仓库
      if (!this.currentRepoPath) {
        alert('请先打开一个仓库再进行推送操作');
        return;
      }

      // 获取当前分支名（从 branchList 组件获取）
      const currentBranch = this.branchList ? this.getCurrentBranchName() : null;
      if (!currentBranch) {
        alert('无法获取当前分支名，请确保已打开仓库');
        return;
      }

      // 阶段 12：Git 操作前静音文件监听器
      try {
        await repoService.muteWatcher();
      } catch (muteErr) {
        console.warn('[App] 静音文件监听器失败:', muteErr);
      }

      try {
        // 调用后端执行 git push origin <branch>
        // remote 通常为 "origin"，branch 为当前分支名
        const result = await repoService.push(this.currentRepoPath, 'origin', currentBranch);

        // 阶段 12：Git 操作完成后取消静音文件监听器
        try {
          await repoService.unmuteWatcher();
        } catch (unmuteErr) {
          console.warn('[App] 取消静音文件监听器失败:', unmuteErr);
        }

        // 显示成功信息
        alert(`推送成功！\n\n${result}`);
        // 推送成功后刷新所有组件（更新分支信息、提交历史等）
        await this.refreshAllComponents();
      } catch (err) {
        // 阶段 12：操作失败也要取消静音文件监听器
        try {
          await repoService.unmuteWatcher();
        } catch (unmuteErr) {
          console.warn('[App] 取消静音文件监听器失败:', unmuteErr);
        }

        // 显示错误信息
        console.error('推送失败:', err);
        alert(`推送失败：${err}`);
      }
    });
  }

  /**
   * 获取当前分支名
   * 
   * 从 branchList 组件中获取当前检出的分支名称。
   * 如果没有打开仓库或没有分支信息，返回 null。
   * 
   * @returns 当前分支名，如果没有则返回 null
   */
  private getCurrentBranchName(): string | null {
    if (!this.branchList) return null;
    // 使用 branchList 组件提供的公共方法获取当前分支名
    return this.branchList.getCurrentBranchName();
  }

  /**
   * 处理 Fetch 按钮点击事件（Task 5.3）
   *
   * 从远程仓库获取更新（git fetch --all --prune），不合并到当前分支。
   * 流程：
   *   1. 检查是否已打开仓库
   *   2. 显示 loading 对话框（"正在获取远程更新..."）
   *   3. 阶段 12：静音文件监听器（muteWatcher），避免 fetch 触发 repo_changed
   *   4. 调用 repoService.fetch 执行 git fetch --all --prune
   *      （默认配置：prune=true 启用清理已删除分支，pruneTags=false 不清理标签）
   *   5. 阶段 12：取消静音文件监听器（unmuteWatcher）
   *   6. 关闭 loading 对话框
   *   7. 刷新节点图（显示新获取的提交）
   *   8. 如果出错，显示错误信息
   */
  private async handleFetch(): Promise<void> {
    // 检查是否已经打开了仓库
    if (!this.currentRepoPath) {
      alert('请先打开一个仓库再进行 Fetch 操作');
      return;
    }

    // 显示 loading 对话框（用户无法关闭，必须等 fetch 完成）
    dialogSingleton.showActionRunning('正在获取远程更新');

    // 阶段 12：Git 操作前静音文件监听器
    try {
      await repoService.muteWatcher();
    } catch (muteErr) {
      console.warn('[App] 静音文件监听器失败:', muteErr);
    }

    try {
      // 调用后端执行 git fetch --all --prune
      // 参数说明：
      //   - remote: undefined（不传）→ 使用 --all 拉取所有远程
      //   - prune: true → 启用 --prune，清理远程已删除的本地远程跟踪分支引用
      //   - pruneTags: false → 不启用 --prune-tags（避免低版本 Git 兼容性问题）
      const result = await repoService.fetch(this.currentRepoPath, undefined, true, false);

      // 阶段 12：Git 操作完成后取消静音文件监听器
      try {
        await repoService.unmuteWatcher();
      } catch (unmuteErr) {
        console.warn('[App] 取消静音文件监听器失败:', unmuteErr);
      }

      // 关闭 loading 对话框
      dialogSingleton.closeActionRunning();

      // 显示 fetch 结果（可能为空字符串，表示无更新）
      if (result && result.trim()) {
        alert(`Fetch 完成！\n\n${result}`);
      } else {
        alert('Fetch 完成！（无输出信息）');
      }

      // 刷新所有组件（更新提交历史、分支信息等）
      // fetch 后远程跟踪分支会更新，节点图需要重新加载以显示新的远程提交
      await this.refreshAllComponents();
    } catch (err) {
      // 阶段 12：操作失败也要取消静音文件监听器
      try {
        await repoService.unmuteWatcher();
      } catch (unmuteErr) {
        console.warn('[App] 取消静音文件监听器失败:', unmuteErr);
      }

      // 关闭 loading 对话框（即使出错也要关闭，避免界面卡住）
      dialogSingleton.closeActionRunning();
      // 显示错误信息
      console.error('Fetch 失败:', err);
      alert(`Fetch 失败：${err}`);
    }
  }

  /**
   * 检测合并冲突并自动打开合并编辑器（阶段 12 集成点）
   *
   * 在可能产生冲突的 Git 操作（如 pull）后调用，检测仓库中是否存在合并冲突文件。
   * 如果存在冲突，自动打开合并编辑器让用户解决第一个冲突文件。
   *
   * 此方法使用动态导入 merge-editor 组件，避免循环依赖。
   *
   * @returns true = 检测到冲突并已打开合并编辑器；false = 无冲突或无法检测
   */
  private async checkConflictsAfterOperation(): Promise<boolean> {
    /* 检查是否已打开仓库 */
    if (!this.currentRepoPath) {
      return false;
    }

    try {
      /* 调用后端检测冲突文件列表 */
      const conflicts = await repoService.detectConflicts(this.currentRepoPath);

      /* 有冲突文件：自动打开合并编辑器 */
      if (conflicts.length > 0) {
        console.log(`[App] 检测到 ${conflicts.length} 个冲突文件，自动打开合并编辑器`);

        /* 动态导入合并编辑器单例（避免循环依赖） */
        const { mergeEditor } = await import('./merge-editor.js');

        /* 打开第一个冲突文件的合并编辑器 */
        await mergeEditor.open(this.currentRepoPath, conflicts[0].path);

        /* 返回 true 表示检测到冲突并已处理 */
        return true;
      }
    } catch (err) {
      /* 检测冲突失败不影响正常流程，仅记录警告 */
      console.warn('[App] 检测合并冲突失败:', err);
    }

    /* 无冲突 */
    return false;
  }

  /**
   * 切换 Find Widget 搜索框的显示/隐藏（Task 5.1）
   *
   * 由 Ctrl+F 快捷键或工具栏"查找"按钮触发。
   * 如果 Find Widget 未创建（未打开仓库），则忽略。
   */
  private toggleFindWidget(): void {
    // 检查是否已创建 Find Widget（只有在打开仓库后才会创建）
    if (!this.findWidget) {
      console.log('[App] Find Widget 尚未初始化（请先打开仓库）');
      return;
    }
    // 切换显示/隐藏状态
    this.findWidget.toggle();
  }

  /** 切换终端面板的显示/隐藏 */
  private toggleTerminal(): void {
    const panel = document.getElementById('terminal-panel');
    if (!panel) return;
    
    this.terminalVisible = !this.terminalVisible;
    if (this.terminalVisible) {
      panel.classList.remove('hidden');
      panel.classList.remove('collapsed');
      if (!this.terminalInstance) {
        const terminalBody = document.getElementById('terminal-body');
        if (terminalBody) {
          this.terminalInstance = new TerminalPanel(terminalBody);
          this.terminalInstance.init();
        }
      }
    } else {
      panel.classList.add('hidden');
    }
  }

  /** 初始化主题切换 */
  private initThemeToggle(): void {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      this.currentTheme = 'light';
      document.documentElement.setAttribute('data-theme', 'light');
    }

    document.getElementById('btn-toggle-theme')?.addEventListener('click', () => {
      this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', this.currentTheme);
      localStorage.setItem('theme', this.currentTheme);
    });
  }

  /** 检测 Git 安装状态 */
  private async checkGitInstallation(): Promise<void> {
    const centerBody = document.getElementById('center-body');
    if (!centerBody) return;

    const installer = new GitInstaller(centerBody);
    await installer.checkAndHandle();

    /* Task 11.4：获取 Git 版本并更新状态栏 */
    await this.updateGitVersion();
  }

  /**
   * 获取 Git 版本并更新状态栏（Task 11.4）
   *
   * 调用后端 get_git_version 命令获取系统安装的 Git 版本号，
   * 并更新状态栏中的 Git 版本显示。
   */
  private async updateGitVersion(): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const version: string = await invoke('get_git_version');
      const gitVersionEl = document.getElementById('statusbar-git-version');
      if (gitVersionEl) {
        gitVersionEl.textContent = `Git: ${version}`;
      }
    } catch (err) {
      console.error('[App] 获取 Git 版本失败:', err);
      const gitVersionEl = document.getElementById('statusbar-git-version');
      if (gitVersionEl) {
        gitVersionEl.textContent = 'Git: ?';
      }
    }
  }

  /**
   * 更新状态栏的分支和 ahead/behind 信息（Task 11.4）
   *
   * 从 branchList 获取当前分支名和 ahead/behind 计数，更新到状态栏。
   * 在仓库打开和刷新时调用。
   */
  private updateStatusbarBranch(): void {
    if (!this.branchList) return;

    /* 获取当前分支名 */
    const currentBranch: string | null = this.getCurrentBranchName();

    /* 更新分支名显示 */
    const branchEl = document.getElementById('statusbar-branch');
    const branchNameEl = document.getElementById('statusbar-branch-name');
    if (branchEl && branchNameEl) {
      if (currentBranch) {
        branchNameEl.textContent = currentBranch;
        branchEl.style.display = 'flex';
      } else {
        branchEl.style.display = 'none';
      }
    }

    /* 更新 ahead/behind 显示 */
    const aheadBehindEl = document.getElementById('statusbar-ahead-behind');
    const aheadBehindTextEl = document.getElementById('statusbar-ahead-behind-text');
    if (aheadBehindEl && aheadBehindTextEl) {
      /* 从 branchList 获取当前分支的 ahead/behind 信息 */
      const aheadBehind: { ahead: number; behind: number } | null = this.getCurrentBranchAheadBehind();
      if (currentBranch && aheadBehind && (aheadBehind.ahead > 0 || aheadBehind.behind > 0)) {
        aheadBehindTextEl.textContent = `↑${aheadBehind.ahead} ↓${aheadBehind.behind}`;
        aheadBehindEl.style.display = 'flex';
      } else {
        aheadBehindEl.style.display = 'none';
      }
    }
  }

  /**
   * 获取当前分支的 ahead/behind 计数（Task 11.4）
   *
   * 从 branchList 获取当前检出分支相对于其上游分支的领先/落后提交数。
   *
   * @returns ahead/behind 对象，如果无法获取则返回 null
   */
  private getCurrentBranchAheadBehind(): { ahead: number; behind: number } | null {
    if (!this.branchList) return null;
    /* 调用 branchList 的方法获取当前分支信息 */
    /* branchList 内部维护了分支列表，每个分支含 ahead/behind 字段 */
    return this.branchList.getCurrentBranchAheadBehind();
  }

  /**
   * 更新状态栏的提交总数和排序方式（Task 11.4）
   *
   * 从 commitGraph 获取已加载的提交数量，从 configService 获取排序方式，
   * 更新到状态栏。在仓库打开和刷新时调用。
   */
  private updateStatusbarCommitInfo(): void {
    /* 更新提交总数 */
    const commitCountEl = document.getElementById('statusbar-commit-count');
    const commitCountTextEl = document.getElementById('statusbar-commit-count-text');
    if (commitCountEl && commitCountTextEl && this.commitGraph) {
      const commits: ReadonlyArray<GitCommit> = this.commitGraph.getCommits();
      if (commits.length > 0) {
        commitCountTextEl.textContent = String(commits.length);
        commitCountEl.style.display = 'flex';
      } else {
        commitCountEl.style.display = 'none';
      }
    }

    /* 更新排序方式 */
    const sortOrderEl = document.getElementById('statusbar-sort-order');
    const sortOrderTextEl = document.getElementById('statusbar-sort-order-text');
    if (sortOrderEl && sortOrderTextEl) {
      const cfg = configService.getAppConfig().repository;
      const orderMap: Record<string, string> = {
        'date': '按日期',
        'author-date': '按作者日期',
        'topo': '拓扑排序',
      };
      const orderText: string = orderMap[cfg.commitOrder] || cfg.commitOrder;
      sortOrderTextEl.textContent = orderText;
      sortOrderEl.style.display = 'flex';
    }
  }

  /**
   * 仓库打开后的 UI 更新回调
   * 
   * 初始化所有 Git 可视化组件并加载数据。
   * 
   * @param info - 从后端获取的仓库基本信息
   */
  private async onRepoOpened(info: RepoInfo): Promise<void> {
    console.log('[App] onRepoOpened 开始执行，仓库路径:', info.path);
    // 保存当前仓库路径
    this.currentRepoPath = info.path;

    // 初始化右键菜单动作系统：注入仓库路径、刷新回调和查看提交详情回调
    // 这些回调由 context-menu-actions.ts 中的 runAction 和菜单项使用
    setRepoPath(info.path);
    setRefreshCallback(() => this.refreshAllComponents());
    setViewCommitCallback((hash: string) => { this.showCommitDetailByHash(hash); });

    // ============================================================
    // 阶段 12：初始化合并编辑器和 Blame 视图的全局回调
    // ============================================================
    // setMergeEditorCallbacks：注入关闭和保存成功回调
    //   - onClose：合并编辑器关闭时调用（刷新所有组件以更新冲突状态）
    //   - onSaved：合并结果保存成功并 git add 后调用（刷新所有组件）
    setMergeEditorCallbacks(
      () => { void this.refreshAllComponents(); },
      () => { void this.refreshAllComponents(); }
    );
    // setBlameViewerCallbacks：注入提交点击和关闭回调
    //   - onCommitClick：用户在 Blame 视图中点击某行的提交哈希时调用（显示该提交的详情）
    //   - onClose：Blame 视图关闭时调用（当前无需额外操作）
    setBlameViewerCallbacks(
      (hash: string) => { this.showCommitDetailByHash(hash); },
      () => { /* Blame 视图关闭时无需额外操作 */ }
    );

    // 更新状态栏
    const repoPathEl = document.getElementById('statusbar-repo-path');
    if (repoPathEl) {
      repoPathEl.textContent = info.path;
    }
    /* Task 11.4：更新状态栏的排序方式显示 */
    this.updateStatusbarCommitInfo();

    // ============================================================
    // 阶段 10：Task 10.6 - 从后端恢复仓库状态
    // ============================================================
    // 调用 stateService.loadStateFromBackend 从 ~/.gittimeprism/state.json
    // 加载该仓库之前保存的视图状态（列宽、分隔位置、显示选项等）
    // 加载成功后状态会同步到 localStorage，后续组件初始化时读取
    try {
      const savedState = await stateService.loadStateFromBackend(info.path);
      console.log('[App] 已从后端恢复仓库状态:', savedState);
      // 注意：实际应用恢复（如设置列宽、滚动位置等）需要各组件支持
      // 当前阶段仅加载状态到 localStorage，组件初始化时会自动读取
      // 后续 Task 12.x 会在此处应用恢复的状态到各组件
    } catch (err) {
      console.warn('[App] 从后端恢复仓库状态失败（不影响应用使用）:', err);
    }

    // ============================================================
    // 阶段 10：Task 10.1 - 注册仓库到后端配置文件
    // ============================================================
    // 调用 repoService.registerRepo 将仓库路径注册到 ~/.gittimeprism/repos.json
    // 记录上次打开时间，便于"最近仓库"列表显示
    try {
      await repoService.registerRepo(info.path);
      console.log('[App] 仓库已注册到后端配置');
    } catch (err) {
      console.warn('[App] 注册仓库到后端配置失败（不影响应用使用）:', err);
    }

    // ============================================================
    // 阶段 10：Task 10.2 - 启动文件监听器
    // ============================================================
    // 调用 repoService.startWatcher 启动后端文件监听器
    // 监听 .git 目录下的文件变化（config/index/HEAD/refs 等）
    // 当检测到变化时，后端会 emit 'repo_changed' 事件，前端已注册监听
    try {
      await repoService.startWatcher(info.path);
      console.log('[App] 文件监听器已启动');
    } catch (err) {
      console.warn('[App] 启动文件监听器失败（不影响应用使用）:', err);
    }

    // 显示提交输入区域
    const commitInputArea = document.getElementById('commit-input-area');
    if (commitInputArea) {
      commitInputArea.style.display = 'block';
      console.log('[App] 提交输入区域已显示');
    }

    // 初始化 diff 视图组件（对比面板）
    // 使用 diff-viewer-body 作为容器，点击文件时在新面板中显示对比
    const diffViewerBody = document.getElementById('diff-viewer-body');
    if (diffViewerBody) {
      // 传入返回回调：点击返回按钮时，隐藏对比面板
      this.diffViewer = new DiffViewer('diff-viewer-body', () => {
        this.hideDiffPanel();
      });
      console.log('[App] diff 视图组件初始化完成');
    }

    // 初始化提交详情组件（详情面板）
    // 传入文件点击回调：点击提交详情中的文件时，在新面板中显示对比
    // Task 13.5：传入文件历史回调：右键菜单点击"查看文件历史"时触发显示该文件的提交历史
    const detailBody = document.getElementById('detail-body');
    if (detailBody) {
      this.commitDetail = new CommitDetail(
        'detail-body',
        (filePath: string, commitHash: string) => {
          this.showCommitFileDiff(filePath, commitHash);
        },
        (filePath: string) => {
          /* Task 13.5：文件历史查看回调 - 显示该文件的提交历史视图 */
          this.showFileHistory(filePath);
        }
      );
      console.log('[App] 提交详情组件初始化完成');
    }

    // 绑定对比面板关闭按钮
    const closeDiffBtn = document.getElementById('btn-close-diff-panel');
    if (closeDiffBtn) {
      closeDiffBtn.addEventListener('click', () => {
        this.hideDiffPanel();
      });
    }

    // 初始化文件历史查看组件（详情面板）
    // 点击历史中的提交时在该面板中显示 diff
    if (this.diffViewer) {
      this.fileHistory = new FileHistory('detail-body', this.diffViewer);
      console.log('[App] 文件历史组件初始化完成');
    }

    // 初始化文件列表组件（左侧面板）
    // 传入文件历史回调：右键菜单点击"查看文件历史"时触发
    const fileListBody = document.getElementById('sidebar-body');
    console.log('[App] sidebar-body 元素存在:', !!fileListBody);
    if (fileListBody) {
      this.fileList = new FileList('sidebar-body', info.path, (filePath, isStaged) => {
        // 点击文件时显示 diff，传递 isStaged 参数以区分暂存区/工作区 diff
        this.showFileDiff(filePath, isStaged);
      }, (filePath) => {
        // 右键菜单点击"查看文件历史"时，调用文件历史组件显示该文件的提交历史
        this.showFileHistory(filePath);
      }, () => {
        // 暂存状态变化时，更新提交按钮状态
        console.log('[App] 收到暂存状态变化通知，调用 updateCommitButtonState');
        this.updateCommitButtonState();
      });
      await this.fileList.refresh();
      console.log('[App] FileList 组件初始化并刷新完成');
    }

    // 初始化提交输入组件（左侧面板底部）
    const commitInputBody = document.getElementById('commit-input-body');
    console.log('[App] commit-input-body 元素存在:', !!commitInputBody);
    if (commitInputBody) {
      this.commitInput = new CommitInput('commit-input-body', info.path, () => {
        // 提交成功后刷新所有组件
        console.log('[App] 提交成功回调被调用');
        this.refreshAllComponents();
      });
      console.log('[App] CommitInput 组件初始化完成');
      this.commitInput.enable();
      console.log('[App] CommitInput 组件已启用');

      // 检查是否有暂存文件，更新提交按钮状态
      try {
        console.log('[App] 开始检查仓库状态，获取暂存文件信息');
        const status = await repoService.getRepoStatus(info.path);
        const hasStaged = status.entries.some(entry => entry.staged);
        console.log('[App] 仓库状态检查完成，是否有暂存文件:', hasStaged);
        this.commitInput.setHasStagedFiles(hasStaged);
      } catch (err) {
        console.error('[App] 获取仓库状态失败:', err);
        this.commitInput.setHasStagedFiles(false);
      }
    }

    // 初始化提交节点图组件（中间面板）
    const centerBody = document.getElementById('center-body');
    console.log('[App] center-body 元素存在:', !!centerBody);
    if (centerBody) {
      console.log('[App] 开始初始化 CommitGraph 组件');
      this.commitGraph = new CommitGraph('center-body', info.path, (commit) => {
        // 点击节点时显示提交详情
        console.log('[App] 节点图节点被点击，hash:', commit.hash);
        this.showCommitDetail(commit);
      });

      // 绑定右键菜单回调：当用户在节点图中右键点击提交节点或 ref 标签时，
      // 调用 handleContextMenu 方法生成并显示对应的上下文菜单
      this.commitGraph.setOnContextMenu((target, data, event) => {
        this.handleContextMenu(target, data, event);
      });

      console.log('[App] CommitGraph 组件初始化完成，开始刷新');
      await this.commitGraph.refresh();
      console.log('[App] CommitGraph 组件刷新完成');

      // 初始化 Find Widget 搜索框组件（Task 5.1）
      // 浮动在节点图上方，支持按作者/哈希/消息/分支/标签/日期/stash 搜索提交
      // 传入回调：
      //   - getCommits：获取当前已加载的提交列表（用于搜索）
      //   - scrollToCommit：导航匹配项时滚动到对应提交
      //   - onViewCommit：导航时自动加载提交详情（对应 gitgraph 的 findOpenCommitDetailsView）
      this.findWidget = new FindWidget(
        centerBody,
        info.path,
        () => this.commitGraph?.getCommits() ?? [],
        (hash: string) => this.commitGraph?.scrollToCommit(hash),
        (hash: string) => this.showCommitDetailByHash(hash),
      );
      // 从 state-service 恢复上次的状态（搜索文本、可见性、大小写、正则模式）
      this.findWidget.restoreState();
      console.log('[App] FindWidget 组件初始化完成');
    }

    // 初始化 Stash 管理组件（作为 commit-graph 的辅助组件）
    // 传入当前仓库路径和成功回调（stash 操作成功后刷新所有组件）
    // 此组件不创建独立 DOM，仅在用户点击工具栏 Stash 按钮或
    // 在节点图中操作 stash 节点时弹出对话框
    this.stashManager = new StashManager(info.path, () => {
      this.refreshAllComponents();
    });
    console.log('[App] StashManager 组件初始化完成');

    // 初始化分支列表组件（工具栏）
    const toolbar = document.getElementById('toolbar');
    if (toolbar) {
      this.branchList = new BranchList('toolbar', info.path, () => {
        // 分支切换成功后刷新所有组件
        this.refreshAllComponents();
      });
      await this.branchList.refresh();
    }
    
    console.log('[App] onRepoOpened 执行完成');
  }

  /**
   * 显示文件历史
   * 
   * 在右侧面板中显示指定文件的提交历史列表。
   * 点击历史中的提交可以查看该提交的 diff。
   * 
   * @param filePath - 文件路径（相对于仓库根目录）
   */
  private async showFileHistory(filePath: string): Promise<void> {
    if (!this.currentRepoPath || !this.fileHistory) return;

    try {
      await this.fileHistory.showHistory(this.currentRepoPath, filePath);
    } catch (err) {
      console.error('显示文件历史失败:', err);
    }
  }

  /**
   * 显示文件 diff
   * 
   * 根据文件是否已暂存，调用不同的 diff 方法：
   * - 已暂存文件：显示暂存区与 HEAD 之间的差异
   * - 未暂存文件：显示工作区与暂存区之间的差异
   * 
   * @param filePath - 文件路径（相对于仓库根目录）
   * @param isStaged - 文件是否已暂存
   */
  private async showFileDiff(filePath: string, isStaged: boolean): Promise<void> {
    if (!this.currentRepoPath || !this.diffViewer) return;

    try {
      if (isStaged) {
        // 已暂存文件：显示暂存区 diff
        await this.diffViewer.showStagedDiff(this.currentRepoPath, filePath);
      } else {
        // 未暂存文件：显示工作区 diff
        await this.diffViewer.showWorkdirDiff(this.currentRepoPath, filePath);
      }
    } catch (err) {
      console.error('显示文件 diff 失败:', err);
    }
  }

  /**
   * 显示提交详情
   *
   * @param commit - 提交节点数据（带 heads/tags/remotes/stash 注解）
   */
  private async showCommitDetail(commit: GitCommit): Promise<void> {
    if (!this.currentRepoPath || !this.commitDetail) return;

    // 保存当前提交哈希，用于返回按钮
    this.currentCommitHash = commit.hash;

    try {
      await this.commitDetail.showCommit(this.currentRepoPath, commit.hash);
    } catch (err) {
      console.error('显示提交详情失败:', err);
    }
  }

  /**
   * 通过提交哈希显示提交详情
   *
   * 当用户在标签右键菜单中选择"View Details"时调用。
   * 由于菜单生成时只有标签名，需要通过此方法接收标签指向的提交哈希来显示详情。
   *
   * @param hash - 提交的完整哈希值
   */
  private async showCommitDetailByHash(hash: string): Promise<void> {
    if (!this.currentRepoPath || !this.commitDetail) return;

    // 保存当前提交哈希，用于返回按钮
    this.currentCommitHash = hash;

    try {
      await this.commitDetail.showCommit(this.currentRepoPath, hash);
    } catch (err) {
      console.error('显示提交详情失败:', err);
    }
  }

  /**
   * 导航到上/下一个提交（Task 11.3：键盘快捷键 Up/Down）
   *
   * 根据当前选中的提交哈希，在提交列表中找到其索引，
   * 然后切换到上（direction=-1）或下（direction=+1）一个提交。
   *
   * @param direction - 导航方向：-1 表示上一个，+1 表示下一个
   */
  private navigateCommit(direction: number): void {
    /* 检查是否已打开仓库和提交图 */
    if (!this.commitGraph || !this.currentCommitHash) {
      return;
    }

    /* 获取当前提交列表 */
    const commits: ReadonlyArray<GitCommit> = this.commitGraph.getCommits();
    if (commits.length === 0) {
      return;
    }

    /* 查找当前提交的索引 */
    let currentIndex: number = -1;
    for (let i = 0; i < commits.length; i++) {
      if (commits[i].hash === this.currentCommitHash) {
        currentIndex = i;
        break;
      }
    }

    /* 如果当前提交不在列表中，无法导航 */
    if (currentIndex === -1) {
      console.log('[App] 当前提交不在已加载列表中，无法导航');
      return;
    }

    /* 计算目标索引（边界检查） */
    const targetIndex: number = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= commits.length) {
      console.log('[App] 已到达提交列表边界');
      return;
    }

    /* 切换到目标提交 */
    const targetCommit: GitCommit = commits[targetIndex];
    this.showCommitDetail(targetCommit);

    /* 滚动到目标提交位置，使其可见 */
    this.commitGraph.scrollToCommit(targetCommit.hash);
  }

  /**
   * 处理右键菜单事件
   *
   * 当用户在节点图中右键点击提交节点或 ref 标签时，由 commit-graph 的
   * onContextMenu 回调调用此方法。根据右键目标的类型，生成对应的
   * 上下文菜单 actions 并通过 contextMenu.show() 显示菜单。
   *
   * 支持的 target 类型：
   *   - 'commit'：右键点击了提交节点（可能是普通提交或 UNCOMMITTED 虚拟节点）
   *   - 'branch'：右键点击了本地分支标签
   *   - 'tag'：右键点击了标签
   *   - 'remote'：右键点击了远程跟踪分支标签
   *   - 'stash'：右键点击了 stash 标签（运行时值，TypeScript 类型中未声明但实际会出现）
   *
   * @param target - 右键目标类型
   * @param data - 相关数据（GitCommit 对象或 ref 名称字符串）
   * @param event - 鼠标事件（用于定位菜单）
   */
  private handleContextMenu(
    target: string,
    data: GitCommit | string,
    event: MouseEvent
  ): void {
    // 获取中间面板作为菜单定位的参照容器
    const frameElem: HTMLElement = document.getElementById('center-body') || document.body;

    // 根据目标类型生成对应的菜单 actions
    let actions: ContextMenuActions;

    if (target === 'commit') {
      // 右键点击了提交节点
      const commit = data as GitCommit;

      // 检查是否是 UNCOMMITTED 虚拟节点（hash 为 '*'）
      if (commit.hash === UNCOMMITTED) {
        // 未提交变更节点：显示未提交变更菜单
        actions = getUncommittedChangesContextMenuActions(null);
      } else {
        // 普通提交节点：显示提交菜单
        actions = getCommitContextMenuActions(commit, null);
      }
    } else if (target === 'branch') {
      // 右键点击了本地分支标签：data 是分支名
      const branchName = data as string;
      actions = getBranchContextMenuActions(branchName, null);
    } else if (target === 'tag') {
      // 右键点击了标签：data 是标签名
      const tagName = data as string;
      actions = getTagContextMenuActions(tagName, null);
    } else if (target === 'remote') {
      // 右键点击了远程跟踪分支标签：data 是远程分支全名（如 "origin/main"）
      const remoteBranchName = data as string;
      actions = getRemoteBranchContextMenuActions(remoteBranchName, null);
    } else if (target === 'stash') {
      // 右键点击了 stash 标签：data 是 stash 选择器（如 "stash@{0}"）
      // 需要从提交列表中查找 stash 的完整哈希值（用于"复制哈希"功能）
      const stashSelector = data as string;
      const commits = this.commitGraph?.getCommits() ?? [];
      // 查找包含该 stash 选择器的提交
      const stashCommit = commits.find(c => c.stash?.selector === stashSelector);
      const stashHash = stashCommit?.hash ?? '';
      actions = getStashContextMenuActions(stashSelector, stashHash, null);
    } else {
      // 未知目标类型：不显示菜单
      console.warn('[App] 未知的右键菜单目标类型:', target);
      return;
    }

    // 显示右键菜单
    // 参数说明：
    //   actions：菜单项的二维数组
    //   false：不显示勾选标记（此项目前不需要勾选类菜单）
    //   null：不绑定特定目标元素（菜单不需要高亮目标）
    //   event：鼠标事件（用于定位菜单位置）
    //   frameElem：菜单定位的参照容器
    contextMenu.show(actions, false, null, event, frameElem);
  }

  /**
   * 显示提交中某个文件的左右分栏对比视图
   * 
   * 当用户在提交详情面板中点击某个文件时调用，
   * 弹出对比面板，左栏显示父提交的文件内容，右栏显示当前提交的文件内容。
   * 提交详情面板保持不变。
   * 
   * @param filePath - 文件路径（相对于仓库根目录）
   * @param commitHash - 提交哈希值
   */
  private async showCommitFileDiff(filePath: string, commitHash: string): Promise<void> {
    if (!this.currentRepoPath || !this.diffViewer) return;

    // 保存当前提交哈希，用于返回按钮
    this.currentCommitHash = commitHash;

    // 显示对比面板
    this.showDiffPanel();

    try {
      await this.diffViewer.showCommitDiff(this.currentRepoPath, commitHash);
    } catch (err) {
      console.error('显示提交文件对比失败:', err);
    }
  }

  /**
   * 显示对比面板（四栏布局）
   * 
   * 将隐藏的对比面板和拖拽手柄显示出来，形成四栏布局。
   */
  private showDiffPanel(): void {
    const diffPanel = document.getElementById('diff-panel');
    const diffHandle = document.getElementById('diff-panel-handle');
    if (diffPanel) diffPanel.style.display = 'flex';
    if (diffHandle) diffHandle.style.display = 'block';
  }

  /**
   * 隐藏对比面板（恢复三栏布局）
   * 
   * 将对比面板和拖拽手柄隐藏，恢复原来的三栏布局。
   */
  private hideDiffPanel(): void {
    const diffPanel = document.getElementById('diff-panel');
    const diffHandle = document.getElementById('diff-panel-handle');
    if (diffPanel) diffPanel.style.display = 'none';
    if (diffHandle) diffHandle.style.display = 'none';
  }

  /**
   * 更新提交按钮状态
   *
   * 检查是否有暂存文件，并更新提交按钮的启用/禁用状态。
   * 在暂存/取消暂存操作后调用。
   */
  private async updateCommitButtonState(): Promise<void> {
    if (!this.commitInput || !this.currentRepoPath) return;

    try {
      const status = await repoService.getRepoStatus(this.currentRepoPath);
      const hasStaged = status.entries.some(entry => entry.staged);
      this.commitInput.setHasStagedFiles(hasStaged);
    } catch (err) {
      console.error('获取仓库状态失败:', err);
      this.commitInput.setHasStagedFiles(false);
    }
  }

  /**
   * 清空所有组件数据（Task 9：切换仓库时清空旧数据）
   *
   * 当切换到非 Git 仓库或关闭仓库时，清空节点图、分支列表、文件列表等组件，
   * 避免显示上一个仓库的过期数据。
   *
   * 此方法会：
   *   1. 清空中央面板（节点图）的 DOM 内容
   *   2. 清空左侧面板（文件变更列表）的 DOM 内容
   *   3. 清空右侧面板（提交详情）的 DOM 内容
   *   4. 隐藏提交输入区域
   *   5. 重置所有组件实例引用为 null（下次打开仓库时会重新创建）
   *   6. 清空当前仓库路径
   *   7. 重置状态栏显示
   */
  private clearAllComponents(): void {
    /* 清空中央面板（节点图区域）的 DOM 内容 */
    const centerBody = document.getElementById('center-body');
    if (centerBody) {
      centerBody.innerHTML = '';
    }

    /* 重置所有组件实例引用为 null，避免旧实例持有过期数据和事件监听器 */
    this.commitGraph = null;
    this.branchList = null;
    this.fileList = null;
    this.commitInput = null;
    this.diffViewer = null;
    this.commitDetail = null;
    this.fileHistory = null;
    this.stashManager = null;
    this.findWidget = null;

    /* 清空左侧面板（文件变更列表）- 显示"没有打开的仓库"提示 */
    const sidebarBody = document.getElementById('sidebar-body');
    if (sidebarBody) {
      sidebarBody.innerHTML = `<p style="color: var(--text-muted); padding: 16px; text-align: center;">${t('sidebar.noRepoOpen')}</p>`;
    }

    /* 清空右侧面板（提交详情）- 显示"请选择一个提交"提示 */
    const detailBody = document.getElementById('detail-body');
    if (detailBody) {
      detailBody.innerHTML = `<p style="color: var(--text-muted); padding: 16px; text-align: center;">${t('detail.selectCommit')}</p>`;
    }

    /* 隐藏提交输入区域（没有仓库时不需要提交功能） */
    const commitInputArea = document.getElementById('commit-input-area');
    if (commitInputArea) {
      commitInputArea.style.display = 'none';
    }

    /* 清空当前仓库路径（防止后续操作使用过期路径） */
    this.currentRepoPath = null;

    /* 重置状态栏显示 */
    const repoPathEl = document.getElementById('statusbar-repo-path');
    if (repoPathEl) {
      repoPathEl.textContent = '';
    }
    const branchEl = document.getElementById('statusbar-branch');
    if (branchEl) {
      branchEl.style.display = 'none';
    }
    const aheadBehindEl = document.getElementById('statusbar-ahead-behind');
    if (aheadBehindEl) {
      aheadBehindEl.style.display = 'none';
    }
    const commitCountEl = document.getElementById('statusbar-commit-count');
    if (commitCountEl) {
      commitCountEl.style.display = 'none';
    }

    /* 隐藏对比面板（如果之前打开了） */
    this.hideDiffPanel();
  }

  /**
   * 显示"非 Git 仓库"提示页面（Task 6.4 + Task 6.5 + Task 9）
   *
   * 当用户打开的目录不是 Git 仓库时，在中央面板显示提示信息和"初始化仓库"按钮。
   * 同时清空旧的节点图、分支列表、文件列表等数据，避免显示过期内容。
   *
   * 点击"初始化仓库"按钮会调用 repoService.initRepo(dir) 在该目录执行 git init，
   * 初始化成功后自动打开仓库。
   *
   * @param dir - 用户选择的目录路径（该目录不是 Git 仓库）
   */
  private showNotGitRepoPrompt(dir: string): void {
    /* Task 9：先清空所有组件数据，避免显示上一个仓库的过期内容 */
    this.clearAllComponents();

    /* 在中央面板显示"非 Git 仓库"提示 + 初始化按钮 */
    const centerBody = document.getElementById('center-body');
    if (centerBody) {
      centerBody.innerHTML = `
        <div style="text-align: center;">
          <p style="color: var(--text-muted); margin-bottom: 16px;">${t('welcome.notGitRepo')}</p>
          <button class="btn btn-primary" id="btn-welcome-init">${t('welcome.initRepoBtn')}</button>
        </div>
      `;

      /* Task 6.5：绑定"初始化仓库"按钮事件 */
      /* 点击后调用 repoService.initRepo(dir) 在该目录执行 git init */
      document.getElementById('btn-welcome-init')?.addEventListener('click', async () => {
        try {
          /* 调用后端执行 git init，返回新仓库信息 */
          const info = await repoService.initRepo(dir);
          /* 初始化成功后，自动打开仓库（加载节点图、分支列表等） */
          this.onRepoOpened(info);
        } catch (err) {
          console.error('初始化仓库失败:', err);
          alert('初始化仓库失败：' + String(err));
        }
      });
    }
  }

  /**
   * 刷新所有组件
   *
   * 在提交、切换分支等操作后调用，重新加载所有数据。
   * 同时检查暂存文件状态并更新提交按钮。
   *
   * Task 9：如果当前仓库路径无效（如切换到非 Git 仓库后），且组件实例仍存在，
   * 会先清空所有组件数据，避免显示过期内容。
   */
  private async refreshAllComponents(): Promise<void> {
    /* Task 9：如果当前没有有效的仓库路径，清空所有组件数据并返回 */
    if (!this.currentRepoPath) {
      /* 如果组件实例存在，说明是从有效仓库切换到无效状态，需要清空 */
      if (this.commitGraph || this.fileList || this.branchList) {
        this.clearAllComponents();
      }
      return;
    }

    try {
      // 刷新文件列表
      if (this.fileList) {
        await this.fileList.refresh();
      }

      // 刷新节点图
      if (this.commitGraph) {
        await this.commitGraph.refresh();

        // 节点图刷新后，刷新右键菜单和对话框的目标元素绑定
        // 因为节点图重新渲染后，之前的 DOM 元素引用已失效，
        // 需要通过 commits 数组重新查找对应的 DOM 元素
        const commits = this.commitGraph.getCommits();
        contextMenu.refresh(commits);
        dialogSingleton.refresh(commits);

        // 刷新 Find Widget 的匹配项（Task 5.1）
        // 节点图重新渲染后，之前的 DOM 高亮已失效，需要重新搜索并高亮
        if (this.findWidget) {
          this.findWidget.refresh();
        }

        /* Task 11.4：更新状态栏的提交总数显示 */
        this.updateStatusbarCommitInfo();
      }

      // 刷新分支列表
      if (this.branchList) {
        await this.branchList.refresh();
        /* Task 11.4：更新状态栏的分支和 ahead/behind 显示 */
        this.updateStatusbarBranch();
      }

      // 刷新提交输入组件状态
      if (this.commitInput) {
        this.commitInput.enable();

        // 检查是否有暂存文件，更新提交按钮状态
        try {
          const status = await repoService.getRepoStatus(this.currentRepoPath);
          const hasStaged = status.entries.some(entry => entry.staged);
          this.commitInput.setHasStagedFiles(hasStaged);
        } catch (err) {
          console.error('获取仓库状态失败:', err);
          this.commitInput.setHasStagedFiles(false);
        }
      }
    } catch (err) {
      console.error('刷新组件失败:', err);
    }
  }

  /**
   * 首次启动环境检测向导（Task 2）
   *
   * 在应用首次启动时检测 Git、Python、git-filter-repo 三项依赖是否已安装。
   * 如果有缺失项，自动打开终端面板并通过 PTY 发送安装命令。
   * 安装命令发送完毕后提示用户重启应用。
   *
   * 此方法只在首次启动时运行一次，完成后在 localStorage 设置
   * `firstLaunchCheckCompleted = 'true'`，后续启动不再执行。
   *
   * 检测项与安装命令：
   *   1. Git - 通过 invoke('check_git_installed') 检测
   *      缺失时安装命令：winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
   *   2. Python - 通过 invoke('check_python_installed') 检测
   *      缺失时安装命令：winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
   *   3. git-filter-repo - 通过 invoke('check_filter_repo_available') 检测
   *      缺失时安装命令：pip install git-filter-repo
   *
   * 安装命令通过终端 PTY 发送（复用 TerminalPanel 的 writeToPty 机制），
   * 用户可以在终端中实时查看安装进度。
   */
  private async runFirstLaunchCheck(): Promise<void> {
    /* 读取 localStorage，如果之前已完成过检测则直接返回，不重复执行 */
    if (localStorage.getItem('firstLaunchCheckCompleted') === 'true') {
      return;
    }

    /* 动态导入 Tauri 的 invoke 函数（用于调用后端命令） */
    const { invoke } = await import('@tauri-apps/api/core');

    /* 收集缺失的依赖项及其安装命令 */
    const missingItems: { name: string; installCommand: string }[] = [];

    /* 1. 检测 Git 是否已安装 */
    /* 后端返回 GitCheckResult: { installed: bool, version: String, path: String } */
    try {
      const gitResult = await invoke<{ installed: boolean; version: string; path: string }>('check_git_installed');
      if (!gitResult.installed) {
        missingItems.push({
          name: 'Git',
          installCommand: 'winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements',
        });
      }
    } catch (err) {
      /* 检测失败时记录警告，不中断流程（可能后端命令暂未实现） */
      console.warn('[首次启动检测] 检测 Git 失败:', err);
    }

    /* 2. 检测 Python 是否已安装 */
    /* 后端返回 PythonCheckResult: { installed: bool, version: Option<String> } */
    try {
      const pythonResult = await invoke<{ installed: boolean; version: string | null }>('check_python_installed');
      if (!pythonResult.installed) {
        missingItems.push({
          name: 'Python',
          installCommand: 'winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements',
        });
      }
    } catch (err) {
      console.warn('[首次启动检测] 检测 Python 失败:', err);
    }

    /* 3. 检测 git-filter-repo 是否可用 */
    /* 后端返回 FilterRepoStatus: { available: bool, version: string | null } */
    try {
      const filterRepoResult = await invoke<{ available: boolean; version: string | null }>('check_filter_repo_available');
      if (!filterRepoResult.available) {
        missingItems.push({
          name: 'git-filter-repo',
          installCommand: 'pip install git-filter-repo',
        });
      }
    } catch (err) {
      console.warn('[首次启动检测] 检测 git-filter-repo 失败:', err);
    }

    /* 如果有缺失项，自动打开终端面板并通过 PTY 发送安装命令 */
    if (missingItems.length > 0) {
      console.log('[首次启动检测] 检测到缺失依赖:', missingItems.map(item => item.name).join(', '));

      /* 打开终端面板（复用现有的 toggleTerminal 机制） */
      /* toggleTerminal 内部会创建 TerminalPanel 实例并异步初始化 PTY */
      this.toggleTerminal();

      /* 等待终端 PTY 初始化完成 */
      /* toggleTerminal 是同步方法，但内部 init() 是异步的，需要等待一段时间让 PTY 启动 */
      await new Promise(resolve => setTimeout(resolve, 1500));

      /* 通过终端 PTY 依次发送安装命令 */
      if (this.terminalInstance) {
        for (const item of missingItems) {
          /* 发送安装命令并按回车执行（\n 表示回车键） */
          /* shell 会排队执行命令：前一条执行完后才会执行下一条 */
          await this.terminalInstance.writeToPty(item.installCommand + '\n');
          /* 命令之间等待 500ms，避免命令输入过快导致 shell 处理混乱 */
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      /* 提示用户安装完成后重启应用 */
      /* 使用 alert 同步提示，确保用户看到消息 */
      alert('检测到缺失依赖（' + missingItems.map(item => item.name).join('、') + '），\n已自动在终端中发送安装命令。\n\n请在终端中等待安装完成后，重启 GitTimePrism 使环境生效。');
    } else {
      console.log('[首次启动检测] 所有依赖已安装，无需安装');
    }

    /* 标记首次启动检测已完成，后续启动不再执行 */
    localStorage.setItem('firstLaunchCheckCompleted', 'true');
  }
}
