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
import { repoService, type RepoInfo, type GraphCommit } from '../services/repo-service.js';
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
import { FileHistory } from './file-history.js';

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

  /** 初始化应用 */
  init(): void {
    this.render();
    this.initTitlebar();
    this.initResizeHandles();
    this.initKeyboardShortcuts();
    this.initThemeToggle();
    this.initWallpaper();
    this.checkGitInstallation();
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
          <button class="titlebar-btn titlebar-btn-close" id="btn-close" title="关闭"></button>
        </div>
      </div>
      <header class="toolbar" id="toolbar">
        <div class="toolbar-section" id="toolbar-left">
          <button class="btn" id="btn-open-repo">${t('toolbar.openRepo')}</button>
          <button class="btn" id="btn-clone-repo">${t('toolbar.cloneRepo')}</button>
          <button class="btn" id="btn-init-repo">${t('toolbar.initRepo')}</button>
        </div>
        <div class="toolbar-spacer"></div>
        <div class="toolbar-section" id="toolbar-right">
          <button class="btn" id="btn-tag-manager" title="标签管理">🏷 标签</button>
          <button class="btn" id="btn-reset-commit" title="撤销提交">↩ 撤销</button>
          <button class="btn" id="btn-pull" title="从远程仓库拉取更新">↓ 拉取</button>
          <button class="btn" id="btn-push" title="推送本地提交到远程仓库">↑ 推送</button>
          <button class="btn" id="btn-wallpaper" title="设置壁纸">🖼</button>
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
        <div class="resize-handle resize-handle-vertical" data-target="sidebar" data-direction="horizontal"></div>
        <!-- 中间面板：提交节点图 + 提交历史 -->
        <main class="center-panel" id="center-panel">
          <div class="panel-header"><span>提交历史</span></div>
          <div class="panel-body" id="center-body" style="flex:1; display:flex; align-items:center; justify-content:center;">
            <div style="text-align: center; color: var(--text-primary);">
              <p style="font-size: var(--font-size-2xl); margin-bottom: 8px; font-weight: 600;">GitTimePrism</p>
              <p>${t('center.welcome')}</p>
            </div>
          </div>
        </main>
        <div class="resize-handle resize-handle-vertical" data-target="detail-panel" data-direction="horizontal"></div>
        <!-- 右侧面板：文件 diff 对比视图 / 提交详情 -->
        <aside class="detail-panel" id="detail-panel">
          <div class="panel-header"><span>${t('detail.title')}</span></div>
          <div class="panel-body" id="detail-body">
            <p style="color: var(--text-muted); padding: 16px; text-align: center;">${t('detail.selectCommit')}</p>
          </div>
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
        <div class="statusbar-item" id="statusbar-git-version">Git: ${t('statusbar.checking')}</div>
        <div class="statusbar-item" id="statusbar-repo-path"></div>
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
   * 3. 绑定壁纸选择按钮
   */
  private initWallpaper(): void {
    this.loadSavedWallpaper();

    document.getElementById('btn-wallpaper')?.addEventListener('click', async () => {
      try {
        const result = await wallpaperService.selectWallpaper();
        if (result && result.dataUrl) {
          this.applyWallpaper(result.dataUrl, result.dominantColors);
          console.log('[壁纸] 壁纸已成功应用');
        }
      } catch (err) {
        console.error('设置壁纸失败:', err);
        alert('设置壁纸失败：' + String(err));
      }
    });

    const btnWallpaper = document.getElementById('btn-wallpaper');
    if (btnWallpaper) {
      btnWallpaper.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.hasWallpaper) {
          wallpaperService.clearWallpaper();
          this.removeWallpaper();
        }
      });
    }
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

  /** 初始化面板拖拽调整大小功能 */
  private initResizeHandles(): void {
    const handles = document.querySelectorAll<HTMLElement>('.resize-handle');
    handles.forEach((handle) => {
      handle.addEventListener('mousedown', (e) => this.startResize(e, handle));
    });

    document.addEventListener('mousemove', (e) => this.onResize(e));
    document.addEventListener('mouseup', () => this.stopResize());
  }

  /** 拖拽状态 */
  private resizing: boolean = false;
  private resizeHandle: HTMLElement | null = null;
  private resizeTarget: HTMLElement | null = null;
  private resizeDirection: string = '';
  private resizeStartX: number = 0;
  private resizeStartY: number = 0;
  private resizeInitialSize: number = 0;

  /** 开始拖拽 */
  private startResize(e: MouseEvent, handle: HTMLElement): void {
    e.preventDefault();
    this.resizing = true;
    this.resizeHandle = handle;
    this.resizeDirection = handle.dataset.direction || 'horizontal';
    
    const targetId = handle.dataset.target || '';
    if (targetId === 'terminal') {
      this.resizeTarget = document.getElementById('terminal-panel');
    } else {
      this.resizeTarget = document.getElementById(targetId);
    }

    if (!this.resizeTarget) return;

    this.resizeStartX = e.clientX;
    this.resizeStartY = e.clientY;
    this.resizeInitialSize = this.resizeDirection === 'horizontal'
      ? this.resizeTarget.offsetWidth
      : this.resizeTarget.offsetHeight;

    handle.classList.add('active');
  }

  /** 拖拽中 */
  private onResize(e: MouseEvent): void {
    if (!this.resizing || !this.resizeTarget) return;
    
    const diff = this.resizeDirection === 'horizontal'
      ? e.clientX - this.resizeStartX
      : e.clientY - this.resizeStartY;

    let newSize: number;
    if (this.resizeDirection === 'horizontal') {
      newSize = this.resizeInitialSize - diff;
    } else {
      newSize = this.resizeInitialSize + diff;
    }

    const computedStyle = getComputedStyle(this.resizeTarget);
    const minSize = parseInt(computedStyle.getPropertyValue('min-width') || computedStyle.getPropertyValue('min-height') || '0');
    const maxSize = parseInt(computedStyle.getPropertyValue('max-width') || computedStyle.getPropertyValue('max-height') || '9999');

    newSize = Math.max(minSize, Math.min(maxSize, newSize));

    if (this.resizeDirection === 'horizontal') {
      this.resizeTarget.style.width = `${newSize}px`;
    } else {
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

  /** 初始化全局快捷键 */
  private initKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        this.toggleTerminal();
      }
    });

    document.getElementById('btn-toggle-terminal')?.addEventListener('click', () => this.toggleTerminal());
    document.getElementById('btn-toggle-terminal-status')?.addEventListener('click', () => this.toggleTerminal());
    document.getElementById('btn-close-terminal')?.addEventListener('click', () => this.toggleTerminal());

    // ---- 绑定仓库操作按钮 ----
    document.getElementById('btn-open-repo')?.addEventListener('click', async () => {
      try {
        const dir = await repoService.selectDirectory();
        if (!dir) return;
        const info = await repoService.openRepo(dir);
        this.onRepoOpened(info);
      } catch (err) {
        console.error('打开仓库失败:', err);
      }
    });

    document.getElementById('btn-clone-repo')?.addEventListener('click', async () => {
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
      }
    });

    document.getElementById('btn-init-repo')?.addEventListener('click', async () => {
      try {
        const dir = await repoService.selectDirectory();
        if (!dir) return;
        const info = await repoService.initRepo(dir);
        this.onRepoOpened(info);
      } catch (err) {
        console.error('初始化仓库失败:', err);
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

      try {
        // 调用后端执行 git pull origin <branch>
        // remote 通常为 "origin"，branch 为当前分支名
        const result = await repoService.pull(this.currentRepoPath, 'origin', currentBranch);
        // 显示成功信息
        alert(`拉取成功！\n\n${result}`);
        // 拉取成功后刷新所有组件（更新提交历史、文件列表等）
        await this.refreshAllComponents();
      } catch (err) {
        // 显示错误信息
        console.error('拉取失败:', err);
        alert(`拉取失败：${err}`);
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

      try {
        // 调用后端执行 git push origin <branch>
        // remote 通常为 "origin"，branch 为当前分支名
        const result = await repoService.push(this.currentRepoPath, 'origin', currentBranch);
        // 显示成功信息
        alert(`推送成功！\n\n${result}`);
        // 推送成功后刷新所有组件（更新分支信息、提交历史等）
        await this.refreshAllComponents();
      } catch (err) {
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
  }

  /**
   * 仓库打开后的 UI 更新回调
   * 
   * 初始化所有 Git 可视化组件并加载数据。
   * 
   * @param info - 从后端获取的仓库基本信息
   */
  private async onRepoOpened(info: RepoInfo): Promise<void> {
    // 保存当前仓库路径
    this.currentRepoPath = info.path;

    // 更新状态栏
    const repoPathEl = document.getElementById('statusbar-repo-path');
    if (repoPathEl) {
      repoPathEl.textContent = info.path;
    }

    // 显示提交输入区域
    const commitInputArea = document.getElementById('commit-input-area');
    if (commitInputArea) {
      commitInputArea.style.display = 'block';
    }

    // 初始化 diff 视图组件（右侧面板）
    // 必须在 FileList 和 FileHistory 之前初始化，因为它们需要引用 diffViewer
    const detailBody = document.getElementById('detail-body');
    if (detailBody) {
      this.diffViewer = new DiffViewer('detail-body');
      this.commitDetail = new CommitDetail('detail-body');
    }

    // 初始化文件历史查看组件（右侧面板）
    // 复用 diffViewer 实例，点击历史中的提交时在该面板中显示 diff
    if (this.diffViewer) {
      this.fileHistory = new FileHistory('detail-body', this.diffViewer);
    }

    // 初始化文件列表组件（左侧面板）
    // 传入文件历史回调：右键菜单点击"查看文件历史"时触发
    const fileListBody = document.getElementById('sidebar-body');
    if (fileListBody) {
      this.fileList = new FileList('sidebar-body', info.path, (filePath, isStaged) => {
        // 点击文件时显示 diff，传递 isStaged 参数以区分暂存区/工作区 diff
        this.showFileDiff(filePath, isStaged);
      }, (filePath) => {
        // 右键菜单点击"查看文件历史"时，调用文件历史组件显示该文件的提交历史
        this.showFileHistory(filePath);
      });
      await this.fileList.refresh();
    }

    // 初始化提交输入组件（左侧面板底部）
    const commitInputBody = document.getElementById('commit-input-body');
    if (commitInputBody) {
      this.commitInput = new CommitInput('commit-input-body', info.path, () => {
        // 提交成功后刷新所有组件
        this.refreshAllComponents();
      });
      this.commitInput.enable();

      // 检查是否有暂存文件，更新提交按钮状态
      try {
        const status = await repoService.getRepoStatus(info.path);
        const hasStaged = status.entries.some(entry => entry.staged);
        this.commitInput.setHasStagedFiles(hasStaged);
      } catch (err) {
        console.error('获取仓库状态失败:', err);
        this.commitInput.setHasStagedFiles(false);
      }
    }

    // 初始化提交节点图组件（中间面板）
    const centerBody = document.getElementById('center-body');
    if (centerBody) {
      this.commitGraph = new CommitGraph('center-body', info.path, (commit) => {
        // 点击节点时显示提交详情
        this.showCommitDetail(commit);
      });
      await this.commitGraph.refresh();
    }

    // 初始化分支列表组件（工具栏）
    const toolbar = document.getElementById('toolbar');
    if (toolbar) {
      this.branchList = new BranchList('toolbar', info.path, () => {
        // 分支切换成功后刷新所有组件
        this.refreshAllComponents();
      });
      await this.branchList.refresh();
    }
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
   * @param commit - 提交节点数据
   */
  private async showCommitDetail(commit: GraphCommit): Promise<void> {
    if (!this.currentRepoPath || !this.commitDetail) return;

    try {
      await this.commitDetail.showCommit(this.currentRepoPath, commit.hash);
    } catch (err) {
      console.error('显示提交详情失败:', err);
    }
  }

  /**
   * 刷新所有组件
   *
   * 在提交、切换分支等操作后调用，重新加载所有数据。
   * 同时检查暂存文件状态并更新提交按钮。
   */
  private async refreshAllComponents(): Promise<void> {
    if (!this.currentRepoPath) return;

    try {
      // 刷新文件列表
      if (this.fileList) {
        await this.fileList.refresh();
      }

      // 刷新节点图
      if (this.commitGraph) {
        await this.commitGraph.refresh();
      }

      // 刷新分支列表
      if (this.branchList) {
        await this.branchList.refresh();
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
}
