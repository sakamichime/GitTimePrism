/**
 * GitTimePrism 应用主框架组件
 *
 * 负责创建整体的三栏布局结构并协调各子组件。
 * 包含自定义标题栏（窗口拖拽、最小化/最大化/关闭）、
 * 壁纸功能（选择壁纸后动态变色）、暗色/亮色主题切换等。
 */

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { t } from '../services/i18n.js';
import { GitInstaller } from './git-installer.js';
import { TerminalPanel } from './terminal.js';
import { repoService } from '../services/repo-service.js';
import { wallpaperService } from '../services/wallpaper.js';
import { themeEngine } from '../services/theme-engine.js';

export class App {
  /** 工具栏 DOM 元素引用 */
  private toolbar: HTMLElement | null = null;
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

  /** 初始化应用 */
  init(): void {
    this.render();
    this.initTitlebar();
    this.initResizeHandles();
    this.initKeyboardShortcuts();
    this.initThemeToggle();
    this.initWallpaper(); // 壁纸初始化（内部异步处理）
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
          <button class="titlebar-btn titlebar-btn-close" id="btn-close" title="关闭">✕</button>
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
          <button class="btn" id="btn-wallpaper" title="设置壁纸">🖼</button>
          <button class="btn" id="btn-toggle-terminal" title="Ctrl+\`">${t('toolbar.toggleTerminal')}</button>
        </div>
      </header>
      <!-- 壁纸层 - 显示用户选择的壁纸图片，位于所有面板之下 -->
      <!-- 内含 <img> 元素用于显示壁纸（比 CSS background-image 更可靠） -->
      <div class="wallpaper-layer" id="wallpaper-layer">
        <img id="wallpaper-img" alt="" />
      </div>
      <div class="main-content">
        <aside class="sidebar" id="sidebar">
          <div class="panel-header"><span>${t('sidebar.repositories')}</span></div>
          <div class="panel-body" id="sidebar-body">
            <p style="color: var(--text-muted); padding: 16px; text-align: center;">${t('sidebar.noRepoOpen')}</p>
          </div>
        </aside>
        <div class="resize-handle resize-handle-vertical" data-target="sidebar" data-direction="horizontal"></div>
        <main class="center-panel" id="center-panel">
          <div class="panel-body" id="center-body" style="flex:1; display:flex; align-items:center; justify-content:center;">
            <div style="text-align: center; color: var(--text-muted);">
              <p style="font-size: var(--font-size-2xl); margin-bottom: 8px; font-weight: 600;">GitTimePrism</p>
              <p>${t('center.welcome')}</p>
            </div>
          </div>
        </main>
        <div class="resize-handle resize-handle-vertical" data-target="detail-panel" data-direction="horizontal"></div>
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
        <!-- 切换终端按钮 -->
        <div class="statusbar-item" id="statusbar-terminal">
          <button class="btn" id="btn-toggle-terminal" title="Ctrl+\`" style="padding: 2px 8px; font-size: var(--font-size-xs);">${t('toolbar.toggleTerminal')}</button>
        </div>
        <div class="statusbar-item" id="statusbar-theme">
          <button class="btn" id="btn-toggle-theme" title="${t('theme.toggle')}" style="padding: 2px 8px; font-size: var(--font-size-xs);">${t('theme.toggle')}</button>
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
    // 获取当前 Tauri 窗口实例
    const appWindow = getCurrentWindow();

    // 标题栏拖拽区域 - 按住拖拽可移动窗口
    const dragArea = document.getElementById('titlebar-drag');
    if (dragArea) {
      dragArea.addEventListener('mousedown', (e) => {
        // 只响应左键（button === 0）
        if (e.button === 0) {
          // 开始拖拽窗口
          appWindow.startDragging();
        }
      });

      // 双击标题栏切换最大化/还原
      dragArea.addEventListener('dblclick', () => {
        appWindow.toggleMaximize();
      });
    }

    // 最小化按钮
    document.getElementById('btn-minimize')?.addEventListener('click', () => {
      appWindow.minimize();
    });

    // 最大化/还原按钮
    document.getElementById('btn-maximize')?.addEventListener('click', () => {
      appWindow.toggleMaximize();
    });

    // 关闭按钮
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
    // 异步加载已保存的壁纸
    this.loadSavedWallpaper();

    // 绑定壁纸选择按钮 - 点击后打开文件选择对话框
    document.getElementById('btn-wallpaper')?.addEventListener('click', async () => {
      try {
        const result = await wallpaperService.selectWallpaper();
        if (result && result.dataUrl) {
          // 用户选择了新壁纸，应用它
          this.applyWallpaper(result.dataUrl, result.dominantColors);
          console.log('[壁纸] 壁纸已成功应用');
        } else if (result === null) {
          // selectWallpaper 返回 null 可能是用户取消，也可能是命令调用失败
          // 如果不是用户主动取消，说明 Rust 命令可能未注册（需要重新编译）
          console.warn('[壁纸] 壁纸未应用 - 可能用户取消了选择，或 Rust 命令未注册（请重新运行 npm run tauri dev）');
        }
      } catch (err) {
        console.error('设置壁纸失败:', err);
        // 弹出提示让用户知道出错了
        alert('设置壁纸失败：' + String(err) + '\n\n请确认已重新运行 npm run tauri dev 来编译新的 Rust 命令。');
      }
    });

    // 绑定壁纸清除功能 - 右键壁纸按钮可清除壁纸
    const btnWallpaper = document.getElementById('btn-wallpaper');
    if (btnWallpaper) {
      btnWallpaper.addEventListener('contextmenu', (e) => {
        e.preventDefault(); // 阻止默认右键菜单
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
      // 直接应用已保存的壁纸（base64 data URL + 颜色数据）
      this.applyWallpaper(saved.dataUrl, saved.dominantColors);
    }
  }

  /**
   * 应用壁纸到界面
   *
   * 使用 <img> 元素显示壁纸（比 CSS background-image 更可靠），
   * 并使用动态变色引擎根据壁纸主色调更新所有UI组件的颜色。
   *
   * 为什么用 <img> 而不是 CSS background-image？
   * - <img> 元素原生支持 data URL，不会出现 CSS url() 解析问题
   * - 没有内联 style 长度限制
   * - 加载成功/失败可以通过 onload/onerror 事件检测
   * - 壁纸层 div 保留 CSS 中的 var(--app-bg) 渐变背景作为底层
   *
   * @param dataUrl - 壁纸图片的 base64 data URL
   * @param colors - 从壁纸中提取的主色调列表
   */
  private applyWallpaper(dataUrl: string, colors: import('../services/wallpaper.js').DominantColor[]): void {
    // 使用 <img> 元素显示壁纸图片（最可靠的方式）
    const img = document.getElementById('wallpaper-img') as HTMLImageElement | null;
    if (img) {
      // 监听加载成功事件
      img.onload = () => {
        console.log('[壁纸] 图片加载成功，尺寸:', img.naturalWidth, 'x', img.naturalHeight);
      };
      // 监听加载失败事件
      img.onerror = (e) => {
        console.error('[壁纸] 图片加载失败:', e);
        alert('壁纸图片加载失败！可能是图片格式不支持或文件已损坏。');
      };
      // 设置图片源，触发加载
      img.src = dataUrl;
      // 显示图片元素
      img.style.display = 'block';
    }
    // 标记当前有壁纸
    this.hasWallpaper = true;
    // 有壁纸时：面板透明度改为 50%（让壁纸更明显透出）
    document.documentElement.style.setProperty('--glass-opacity-panel', '0.5');
    document.documentElement.style.setProperty('--glass-opacity-bar', '0.5');
    // 如果有颜色数据，应用动态变色
    if (colors.length > 0) {
      themeEngine.applyFromWallpaper(colors);
    }
  }

  /**
   * 移除壁纸，恢复默认渐变背景
   */
  private removeWallpaper(): void {
    // 隐藏并清除 <img> 元素
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

    // 鼠标移动和松开事件绑定到 document 上
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
      // Ctrl+` 切换终端面板
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        this.toggleTerminal();
      }
    });

    // 绑定终端按钮
    document.getElementById('btn-toggle-terminal')?.addEventListener('click', () => this.toggleTerminal());
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
   * @param info - 从后端获取的仓库基本信息
   */
  private async onRepoOpened(info: import('../services/repo-service.js').RepoInfo): Promise<void> {
    const repoPathEl = document.getElementById('statusbar-repo-path');
    if (repoPathEl) {
      repoPathEl.textContent = info.path;
    }

    try {
      const branches = await repoService.getBranches(info.path);
      const sidebarBody = document.getElementById('sidebar-body');
      if (sidebarBody) {
        if (branches.local.length === 0) {
          sidebarBody.innerHTML = `<p style="color: var(--text-muted); padding: 16px; text-align: center;">${t('sidebar.noRepoOpen')}</p>`;
        } else {
          sidebarBody.innerHTML = branches.local.map((b) => {
            const current = b.is_current ? 'style="color: var(--accent-color); font-weight: 600;"' : '';
            const icon = b.is_current ? '&#9654;' : '&#9655;';
            const aheadBehind = (b.ahead > 0 || b.behind > 0) ? ` <span style="color: var(--text-muted); font-size: var(--font-size-xs);">↑${b.ahead} ↓${b.behind}</span>` : '';
            return `<div ${current} style="padding: 6px 16px; cursor: pointer; border-bottom: 1px solid var(--divider);">${icon} ${b.name}${aheadBehind}</div>`;
          }).join('');
        }
      }
    } catch (err) {
      console.error('获取分支列表失败:', err);
    }

    try {
      const status = await repoService.getRepoStatus(info.path);
      const centerBody = document.getElementById('center-body');
      if (centerBody) {
        if (status.entries.length === 0) {
          centerBody.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 40px;">
              <p style="font-size: var(--font-size-lg); margin-bottom: 8px;">✓ ${t('repo.cleanWorkingTree')}</p>
              <p>${t('center.welcome')}</p>
            </div>`;
        } else {
          centerBody.innerHTML = `
            <div style="padding: 8px 16px; border-bottom: 1px solid var(--divider); color: var(--text-muted);">
              ${t('repo.changesCount', { count: status.entries.length })}
            </div>
            ${status.entries.map((e) => {
              const icon = this.getStatusIcon(e.status);
              const staged = e.staged ? `<span style="color: var(--green); font-size: var(--font-size-xs);">S</span>` : `<span style="color: var(--text-muted); font-size: var(--font-size-xs);">W</span>`;
              return `<div style="padding: 4px 16px; border-bottom: 1px solid var(--divider); display: flex; align-items: center; gap: 8px; font-size: var(--font-size-sm);">${staged} ${icon} <span style="flex: 1; overflow: hidden; text-overflow: ellipsis;">${e.path}</span></div>`;
            }).join('')}`;
        }
      }
    } catch (err) {
      console.error('获取仓库状态失败:', err);
    }
  }

  /** 根据文件状态返回对应的图标字符 */
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'Modified': return '✎';
      case 'Added': return '+';
      case 'Deleted': return '✕';
      case 'Untracked': return '?';
      case 'Renamed': return '→';
      case 'Copied': return '⧉';
      case 'Unmerged': return '⚠';
      default: return '?';
    }
  }
}
