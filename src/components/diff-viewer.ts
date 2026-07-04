/*
 * 文件差异对比组件
 * 
 * 显示文件的 diff 内容，支持左右分栏显示（旧文件/新文件）。
 * 新增行显示为绿色，删除行显示为红色，上下文行显示为灰色。
 * 支持行号显示和 hunk 头信息。
 * 
 * 使用方式：
 * const diffViewer = new DiffViewer('detail-body');
 * await diffViewer.showWorkdirDiff(repoPath, filePath);
 * await diffViewer.showCommitDiff(repoPath, commitHash);
 */

import { repoService, type DiffResult, type FileDiff, type DiffHunk } from '../services/repo-service.js';

/**
 * 文件差异对比组件类
 *
 * 管理 diff 视图的显示，包括：
 * - 获取并解析 diff 数据
 * - 渲染左右分栏的 diff 视图
 * - 语法高亮（新增/删除/上下文）
 * - 行号显示
 * - 多文件标签栏切换（当提交涉及多个文件时）
 */
export class DiffViewer {
  /** 容器 DOM 元素的 ID */
  private containerId: string;
  /** 容器 DOM 元素引用 */
  private container: HTMLElement | null = null;
  /** 当前正在显示的完整 diff 数据（包含所有文件），用于标签切换 */
  private currentDiffResult: DiffResult | null = null;
  /** 当前选中的文件索引（在 files 数组中的下标） */
  private currentFileIndex: number = 0;

  /**
   * 创建 diff 视图组件
   *
   * @param containerId - 容器 DOM 元素的 ID
   */
  constructor(containerId: string) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
  }

  /**
   * 显示工作区文件的 diff
   * 
   * 获取工作区与暂存区之间的差异，并显示指定文件的 diff。
   * 
   * @param repoPath - 仓库路径
   * @param filePath - 要查看的文件路径（相对于仓库根目录）
   */
  async showWorkdirDiff(repoPath: string, filePath: string): Promise<void> {
    if (!this.container) return;

    try {
      // 获取工作区 diff
      const diffResult = await repoService.getWorkdirDiff(repoPath, filePath);

      // 查找指定文件的 diff
      const fileDiff = diffResult.files.find(f => f.path === filePath);
      if (!fileDiff) {
        this.container.innerHTML = `<p style="color: var(--text-muted); padding: 16px;">该文件没有变更</p>`;
        return;
      }

      // 渲染 diff
      this.renderFileDiff(fileDiff);
    } catch (err) {
      console.error('获取 diff 失败:', err);
      this.container.innerHTML = `<p style="color: var(--error); padding: 16px;">获取 diff 失败: ${err}</p>`;
    }
  }

  /**
   * 显示暂存区文件的 diff
   * 
   * 获取暂存区与 HEAD 之间的差异，并显示指定文件的 diff。
   * 用于查看已暂存但未提交的变更。
   * 
   * @param repoPath - 仓库路径
   * @param filePath - 要查看的文件路径（相对于仓库根目录）
   */
  async showStagedDiff(repoPath: string, filePath: string): Promise<void> {
    if (!this.container) return;

    try {
      // 获取暂存区 diff（包含所有暂存文件）
      const diffResult = await repoService.getStagedDiff(repoPath);

      // 查找指定文件的 diff
      const fileDiff = diffResult.files.find(f => f.path === filePath);
      if (!fileDiff) {
        this.container.innerHTML = `<p style="color: var(--text-muted); padding: 16px;">该文件没有暂存的变更</p>`;
        return;
      }

      // 渲染 diff
      this.renderFileDiff(fileDiff);
    } catch (err) {
      console.error('获取暂存区 diff 失败:', err);
      this.container.innerHTML = `<p style="color: var(--error); padding: 16px;">获取 diff 失败: ${err}</p>`;
    }
  }

  /**
   * 显示提交的 diff
   *
   * 获取指定提交引入的所有文件变更，支持多文件标签栏切换。
   * 当涉及多个文件时，在顶部显示文件列表标签栏，默认显示第一个文件的 diff。
   *
   * @param repoPath - 仓库路径
   * @param commitHash - 提交的哈希值
   */
  async showCommitDiff(repoPath: string, commitHash: string): Promise<void> {
    if (!this.container) return;

    try {
      // 获取提交 diff，包含所有文件的变更信息
      const diffResult = await repoService.getCommitDiff(repoPath, commitHash);

      if (diffResult.files.length === 0) {
        this.container.innerHTML = `<p style="color: var(--text-muted); padding: 16px;">该提交没有文件变更</p>`;
        return;
      }

      // 保存当前 diff 数据，用于后续标签切换
      this.currentDiffResult = diffResult;
      // 默认选中第一个文件
      this.currentFileIndex = 0;

      // 渲染完整的 diff 视图（包括标签栏和文件内容）
      this.renderDiffWithTabs();
    } catch (err) {
      console.error('获取提交 diff 失败:', err);
      this.container.innerHTML = `<p style="color: var(--error); padding: 16px;">获取 diff 失败: ${err}</p>`;
    }
  }

  /**
   * 渲染带有文件标签栏的 diff 视图
   *
   * 当提交涉及多个文件时，在顶部显示文件列表标签栏，
   * 标签栏下方显示当前选中文件的 diff 内容。
   * 如果只有一个文件，则不显示标签栏，直接显示 diff 内容。
   */
  private renderDiffWithTabs(): void {
    if (!this.container || !this.currentDiffResult) return;

    const files = this.currentDiffResult.files;

    // 如果只有一个文件，不显示标签栏，直接渲染文件 diff
    if (files.length === 1) {
      this.renderFileDiff(files[this.currentFileIndex]);
      return;
    }

    // 多个文件时，先渲染文件标签栏
    let html = this.renderFileTabs();

    // 然后渲染当前选中文件的 diff 内容
    const fileDiff = files[this.currentFileIndex];

    // 文件头信息
    html += `
      <div class="diff-header">
        <div class="diff-file-path">
          <span class="diff-file-icon">📄</span>
          <span class="diff-file-name">${fileDiff.path}</span>
        </div>
        <div class="diff-stats">
          <span class="diff-additions">+${fileDiff.additions}</span>
          <span class="diff-deletions">-${fileDiff.deletions}</span>
        </div>
      </div>
    `;

    // 如果是重命名文件，显示旧路径
    if (fileDiff.is_renamed && fileDiff.old_path) {
      html += `
        <div class="diff-rename-info">
          从 ${fileDiff.old_path} 重命名
        </div>
      `;
    }

    // 渲染所有 hunks
    for (const hunk of fileDiff.hunks) {
      html += this.renderHunk(hunk);
    }

    this.container.innerHTML = html;

    // 为每个标签绑定点击事件，实现文件切换
    this.bindTabClickEvents();
  }

  /**
   * 渲染文件标签栏
   *
   * 生成文件列表标签栏的 HTML，每个标签显示文件名和变更统计（+/- 行数）。
   * 当前选中的标签会添加激活状态的 CSS 类名。
   *
   * @returns 标签栏的 HTML 字符串
   */
  private renderFileTabs(): string {
    if (!this.currentDiffResult) return '';

    const files = this.currentDiffResult.files;

    // 标签栏容器
    let html = `<div class="diff-file-tabs">`;

    // 遍历所有文件，为每个文件生成一个标签
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // 判断当前标签是否为选中状态
      const activeClass = i === this.currentFileIndex ? ' diff-file-tab-active' : '';

      // 获取文件的短名称（取路径最后一段），用于标签显示
      const shortName = file.path.split('/').pop() || file.path;

      // 文件状态图标：新增文件用 🟢，删除文件用 🔴，重命名文件用 📝，修改文件用 📄
      let statusIcon = '📄';
      if (file.is_new) statusIcon = '🟢';
      else if (file.is_deleted) statusIcon = '🔴';
      else if (file.is_renamed) statusIcon = '📝';

      // 每个标签包含：状态图标、文件短名称、新增行数、删除行数
      // data-file-index 属性用于点击事件时确定切换到了哪个文件
      html += `
        <div class="diff-file-tab${activeClass}" data-file-index="${i}" title="${this.escapeHtml(file.path)}">
          <span class="diff-file-tab-icon">${statusIcon}</span>
          <span class="diff-file-tab-name">${this.escapeHtml(shortName)}</span>
          <span class="diff-file-tab-stats">
            <span class="diff-file-tab-additions">+${file.additions}</span>
            <span class="diff-file-tab-deletions">-${file.deletions}</span>
          </span>
        </div>
      `;
    }

    html += `</div>`;
    return html;
  }

  /**
   * 为文件标签栏中的每个标签绑定点击事件
   *
   * 点击标签后，更新当前选中文件索引，并重新渲染 diff 视图。
   * 使用事件委托的方式绑定，避免重复绑定。
   */
  private bindTabClickEvents(): void {
    if (!this.container) return;

    // 查找所有文件标签元素
    const tabs = this.container.querySelectorAll('.diff-file-tab');

    // 为每个标签添加点击事件监听器
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        // 从 data-file-index 属性获取要切换到的文件索引
        const fileIndex = parseInt(tab.getAttribute('data-file-index') || '0', 10);

        // 调用 switchFile 方法切换显示的文件
        this.switchFile(fileIndex);
      });
    });
  }

  /**
   * 切换到指定索引的文件 diff
   *
   * 更新当前文件索引，然后重新渲染整个 diff 视图（包括标签栏和文件内容）。
   * 如果索引无效或没有 diff 数据，则不做任何操作。
   *
   * @param fileIndex - 要切换到的文件在 files 数组中的索引
   */
  private switchFile(fileIndex: number): void {
    // 检查是否有 diff 数据
    if (!this.currentDiffResult) return;

    // 检查索引是否有效（在合法范围内）
    if (fileIndex < 0 || fileIndex >= this.currentDiffResult.files.length) return;

    // 如果点击的是当前已选中的标签，不需要重新渲染
    if (fileIndex === this.currentFileIndex) return;

    // 更新当前选中的文件索引
    this.currentFileIndex = fileIndex;

    // 重新渲染整个 diff 视图（标签栏 + 文件内容）
    this.renderDiffWithTabs();
  }

  /**
   * 渲染单个文件的 diff
   *
   * @param fileDiff - 文件的 diff 数据
   */
  private renderFileDiff(fileDiff: FileDiff): void {
    if (!this.container) return;

    // 文件头信息
    let html = `
      <div class="diff-header">
        <div class="diff-file-path">
          <span class="diff-file-icon">📄</span>
          <span class="diff-file-name">${fileDiff.path}</span>
        </div>
        <div class="diff-stats">
          <span class="diff-additions">+${fileDiff.additions}</span>
          <span class="diff-deletions">-${fileDiff.deletions}</span>
        </div>
      </div>
    `;

    // 如果是重命名文件，显示旧路径
    if (fileDiff.is_renamed && fileDiff.old_path) {
      html += `
        <div class="diff-rename-info">
          从 ${fileDiff.old_path} 重命名
        </div>
      `;
    }

    // 渲染所有 hunks
    for (const hunk of fileDiff.hunks) {
      html += this.renderHunk(hunk);
    }

    this.container.innerHTML = html;
  }

  /**
   * 渲染单个 hunk（变更块）
   * 
   * @param hunk - hunk 数据
   * @returns hunk 的 HTML 字符串
   */
  private renderHunk(hunk: DiffHunk): string {
    // hunk 头信息
    let html = `
      <div class="diff-hunk-header">
        @@ -${hunk.old_start},${hunk.old_count} +${hunk.new_start},${hunk.new_count} @@
      </div>
      <div class="diff-hunk-content">
    `;

    // 渲染每一行
    let oldLineNum = hunk.old_start;
    let newLineNum = hunk.new_start;

    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        // 新增行（绿色）
        html += `
          <div class="diff-line diff-line-add">
            <span class="diff-line-num diff-line-num-old"></span>
            <span class="diff-line-num diff-line-num-new">${newLineNum}</span>
            <span class="diff-line-content">${this.escapeHtml(line.substring(1))}</span>
          </div>
        `;
        newLineNum++;
      } else if (line.startsWith('-')) {
        // 删除行（红色）
        html += `
          <div class="diff-line diff-line-remove">
            <span class="diff-line-num diff-line-num-old">${oldLineNum}</span>
            <span class="diff-line-num diff-line-num-new"></span>
            <span class="diff-line-content">${this.escapeHtml(line.substring(1))}</span>
          </div>
        `;
        oldLineNum++;
      } else {
        // 上下文行（灰色）
        html += `
          <div class="diff-line diff-line-context">
            <span class="diff-line-num diff-line-num-old">${oldLineNum}</span>
            <span class="diff-line-num diff-line-num-new">${newLineNum}</span>
            <span class="diff-line-content">${this.escapeHtml(line.substring(1))}</span>
          </div>
        `;
        oldLineNum++;
        newLineNum++;
      }
    }

    html += `</div>`;
    return html;
  }

  /**
   * HTML 转义
   * 
   * 防止 XSS 攻击，将特殊字符转义为 HTML 实体。
   * 
   * @param text - 要转义的文本
   * @returns 转义后的文本
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
