/*
 * Blame 视图组件（Task 8.4）
 *
 * 此组件以模态浮层的形式显示文件每行的提交溯源信息（git blame）。
 *
 * 功能说明：
 * 1. 调用后端 `get_blame` 命令获取文件每行的提交信息
 * 2. 以三列网格布局显示每行：行号 | commit 信息 | 代码内容
 * 3. 不同 commit 使用不同背景色块标识，便于识别同一 commit 的连续行
 * 4. 点击某行可跳转到对应提交的详情视图（通过 onCommitClick 回调）
 * 5. 边界提交（boundary commit）使用更浅的色调显示
 * 6. 提供"刷新"按钮重新加载 Blame 数据
 * 7. 提供"关闭"按钮关闭视图
 *
 * 数据来源：
 * - repoService.getBlame(repoPath, filePath) → 返回 BlameLine[]
 *
 * 使用方式：
 *   const viewer = new BlameViewer(
 *     (hash) => { // onCommitClick 回调，跳转提交详情 },
 *     () => { // onClose 回调，关闭后清理引用 }
 *   );
 *   await viewer.open(repoPath, filePath);
 *
 * 关闭方式：
 *   viewer.close();  // 主动关闭
 *   // 或点击关闭按钮、按 ESC 键
 */

// 导入 Tauri 的 invoke 函数（用于调用后端命令）
import { invoke } from '@tauri-apps/api/core';

// 导入仓库服务（封装了 getBlame 方法，调用后端 get_blame 命令）
import { repoService, type BlameLine } from '../services/repo-service.js';

/**
 * 颜色调色板
 *
 * 用于给不同 commit 的信息列着色，让用户能直观区分不同的提交。
 * 使用浅色背景，避免影响代码内容的可读性。
 *
 * 颜色选择原则：
 * - 都是低饱和度的浅色，作为背景色不会喧宾夺主
 * - 8 种颜色循环使用，足以区分常见的连续 commit 块
 */
const COMMIT_COLORS: ReadonlyArray<string> = [
  'rgba(255, 200, 200, 0.3)',  // 浅红
  'rgba(200, 255, 200, 0.3)',  // 浅绿
  'rgba(200, 200, 255, 0.3)',  // 浅蓝
  'rgba(255, 255, 200, 0.3)',  // 浅黄
  'rgba(255, 200, 255, 0.3)',  // 浅紫
  'rgba(200, 255, 255, 0.3)',  // 浅青
  'rgba(255, 220, 180, 0.3)',  // 浅橙
  'rgba(220, 220, 220, 0.3)',  // 浅灰
];

/**
 * Blame 视图组件类
 *
 * 以模态浮层形式显示文件的 Blame 信息。
 *
 * 使用方式：
 *   const viewer = new BlameViewer(onCommitClick, onClose);
 *   await viewer.open('/path/to/repo', 'src/main.rs');
 *   // ... 用户操作 ...
 *   viewer.close();
 */
export class BlameViewer {
  /**
   * 模态遮罩层 DOM 元素
   *
   * 包含整个 Blame 视图的根元素，添加到 document.body。
   * 关闭时从 DOM 中移除。
   */
  private overlay: HTMLElement | null = null;

  /**
   * 内容区容器 DOM 元素
   *
   * 用于显示 Blame 行列表的容器，便于在刷新时替换内容。
   */
  private contentContainer: HTMLElement | null = null;

  /**
   * 标题栏信息元素
   *
   * 显示总行数等辅助信息，便于在数据加载后更新。
   */
  private infoElement: HTMLElement | null = null;

  /**
   * 当前打开的仓库路径
   *
   * 用于刷新时重新加载 Blame 数据。
   */
  private currentRepoPath: string | null = null;

  /**
   * 当前打开的文件路径
   *
   * 用于刷新时重新加载 Blame 数据。
   */
  private currentFilePath: string | null = null;

  /**
   * 当前的 Blame 行数据
   *
   * 缓存最近一次加载的数据，便于刷新和后续操作。
   */
  private blameLines: BlameLine[] = [];

  /**
   * 提交点击回调函数
   *
   * 当用户点击某行的 commit hash 时调用，参数为提交的完整哈希。
   * 通常用于跳转到对应提交的详情视图。
   */
  private onCommitClick: ((hash: string) => void) | null;

  /**
   * 关闭回调函数
   *
   * 当视图被关闭时调用（无论是用户点击关闭按钮、按 ESC，还是调用 close() 方法）。
   * 通常用于让调用者清理对 BlameViewer 实例的引用。
   */
  private onClose: (() => void) | null;

  /**
   * ESC 键事件监听器的引用
   *
   * 用于在关闭视图时移除事件监听器，避免内存泄漏。
   */
  private escKeyListener: ((event: KeyboardEvent) => void) | null = null;

  /**
   * 创建 Blame 视图组件实例
   *
   * @param onCommitClick - 提交点击回调，参数为提交哈希（可选）
   * @param onClose - 关闭回调（可选）
   */
  constructor(
    onCommitClick?: (hash: string) => void,
    onClose?: () => void,
  ) {
    this.onCommitClick = onCommitClick || null;
    this.onClose = onClose || null;
  }

  /**
   * 打开 Blame 视图
   *
   * 加载指定文件的 Blame 数据并以模态浮层显示。
   * 如果已经有视图打开，会先关闭旧视图再打开新视图。
   *
   * 实现步骤：
   * 1. 保存仓库路径和文件路径（用于后续刷新）
   * 2. 创建模态遮罩层和视图 DOM 结构
   * 3. 显示"加载中"提示
   * 4. 调用 repoService.getBlame 获取数据
   * 5. 渲染 Blame 行列表
   * 6. 绑定事件（关闭按钮、ESC 键、行点击）
   *
   * @param repoPath - 仓库路径
   * @param filePath - 文件路径（相对于仓库根目录）
   */
  async open(repoPath: string, filePath: string): Promise<void> {
    // 保存当前路径，用于后续刷新
    this.currentRepoPath = repoPath;
    this.currentFilePath = filePath;

    // 如果已经有视图打开，先关闭
    if (this.overlay) {
      this.close();
    }

    // 创建并显示视图骨架（立即显示，给用户即时反馈）
    this.createViewSkeleton(filePath);

    // 绑定事件（关闭按钮、ESC 键）
    this.bindEvents();

    // 显示加载中提示
    this.showLoading();

    try {
      // 调用后端获取 Blame 数据
      this.blameLines = await repoService.getBlame(repoPath, filePath);

      // 渲染 Blame 行列表
      this.renderBlameLines();
    } catch (err) {
      // 加载失败，显示错误信息
      console.error('[BlameViewer] 加载 Blame 数据失败:', err);
      this.showError(String(err));
    }
  }

  /**
   * 关闭 Blame 视图
   *
   * 从 DOM 中移除视图元素，并清理事件监听器。
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
    this.contentContainer = null;
    this.infoElement = null;

    // 调用关闭回调
    if (this.onClose) {
      this.onClose();
    }
  }

  /**
   * 刷新 Blame 数据
   *
   * 重新调用后端获取最新数据并重新渲染。
   * 通常在文件被修改后调用。
   */
  async refresh(): Promise<void> {
    if (!this.currentRepoPath || !this.currentFilePath) {
      return;
    }

    // 显示加载中提示
    this.showLoading();

    try {
      // 重新获取数据
      this.blameLines = await repoService.getBlame(
        this.currentRepoPath,
        this.currentFilePath,
      );

      // 重新渲染
      this.renderBlameLines();
    } catch (err) {
      console.error('[BlameViewer] 刷新 Blame 数据失败:', err);
      this.showError(String(err));
    }
  }

  /* ============================================================
   * 内部方法：DOM 创建与渲染
   * ============================================================ */

  /**
   * 创建视图骨架
   *
   * 创建模态遮罩层和视图主体结构，包括：
   * - 标题栏（文件名 + 关闭按钮）
   * - 工具栏（刷新按钮）
   * - 内容区（空容器，等待数据加载后填充）
   *
   * 创建后立即将遮罩层添加到 document.body，让用户看到浮层。
   *
   * @param filePath - 文件路径（用于标题栏显示）
   */
  private createViewSkeleton(filePath: string): void {
    // 创建遮罩层
    this.overlay = document.createElement('div');
    this.overlay.className = 'blame-viewer-overlay';

    // 创建视图主容器
    const container: HTMLElement = document.createElement('div');
    container.className = 'blame-viewer-container';

    // 创建标题栏
    const header: HTMLElement = document.createElement('div');
    header.className = 'blame-viewer-header';

    // 标题（文件名）
    const title: HTMLElement = document.createElement('div');
    title.className = 'blame-viewer-title';
    title.textContent = `Blame: ${filePath}`;
    title.title = filePath; // 鼠标悬停显示完整路径

    // 辅助信息（总行数，数据加载后更新）
    this.infoElement = document.createElement('div');
    this.infoElement.className = 'blame-viewer-info';
    this.infoElement.textContent = '加载中...';

    // 关闭按钮
    const closeBtn: HTMLElement = document.createElement('button');
    closeBtn.className = 'blame-viewer-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = '关闭 (Esc)';
    closeBtn.addEventListener('click', () => {
      this.close();
    });

    // 组装标题栏
    header.appendChild(title);
    header.appendChild(this.infoElement);
    header.appendChild(closeBtn);

    // 创建工具栏
    const toolbar: HTMLElement = document.createElement('div');
    toolbar.className = 'blame-viewer-toolbar';

    // 刷新按钮
    const refreshBtn: HTMLElement = document.createElement('button');
    refreshBtn.className = 'blame-viewer-btn';
    refreshBtn.textContent = '刷新';
    refreshBtn.title = '重新加载 Blame 数据';
    refreshBtn.addEventListener('click', () => {
      this.refresh();
    });

    // 组装工具栏
    toolbar.appendChild(refreshBtn);

    // 创建内容区容器
    this.contentContainer = document.createElement('div');
    this.contentContainer.className = 'blame-viewer-content';

    // 组装视图主体
    container.appendChild(header);
    container.appendChild(toolbar);
    container.appendChild(this.contentContainer);

    // 将视图主体添加到遮罩层
    this.overlay.appendChild(container);

    // 将遮罩层添加到 document.body
    document.body.appendChild(this.overlay);
  }

  /**
   * 显示加载中提示
   *
   * 在内容区显示"加载中..."文字。
   */
  private showLoading(): void {
    if (!this.contentContainer) return;

    this.contentContainer.innerHTML = '';
    const loading: HTMLElement = document.createElement('div');
    loading.className = 'blame-viewer-loading';
    loading.textContent = '正在加载 Blame 数据...';
    this.contentContainer.appendChild(loading);
  }

  /**
   * 显示错误信息
   *
   * 在内容区显示错误提示框。
   *
   * @param message - 错误信息文本
   */
  private showError(message: string): void {
    if (!this.contentContainer) return;

    this.contentContainer.innerHTML = '';
    const errorBox: HTMLElement = document.createElement('div');
    errorBox.className = 'blame-viewer-error';
    errorBox.textContent = `加载 Blame 数据失败: ${message}`;
    this.contentContainer.appendChild(errorBox);

    // 更新信息标签
    if (this.infoElement) {
      this.infoElement.textContent = '加载失败';
    }
  }

  /**
   * 渲染 Blame 行列表
   *
   * 将 BlameLine 数组渲染为 DOM 元素并显示在内容区。
   *
   * 渲染逻辑：
   * 1. 如果数据为空，显示"无 Blame 数据"提示
   * 2. 为每行创建一个 .blame-line 元素，包含三个子元素：
   *    - .blame-line-number：行号
   *    - .blame-line-info：commit hash + author + date
   *    - .blame-line-content：代码内容
   * 3. 根据 commit hash 分配颜色（同一 commit 的连续行使用相同背景色）
   * 4. 边界提交（is_boundary=true）添加 .boundary 类
   * 5. 点击行号或 commit hash 时触发 onCommitClick 回调
   *
   * 颜色分配算法：
   * - 维护一个 hash → colorIndex 的映射
   * 遇到新的 hash 时，从颜色调色板中按顺序选择下一个颜色
   * - 颜色循环使用（8 种颜色循环）
   */
  private renderBlameLines(): void {
    if (!this.contentContainer) return;

    // 清空内容区
    this.contentContainer.innerHTML = '';

    // 如果数据为空，显示空状态提示
    if (this.blameLines.length === 0) {
      const empty: HTMLElement = document.createElement('div');
      empty.className = 'blame-viewer-empty';
      empty.textContent = '无 Blame 数据（文件可能为空或不存在）';
      this.contentContainer.appendChild(empty);

      // 更新信息标签
      if (this.infoElement) {
        this.infoElement.textContent = '0 行';
      }
      return;
    }

    // 更新信息标签（显示总行数）
    if (this.infoElement) {
      this.infoElement.textContent = `${this.blameLines.length} 行`;
    }

    // 创建文档片段，批量添加 DOM 元素（提高性能）
    const fragment: DocumentFragment = document.createDocumentFragment();

    // commit hash → 颜色索引的映射
    // 同一 commit 的所有行使用相同的背景色
    const hashColorMap: Map<string, number> = new Map();
    // 下一个可用的颜色索引（循环使用）
    let nextColorIndex: number = 0;

    // 遍历每行 Blame 数据，创建对应的 DOM 元素
    for (const line of this.blameLines) {
      // 创建行容器
      const lineElem: HTMLElement = document.createElement('div');
      lineElem.className = 'blame-line';

      // 如果是边界提交，添加 boundary 类（使用更浅的色调）
      if (line.is_boundary) {
        lineElem.classList.add('boundary');
      }

      // 为该 commit 分配颜色（如果尚未分配）
      let colorIndex: number;
      if (hashColorMap.has(line.commit_hash)) {
        // 已有颜色，复用
        colorIndex = hashColorMap.get(line.commit_hash)!;
      } else {
        // 新 commit，分配下一个颜色
        colorIndex = nextColorIndex;
        hashColorMap.set(line.commit_hash, colorIndex);
        // 颜色索引循环递增（mod 颜色数组长度）
        nextColorIndex = (nextColorIndex + 1) % COMMIT_COLORS.length;
      }

      // 创建行号列
      const lineNumber: HTMLElement = document.createElement('div');
      lineNumber.className = 'blame-line-number';
      lineNumber.textContent = String(line.line_number);

      // 创建 commit 信息列
      const lineInfo: HTMLElement = document.createElement('div');
      lineInfo.className = 'blame-line-info';
      // 设置背景色（根据 commit hash 分配的颜色）
      lineInfo.style.backgroundColor = COMMIT_COLORS[colorIndex];

      // commit 短哈希（可点击跳转）
      const hashElem: HTMLElement = document.createElement('div');
      hashElem.className = 'blame-line-hash';
      hashElem.textContent = line.short_hash;
      hashElem.title = `提交哈希: ${line.commit_hash}\n点击查看提交详情`;
      // 鼠标指针提示可点击
      hashElem.style.cursor = 'pointer';
      // 点击 hash 跳转到提交详情
      hashElem.addEventListener('click', (event: MouseEvent) => {
        event.stopPropagation();
        if (this.onCommitClick) {
          this.onCommitClick(line.commit_hash);
        }
      });

      // 作者名字
      const authorElem: HTMLElement = document.createElement('div');
      authorElem.className = 'blame-line-author';
      authorElem.textContent = line.author;
      authorElem.title = `作者: ${line.author} <${line.author_email}>`;

      // 日期（格式化为本地时间）
      const dateElem: HTMLElement = document.createElement('div');
      dateElem.className = 'blame-line-date';
      dateElem.textContent = this.formatDate(line.author_date);
      dateElem.title = `作者日期: ${this.formatDate(line.author_date)}\n提交者: ${line.committer} <${line.committer_email}>\n提交者日期: ${this.formatDate(line.committer_date)}`;

      // 组装 commit 信息列
      lineInfo.appendChild(hashElem);
      lineInfo.appendChild(authorElem);
      lineInfo.appendChild(dateElem);

      // 创建代码内容列
      const lineContent: HTMLElement = document.createElement('div');
      lineContent.className = 'blame-line-content';
      // 使用 textContent 避免 XSS（代码内容可能包含 HTML 字符）
      lineContent.textContent = line.line_content;

      // 组装行
      lineElem.appendChild(lineNumber);
      lineElem.appendChild(lineInfo);
      lineElem.appendChild(lineContent);

      // 整行点击也可以跳转（除了点击关闭按钮等特定区域）
      lineElem.addEventListener('click', () => {
        if (this.onCommitClick) {
          this.onCommitClick(line.commit_hash);
        }
      });

      // 添加到文档片段
      fragment.appendChild(lineElem);
    }

    // 一次性添加所有行到内容区
    this.contentContainer.appendChild(fragment);
  }

  /**
   * 格式化日期字符串
   *
   * 将 ISO 8601 UTC 格式（如 "2024-01-15T08:30:00Z"）
   * 转换为本地化的可读格式（如 "2024-01-15 16:30"）。
   *
   * @param isoDate - ISO 8601 格式的日期字符串
   * @returns 格式化后的日期字符串；如果解析失败则返回原字符串
   */
  private formatDate(isoDate: string): string {
    try {
      // 使用 Date 对象解析 ISO 8601 字符串
      const date: Date = new Date(isoDate);

      // 检查解析是否成功（Invalid Date 时 getTime() 返回 NaN）
      if (isNaN(date.getTime())) {
        return isoDate;
      }

      // 格式化为 YYYY-MM-DD HH:MM（本地时间）
      const year: number = date.getFullYear();
      const month: string = String(date.getMonth() + 1).padStart(2, '0');
      const day: string = String(date.getDate()).padStart(2, '0');
      const hours: string = String(date.getHours()).padStart(2, '0');
      const minutes: string = String(date.getMinutes()).padStart(2, '0');

      return `${year}-${month}-${day} ${hours}:${minutes}`;
    } catch {
      // 解析失败，返回原字符串
      return isoDate;
    }
  }

  /* ============================================================
   * 内部方法：事件绑定
   * ============================================================ */

  /**
   * 绑定事件
   *
   * 绑定以下事件：
   * 1. ESC 键关闭视图
   * 2. 点击遮罩层空白区域不关闭（避免误操作丢失视图）
   *    （点击关闭按钮的事件在 createViewSkeleton 中绑定）
   */
  private bindEvents(): void {
    if (!this.overlay) return;

    // ESC 键关闭视图
    this.escKeyListener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.close();
      }
    };
    document.addEventListener('keydown', this.escKeyListener);

    // 点击遮罩层空白区域不关闭（与对话框不同，Blame 视图不响应遮罩点击）
    // 这里不做任何处理，保持视图打开
  }
}

/**
 * Blame 视图全局单例
 *
 * 整个应用只维护一个 BlameViewer 实例，避免重复创建。
 * 由 app.ts 在初始化时调用 setBlameViewerCallbacks 注入回调。
 *
 * 使用方式：
 *   // 在 app.ts 中初始化
 *   setBlameViewerCallbacks(
 *     (hash) => this.showCommitDetailByHash(hash),
 *     () => { this.blameViewerOpen = false; }
 *   );
 *
 *   // 在文件右键菜单中触发
 *   blameViewer.open(repoPath, filePath);
 */
export const blameViewer: BlameViewer = new BlameViewer();

/**
 * 设置 Blame 视图的回调函数
 *
 * 由 app.ts 在初始化时调用，注入提交点击和关闭的回调。
 *
 * @param onCommitClick - 提交点击回调，参数为提交哈希
 * @param onClose - 关闭回调
 */
export function setBlameViewerCallbacks(
  onCommitClick: (hash: string) => void,
  onClose: () => void,
): void {
  // 直接修改 blameViewer 实例的私有属性（通过 as any 绕过 TypeScript 检查）
  // 这种方式比重新创建实例更简单，且能保持已有的引用
  (blameViewer as unknown as {
    onCommitClick: ((hash: string) => void) | null;
    onClose: (() => void) | null;
  }).onCommitClick = onCommitClick;
  (blameViewer as unknown as {
    onClose: (() => void) | null;
  }).onClose = onClose;
}
