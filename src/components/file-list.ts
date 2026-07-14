/*
 * 文件变更列表组件
 *
 * 显示仓库中所有变更的文件，分为"已暂存"和"未暂存"两组。
 * 每个文件显示状态图标、文件路径，以及暂存/取消暂存按钮。
 * 点击文件可以在详情面板中显示 diff。
 *
 * 此外还提供完整的文件右键菜单（Task 13.5），包含：
 * - 暂存 / 取消暂存（git add / git reset HEAD）
 * - 放弃修改（discard，git checkout HEAD -- <file>）
 * - 添加到 .gitignore（在 .gitignore 文件追加该路径）
 * - 删除文件（调用 Tauri fs API 删除工作区文件）
 * - 在编辑器中打开（调用后端 open_file 命令）
 * - 查看文件历史（触发文件历史视图）
 * - 查看 Blame（打开 blame-viewer 组件）
 *
 * 使用方式：
 * const fileList = new FileList('sidebar-body', repoPath, onFileSelect);
 * await fileList.refresh();
 */

import { invoke } from '@tauri-apps/api/core';
/* 导入 Tauri fs 插件的 remove 函数，用于删除工作区文件 */
import { remove } from '@tauri-apps/plugin-fs';
/* 导入 path 工具，用于拼接仓库路径和文件相对路径得到绝对路径 */
import { join } from '@tauri-apps/api/path';
import { repoService, type StatusEntry, type FileStatus } from '../services/repo-service.js';
/* 导入全局右键菜单组件（Task 13.5：复用 contextMenu.show() 方法显示文件右键菜单） */
import { contextMenu, type ContextMenuAction, type ContextMenuTarget } from './context-menu.js';
/* 导入文件图标服务，用于根据文件路径获取对应的 vscode-icons 风格 SVG 图标 URL */
import { fileIconService } from '../services/file-icon-service.js';

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

  /**
   * 获取容器 DOM 元素
   * 
   * 每次使用时重新查询 DOM，避免 app.render() 重新渲染后引用失效。
   * 
   * @returns 容器 DOM 元素，如果不存在则返回 null
   */
  private get container(): HTMLElement | null {
    return document.getElementById(this.containerId);
  }

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
      const statusName = STATUS_NAMES[file.status] || file.status;
      const actionText = isStaged ? '取消暂存' : '暂存';
      const actionIcon = isStaged ? '↩' : '➕';

      html += `
        <div class="file-item" data-path="${file.path}" data-staged="${isStaged}">
          <div class="file-info" data-action="view-diff">
            <img class="file-type-icon" src="${fileIconService.getFileIconUrl(file.path)}" alt="">
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

        // Task 13.5：右键菜单事件 - 显示完整的文件右键菜单
        // 将 Element 转换为 HTMLElement，以便使用 contextmenu 事件和 MouseEvent 类型
        // 菜单项含：暂存/取消暂存、放弃修改、添加到 .gitignore、删除文件、
        // 在编辑器中打开、查看文件历史、查看 Blame
        (fileInfo as HTMLElement).addEventListener('contextmenu', ((e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          this.showFileContextMenu(e, path, isStaged);
        }) as EventListener);
      }
    }
  }

  /**
   * Task 13.5：显示文件右键菜单
   *
   * 复用全局 contextMenu.show() 方法，在鼠标位置弹出文件右键菜单。
   * 菜单项根据文件的暂存状态动态调整：
   *   - 已暂存文件：显示"取消暂存"
   *   - 未暂存文件：显示"暂存"
   *   - 未跟踪文件：不显示"放弃修改"（因为没有 HEAD 版本可恢复）
   *
   * 菜单分 4 组（组间有分隔线）：
   *   - 组 1：暂存/取消暂存、放弃修改
   *   - 组 2：添加到 .gitignore、删除文件、在编辑器中打开
   *   - 组 3：查看文件历史、查看 Blame
   *   - 组 4：复制文件路径
   *
   * @param event - 触发右键的鼠标事件（用于获取点击位置）
   * @param filePath - 当前右键的文件路径（相对于仓库根目录）
   * @param isStaged - 文件是否已暂存
   */
  private showFileContextMenu(event: MouseEvent, filePath: string, isStaged: boolean): void {
    // 查找当前文件的状态项，用于判断文件类型（是否未跟踪等）
    const statusEntry: StatusEntry | undefined = this.status.find(s => s.path === filePath);
    // 是否是未跟踪文件（未跟踪文件没有 HEAD 版本，不能"放弃修改"）
    const isUntracked: boolean = statusEntry?.status === 'Untracked';
    // 是否是已删除文件（已删除文件不能"在编辑器中打开"或"查看 Blame"）
    const isDeleted: boolean = statusEntry?.status === 'Deleted';

    // 构造右键菜单目标（CommitDetailsView 类型适用于详情视图内的元素）
    // 这里使用容器元素作为 frameElem，让菜单在文件列表区域内定位
    const target: ContextMenuTarget = {
      type: 'CommitDetailsView',
      elem: this.container || document.body,
      hash: '',
      index: 0,
    };

    // 构建菜单项（二维数组，组间渲染分隔线）
    const actions: ReadonlyArray<ReadonlyArray<ContextMenuAction>> = [
      /* ===== 第 1 组：暂存操作和放弃修改 ===== */
      [
        {
          /* 暂存：仅未暂存文件显示此选项，调用 git add <file> */
          title: '➕ 暂存',
          visible: !isStaged,
          onClick: () => { this.handleStage(filePath); },
        },
        {
          /* 取消暂存：仅已暂存文件显示此选项，调用 git reset HEAD <file> */
          title: '↩ 取消暂存',
          visible: isStaged,
          onClick: () => { this.handleUnstage(filePath); },
        },
        {
          /* 放弃修改：恢复文件到 HEAD 版本（git checkout HEAD -- <file>）
           * 未跟踪文件没有 HEAD 版本，不显示此选项
           * 调用后端 reset_file_to_revision 命令，参数：仓库路径、目标版本（HEAD）、文件路径 */
          title: '↺ 放弃修改',
          visible: !isUntracked,
          onClick: () => { this.discardFileChanges(filePath); },
        },
      ],
      /* ===== 第 2 组：文件管理操作 ===== */
      [
        {
          /* 添加到 .gitignore：将该文件路径追加到仓库根目录的 .gitignore 文件中
           * 如果 .gitignore 不存在会自动创建 */
          title: '🚫 添加到 .gitignore',
          visible: true,
          onClick: () => { this.addToGitignore(filePath); },
        },
        {
          /* 删除文件：调用 Tauri fs API 从工作区中物理删除该文件
           * 已删除文件不显示此选项（已经不存在了）
           * 这是危险操作，会弹出确认对话框 */
          title: '🗑️ 删除文件',
          visible: !isDeleted,
          onClick: () => { this.deleteFile(filePath); },
        },
        {
          /* 在编辑器中打开：调用后端 open_file 命令在系统默认编辑器中打开此文件
           * 已删除文件不显示此选项 */
          title: '📝 在编辑器中打开',
          visible: !isDeleted,
          onClick: () => { this.openInEditor(filePath); },
        },
      ],
      /* ===== 第 3 组：查看操作 ===== */
      [
        {
          /* 查看文件历史：触发 onFileHistory 回调，显示该文件的提交历史视图 */
          title: '📜 查看文件历史',
          visible: true,
          onClick: () => {
            if (this.onFileHistory) {
              this.onFileHistory(filePath);
            }
          },
        },
        {
          /* 查看 Blame：打开 blame-viewer 组件，显示文件每行的提交溯源信息
           * 已删除文件不显示此选项（文件不存在无法 blame）
           * 未跟踪文件不显示此选项（未跟踪文件没有提交历史） */
          title: '🔍 查看 Blame',
          visible: !isDeleted && !isUntracked,
          onClick: () => { this.viewBlame(filePath); },
        },
      ],
      /* ===== 第 4 组：复制操作 ===== */
      [
        {
          /* 复制文件路径：将相对路径复制到剪贴板 */
          title: '📋 复制文件路径',
          visible: true,
          onClick: () => { this.copyFilePath(filePath); },
        },
      ],
    ];

    // 获取菜单渲染的容器元素（菜单相对于此元素定位）
    const frameElem: HTMLElement = this.container || document.body;
    // 调用全局 contextMenu.show() 显示菜单
    contextMenu.show(actions as ContextMenuAction[][], false, target, event, frameElem);
  }

  /**
   * Task 13.5：放弃文件的修改（discard changes）
   *
   * 调用后端 reset_file_to_revision 命令，执行 `git checkout HEAD -- <file>`，
   * 将工作区和暂存区中的指定文件恢复到 HEAD 版本。
   * 注意：此操作会丢失该文件的所有未提交变更，不可逆。
   *
   * 后端命令参数说明：
   *   - repoPath：仓库根目录路径
   *   - hash：目标版本（'HEAD' 表示当前提交）
   *   - file：要恢复的文件路径（相对于仓库根目录）
   *
   * @param filePath - 要放弃修改的文件路径
   */
  private async discardFileChanges(filePath: string): Promise<void> {
    console.log('[FileList] 放弃文件修改:', filePath);
    try {
      // 调用后端 reset_file_to_revision 命令，将文件恢复到 HEAD 版本
      // 注意：后端参数名为 file（不是 filePath）
      await invoke('reset_file_to_revision', {
        repoPath: this.repoPath,
        hash: 'HEAD',
        file: filePath,
      });
      // 刷新文件列表以显示最新状态
      await this.refresh();
      // 通知父组件暂存状态变化
      if (this.onStagingChange) this.onStagingChange();
      console.log('[FileList] 放弃修改成功');
    } catch (err) {
      console.error('[FileList] 放弃修改失败:', err);
      alert(`放弃修改失败: ${err}`);
    }
  }

  /**
   * Task 13.5：添加文件路径到 .gitignore
   *
   * 将指定文件路径追加到仓库根目录的 .gitignore 文件中。
   * 如果 .gitignore 文件不存在，会自动创建。
   * 如果文件路径已存在于 .gitignore 中，则不重复添加。
   *
   * 实现步骤：
   *   1. 读取当前 .gitignore 内容（如果文件不存在则视为空）
   *   2. 检查文件路径是否已存在，避免重复添加
   *   3. 追加新行（文件路径）到 .gitignore
   *   4. 调用后端 write_file_content 命令写回 .gitignore
   *
   * @param filePath - 要添加到 .gitignore 的文件路径
   */
  private async addToGitignore(filePath: string): Promise<void> {
    console.log('[FileList] 添加到 .gitignore:', filePath);
    try {
      // 步骤 1：读取当前 .gitignore 内容（文件不存在时视为空字符串）
      let currentContent: string = '';
      try {
        currentContent = await repoService.getWorktreeFileContent(this.repoPath, '.gitignore');
      } catch {
        // .gitignore 文件不存在，currentContent 保持为空字符串
        console.log('[FileList] .gitignore 文件不存在，将创建新文件');
      }

      // 步骤 2：检查文件路径是否已存在于 .gitignore 中（避免重复添加）
      const lines: string[] = currentContent.split(/\r?\n/);
      if (lines.includes(filePath)) {
        console.log('[FileList] 文件路径已存在于 .gitignore 中，不重复添加');
        alert(`"${filePath}" 已在 .gitignore 中`);
        return;
      }

      // 步骤 3：追加新行到 .gitignore
      // 如果当前内容不为空且不以换行结尾，先添加换行符
      const newLine: string = currentContent.length > 0 && !currentContent.endsWith('\n')
        ? `\n${filePath}\n`
        : `${filePath}\n`;
      const newContent: string = currentContent + newLine;

      // 步骤 4：调用后端 write_file_content 命令写回 .gitignore
      await repoService.writeFileContent(this.repoPath, '.gitignore', newContent);
      console.log('[FileList] 已添加到 .gitignore');

      // 刷新文件列表（添加到 .gitignore 后，未跟踪文件可能从列表消失）
      await this.refresh();
      if (this.onStagingChange) this.onStagingChange();
    } catch (err) {
      console.error('[FileList] 添加到 .gitignore 失败:', err);
      alert(`添加到 .gitignore 失败: ${err}`);
    }
  }

  /**
   * Task 13.5：删除工作区中的文件
   *
   * 调用 Tauri fs 插件的 remove 函数，从工作区中物理删除指定文件。
   * 这是危险操作，会弹出确认对话框让用户二次确认。
   *
   * 注意：此操作只删除工作区文件，不影响 Git 历史。
   * 删除后文件会显示为"已删除"状态（如果之前是跟踪文件）。
   *
   * @param filePath - 要删除的文件路径（相对于仓库根目录）
   */
  private async deleteFile(filePath: string): Promise<void> {
    console.log('[FileList] 删除文件:', filePath);
    // 弹出确认对话框（危险操作需二次确认）
    const confirmed: boolean = confirm(`确定要删除文件 "${filePath}" 吗？\n\n此操作不可逆，文件将从工作区中永久删除。`);
    if (!confirmed) return;

    try {
      // 拼接文件的绝对路径（仓库根路径 + 文件相对路径）
      const absolutePath: string = await join(this.repoPath, filePath);
      // 调用 Tauri fs 插件的 remove 函数删除文件
      await remove(absolutePath);
      console.log('[FileList] 文件删除成功:', filePath);
      // 刷新文件列表以显示最新状态
      await this.refresh();
      if (this.onStagingChange) this.onStagingChange();
    } catch (err) {
      console.error('[FileList] 删除文件失败:', err);
      alert(`删除文件失败: ${err}`);
    }
  }

  /**
   * Task 13.5：在系统默认编辑器中打开文件
   *
   * 调用后端 open_file 命令，在系统默认编辑器中打开指定文件。
   * 后端会调用操作系统的默认关联程序打开文件。
   *
   * @param filePath - 要打开的文件路径（相对于仓库根目录）
   */
  private async openInEditor(filePath: string): Promise<void> {
    console.log('[FileList] 在编辑器中打开:', filePath);
    try {
      // 拼接文件的绝对路径（后端 open_file 命令需要绝对路径）
      const absolutePath: string = await join(this.repoPath, filePath);
      // 调用后端 open_file 命令在系统默认编辑器中打开文件
      await invoke('open_file', { filePath: absolutePath });
      console.log('[FileList] 已在编辑器中打开:', filePath);
    } catch (err) {
      console.error('[FileList] 在编辑器中打开失败:', err);
      alert(`在编辑器中打开失败: ${err}`);
    }
  }

  /**
   * Task 13.5：查看文件的 Blame 信息
   *
   * 打开 Blame 视图组件，显示文件每行的提交溯源信息（commit hash/author/date）。
   * 使用全局单例 blameViewer（在 blame-viewer.ts 中导出）。
   *
   * @param filePath - 要查看 blame 的文件路径（相对于仓库根目录）
   */
  private async viewBlame(filePath: string): Promise<void> {
    console.log('[FileList] 查看 Blame:', filePath);
    try {
      // 动态导入 Blame 视图组件（延迟导入，避免循环依赖）
      const { blameViewer } = await import('./blame-viewer.js');
      // 打开 Blame 视图，加载文件每行的提交溯源信息
      await blameViewer.open(this.repoPath, filePath);
      console.log('[FileList] 已打开 Blame 视图:', filePath);
    } catch (err) {
      console.error('[FileList] 查看 Blame 失败:', err);
      alert(`查看 Blame 失败: ${err}`);
    }
  }

  /**
   * Task 13.5：复制文件路径到剪贴板
   *
   * 将文件相对路径复制到系统剪贴板。
   *
   * @param filePath - 文件路径（相对路径）
   */
  private async copyFilePath(filePath: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(filePath);
      console.log('[FileList] 已复制文件路径:', filePath);
    } catch (err) {
      console.error('[FileList] 复制路径失败:', err);
      alert(`复制路径失败: ${err}`);
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
