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
 */
export class FileList {
  /** 容器 DOM 元素的 ID */
  private containerId: string;
  /** 仓库路径 */
  private repoPath: string;
  /** 文件选择回调函数，参数为文件路径和是否已暂存 */
  private onFileSelect: (path: string, isStaged: boolean) => void;
  /** 当前仓库状态 */
  private status: StatusEntry[] = [];
  /** 容器 DOM 元素引用 */
  private container: HTMLElement | null = null;

  /**
   * 创建文件列表组件
   * 
   * @param containerId - 容器 DOM 元素的 ID
   * @param repoPath - 仓库路径
   * @param onFileSelect - 文件选择回调函数，参数为文件路径和是否已暂存
   */
  constructor(containerId: string, repoPath: string, onFileSelect: (path: string, isStaged: boolean) => void) {
    this.containerId = containerId;
    this.repoPath = repoPath;
    this.onFileSelect = onFileSelect;
    this.container = document.getElementById(containerId);
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
      }
    }
  }

  /**
   * 暂存单个文件
   * 
   * @param filePath - 要暂存的文件路径
   */
  private async handleStage(filePath: string): Promise<void> {
    try {
      await repoService.stageFile(this.repoPath, filePath);
      await this.refresh(); // 刷新列表
    } catch (err) {
      console.error('暂存文件失败:', err);
      alert(`暂存文件失败: ${err}`);
    }
  }

  /**
   * 取消暂存单个文件
   * 
   * @param filePath - 要取消暂存的文件路径
   */
  private async handleUnstage(filePath: string): Promise<void> {
    try {
      await repoService.unstageFile(this.repoPath, filePath);
      await this.refresh(); // 刷新列表
    } catch (err) {
      console.error('取消暂存失败:', err);
      alert(`取消暂存失败: ${err}`);
    }
  }

  /**
   * 暂存所有文件
   * 
   * 将所有未暂存的文件一次性添加到暂存区。
   */
  private async handleStageAll(): Promise<void> {
    try {
      await repoService.stageAll(this.repoPath);
      await this.refresh(); // 刷新列表
    } catch (err) {
      console.error('全部暂存失败:', err);
      alert(`全部暂存失败: ${err}`);
    }
  }
}
