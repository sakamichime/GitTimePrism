/**
 * GitTimePrism 应用主框架组件
 * 负责创建整体的三栏布局结构并协调各子组件
 */

import { invoke } from '@tauri-apps/api/core';
import { t } from '../services/i18n.js';
import { GitInstaller } from './git-installer.js';
import { TerminalPanel } from './terminal.js';
import { repoService } from '../services/repo-service.js';

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

  /** 初始化应用 */
  init(): void {
    this.render();
    this.initResizeHandles();
    this.initKeyboardShortcuts();
    this.initThemeToggle();
    this.checkGitInstallation();
  }

  /** 渲染整体布局的 DOM 结构 */
  render(): void {
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = `
      <header class="toolbar" id="toolbar">
        <div class="toolbar-section" id="toolbar-left">
          <button class="btn" id="btn-open-repo">${t('toolbar.openRepo')}</button>
          <button class="btn" id="btn-clone-repo">${t('toolbar.cloneRepo')}</button>
          <button class="btn" id="btn-init-repo">${t('toolbar.initRepo')}</button>
        </div>
        <div class="toolbar-spacer"></div>
        <div class="toolbar-section" id="toolbar-right">
          <button class="btn" id="btn-toggle-terminal" title="Ctrl+\`">${t('toolbar.toggleTerminal')}</button>
        </div>
      </header>
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
        <!-- 切换终端按钮（从顶部 toolbar 迁移至此） -->
        <div class="statusbar-item" id="statusbar-terminal">
          <button class="btn" id="btn-toggle-terminal" title="Ctrl+\`" style="padding: 2px 8px; font-size: var(--font-size-xs);">${t('toolbar.toggleTerminal')}</button>
        </div>
        <div class="statusbar-item" id="statusbar-theme">
          <button class="btn" id="btn-toggle-theme" title="${t('theme.toggle')}" style="padding: 2px 8px; font-size: var(--font-size-xs);">${t('theme.toggle')}</button>
        </div>
      </footer>
    `;
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
    
    // 找到要调整的目标面板
    const targetId = handle.dataset.target || '';
    if (targetId === 'terminal') {
      this.resizeTarget = document.getElementById('terminal-panel');
    } else {
      this.resizeTarget = document.getElementById(targetId);
    }

    if (!this.resizeTarget) return;

    // 记录起始位置
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

    // 计算新尺寸（拖拽水平分割条时，向左拖表示减小宽度）
    let newSize: number;
    if (this.resizeDirection === 'horizontal') {
      newSize = this.resizeInitialSize - diff;
    } else {
      newSize = this.resizeInitialSize + diff;
    }

    // 获取 min/max 限制
    const computedStyle = getComputedStyle(this.resizeTarget);
    const minSize = parseInt(computedStyle.getPropertyValue('min-width') || computedStyle.getPropertyValue('min-height') || '0');
    const maxSize = parseInt(computedStyle.getPropertyValue('max-width') || computedStyle.getPropertyValue('max-height') || '9999');

    // 应用限制
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
    // 打开仓库按钮：弹出文件选择对话框，选择一个目录后加载该 Git 仓库
    document.getElementById('btn-open-repo')?.addEventListener('click', async () => {
      try {
        const dir = await repoService.selectDirectory();
        if (!dir) return; // 用户取消了选择
        const info = await repoService.openRepo(dir);
        this.onRepoOpened(info);
      } catch (err) {
        console.error('打开仓库失败:', err);
      }
    });

    // 克隆仓库按钮：弹出提示让用户输入 URL，然后选择保存目录
    document.getElementById('btn-clone-repo')?.addEventListener('click', async () => {
      try {
        // 使用简单的 prompt 获取仓库 URL
        const url = prompt(t('repo.cloneUrlPrompt'));
        if (!url) return; // 用户取消了输入
        const dir = await repoService.selectDirectory();
        if (!dir) return; // 用户取消了选择
        await repoService.cloneRepo(url, dir);
        // 克隆完成后自动打开该仓库
        const info = await repoService.openRepo(dir);
        this.onRepoOpened(info);
      } catch (err) {
        console.error('克隆仓库失败:', err);
      }
    });

    // 初始化仓库按钮：选择一个目录，在该目录下执行 git init
    document.getElementById('btn-init-repo')?.addEventListener('click', async () => {
      try {
        const dir = await repoService.selectDirectory();
        if (!dir) return; // 用户取消了选择
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
      // 展开终端面板
      panel.classList.remove('hidden');
      panel.classList.remove('collapsed');
      // 首次展开时初始化终端
      if (!this.terminalInstance) {
        const terminalBody = document.getElementById('terminal-body');
        if (terminalBody) {
          this.terminalInstance = new TerminalPanel(terminalBody);
          this.terminalInstance.init();
        }
      }
    } else {
      // 折叠终端面板
      panel.classList.add('hidden');
    }
  }

  /** 初始化主题切换 */
  private initThemeToggle(): void {
    // 从 localStorage 读取保存的主题偏好
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      this.currentTheme = 'light';
      document.documentElement.setAttribute('data-theme', 'light');
    }

    // 绑定切换按钮
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
   * 当用户打开/克隆/初始化仓库后，更新各个面板显示仓库信息
   * 
   * @param info - 从后端获取的仓库基本信息
   */
  private async onRepoOpened(info: import('../services/repo-service.js').RepoInfo): Promise<void> {
    // 更新状态栏显示当前仓库路径
    const repoPathEl = document.getElementById('statusbar-repo-path');
    if (repoPathEl) {
      repoPathEl.textContent = info.path;
    }

    // 更新 sidebar 显示分支列表
    try {
      const branches = await repoService.getBranches(info.path);
      const sidebarBody = document.getElementById('sidebar-body');
      if (sidebarBody) {
        if (branches.local.length === 0) {
          sidebarBody.innerHTML = `<p style="color: var(--text-muted); padding: 16px; text-align: center;">${t('sidebar.noRepoOpen')}</p>`;
        } else {
          // 显示分支列表
          sidebarBody.innerHTML = branches.local.map((b) => {
            const current = b.is_current ? 'style="color: var(--accent-color); font-weight: 600;"' : '';
            const icon = b.is_current ? '&#9654;' : '&#9655;'; // 实心三角/空心三角
            const aheadBehind = (b.ahead > 0 || b.behind > 0) ? ` <span style="color: var(--text-muted); font-size: var(--font-size-xs);">↑${b.ahead} ↓${b.behind}</span>` : '';
            return `<div ${current} style="padding: 6px 16px; cursor: pointer; border-bottom: 1px solid var(--divider);">${icon} ${b.name}${aheadBehind}</div>`;
          }).join('');
        }
      }
    } catch (err) {
      console.error('获取分支列表失败:', err);
    }

    // 更新 center-panel 显示文件状态
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

  /**
   * 根据文件状态返回对应的图标字符
   * 用于在文件列表中显示变更类型的直观标识
   */
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
