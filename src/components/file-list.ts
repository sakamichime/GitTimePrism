/*
 * 文件变更列表组件
 * 
 * 显示仓库中所有变更的文件，分为"已暂存"和"未暂存"两组。
 * 每个文件显示状态图标、文件路径，以及暂存/取消暂存按钮。
 * 点击文件可以在详情面板中显示 diff。
 * 
 * 使用方式：
 * const fileList = new FileList('sidebar-body', repoPath, onFileSelect);
 * await fileList.refresh();
 */

import { repoService, type StatusEntry, type FileStatus } from '../services/repo-service.js';

/**
 * 文件状态图标映射
 * 根据文件状态返回对应的 Unicode 图标
 */
const STATUS_ICONS: Record<FileStatus, string> = {
  Modified: '✏️',   // 修改
  Added: '➕',      // 新增
  Deleted: '🗑️',    // 删除
  Untracked: '❓',  // 未跟踪
  Renamed: '️',    // 重命名
  Copied: '📋',     // 复制
  Unmerged: '⚠️',   // 冲突
};

/**
 * 文件状态中文名称映射
 */
const STATUS_NAMES: Record<FileStatus, string> = {
  Modified: '已修改',
  Added: '已添加',
  Deleted: '已删除',
  Untracked: '未跟踪',
  Renamed: '已重命名',
  Copied: '已复制',
  Unmerged: '冲突',
};

/**
 * 文件变更列表组件类
 * 
 * 管理文件列表的显示和交互，包括：
 * - 获取并显示仓库状态
 * - 暂存/取消暂存文件
 * - 点击文件触发回调（用于显示 diff）
 * - 右键菜单触发回调（用于查看文件历史）
 */
export class FileList {
  /** 容器 DOM 元素的 ID */
  private containerId: string;
  /** 仓库路径 */
  private repoPath: string;
  /** 文件选择回调函数，参数为文件路径和是否已暂存 */
  private onFileSelect: (path: string, isStaged: boolean) => void;
  /** 文件历史查看回调函数，参数为文件路径 */
  private onFileHistory: ((path: string) => void) | null;
  /** 暂存状态变化回调函数，用于通知父组件更新提交按钮状态 */
  private onStagingChange: (() => void) | null;
  /** 当前仓库状态 */
  private status: StatusEntry[] = [];
  /** 容器 DOM 元素引用 */
  private container: HTMLElement | null = null;
  /** 右键菜单 DOM 元素 */
  private contextMenu: HTMLElement | null = null;

  /**
   * 创建文件列表组件
   * 
   * @param containerId - 容器 DOM 元素的 ID
   * @param repoPath - 仓库路径
   * @param onFileSelect - 文件选择回调函数，参数为文件路径和是否已暂存
   * @param onFileHistory - 文件历史查看回调函数（可选），参数为文件路径
   */
  constructor(
    containerId: string, 
    repoPath: string, 
    onFileSelect: (path: string, isStaged: boolean) => void,
    onFileHistory?: (path: string) => void,
    onStagingChange?: () => void
  ) {
    this.containerId = containerId;
    this.repoPath = repoPath;
    this.onFileSelect = onFileSelect;
    this.onFileHistory = onFileHistory || null;
    this.onStagingChange = onStagingChange || null;
    this.container = document.getElementById(containerId);
    // 初始化右键菜单
    this.initContextMenu();
  }

  /**
   * 刷新文件列表
   * 
   * 从后端获取最新的仓库状态，并重新渲染文件列表。
   * 每次暂存/取消暂存操作后应调用此方法刷新显示。
   */
  async refresh(): Promise<void> {
    if (!this.container) return;

    try {
      // 获取仓库状态
      const repoStatus = await repoService.getRepoStatus(this.repoPath);
      this.status = repoStatus.entries;

      // 渲染文件列表
      this.render();
    } catch (err) {
      console.error('获取仓库状态失败:', err);
      this.container.innerHTML = `<p style="color: var(--error); padding: 16px;">获取仓库状态失败</p>`;
    }
  }

  /**
   * 渲染文件列表
   * 
   * 将文件分为"已暂存"和"未暂存"两组，
   * 每组显示文件列表和"全部暂存"按钮。
   */
  private render(): void {
    if (!this.container) return;

    // 分组文件
    const staged = this.status.filter(e => e.staged);
    const unstaged = this.status.filter(e => !e.staged);

    // 如果没有变更文件，显示空状态
    if (staged.length === 0 && unstaged.length === 0) {
      this.container.innerHTML = `
        <p style="color: var(--text-muted); padding: 16px; text-align: center;">
          没有变更的文件
        </p>
      `;
      return;
    }

    // 生成 HTML
    let html = '';

    // 已暂存文件组
    if (staged.length > 0) {
      html += this.renderFileGroup('已暂存', staged, true);
    }

    // 未暂存文件组
    if (unstaged.length > 0) {
      html += this.renderFileGroup('未暂存', unstaged, false);
    }

    this.container.innerHTML = html;

    // 绑定事件
    this.bindEvents();
  }

  /**
   * 渲染文件分组
   * 
   * @param title - 分组标题（"已暂存"或"未暂存"）
   * @param files - 该分组的文件列表
   * @param isStaged - 是否是已暂存分组
   * @returns 分组的 HTML 字符串
   */
  private renderFileGroup(title: string, files: StatusEntry[], isStaged: boolean): string {
    let html = `
      <div class="file-group">
        <div class="file-group-header">
          <span class="file-group-title">${title} (${files.length})</span>
          ${!isStaged ? `<button class="btn btn-small" data-action="stage-all">全部暂存</button>` : ''}
        </div>
        <div class="file-list">
    `;

    // 渲染每个文件
    for (const file of files) {
      const icon = STATUS_ICONS[file.status] || '📄';
      const statusName = STATUS_NAMES[file.status] || file.status;
      const actionText = isStaged ? '取消暂存' : '暂存';
      const actionIcon = isStaged ? '↩' : '➕';

      html += `
        <div class="file-item" data-path="${file.path}" data-staged="${isStaged}">
          <div class="file-info" data-action="view-diff">
            <span class="file-icon">${icon}</span>
            <span class="file-path" title="${file.path}">${file.path}</span>
            <span class="file-status">${statusName}</span>
          </div>
          <button class="btn btn-icon" data-action="${isStaged ? 'unstage' : 'stage'}" data-path="${file.path}" title="${actionText}">
            ${actionIcon}
          </button>
        </div>
      `;
    }

    html += `
        </div>
      </div>
    `;

    return html;
  }

  /**
   * 绑定事件监听器
   * 
   * 为文件列表中的按钮和文件项绑定点击事件。
   * 同时为文件项绑定右键菜单事件，用于查看文件历史。
   */
  private bindEvents(): void {
    if (!this.container) return;

    // 全部暂存按钮
    const stageAllBtn = this.container.querySelector('[data-action="stage-all"]');
    if (stageAllBtn) {
      stageAllBtn.addEventListener('click', () => this.handleStageAll());
    }

    // 文件项中的按钮和文件信息
    const fileItems = this.container.querySelectorAll('.file-item');
    for (const item of fileItems) {
      const path = item.getAttribute('data-path') || '';
      const isStaged = item.getAttribute('data-staged') === 'true';

      // 暂存/取消暂存按钮
      const actionBtn = item.querySelector('[data-action="stage"], [data-action="unstage"]');
      if (actionBtn) {
        actionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isStaged) {
            this.handleUnstage(path);
          } else {
            this.handleStage(path);
          }
        });
      }

      // 点击文件查看 diff - 传递文件路径和暂存状态，让 app.ts 决定调用哪种 diff 方法
      const fileInfo = item.querySelector('[data-action="view-diff"]');
      if (fileInfo) {
        fileInfo.addEventListener('click', () => {
          this.onFileSelect(path, isStaged);
        });

        // 右键菜单事件 - 显示"查看文件历史"选项
        // 将 Element 转换为 HTMLElement，以便使用 contextmenu 事件和 MouseEvent 类型
        (fileInfo as HTMLElement).addEventListener('contextmenu', ((e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          this.showContextMenu(e.clientX, e.clientY, path);
        }) as EventListener);
      }
    }
  }

  /**
   * 初始化右键菜单 DOM 元素
   * 
   * 创建一个隐藏的右键菜单元素，添加到 document.body 中。
   * 菜单包含"查看文件历史"选项。
   */
  private initContextMenu(): void {
    // 如果已经创建过菜单，先移除旧的
    if (this.contextMenu) {
      this.contextMenu.remove();
    }

    // 创建菜单容器
    this.contextMenu = document.createElement('div');
    this.contextMenu.className = 'file-context-menu';
    this.contextMenu.style.display = 'none';
    this.contextMenu.innerHTML = `
      <div class="file-context-menu-item" data-action="view-history">
        <span class="file-context-menu-icon">📜</span>
        <span class="file-context-menu-text">查看文件历史</span>
      </div>
    `;
    document.body.appendChild(this.contextMenu);

    // 为菜单项绑定点击事件
    const historyItem = this.contextMenu.querySelector('[data-action="view-history"]');
    if (historyItem) {
      historyItem.addEventListener('click', () => {
        const filePath = this.contextMenu?.getAttribute('data-file-path') || '';
        this.hideContextMenu();
        if (this.onFileHistory && filePath) {
          this.onFileHistory(filePath);
        }
      });
    }

    // 点击页面其他地方时隐藏菜单
    document.addEventListener('click', () => {
      this.hideContextMenu();
    });

    // 按 ESC 键时隐藏菜单
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideContextMenu();
      }
    });
  }

  /**
   * 显示右键菜单
   * 
   * 在指定位置显示右键菜单，并设置当前操作的文件路径。
   * 
   * @param x - 菜单显示的 X 坐标（鼠标位置）
   * @param y - 菜单显示的 Y 坐标（鼠标位置）
   * @param filePath - 当前右键点击的文件路径
   */
  private showContextMenu(x: number, y: number, filePath: string): void {
    if (!this.contextMenu) return;

    // 保存当前操作的文件路径
    this.contextMenu.setAttribute('data-file-path', filePath);

    // 设置菜单位置
    this.contextMenu.style.left = `${x}px`;
    this.contextMenu.style.top = `${y}px`;
    this.contextMenu.style.display = 'block';

    // 检查菜单是否超出视口，如果超出则调整位置
    const rect = this.contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      this.contextMenu.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      this.contextMenu.style.top = `${y - rect.height}px`;
    }
  }

  /**
   * 隐藏右键菜单
   */
  private hideContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.style.display = 'none';
    }
  }

  /**
   * 暂存单个文件
   * 
   * @param filePath - 要暂存的文件路径
   */
  private async handleStage(filePath: string): Promise<void> {
    console.log('[FileList] 暂存文件:', filePath);
    try {
      await repoService.stageFile(this.repoPath, filePath);
      await this.refresh(); // 刷新列表
      console.log('[FileList] 暂存成功，调用 onStagingChange 回调');
      // 通知父组件暂存状态变化，更新提交按钮状态
      if (this.onStagingChange) this.onStagingChange();
    } catch (err) {
      console.error('[FileList] 暂存文件失败:', err);
      alert(`暂存文件失败: ${err}`);
    }
  }

  /**
   * 取消暂存单个文件
   * 
   * @param filePath - 要取消暂存的文件路径
   */
  private async handleUnstage(filePath: string): Promise<void> {
    console.log('[FileList] 取消暂存文件:', filePath);
    try {
      await repoService.unstageFile(this.repoPath, filePath);
      await this.refresh(); // 刷新列表
      console.log('[FileList] 取消暂存成功，调用 onStagingChange 回调');
      // 通知父组件暂存状态变化，更新提交按钮状态
      if (this.onStagingChange) this.onStagingChange();
    } catch (err) {
      console.error('[FileList] 取消暂存失败:', err);
      alert(`取消暂存失败: ${err}`);
    }
  }

  /**
   * 暂存所有文件
   * 
   * 将所有未暂存的文件一次性添加到暂存区。
   */
  private async handleStageAll(): Promise<void> {
    console.log('[FileList] 全部暂存');
    try {
      await repoService.stageAll(this.repoPath);
      await this.refresh(); // 刷新列表
      console.log('[FileList] 全部暂存成功，调用 onStagingChange 回调');
      // 通知父组件暂存状态变化，更新提交按钮状态
      if (this.onStagingChange) this.onStagingChange();
    } catch (err) {
      console.error('[FileList] 全部暂存失败:', err);
      alert(`全部暂存失败: ${err}`);
    }
  }
}
