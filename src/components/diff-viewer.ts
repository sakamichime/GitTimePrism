/*
 * 文件差异对比组件（左右分栏版本）
 * 
 * 显示文件的 diff 内容，采用左右分栏对比视图（side-by-side diff）。
 * 左栏显示旧版本（工作树或暂存区），右栏显示新版本（暂存区或 HEAD）。
 * 新增行在右栏高亮为绿色，删除行在左栏高亮为红色。
 * 上下文行两栏对齐显示，行号也同步对齐。
 * 
 * 使用方式：
 * const diffViewer = new DiffViewer('detail-body');
 * await diffViewer.showWorkdirDiff(repoPath, filePath);   // 左:工作树 右:暂存区
 * await diffViewer.showStagedDiff(repoPath, filePath);    // 左:暂存区 右:HEAD
 * await diffViewer.showCommitDiff(repoPath, commitHash);  // 左:父提交 右:当前提交
 */

import { repoService, type DiffResult, type FileDiff, type DiffHunk } from '../services/repo-service.js';

/**
 * 对比行类型
 * 
 * 表示左右分栏中的一行数据：
 * - 'both': 左右都有内容（上下文行或修改行）
 * - 'left-only': 只有左栏有内容（删除行）
 * - 'right-only': 只有右栏有内容（新增行）
 */
interface DiffLine {
  /** 行类型 */
  type: 'both' | 'left-only' | 'right-only';
  /** 左栏行号（null 表示该行在左栏不存在） */
  leftLineNum: number | null;
  /** 左栏内容 */
  leftContent: string;
  /** 右栏行号（null 表示该行在右栏不存在） */
  rightLineNum: number | null;
  /** 右栏内容 */
  rightContent: string;
}

/**
 * 文件差异对比组件类（左右分栏版本）
 *
 * 管理 diff 视图的显示，包括：
 * - 获取文件在两个版本中的完整内容
 * - 使用 Myers diff 算法进行行级别对比
 * - 渲染左右分栏的对比视图
 * - 行号对齐显示
 * - 多文件标签栏切换
 */
export class DiffViewer {
  /** 容器 DOM 元素的 ID */
  private containerId: string;
  /** 返回回调函数，点击返回按钮时调用 */
  private onBack: (() => void) | null;
  /** 当前正在显示的完整 diff 数据（包含所有文件），用于标签切换 */
  private currentDiffResult: DiffResult | null = null;
  /** 当前选中的文件索引（在 files 数组中的下标） */
  private currentFileIndex: number = 0;
  /** 当前仓库路径（用于标签切换时重新获取文件内容） */
  private currentRepoPath: string | null = null;
  /** 当前显示模式：'workdir' | 'staged' | 'commit' */
  private currentMode: string = 'workdir';
  /** 当前提交哈希（仅 commit 模式使用） */
  private currentCommitHash: string | null = null;

  /**
   * 创建 diff 视图组件
   *
   * @param containerId - 容器 DOM 元素的 ID
   * @param onBack - 返回回调函数（可选），点击返回按钮时调用
   */
  constructor(containerId: string, onBack?: () => void) {
    this.containerId = containerId;
    this.onBack = onBack || null;
  }

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
   * 显示工作区文件的 diff（左右分栏）
   * 
   * 左栏显示工作树（当前编辑的文件），右栏显示暂存区文件内容。
   * 
   * @param repoPath - 仓库路径
   * @param filePath - 要查看的文件路径（相对于仓库根目录）
   */
  async showWorkdirDiff(repoPath: string, filePath: string): Promise<void> {
    if (!this.container) return;

    // 保存当前状态，用于标签切换
    this.currentRepoPath = repoPath;
    this.currentMode = 'workdir';

    try {
      // 并行获取工作树和暂存区的文件内容
      const [leftContent, rightContent] = await Promise.all([
        repoService.getWorktreeFileContent(repoPath, filePath),
        repoService.getStagedFileContent(repoPath, filePath).catch(() => ''),
      ]);

      // 渲染左右分栏对比视图
      this.renderSideBySideDiff(
        leftContent,
        rightContent,
        '工作树（当前文件）',
        '暂存区（已暂存版本）',
        filePath
      );
    } catch (err) {
      console.error('获取文件内容失败:', err);
      this.container.innerHTML = `<p style="color: var(--error); padding: 16px;">获取文件内容失败: ${err}</p>`;
    }
  }

  /**
   * 显示暂存区文件的 diff（左右分栏）
   * 
   * 左栏显示暂存区文件内容，右栏显示 HEAD（上一次提交）文件内容。
   * 
   * @param repoPath - 仓库路径
   * @param filePath - 要查看的文件路径（相对于仓库根目录）
   */
  async showStagedDiff(repoPath: string, filePath: string): Promise<void> {
    if (!this.container) return;

    // 保存当前状态
    this.currentRepoPath = repoPath;
    this.currentMode = 'staged';

    try {
      // 并行获取暂存区和 HEAD 的文件内容
      const [leftContent, rightContent] = await Promise.all([
        repoService.getStagedFileContent(repoPath, filePath),
        repoService.getHeadFileContent(repoPath, filePath).catch(() => ''),
      ]);

      // 渲染左右分栏对比视图
      this.renderSideBySideDiff(
        leftContent,
        rightContent,
        '暂存区（已暂存版本）',
        'HEAD（上次提交版本）',
        filePath
      );
    } catch (err) {
      console.error('获取文件内容失败:', err);
      this.container.innerHTML = `<p style="color: var(--error); padding: 16px;">获取文件内容失败: ${err}</p>`;
    }
  }

  /**
   * 显示提交的 diff（左右分栏）
   *
   * 左栏显示父提交的文件内容，右栏显示当前提交的文件内容。
   * 支持多文件标签栏切换。
   *
   * @param repoPath - 仓库路径
   * @param commitHash - 提交的哈希值
   */
  async showCommitDiff(repoPath: string, commitHash: string): Promise<void> {
    if (!this.container) return;

    try {
      // 获取提交 diff，包含所有文件的变更信息（用于标签栏）
      const diffResult = await repoService.getCommitDiff(repoPath, commitHash);

      if (diffResult.files.length === 0) {
        this.container.innerHTML = `<p style="color: var(--text-muted); padding: 16px;">该提交没有文件变更</p>`;
        return;
      }

      // 保存当前状态
      this.currentDiffResult = diffResult;
      this.currentFileIndex = 0;
      this.currentRepoPath = repoPath;
      this.currentMode = 'commit';
      this.currentCommitHash = commitHash;

      // 渲染完整的 diff 视图（包括标签栏和文件内容）
      await this.renderCommitDiffWithTabs();
    } catch (err) {
      console.error('获取提交 diff 失败:', err);
      this.container.innerHTML = `<p style="color: var(--error); padding: 16px;">获取 diff 失败: ${err}</p>`;
    }
  }

  /**
   * 渲染提交 diff 的左右分栏视图（带标签栏）
   * 
   * 当提交涉及多个文件时，在顶部显示文件列表标签栏，
   * 标签栏下方显示当前选中文件的左右分栏对比内容。
   * 
   * 左栏显示父提交的文件内容，右栏显示当前提交的文件内容。
   */
  private async renderCommitDiffWithTabs(): Promise<void> {
    if (!this.container || !this.currentDiffResult || !this.currentRepoPath || !this.currentCommitHash) return;

    const files = this.currentDiffResult.files;
    const fileDiff = files[this.currentFileIndex];

    try {
      // 获取父提交和当前提交的文件内容
      // 使用 git show <commit>:file_path 获取指定提交中的文件内容
      const [leftContent, rightContent] = await Promise.all([
        // 左栏：父提交的文件内容
        repoService.getFileContentAtCommit(this.currentRepoPath, `${this.currentCommitHash}^`, fileDiff.path).catch(() => ''),
        // 右栏：当前提交的文件内容
        repoService.getFileContentAtCommit(this.currentRepoPath, this.currentCommitHash, fileDiff.path).catch(() => ''),
      ]);

      // 渲染左右分栏对比视图
      this.renderSideBySideDiff(
        leftContent,
        rightContent,
        `父提交 (${this.currentCommitHash.substring(0, 7)}^)`,
        `当前提交 (${this.currentCommitHash.substring(0, 7)})`,
        fileDiff.path
      );
    } catch (err) {
      console.error('获取提交文件内容失败:', err);
      // 回退到使用 hunks 渲染
      this.renderCommitSideBySide(fileDiff, files);
    }
  }

  /**
   * 使用 diff hunks 渲染提交的分栏对比视图
   * 
   * 当无法直接获取文件完整内容时，使用 diff hunks 数据
   * 来构建左右分栏视图。
   * 
   * @param fileDiff - 文件的 diff 数据
   * @param allFiles - 所有变更文件列表（用于标签栏）
   */
  private renderCommitSideBySide(fileDiff: FileDiff, allFiles: FileDiff[]): void {
    if (!this.container) return;

    let html = '';

    // 多文件时显示标签栏
    if (allFiles.length > 1) {
      html += this.renderFileTabs();
    }

    // 文件头信息
    html += `
      <div class="diff-header">
        <div class="diff-file-path">
          <span class="diff-file-icon">📄</span>
          <span class="diff-file-name">${this.escapeHtml(fileDiff.path)}</span>
        </div>
        <div class="diff-stats">
          <span class="diff-additions">+${fileDiff.additions}</span>
          <span class="diff-deletions">-${fileDiff.deletions}</span>
        </div>
      </div>
    `;

    // 从 hunks 构建分栏行
    const diffLines = this.hunksToDiffLines(fileDiff.hunks);

    // 检测是否为二进制文件（hunks 为空且文件有变更，通常是二进制文件）
    const isBinaryFile = fileDiff.hunks.length === 0 && (fileDiff.additions > 0 || fileDiff.deletions > 0);

    if (isBinaryFile) {
      const ext = fileDiff.path.split('.').pop()?.toUpperCase() || 'BINARY';
      html += `
        <div class="diff-side-by-side">
          <div class="diff-pane diff-pane-left">
            <div class="diff-pane-header">
              <span class="diff-pane-title">父提交（旧版本）</span>
            </div>
            <div class="diff-pane-content" style="display:flex; align-items:center; justify-content:center; color: var(--text-muted);">
              <div style="text-align:center;">
                <div style="font-size:48px; margin-bottom:12px;">📦</div>
                <div>二进制文件（.${ext.toLowerCase()}）</div>
                <div style="font-size:12px; margin-top:4px;">无法显示文本对比</div>
              </div>
            </div>
          </div>
          <div class="diff-pane-divider"></div>
          <div class="diff-pane diff-pane-right">
            <div class="diff-pane-header">
              <span class="diff-pane-title">当前提交（新版本）</span>
            </div>
            <div class="diff-pane-content" style="display:flex; align-items:center; justify-content:center; color: var(--text-muted);">
              <div style="text-align:center;">
                <div style="font-size:48px; margin-bottom:12px;">🖼️</div>
                <div>二进制文件（.${ext.toLowerCase()}）</div>
                <div style="font-size:12px; margin-top:4px;">无法显示文本对比</div>
              </div>
            </div>
          </div>
        </div>
      `;
      this.container.innerHTML = html;
      this.bindDividerDrag();
      return;
    }

    // 渲染分栏内容
    html += this.renderDiffLines(diffLines);

    this.container.innerHTML = html;

    // 绑定标签点击事件
    if (allFiles.length > 1) {
      this.bindTabClickEvents();
    }

    // 绑定分栏分隔条拖拽事件
    this.bindDividerDrag();
  }

  /**
   * 将 diff hunks 转换为分栏行数据
   * 
   * 解析 unified diff 的 hunks，将其转换为左右分栏的行数据。
   * 每行包含左栏行号/内容和右栏行号/内容。
   * 
   * @param hunks - diff hunk 列表
   * @returns 分栏行数据数组
   */
  private hunksToDiffLines(hunks: DiffHunk[]): DiffLine[] {
    const lines: DiffLine[] = [];

    for (const hunk of hunks) {
      let oldLineNum = hunk.old_start;
      let newLineNum = hunk.new_start;

      for (const line of hunk.lines) {
        if (line.startsWith('+')) {
          // 新增行：只有右栏有内容
          lines.push({
            type: 'right-only',
            leftLineNum: null,
            leftContent: '',
            rightLineNum: newLineNum,
            rightContent: line.substring(1),
          });
          newLineNum++;
        } else if (line.startsWith('-')) {
          // 删除行：只有左栏有内容
          lines.push({
            type: 'left-only',
            leftLineNum: oldLineNum,
            leftContent: line.substring(1),
            rightLineNum: null,
            rightContent: '',
          });
          oldLineNum++;
        } else {
          // 上下文行：左右都有内容
          lines.push({
            type: 'both',
            leftLineNum: oldLineNum,
            leftContent: line.substring(1),
            rightLineNum: newLineNum,
            rightContent: line.substring(1),
          });
          oldLineNum++;
          newLineNum++;
        }
      }
    }

    return lines;
  }

  /**
   * 渲染左右分栏对比视图
   * 
   * 核心方法：获取两个版本的完整文件内容，使用 Myers diff 算法
   * 进行行级别对比，然后渲染为左右分栏的 HTML。
   * 
   * @param leftContent - 左栏文件内容（旧版本）
   * @param rightContent - 右栏文件内容（新版本）
   * @param leftTitle - 左栏标题（如"工作树（当前文件）"）
   * @param rightTitle - 右栏标题（如"暂存区（已暂存版本）"）
   * @param filePath - 文件路径（显示在顶部）
   */
  private renderSideBySideDiff(
    leftContent: string,
    rightContent: string,
    leftTitle: string,
    rightTitle: string,
    filePath: string
  ): void {
    if (!this.container) return;

    // 将文件内容按行分割
    const leftLines = leftContent.split('\n');
    const rightLines = rightContent.split('\n');

    // 如果最后一行是空字符串（文件以换行符结尾），移除它
    if (leftLines.length > 0 && leftLines[leftLines.length - 1] === '') {
      leftLines.pop();
    }
    if (rightLines.length > 0 && rightLines[rightLines.length - 1] === '') {
      rightLines.pop();
    }

    // 使用 Myers diff 算法进行行级别对比
    const diffLines = this.myersDiff(leftLines, rightLines);

    // 检测是否为二进制文件
    const isBinary = this.isBinaryContent(leftContent) || this.isBinaryContent(rightContent);

    // 如果是二进制文件，显示提示信息而非乱码
    if (isBinary) {
      const ext = filePath.split('.').pop()?.toUpperCase() || 'BINARY';
      let html = `
        <div class="diff-header">
          <div class="diff-header-left">
            ${this.onBack ? `<button class="diff-back-btn" id="diff-back-btn" title="返回详情">← 返回</button>` : ''}
            <div class="diff-file-path">
              <span class="diff-file-icon"></span>
              <span class="diff-file-name">${this.escapeHtml(filePath)}</span>
            </div>
          </div>
        </div>
        <div class="diff-side-by-side">
          <div class="diff-pane diff-pane-left">
            <div class="diff-pane-header">
              <span class="diff-pane-title">${this.escapeHtml(leftTitle)}</span>
            </div>
            <div class="diff-pane-content" style="display:flex; align-items:center; justify-content:center; color: var(--text-muted);">
              <div style="text-align:center;">
                <div style="font-size:48px; margin-bottom:12px;">️</div>
                <div>二进制文件（.${ext.toLowerCase()}）</div>
                <div style="font-size:12px; margin-top:4px;">无法显示文本对比</div>
              </div>
            </div>
          </div>
          <div class="diff-pane-divider"></div>
          <div class="diff-pane diff-pane-right">
            <div class="diff-pane-header">
              <span class="diff-pane-title">${this.escapeHtml(rightTitle)}</span>
            </div>
            <div class="diff-pane-content" style="display:flex; align-items:center; justify-content:center; color: var(--text-muted);">
              <div style="text-align:center;">
                <div style="font-size:48px; margin-bottom:12px;">🖼️</div>
                <div>二进制文件（.${ext.toLowerCase()}）</div>
                <div style="font-size:12px; margin-top:4px;">无法显示文本对比</div>
              </div>
            </div>
          </div>
        </div>
      `;
      this.container.innerHTML = html;
      this.bindBackButton();
      return;
    }

    // 统计新增/删除行数
    let additions = 0;
    let deletions = 0;
    for (const line of diffLines) {
      if (line.type === 'right-only') additions++;
      else if (line.type === 'left-only') deletions++;
    }

    // 构建 HTML
    let html = `
      <div class="diff-header">
        <div class="diff-header-left">
          ${this.onBack ? `<button class="diff-back-btn" id="diff-back-btn" title="返回详情">← 返回</button>` : ''}
          <div class="diff-file-path">
            <span class="diff-file-icon">📄</span>
            <span class="diff-file-name">${this.escapeHtml(filePath)}</span>
          </div>
        </div>
        <div class="diff-stats">
          <span class="diff-additions">+${additions}</span>
          <span class="diff-deletions">-${deletions}</span>
        </div>
      </div>
      <div class="diff-side-by-side">
        <!-- 左栏：旧版本 -->
        <div class="diff-pane diff-pane-left">
          <div class="diff-pane-header">
            <span class="diff-pane-title">${this.escapeHtml(leftTitle)}</span>
          </div>
          <div class="diff-pane-content">
    `;

    // 如果左栏内容为空且右栏有内容，说明是新文件
    const isNewFile = leftContent.trim() === '' && rightContent.trim() !== '';

    // 渲染每一行到左栏
    for (const line of diffLines) {
      if (line.type === 'both') {
        // 上下文行：两栏都显示
        html += `<div class="diff-line diff-line-context"><span class="diff-line-number">${line.leftLineNum}</span><span class="diff-line-content">${this.escapeHtml(line.leftContent)}</span></div>`;
      } else if (line.type === 'left-only') {
        // 删除行：只有左栏显示，红色高亮
        html += `<div class="diff-line diff-line-remove"><span class="diff-line-number">${line.leftLineNum}</span><span class="diff-line-content">${this.escapeHtml(line.leftContent)}</span></div>`;
      } else if (line.type === 'right-only') {
        // 新增行：左栏显示空行占位
        html += `<div class="diff-line diff-line-empty"><span class="diff-line-number"></span><span class="diff-line-content"></span></div>`;
      }
    }

    // 如果是新文件，在左栏显示提示
    if (isNewFile && diffLines.length === 0) {
      html += `<div class="diff-line diff-line-empty" style="padding: 16px; text-align: center; color: var(--text-muted);">
        <span style="font-size: 24px;"></span><br/>
        <span>此文件在父提交中不存在</span><br/>
        <span style="font-size: 12px;">（新文件）</span>
      </div>`;
    }

    html += `
          </div>
        </div>
        <!-- 左右分栏之间的可拖拽分隔条 -->
        <div class="diff-pane-divider" id="diff-pane-divider"></div>
        <!-- 右栏：新版本 -->
        <div class="diff-pane diff-pane-right">
          <div class="diff-pane-header">
            <span class="diff-pane-title">${this.escapeHtml(rightTitle)}</span>
          </div>
          <div class="diff-pane-content">
    `;

    // 渲染每一行到右栏
    for (const line of diffLines) {
      if (line.type === 'both') {
        // 上下文行：两栏都显示
        html += `<div class="diff-line diff-line-context"><span class="diff-line-number">${line.rightLineNum}</span><span class="diff-line-content">${this.escapeHtml(line.rightContent)}</span></div>`;
      } else if (line.type === 'left-only') {
        // 删除行：右栏显示空行占位
        html += `<div class="diff-line diff-line-empty"><span class="diff-line-number"></span><span class="diff-line-content"></span></div>`;
      } else if (line.type === 'right-only') {
        // 新增行：只有右栏显示，绿色高亮
        html += `<div class="diff-line diff-line-add"><span class="diff-line-number">${line.rightLineNum}</span><span class="diff-line-content">${this.escapeHtml(line.rightContent)}</span></div>`;
      }
    }

    html += `
          </div>
        </div>
      </div>
    `;

    this.container.innerHTML = html;

    // 绑定返回按钮点击事件
    this.bindBackButton();

    // 绑定分栏分隔条拖拽事件
    this.bindDividerDrag();
  }

  /**
   * 绑定返回按钮的点击事件
   * 
   * 点击返回按钮时，调用 onBack 回调函数，
   * 让用户可以回到之前的视图（如提交详情）。
   */
  private bindBackButton(): void {
    if (!this.container || !this.onBack) return;

    const backBtn = this.container.querySelector('#diff-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.onBack!();
      });
    }
  }

  /**
   * 绑定左右分栏分隔条的拖拽事件
   * 
   * 用户可以拖动分隔条来调整左右两栏的宽度比例。
   * 拖拽时实时更新两栏的 flex 比例。
   */
  private bindDividerDrag(): void {
    if (!this.container) return;

    const divider = this.container.querySelector<HTMLElement>('#diff-pane-divider');
    if (!divider) return;

    let isDragging = false;
    let startX = 0;
    let leftPane: HTMLElement | null = null;
    let rightPane: HTMLElement | null = null;
    // 保存初始宽度，避免每次读取 offsetWidth 导致 diff 累加
    let initialLeftWidth = 0;
    let initialRightWidth = 0;

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      startX = e.clientX;
      leftPane = this.container?.querySelector('.diff-pane-left') as HTMLElement;
      rightPane = this.container?.querySelector('.diff-pane-right') as HTMLElement;
      // 记录初始宽度（基于百分比或像素）
      if (leftPane && rightPane) {
        initialLeftWidth = leftPane.offsetWidth;
        initialRightWidth = rightPane.offsetWidth;
      }
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging || !leftPane || !rightPane) return;

      const diff = e.clientX - startX;
      // 基于初始宽度计算，而非实时 offsetWidth（避免 diff 累加导致灵敏度异常）
      const newLeftWidth = initialLeftWidth + diff;
      const newRightWidth = initialRightWidth - diff;
      const totalWidth = newLeftWidth + newRightWidth;

      // 限制每栏最小宽度为 150px
      if (newLeftWidth < 150 || newRightWidth < 150) return;

      // 使用百分比 flex-basis，确保两栏总宽度始终等于容器宽度，不会产生空缺
      const leftPercent = (newLeftWidth / totalWidth) * 100;
      const rightPercent = (newRightWidth / totalWidth) * 100;
      leftPane.style.flex = `0 0 ${leftPercent}%`;
      rightPane.style.flex = `0 0 ${rightPercent}%`;
    };

    const onMouseUp = () => {
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    divider.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  /**
   * 渲染分栏行数据为 HTML
   * 
   * 将 DiffLine 数组渲染为左右分栏的 HTML 结构。
   * 
   * @param diffLines - 分栏行数据数组
   * @returns HTML 字符串
   */
  private renderDiffLines(diffLines: DiffLine[]): string {
    let html = `
      <div class="diff-side-by-side">
        <!-- 左栏：父提交（旧版本） -->
        <div class="diff-pane diff-pane-left">
          <div class="diff-pane-header">
            <span class="diff-pane-title">父提交（旧版本）</span>
          </div>
          <div class="diff-pane-content">
    `;

    for (const line of diffLines) {
      if (line.type === 'both') {
        html += `<div class="diff-line diff-line-context"><span class="diff-line-number">${line.leftLineNum}</span><span class="diff-line-content">${this.escapeHtml(line.leftContent)}</span></div>`;
      } else if (line.type === 'left-only') {
        html += `<div class="diff-line diff-line-remove"><span class="diff-line-number">${line.leftLineNum}</span><span class="diff-line-content">${this.escapeHtml(line.leftContent)}</span></div>`;
      } else if (line.type === 'right-only') {
        html += `<div class="diff-line diff-line-empty"><span class="diff-line-number"></span><span class="diff-line-content"></span></div>`;
      }
    }

    html += `
          </div>
        </div>
        <!-- 左右分栏之间的可拖拽分隔条 -->
        <div class="diff-pane-divider" id="diff-pane-divider"></div>
        <!-- 右栏：当前提交（新版本） -->
        <div class="diff-pane diff-pane-right">
          <div class="diff-pane-header">
            <span class="diff-pane-title">当前提交（新版本）</span>
          </div>
          <div class="diff-pane-content">
    `;

    for (const line of diffLines) {
      if (line.type === 'both') {
        html += `<div class="diff-line diff-line-context"><span class="diff-line-number">${line.rightLineNum}</span><span class="diff-line-content">${this.escapeHtml(line.rightContent)}</span></div>`;
      } else if (line.type === 'left-only') {
        html += `<div class="diff-line diff-line-empty"><span class="diff-line-number"></span><span class="diff-line-content"></span></div>`;
      } else if (line.type === 'right-only') {
        html += `<div class="diff-line diff-line-add"><span class="diff-line-number">${line.rightLineNum}</span><span class="diff-line-content">${this.escapeHtml(line.rightContent)}</span></div>`;
      }
    }

    html += `
          </div>
        </div>
      </div>
    `;

    return html;
  }

  /**
   * Myers diff 算法实现
   * 
   * 经典的 Myers diff 算法，用于计算两个行序列之间的最小编辑距离。
   * 返回一组 DiffLine，表示左右分栏中的每一行。
   * 
   * 算法思路：
   * 1. 找到两个序列的最长公共子序列（LCS）
   * 2. 根据 LCS 构建编辑脚本（哪些行相同、哪些行新增、哪些行删除）
   * 
   * @param leftLines - 左栏（旧版本）的行数组
   * @param rightLines - 右栏（新版本）的行数组
   * @returns 分栏行数据数组
   */
  private myersDiff(leftLines: string[], rightLines: string[]): DiffLine[] {
    const N = leftLines.length;
    const M = rightLines.length;

    // 特殊情况：两个都为空
    if (N === 0 && M === 0) return [];

    // 特殊情况：左栏为空（全部是新增行）
    if (N === 0) {
      return rightLines.map((content, i) => ({
        type: 'right-only' as const,
        leftLineNum: null,
        leftContent: '',
        rightLineNum: i + 1,
        rightContent: content,
      }));
    }

    // 特殊情况：右栏为空（全部是删除行）
    if (M === 0) {
      return leftLines.map((content, i) => ({
        type: 'left-only' as const,
        leftLineNum: i + 1,
        leftContent: content,
        rightLineNum: null,
        rightContent: '',
      }));
    }

    // Myers diff 核心算法
    // MAX 是最大可能的编辑距离
    const MAX = N + M;
    // V 数组：V[k] 存储在对角线 k 上能到达的最远 x 坐标
    // 使用偏移量 MAX 使负索引变为正索引
    const V = new Int32Array(2 * MAX + 1);
    V.fill(-1);
    // 记录每一步的 V 数组状态，用于回溯
    const trace: Int32Array[] = [];

    // V[MAX] = 0 表示从 (0, 0) 开始
    V[MAX] = 0;

    let found = false;

    // 外层循环：编辑距离 d 从 0 到 MAX
    for (let d = 0; d <= MAX; d++) {
      // 保存当前 V 数组的副本，用于后续回溯
      trace.push(new Int32Array(V));

      // 内层循环：对角线 k 从 -d 到 d，步长为 2
      for (let k = -d; k <= d; k += 2) {
        let x: number;

        // 决定是向下走（删除）还是向右走（新增）
        if (k === -d || (k !== d && V[MAX + k - 1] < V[MAX + k + 1])) {
          // 向右走：从对角线 k+1 下来（新增一行）
          x = V[MAX + k + 1];
        } else {
          // 向下走：从对角线 k-1 过来（删除一行）
          x = V[MAX + k - 1] + 1;
        }

        // y 坐标由 x - k 得出
        let y = x - k;

        // 沿着对角线尽可能远地走（匹配相同的行）
        while (x < N && y < M && leftLines[x] === rightLines[y]) {
          x++;
          y++;
        }

        // 记录在对角线 k 上能到达的最远 x 坐标
        V[MAX + k] = x;

        // 如果到达了终点 (N, M)，diff 计算完成
        if (x >= N && y >= M) {
          found = true;
          break;
        }
      }

      if (found) break;
    }

    // 回溯：从终点 (N, M) 反向追踪编辑路径
    return this.backtrack(trace, leftLines, rightLines, N, M, MAX);
  }

  /**
   * Myers diff 回溯算法
   * 
   * 从终点 (N, M) 反向追踪编辑路径，构建分栏行数据。
   * 
   * @param trace - 每一步的 V 数组状态
   * @param leftLines - 左栏行数组
   * @param rightLines - 右栏行数组
   * @param N - 左栏行数
   * @param M - 右栏行数
   * @param MAX - 最大编辑距离
   * @returns 分栏行数据数组（从文件开头到结尾的顺序）
   */
  private backtrack(
    trace: Int32Array[],
    leftLines: string[],
    rightLines: string[],
    N: number,
    M: number,
    MAX: number
  ): DiffLine[] {
    // 存储反向的操作序列
    const ops: Array<{ type: 'equal' | 'delete' | 'insert'; leftIdx: number; rightIdx: number }> = [];

    let x = N;
    let y = M;

    // 从最后一步开始反向追踪
    for (let d = trace.length - 1; d >= 0; d--) {
      const V = trace[d];
      const k = x - y;

      let prevK: number;
      if (k === -d || (k !== d && V[MAX + k - 1] < V[MAX + k + 1])) {
        prevK = k + 1;
      } else {
        prevK = k - 1;
      }

      const prevX = V[MAX + prevK];
      const prevY = prevX - prevK;

      // 先记录对角线上的匹配行（相等行）
      while (x > prevX && y > prevY) {
        x--;
        y--;
        ops.push({ type: 'equal', leftIdx: x, rightIdx: y });
      }

      if (d > 0) {
        // 记录编辑操作（删除或新增）
        if (k === -d || (k !== d && V[MAX + k - 1] < V[MAX + k + 1])) {
          // 从 k+1 下来，表示新增一行
          y--;
          ops.push({ type: 'insert', leftIdx: x, rightIdx: y });
        } else {
          // 从 k-1 过来，表示删除一行
          x--;
          ops.push({ type: 'delete', leftIdx: x, rightIdx: y });
        }
      }
    }

    // 反转操作序列（因为我们是反向追踪的）
    ops.reverse();

    // 将操作序列转换为分栏行数据
    const result: DiffLine[] = [];
    let leftLineNum = 1;
    let rightLineNum = 1;

    for (const op of ops) {
      if (op.type === 'equal') {
        // 相等行：两栏都显示
        result.push({
          type: 'both',
          leftLineNum: leftLineNum,
          leftContent: leftLines[op.leftIdx],
          rightLineNum: rightLineNum,
          rightContent: rightLines[op.rightIdx],
        });
        leftLineNum++;
        rightLineNum++;
      } else if (op.type === 'delete') {
        // 删除行：只有左栏显示
        result.push({
          type: 'left-only',
          leftLineNum: leftLineNum,
          leftContent: leftLines[op.leftIdx],
          rightLineNum: null,
          rightContent: '',
        });
        leftLineNum++;
      } else if (op.type === 'insert') {
        // 新增行：只有右栏显示
        result.push({
          type: 'right-only',
          leftLineNum: null,
          leftContent: '',
          rightLineNum: rightLineNum,
          rightContent: rightLines[op.rightIdx],
        });
        rightLineNum++;
      }
    }

    return result;
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

    // 从 hunks 构建分栏行并渲染
    const diffLines = this.hunksToDiffLines(fileDiff.hunks);
    html += this.renderDiffLines(diffLines);

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
   * 更新当前文件索引，然后重新渲染整个 diff 视图。
   *
   * @param fileIndex - 要切换到的文件在 files 数组中的索引
   */
  private switchFile(fileIndex: number): void {
    // 检查是否有 diff 数据
    if (!this.currentDiffResult) return;

    // 检查索引是否有效
    if (fileIndex < 0 || fileIndex >= this.currentDiffResult.files.length) return;

    // 如果点击的是当前已选中的标签，不需要重新渲染
    if (fileIndex === this.currentFileIndex) return;

    // 更新当前选中的文件索引
    this.currentFileIndex = fileIndex;

    // 根据当前模式重新渲染
    if (this.currentMode === 'commit') {
      this.renderCommitDiffWithTabs();
    } else {
      this.renderDiffWithTabs();
    }
  }

  /**
   * 渲染单个文件的 diff（兼容旧接口）
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

    // 从 hunks 构建分栏行并渲染
    const diffLines = this.hunksToDiffLines(fileDiff.hunks);
    html += this.renderDiffLines(diffLines);

    this.container.innerHTML = html;
  }

  /**
   * 检测内容是否为二进制文件
   * 
   * 通过检测内容中是否包含 null 字节来判断（二进制文件的典型特征）。
   * 
   * @param content - 文件内容
   * @returns 是否为二进制内容
   */
  private isBinaryContent(content: string): boolean {
    if (!content) return false;
    // 检测前 8KB 中是否有 null 字节
    const sample = content.substring(0, 8192);
    for (let i = 0; i < sample.length; i++) {
      if (sample.charCodeAt(i) === 0) return true;
    }
    return false;
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
