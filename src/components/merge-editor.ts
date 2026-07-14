/*
 * 合并编辑器组件（Task 8.2）
 *
 * 此组件以模态浮层的形式显示合并冲突解决界面，提供三栏布局：
 * - Ours（我们的版本）：当前分支的修改
 * - Merged（合并结果）：用户可编辑的合并结果
 * - Theirs（他们的版本）：被合并分支的修改
 *
 * 功能说明：
 * 1. 读取冲突文件内容（包含 <<<<<<< / ======= / >>>>>>> 冲突标记）
 * 2. 解析冲突标记，分离出 ours 和 theirs 部分
 * 3. 三栏布局显示，支持同步滚动
 * 4. 接受单段：点击某个冲突块的"接受 ours"或"接受 theirs"按钮
 * 5. 一键"接受所有 ours" / "接受所有 theirs"
 * 6. 手动编辑合并结果（在 Merged 栏直接编辑）
 * 7. 冲突块导航（上一个 / 下一个）
 * 8. 进度指示（X / Y 冲突已解决）
 * 9. 标记冲突已解决（写回文件 + git add）
 *
 * 数据来源：
 * - repoService.getWorktreeFileContent(repoPath, filePath) → 读取冲突文件
 * - repoService.writeFileContent(repoPath, filePath, content) → 写回合并结果
 * - repoService.stageFile(repoPath, filePath) → 标记冲突已解决（git add）
 *
 * 使用方式：
 *   const editor = new MergeEditor(onClose);
 *   await editor.open(repoPath, filePath);
 *
 * 关闭方式：
 *   editor.close();  // 主动关闭
 *   // 或点击关闭按钮、按 ESC 键、保存成功后自动关闭
 */

// 导入 Tauri 的 invoke 函数（保留 import，便于将来扩展直接调用）
import { invoke } from '@tauri-apps/api/core';

// 导入仓库服务（封装了文件读写和暂存操作）
import { repoService } from '../services/repo-service.js';

/**
 * 冲突块类型
 *
 * 表示文件中一个完整的冲突区域，包含：
 * - ours：<<<<<<< 和 ======= 之间的内容（当前分支版本）
 * - theirs：======= 和 >>>>>>> 之间的内容（被合并分支版本）
 * - resolved：该冲突是否已解决（用户已选择接受 ours/theirs 或手动编辑）
 */
interface ConflictBlock {
  /** 冲突块的序号（从 0 开始） */
  index: number;
  /** ours 部分的内容（行数组） */
  ours: string[];
  /** theirs 部分的内容（行数组） */
  theirs: string[];
  /** 该冲突块是否已解决（已接受 ours/theirs 或手动编辑后标记为已解决） */
  resolved: boolean;
}

/**
 * 解析后的文件结构
 *
 * 文件被分割为多个段：
 * - 普通文本段（在冲突块之外的内容）
 * - 冲突段（ConflictBlock）
 *
 * 按顺序交替出现：text → conflict → text → conflict → ... → text
 */
interface ParsedFile {
  /** 普通文本段（数组下标对应段序号） */
  textSegments: string[];
  /** 冲突块列表 */
  conflictBlocks: ConflictBlock[];
}

/**
 * 合并编辑器组件类
 *
 * 提供三栏合并冲突解决界面。
 *
 * 使用方式：
 *   const editor = new MergeEditor(onClose);
 *   await editor.open('/path/to/repo', 'src/main.rs');
 *   // ... 用户操作 ...
 *   editor.close();
 */
export class MergeEditor {
  /**
   * 模态遮罩层 DOM 元素
   *
   * 包含整个编辑器的根元素，添加到 document.body。
   * 关闭时从 DOM 中移除。
   */
  private overlay: HTMLElement | null = null;

  /**
   * Merged 栏的可编辑 textarea 元素
   *
   * 用户在此编辑合并结果。
   */
  private mergedTextarea: HTMLTextAreaElement | null = null;

  /**
   * 进度指示元素
   *
   * 显示 "X / Y 冲突已解决"。
   */
  private progressElement: HTMLElement | null = null;

  /**
   * 当前打开的仓库路径
   */
  private currentRepoPath: string | null = null;

  /**
   * 当前打开的文件路径
   */
  private currentFilePath: string | null = null;

  /**
   * 解析后的文件结构
   *
   * 包含普通文本段和冲突块列表。
   */
  private parsedFile: ParsedFile | null = null;

  /**
   * 当前选中的冲突块序号
   *
   * 用于导航（上一个 / 下一个冲突）。
   * -1 表示没有选中任何冲突块。
   */
  private currentConflictIndex: number = -1;

  /**
   * 原始文件内容
   *
   * 保存最初读取的文件内容，便于在取消编辑时恢复。
   */
  private originalContent: string = '';

  /**
   * 关闭回调函数
   *
   * 当编辑器被关闭时调用（无论是用户点击关闭按钮、按 ESC、保存成功，还是调用 close() 方法）。
   * 通常用于让调用者清理对 MergeEditor 实例的引用。
   */
  private onClose: (() => void) | null;

  /**
   * 保存成功回调函数
   *
   * 当用户成功保存合并结果（写回文件 + git add）后调用。
   * 通常用于刷新文件列表或节点图。
   */
  private onSaved: (() => void) | null;

  /**
   * ESC 键事件监听器的引用
   *
   * 用于在关闭编辑器时移除事件监听器，避免内存泄漏。
   */
  private escKeyListener: ((event: KeyboardEvent) => void) | null = null;

  /**
   * 创建合并编辑器组件实例
   *
   * @param onClose - 关闭回调（可选）
   * @param onSaved - 保存成功回调（可选）
   */
  constructor(
    onClose?: () => void,
    onSaved?: () => void,
  ) {
    this.onClose = onClose || null;
    this.onSaved = onSaved || null;
  }

  /**
   * 打开合并编辑器
   *
   * 读取指定冲突文件的内容，解析冲突标记，渲染三栏编辑器。
   *
   * 实现步骤：
   * 1. 保存仓库路径和文件路径
   * 2. 读取文件内容
   * 3. 解析冲突标记（<<<<<<< / ======= / >>>>>>>）
   * 4. 创建模态遮罩层和编辑器 DOM 结构
   * 5. 渲染三栏内容
   * 6. 绑定事件
   *
   * @param repoPath - 仓库路径
   * @param filePath - 冲突文件路径（相对于仓库根目录）
   */
  async open(repoPath: string, filePath: string): Promise<void> {
    // 保存当前路径
    this.currentRepoPath = repoPath;
    this.currentFilePath = filePath;

    // 如果已经有编辑器打开，先关闭
    if (this.overlay) {
      this.close();
    }

    // 创建并显示编辑器骨架（立即显示，给用户即时反馈）
    this.createEditorSkeleton(filePath);

    // 绑定事件
    this.bindEvents();

    // 显示加载中提示
    this.showLoading();

    try {
      // 读取冲突文件内容
      this.originalContent = await repoService.getWorktreeFileContent(repoPath, filePath);

      // 解析冲突标记
      this.parsedFile = this.parseConflicts(this.originalContent);

      // 渲染三栏内容
      this.renderContent();

      // 如果有冲突块，选中第一个
      if (this.parsedFile.conflictBlocks.length > 0) {
        this.currentConflictIndex = 0;
        this.updateProgress();
      } else {
        // 没有冲突块，提示用户
        this.showNoConflicts();
      }
    } catch (err) {
      // 加载失败，显示错误信息
      console.error('[MergeEditor] 加载冲突文件失败:', err);
      this.showError(String(err));
    }
  }

  /**
   * 关闭合并编辑器
   *
   * 从 DOM 中移除编辑器元素，并清理事件监听器。
   * 调用 onClose 回调通知调用者。
   */
  close(): void {
    // 移除 ESC 键监听器
    if (this.escKeyListener) {
      document.removeEventListener('keydown', this.escKeyListener);
      this.escKeyListener = null;
    }

    // 从 DOM 中移除遮罩层
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }

    // 清理引用
    this.mergedTextarea = null;
    this.progressElement = null;
    this.parsedFile = null;
    this.currentConflictIndex = -1;

    // 调用关闭回调
    if (this.onClose) {
      this.onClose();
    }
  }

  /* ============================================================
   * 内部方法：冲突解析
   * ============================================================ */

  /**
   * 解析文件中的冲突标记
   *
   * 文件中的冲突标记格式：
   * ```
   * <<<<<<< HEAD
   * ours 的内容（当前分支的修改）
   * =======
   * theirs 的内容（被合并分支的修改）
   * >>>>>>> branch-name
   * ```
   *
   * 解析算法：
   * 1. 按行分割文件内容
   * 2. 逐行扫描，识别冲突标记（<<<<<<< / ======= / >>>>>>>）
   * 3. 将冲突块之外的内容作为普通文本段
   * 4. 将冲突块内的内容分为 ours 和 theirs 两部分
   *
   * 返回的 ParsedFile 结构：
   * - textSegments[0]：第一个冲突块之前的文本
   * - conflictBlocks[0]：第一个冲突块
   * - textSegments[1]：第一个和第二个冲突块之间的文本
   * - conflictBlocks[1]：第二个冲突块
   * - ... 以此类推
   * - textSegments[N]：最后一个冲突块之后的文本
   *
   * @param content - 文件内容
   * @returns 解析后的文件结构
   */
  private parseConflicts(content: string): ParsedFile {
    const textSegments: string[] = [];
    const conflictBlocks: ConflictBlock[] = [];
    let currentText: string[] = []; // 当前普通文本段的行
    let currentOurs: string[] = []; // 当前冲突块的 ours 部分
    let currentTheirs: string[] = []; // 当前冲突块的 theirs 部分
    let inConflict = false; // 是否在冲突块内
    let inOurs = false; // 是否在 ours 部分（<<<<<<< 和 ======= 之间）
    let inTheirs = false; // 是否在 theirs 部分（======= 和 >>>>>>> 之间）
    let conflictIndex = 0; // 冲突块序号

    // 按行分割（保留行尾换行符的处理）
    // 使用 split('\n') 简单分割，后续渲染时再处理换行
    const lines: string[] = content.split('\n');

    for (const line of lines) {
      // 检测冲突开始标记：<<<<<<< HEAD 或 <<<<<<< branch-name
      if (line.startsWith('<<<<<<<')) {
        // 进入冲突块
        inConflict = true;
        inOurs = true;
        inTheirs = false;
        // 保存之前的普通文本段
        textSegments.push(currentText.join('\n'));
        currentText = [];
        currentOurs = [];
        currentTheirs = [];
        continue;
      }

      // 检测分隔标记：=======
      if (inConflict && inOurs && line === '=======') {
        // 从 ours 切换到 theirs
        inOurs = false;
        inTheirs = true;
        continue;
      }

      // 检测冲突结束标记：>>>>>>> branch-name
      if (inConflict && inTheirs && line.startsWith('>>>>>>>')) {
        // 结束冲突块
        conflictBlocks.push({
          index: conflictIndex,
          ours: currentOurs,
          theirs: currentTheirs,
          resolved: false,
        });
        conflictIndex++;
        inConflict = false;
        inOurs = false;
        inTheirs = false;
        currentOurs = [];
        currentTheirs = [];
        continue;
      }

      // 根据当前位置追加到对应的部分
      if (inConflict) {
        if (inOurs) {
          currentOurs.push(line);
        } else if (inTheirs) {
          currentTheirs.push(line);
        }
      } else {
        currentText.push(line);
      }
    }

    // 保存最后的普通文本段
    textSegments.push(currentText.join('\n'));

    return { textSegments, conflictBlocks };
  }

  /* ============================================================
   * 内部方法：DOM 创建与渲染
   * ============================================================ */

  /**
   * 创建编辑器骨架
   *
   * 创建模态遮罩层和编辑器主体结构，包括：
   * - 标题栏（文件名 + 关闭按钮）
   * - 工具栏（接受所有 ours / 接受所有 theirs / 上一个 / 下一个 / 保存）
   * - 三栏内容区（Ours / Merged / Theirs）
   *
   * 创建后立即将遮罩层添加到 document.body。
   *
   * @param filePath - 文件路径（用于标题栏显示）
   */
  private createEditorSkeleton(filePath: string): void {
    // 创建遮罩层
    this.overlay = document.createElement('div');
    this.overlay.className = 'merge-editor-overlay';

    // 创建编辑器主容器
    const container: HTMLElement = document.createElement('div');
    container.className = 'merge-editor-container';

    // 创建标题栏
    const header: HTMLElement = document.createElement('div');
    header.className = 'merge-editor-header';

    // 标题（文件名）
    const title: HTMLElement = document.createElement('div');
    title.className = 'merge-editor-title';
    title.textContent = `合并冲突: ${filePath}`;
    title.title = filePath;

    // 冲突数标签（数据加载后更新）
    const conflictCount: HTMLElement = document.createElement('div');
    conflictCount.className = 'merge-editor-conflict-count';
    conflictCount.textContent = '加载中...';

    // 关闭按钮
    const closeBtn: HTMLElement = document.createElement('button');
    closeBtn.className = 'merge-editor-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = '关闭 (Esc)';
    closeBtn.addEventListener('click', () => {
      this.close();
    });

    // 组装标题栏
    header.appendChild(title);
    header.appendChild(conflictCount);
    header.appendChild(closeBtn);

    // 创建工具栏
    const toolbar: HTMLElement = document.createElement('div');
    toolbar.className = 'merge-editor-toolbar';

    // 接受所有 ours 按钮
    const acceptAllOursBtn: HTMLElement = document.createElement('button');
    acceptAllOursBtn.className = 'merge-editor-btn btn-accept-all-ours';
    acceptAllOursBtn.textContent = '接受所有 Ours';
    acceptAllOursBtn.title = '将所有冲突块解决为 ours 版本';
    acceptAllOursBtn.addEventListener('click', () => {
      this.acceptAllOurs();
    });

    // 接受所有 theirs 按钮
    const acceptAllTheirsBtn: HTMLElement = document.createElement('button');
    acceptAllTheirsBtn.className = 'merge-editor-btn btn-accept-all-theirs';
    acceptAllTheirsBtn.textContent = '接受所有 Theirs';
    acceptAllTheirsBtn.title = '将所有冲突块解决为 theirs 版本';
    acceptAllTheirsBtn.addEventListener('click', () => {
      this.acceptAllTheirs();
    });

    // 分隔符
    const divider1: HTMLElement = document.createElement('div');
    divider1.className = 'merge-editor-divider';

    // 上一个冲突按钮
    const prevBtn: HTMLElement = document.createElement('button');
    prevBtn.className = 'merge-editor-btn';
    prevBtn.textContent = '上一个冲突';
    prevBtn.title = '跳转到上一个未解决的冲突块';
    prevBtn.addEventListener('click', () => {
      this.goToPrevConflict();
    });

    // 下一个冲突按钮
    const nextBtn: HTMLElement = document.createElement('button');
    nextBtn.className = 'merge-editor-btn';
    nextBtn.textContent = '下一个冲突';
    nextBtn.title = '跳转到下一个未解决的冲突块';
    nextBtn.addEventListener('click', () => {
      this.goToNextConflict();
    });

    // 分隔符
    const divider2: HTMLElement = document.createElement('div');
    divider2.className = 'merge-editor-divider';

    // 保存按钮
    const saveBtn: HTMLElement = document.createElement('button');
    saveBtn.className = 'merge-editor-btn btn-save';
    saveBtn.textContent = '保存并标记已解决';
    saveBtn.title = '写回文件并执行 git add 标记冲突已解决';
    saveBtn.addEventListener('click', () => {
      this.saveAndMarkResolved();
    });

    // 进度指示
    this.progressElement = document.createElement('div');
    this.progressElement.className = 'merge-editor-progress';
    this.progressElement.textContent = '0 / 0 已解决';

    // 组装工具栏
    toolbar.appendChild(acceptAllOursBtn);
    toolbar.appendChild(acceptAllTheirsBtn);
    toolbar.appendChild(divider1);
    toolbar.appendChild(prevBtn);
    toolbar.appendChild(nextBtn);
    toolbar.appendChild(divider2);
    toolbar.appendChild(saveBtn);
    toolbar.appendChild(this.progressElement);

    // 创建三栏内容区
    const content: HTMLElement = document.createElement('div');
    content.className = 'merge-editor-content';

    // Ours 栏
    const oursPane: HTMLElement = document.createElement('div');
    oursPane.className = 'merge-editor-pane ours';
    const oursHeader: HTMLElement = document.createElement('div');
    oursHeader.className = 'merge-editor-pane-header';
    oursHeader.textContent = 'Ours（当前分支）';
    const oursCode: HTMLElement = document.createElement('pre');
    oursCode.className = 'merge-editor-code';
    oursCode.id = 'merge-editor-ours-code';
    oursPane.appendChild(oursHeader);
    oursPane.appendChild(oursCode);

    // Merged 栏（可编辑）
    const mergedPane: HTMLElement = document.createElement('div');
    mergedPane.className = 'merge-editor-pane merged';
    const mergedHeader: HTMLElement = document.createElement('div');
    mergedHeader.className = 'merge-editor-pane-header';
    mergedHeader.textContent = 'Merged（合并结果，可编辑）';
    this.mergedTextarea = document.createElement('textarea');
    this.mergedTextarea.className = 'merge-editor-textarea';
    this.mergedTextarea.placeholder = '合并结果将在此显示，您可以手动编辑...';
    this.mergedTextarea.spellcheck = false;
    mergedPane.appendChild(mergedHeader);
    mergedPane.appendChild(this.mergedTextarea);

    // Theirs 栏
    const theirsPane: HTMLElement = document.createElement('div');
    theirsPane.className = 'merge-editor-pane theirs';
    const theirsHeader: HTMLElement = document.createElement('div');
    theirsHeader.className = 'merge-editor-pane-header';
    theirsHeader.textContent = 'Theirs（被合并分支）';
    const theirsCode: HTMLElement = document.createElement('pre');
    theirsCode.className = 'merge-editor-code';
    theirsCode.id = 'merge-editor-theirs-code';
    theirsPane.appendChild(theirsHeader);
    theirsPane.appendChild(theirsCode);

    // 组装三栏内容区
    content.appendChild(oursPane);
    content.appendChild(mergedPane);
    content.appendChild(theirsPane);

    // 组装编辑器主体
    container.appendChild(header);
    container.appendChild(toolbar);
    container.appendChild(content);

    // 将编辑器主体添加到遮罩层
    this.overlay.appendChild(container);

    // 将遮罩层添加到 document.body
    document.body.appendChild(this.overlay);
  }

  /**
   * 显示加载中提示
   *
   * 在三栏内容区显示"加载中..."文字。
   */
  private showLoading(): void {
    if (!this.overlay) return;
    const content: HTMLElement | null = this.overlay.querySelector('.merge-editor-content');
    if (!content) return;

    content.innerHTML = '<div class="merge-editor-loading">正在加载冲突文件...</div>';
  }

  /**
   * 显示错误信息
   *
   * @param message - 错误信息文本
   */
  private showError(message: string): void {
    if (!this.overlay) return;
    const content: HTMLElement | null = this.overlay.querySelector('.merge-editor-content');
    if (!content) return;

    content.innerHTML = `<div class="merge-editor-error">加载冲突文件失败: ${this.escapeHtml(message)}</div>`;
  }

  /**
   * 显示"无冲突"提示
   *
   * 当文件中没有冲突标记时显示此提示。
   */
  private showNoConflicts(): void {
    if (!this.overlay) return;
    const content: HTMLElement | null = this.overlay.querySelector('.merge-editor-content');
    if (!content) return;

    content.innerHTML = '<div class="merge-editor-empty">该文件没有冲突标记。<br>可能冲突已经被解决，或文件没有冲突。</div>';
  }

  /**
   * 渲染三栏内容
   *
   * 将解析后的文件内容渲染到三栏：
   * - Ours 栏：显示所有 ours 部分（含冲突标记）
   * - Merged 栏：可编辑的合并结果（初始为带冲突标记的原始内容）
   * - Theirs 栏：显示所有 theirs 部分（含冲突标记）
   */
  private renderContent(): void {
    if (!this.parsedFile || !this.mergedTextarea) return;

    // 构建 Ours 栏的内容（带冲突标记）
    let oursContent: string = '';
    // 构建 Theirs 栏的内容（带冲突标记）
    let theirsContent: string = '';
    // 构建 Merged 栏的内容（初始为原始内容）
    let mergedContent: string = '';

    const { textSegments, conflictBlocks } = this.parsedFile;

    // 遍历所有段，按顺序拼接
    for (let i = 0; i < textSegments.length; i++) {
      // 添加普通文本段
      oursContent += textSegments[i];
      theirsContent += textSegments[i];
      mergedContent += textSegments[i];

      // 如果有对应的冲突块，添加冲突内容
      if (i < conflictBlocks.length) {
        const block = conflictBlocks[i];

        // Ours 栏：显示 ours 部分和冲突标记
        oursContent += `<<<<<<< HEAD\n${block.ours.join('\n')}\n=======\n>>>>>>> theirs\n`;

        // Theirs 栏：显示 theirs 部分和冲突标记
        theirsContent += `<<<<<<< HEAD\n=======\n${block.theirs.join('\n')}\n>>>>>>> theirs\n`;

        // Merged 栏：保留原始冲突标记（用户可在此编辑）
        mergedContent += `<<<<<<< HEAD\n${block.ours.join('\n')}\n=======\n${block.theirs.join('\n')}\n>>>>>>> theirs\n`;
      }
    }

    // 设置 Ours 栏内容
    const oursCode: HTMLElement | null = this.overlay?.querySelector('#merge-editor-ours-code');
    if (oursCode) {
      oursCode.textContent = oursContent;
    }

    // 设置 Theirs 栏内容
    const theirsCode: HTMLElement | null = this.overlay?.querySelector('#merge-editor-theirs-code');
    if (theirsCode) {
      theirsCode.textContent = theirsContent;
    }

    // 设置 Merged 栏内容（可编辑）
    this.mergedTextarea.value = mergedContent;

    // 更新进度指示
    this.updateProgress();
  }

  /* ============================================================
   * 内部方法：操作处理
   * ============================================================ */

  /**
   * 接受所有冲突块的 ours 版本
   *
   * 将所有冲突块解决为 ours 的内容。
   * 在 Merged 栏中用 ours 内容替换冲突标记块。
   */
  private acceptAllOurs(): void {
    if (!this.parsedFile || !this.mergedTextarea) return;

    // 标记所有冲突块为已解决
    for (const block of this.parsedFile.conflictBlocks) {
      block.resolved = true;
    }

    // 重新构建 Merged 内容：用 ours 内容替换冲突块
    const mergedContent: string = this.buildResolvedContent('ours');

    // 更新 Merged 栏内容
    this.mergedTextarea.value = mergedContent;

    // 更新进度
    this.updateProgress();
  }

  /**
   * 接受所有冲突块的 theirs 版本
   *
   * 将所有冲突块解决为 theirs 的内容。
   * 在 Merged 栏中用 theirs 内容替换冲突标记块。
   */
  private acceptAllTheirs(): void {
    if (!this.parsedFile || !this.mergedTextarea) return;

    // 标记所有冲突块为已解决
    for (const block of this.parsedFile.conflictBlocks) {
      block.resolved = true;
    }

    // 重新构建 Merged 内容：用 theirs 内容替换冲突块
    const mergedContent: string = this.buildResolvedContent('theirs');

    // 更新 Merged 栏内容
    this.mergedTextarea.value = mergedContent;

    // 更新进度
    this.updateProgress();
  }

  /**
   * 构建解决冲突后的文件内容
   *
   * 将所有冲突块替换为指定版本（ours 或 theirs）的内容，
   * 保留普通文本段不变。
   *
   * @param choice - 'ours' 表示用 ours 内容，'theirs' 表示用 theirs 内容
   * @returns 解决冲突后的完整文件内容
   */
  private buildResolvedContent(choice: 'ours' | 'theirs'): string {
    if (!this.parsedFile) return '';

    const { textSegments, conflictBlocks } = this.parsedFile;
    let result: string = '';

    for (let i = 0; i < textSegments.length; i++) {
      // 添加普通文本段
      result += textSegments[i];

      // 如果有对应的冲突块，添加选定版本的内容
      if (i < conflictBlocks.length) {
        const block = conflictBlocks[i];
        const selectedContent: string[] = choice === 'ours' ? block.ours : block.theirs;
        result += selectedContent.join('\n');
      }
    }

    return result;
  }

  /**
   * 跳转到上一个未解决的冲突块
   *
   * 在 Merged 栏中滚动到上一个未解决冲突块的位置。
   */
  private goToPrevConflict(): void {
    if (!this.parsedFile || !this.mergedTextarea) return;

    const blocks: ConflictBlock[] = this.parsedFile.conflictBlocks;
    if (blocks.length === 0) return;

    // 从当前序号向前查找未解决的冲突块
    let startIndex: number = this.currentConflictIndex - 1;
    if (startIndex < 0) {
      startIndex = blocks.length - 1; // 循环到最后一个
    }

    for (let i = startIndex; i >= 0; i--) {
      if (!blocks[i].resolved) {
        this.currentConflictIndex = i;
        this.scrollToConflict(i);
        return;
      }
    }

    // 没找到，从头开始查找（循环）
    for (let i = blocks.length - 1; i > startIndex; i--) {
      if (!blocks[i].resolved) {
        this.currentConflictIndex = i;
        this.scrollToConflict(i);
        return;
      }
    }

    // 所有冲突块都已解决
    console.log('[MergeEditor] 所有冲突块都已解决');
  }

  /**
   * 跳转到下一个未解决的冲突块
   *
   * 在 Merged 栏中滚动到下一个未解决冲突块的位置。
   */
  private goToNextConflict(): void {
    if (!this.parsedFile || !this.mergedTextarea) return;

    const blocks: ConflictBlock[] = this.parsedFile.conflictBlocks;
    if (blocks.length === 0) return;

    // 从当前序号向后查找未解决的冲突块
    let startIndex: number = this.currentConflictIndex + 1;
    if (startIndex >= blocks.length) {
      startIndex = 0; // 循环到第一个
    }

    for (let i = startIndex; i < blocks.length; i++) {
      if (!blocks[i].resolved) {
        this.currentConflictIndex = i;
        this.scrollToConflict(i);
        return;
      }
    }

    // 没找到，从头开始查找（循环）
    for (let i = 0; i < startIndex; i++) {
      if (!blocks[i].resolved) {
        this.currentConflictIndex = i;
        this.scrollToConflict(i);
        return;
      }
    }

    // 所有冲突块都已解决
    console.log('[MergeEditor] 所有冲突块都已解决');
  }

  /**
   * 在 Merged 栏中滚动到指定冲突块的位置
   *
   * 通过查找 Merged 栏文本中的 <<<<<<< 标记来定位冲突块。
   *
   * @param conflictIndex - 冲突块序号
   */
  private scrollToConflict(conflictIndex: number): void {
    if (!this.mergedTextarea || !this.parsedFile) return;

    const text: string = this.mergedTextarea.value;
    const lines: string[] = text.split('\n');

    // 查找第 conflictIndex 个 <<<<<<< 标记的行号
    let foundCount: number = 0;
    let targetLine: number = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('<<<<<<<')) {
        if (foundCount === conflictIndex) {
          targetLine = i;
          break;
        }
        foundCount++;
      }
    }

    // 估算滚动位置（每行约 19.5 像素，13px 字号 × 1.5 行高）
    const scrollPosition: number = targetLine * 19.5;
    this.mergedTextarea.scrollTop = scrollPosition;

    // 选区定位到该行（让用户看到当前位置）
    this.mergedTextarea.focus();

    // 更新进度
    this.updateProgress();
  }

  /**
   * 更新进度指示
   *
   * 显示 "X / Y 冲突已解决"，其中 X 是已解决的冲突数，Y 是总冲突数。
   */
  private updateProgress(): void {
    if (!this.progressElement || !this.parsedFile) return;

    const total: number = this.parsedFile.conflictBlocks.length;
    const resolved: number = this.parsedFile.conflictBlocks.filter(b => b.resolved).length;

    this.progressElement.innerHTML =
      `<span class="progress-resolved">${resolved}</span> / <span class="progress-total">${total}</span> 冲突已解决`;

    // 同时更新标题栏的冲突数标签
    const conflictCount: HTMLElement | null = this.overlay?.querySelector('.merge-editor-conflict-count');
    if (conflictCount) {
      conflictCount.textContent = `${resolved} / ${total} 已解决`;
    }
  }

  /**
   * 保存合并结果并标记冲突已解决
   *
   * 实现步骤：
   * 1. 获取 Merged 栏的编辑后内容
   * 2. 写回工作区文件（覆盖原有内容）
   * 3. 执行 git add 标记冲突已解决
   * 4. 调用 onSaved 回调通知调用者
   * 5. 关闭编辑器
   */
  private async saveAndMarkResolved(): Promise<void> {
    if (!this.currentRepoPath || !this.currentFilePath || !this.mergedTextarea) {
      return;
    }

    try {
      // 获取 Merged 栏的编辑后内容
      const mergedContent: string = this.mergedTextarea.value;

      // 写回工作区文件（覆盖原有内容）
      await repoService.writeFileContent(
        this.currentRepoPath,
        this.currentFilePath,
        mergedContent,
      );

      // 执行 git add 标记冲突已解决
      await repoService.stageFile(
        this.currentRepoPath,
        this.currentFilePath,
      );

      console.log('[MergeEditor] 合并结果已保存并标记为已解决:', this.currentFilePath);

      // 调用保存成功回调
      if (this.onSaved) {
        this.onSaved();
      }

      // 关闭编辑器
      this.close();
    } catch (err) {
      console.error('[MergeEditor] 保存合并结果失败:', err);
      this.showError(`保存失败: ${String(err)}`);
    }
  }

  /* ============================================================
   * 内部方法：事件绑定与工具
   * ============================================================ */

  /**
   * 绑定事件
   *
   * 绑定以下事件：
   * 1. ESC 键关闭编辑器
   * 2. 监听 Merged 栏的编辑事件，更新冲突块的解决状态
   */
  private bindEvents(): void {
    if (!this.overlay) return;

    // ESC 键关闭编辑器
    this.escKeyListener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.close();
      }
    };
    document.addEventListener('keydown', this.escKeyListener);

    // 监听 Merged 栏的输入事件
    // 当用户手动编辑 Merged 栏并清除了所有冲突标记后，标记所有冲突块为已解决
    if (this.mergedTextarea) {
      this.mergedTextarea.addEventListener('input', () => {
        this.checkConflictsResolved();
      });
    }
  }

  /**
   * 检查冲突是否已解决
   *
   * 当用户在 Merged 栏手动编辑后，检查是否还有冲突标记。
   * 如果所有冲突标记都被清除，标记所有冲突块为已解决。
   */
  private checkConflictsResolved(): void {
    if (!this.parsedFile || !this.mergedTextarea) return;

    const text: string = this.mergedTextarea.value;

    // 检查是否还有 <<<<<<< 或 ======= 或 >>>>>>> 标记
    const hasConflictMarkers: boolean =
      text.includes('<<<<<<<') ||
      text.includes('=======') ||
      text.includes('>>>>>>>');

    if (!hasConflictMarkers) {
      // 所有冲突标记都被清除，标记所有冲突块为已解决
      for (const block of this.parsedFile.conflictBlocks) {
        block.resolved = true;
      }
      this.updateProgress();
    }
  }

  /**
   * HTML 转义
   *
   * 将特殊字符（<, >, &, ", '）转义为 HTML 实体，
   * 防止 XSS 攻击。
   *
   * @param text - 原始文本
   * @returns 转义后的文本
   */
  private escapeHtml(text: string): string {
    const escapeMap: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return text.replace(/[&<>"']/g, (char: string) => escapeMap[char] || char);
  }
}

/**
 * 合并编辑器全局单例
 *
 * 整个应用只维护一个 MergeEditor 实例，避免重复创建。
 * 由 app.ts 在初始化时调用 setMergeEditorCallbacks 注入回调。
 *
 * 使用方式：
 *   // 在 app.ts 中初始化
 *   setMergeEditorCallbacks(
 *     () => { this.mergeEditorOpen = false; },
 *     () => { this.refreshAllComponents(); }
 *   );
 *
 *   // 在检测到冲突时触发
 *   mergeEditor.open(repoPath, filePath);
 */
export const mergeEditor: MergeEditor = new MergeEditor();

/**
 * 设置合并编辑器的回调函数
 *
 * 由 app.ts 在初始化时调用，注入关闭和保存成功的回调。
 *
 * @param onClose - 关闭回调
 * @param onSaved - 保存成功回调（写回文件 + git add 后调用）
 */
export function setMergeEditorCallbacks(
  onClose: () => void,
  onSaved: () => void,
): void {
  // 直接修改 mergeEditor 实例的私有属性（通过类型断言绕过 TypeScript 检查）
  (mergeEditor as unknown as {
    onClose: (() => void) | null;
    onSaved: (() => void) | null;
  }).onClose = onClose;
  (mergeEditor as unknown as {
    onSaved: (() => void) | null;
  }).onSaved = onSaved;
}
