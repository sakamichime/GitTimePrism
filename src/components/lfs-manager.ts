/**
 * LFS 管理组件（阶段 9：Task 9.4）
 *
 * 提供 Git LFS（Large File Storage）的管理功能，包括：
 * - LFS 状态概览（是否已初始化、跟踪的文件类型列表）
 * - 添加/移除 LFS 跟踪规则（git lfs track / untrack）
 * - 查看 LFS 文件锁列表（git lfs locks）
 * - 拉取/推送 LFS 对象（git lfs pull / push）
 *
 * 使用模态对话框形式展示，点击工具栏的"LFS"按钮后弹出
 */

import { repoService, type LfsPattern, type LfsLock } from '../services/repo-service.js';

/**
 * LFS 管理组件类
 *
 * 负责创建和管理 LFS 管理的模态对话框 UI
 */
export class LfsManager {
  /** 当前仓库路径 */
  private repoPath: string;
  /** 操作成功后的回调函数（用于刷新主界面） */
  private onSuccess: () => void;
  /** 模态对话框的 DOM 容器 */
  private overlay: HTMLElement | null = null;
  /** LFS 跟踪规则列表 */
  private patterns: LfsPattern[] = [];
  /** LFS 文件锁列表 */
  private locks: LfsLock[] = [];

  /**
   * 构造函数
   *
   * @param repoPath - 当前仓库的路径
   * @param onSuccess - LFS 操作成功后的回调函数
   */
  constructor(repoPath: string, onSuccess: () => void) {
    this.repoPath = repoPath;
    this.onSuccess = onSuccess;
  }

  /**
   * 显示 LFS 管理对话框
   *
   * 创建模态对话框并加载 LFS 数据
   */
  async show(): Promise<void> {
    // 创建模态对话框的 DOM 结构
    this.createOverlay();
    // 加载 LFS 跟踪规则和文件锁
    await this.loadLfsData();
  }

  /**
   * 创建模态对话框的 DOM 结构
   *
   * 包含遮罩层、对话框容器、LFS 状态、跟踪规则、文件锁等
   */
  private createOverlay(): void {
    // 创建遮罩层（覆盖整个窗口）
    this.overlay = document.createElement('div');
    this.overlay.className = 'lfs-manager-overlay';

    // 创建对话框容器
    this.overlay.innerHTML = `
      <div class="lfs-manager-dialog">
        <!-- 对话框头部：标题和关闭按钮 -->
        <div class="lfs-manager-header">
          <h2 class="lfs-manager-title">LFS 管理</h2>
          <!-- Task 8.3：右上角 X 关闭按钮，添加 close-icon-btn 类统一样式 -->
          <button class="lfs-manager-close-btn close-icon-btn" id="lfs-manager-close" title="关闭">✕</button>
        </div>

        <!-- 对话框主体 -->
        <div class="lfs-manager-body">
          <!-- LFS 操作按钮区 -->
          <div class="lfs-manager-section">
            <div class="lfs-manager-actions">
              <button class="btn btn-primary" id="btn-lfs-install">初始化 LFS</button>
              <button class="btn" id="btn-lfs-pull">拉取 LFS 对象</button>
              <button class="btn" id="btn-lfs-push">推送 LFS 对象</button>
            </div>
          </div>

          <!-- LFS 跟踪规则区 -->
          <div class="lfs-manager-section">
            <h3 class="lfs-manager-section-title">跟踪规则</h3>
            <div class="lfs-pattern-list" id="lfs-pattern-list">
              <p class="lfs-manager-loading">加载中...</p>
            </div>

            <!-- 添加跟踪规则表单 -->
            <form class="lfs-track-form" id="lfs-track-form">
              <div class="form-group lfs-track-form-group">
                <input type="text" class="form-input" id="lfs-track-pattern" placeholder='例如：*.psd' required>
                <button type="submit" class="btn btn-primary">添加跟踪</button>
              </div>
            </form>
          </div>

          <!-- LFS 文件锁区 -->
          <div class="lfs-manager-section">
            <h3 class="lfs-manager-section-title">文件锁</h3>
            <div class="lfs-lock-list" id="lfs-lock-list">
              <p class="lfs-manager-loading">加载中...</p>
            </div>
          </div>
        </div>
      </div>
    `;

    // 将对话框添加到页面
    document.body.appendChild(this.overlay);

    // 绑定事件监听器
    this.bindEvents();
  }

  /**
   * 绑定事件监听器
   *
   * 处理关闭按钮、表单提交、LFS 操作按钮等交互
   */
  private bindEvents(): void {
    if (!this.overlay) return;

    // 关闭按钮点击事件
    const closeBtn = this.overlay.querySelector('#lfs-manager-close');
    closeBtn?.addEventListener('click', () => this.close());

    // 点击遮罩层关闭对话框
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    // 初始化 LFS 按钮
    const installBtn = this.overlay.querySelector('#btn-lfs-install');
    installBtn?.addEventListener('click', () => this.handleInstall());

    // 拉取 LFS 对象按钮
    const pullBtn = this.overlay.querySelector('#btn-lfs-pull');
    pullBtn?.addEventListener('click', () => this.handlePull());

    // 推送 LFS 对象按钮
    const pushBtn = this.overlay.querySelector('#btn-lfs-push');
    pushBtn?.addEventListener('click', () => this.handlePush());

    // 添加跟踪规则表单提交事件
    const form = this.overlay.querySelector('#lfs-track-form') as HTMLFormElement;
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleTrack();
    });
  }

  /**
   * 加载 LFS 数据
   *
   * 从后端获取跟踪规则和文件锁列表
   */
  private async loadLfsData(): Promise<void> {
    // 并行加载跟踪规则和文件锁
    await Promise.all([
      this.loadPatterns(),
      this.loadLocks(),
    ]);
  }

  /**
   * 加载 LFS 跟踪规则
   */
  private async loadPatterns(): Promise<void> {
    const listContainer = this.overlay?.querySelector('#lfs-pattern-list');
    if (!listContainer) return;

    try {
      // 调用后端 API 获取跟踪规则
      this.patterns = await repoService.lfsList(this.repoPath);

      // 如果没有跟踪规则，显示提示信息
      if (this.patterns.length === 0) {
        listContainer.innerHTML = '<p class="lfs-manager-empty">暂无 LFS 跟踪规则</p>';
        return;
      }

      // 渲染跟踪规则列表
      this.renderPatternList();
    } catch (err) {
      console.error('加载 LFS 跟踪规则失败:', err);
      listContainer.innerHTML = `<p class="lfs-manager-error">加载失败: ${String(err)}</p>`;
    }
  }

  /**
   * 加载 LFS 文件锁
   */
  private async loadLocks(): Promise<void> {
    const listContainer = this.overlay?.querySelector('#lfs-lock-list');
    if (!listContainer) return;

    try {
      // 调用后端 API 获取文件锁
      this.locks = await repoService.lfsLocks(this.repoPath);

      // 如果没有文件锁，显示提示信息
      if (this.locks.length === 0) {
        listContainer.innerHTML = '<p class="lfs-manager-empty">暂无文件锁</p>';
        return;
      }

      // 渲染文件锁列表
      this.renderLockList();
    } catch (err) {
      console.error('加载 LFS 文件锁失败:', err);
      listContainer.innerHTML = `<p class="lfs-manager-error">加载失败: ${String(err)}</p>`;
    }
  }

  /**
   * 渲染跟踪规则列表
   */
  private renderPatternList(): void {
    const listContainer = this.overlay?.querySelector('#lfs-pattern-list');
    if (!listContainer) return;

    // 清空容器
    listContainer.innerHTML = '';

    // 为每个跟踪规则创建列表项
    this.patterns.forEach(p => {
      const item = document.createElement('div');
      item.className = 'lfs-pattern-item';

      // 锁定状态标记
      const lockBadge = p.isLocked
        ? '<span class="lfs-lock-badge">已锁定</span>'
        : '';

      item.innerHTML = `
        <div class="lfs-pattern-info">
          <code class="lfs-pattern-code">${this.escapeHtml(p.pattern)}</code>
          ${lockBadge}
        </div>
        <div class="lfs-pattern-actions">
          <button class="btn btn-small btn-danger btn-untrack" data-pattern="${this.escapeHtml(p.pattern)}">移除跟踪</button>
        </div>
      `;

      listContainer.appendChild(item);
    });

    // 绑定移除跟踪按钮事件
    const untrackBtns = listContainer.querySelectorAll('.btn-untrack');
    untrackBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const pattern = (btn as HTMLElement).dataset.pattern;
        if (pattern) {
          await this.handleUntrack(pattern);
        }
      });
    });
  }

  /**
   * 渲染文件锁列表
   */
  private renderLockList(): void {
    const listContainer = this.overlay?.querySelector('#lfs-lock-list');
    if (!listContainer) return;

    // 清空容器
    listContainer.innerHTML = '';

    // 为每个文件锁创建列表项
    this.locks.forEach(lock => {
      const item = document.createElement('div');
      item.className = 'lfs-lock-item';

      item.innerHTML = `
        <div class="lfs-lock-info">
          <code class="lfs-lock-path">${this.escapeHtml(lock.path)}</code>
          <span class="lfs-lock-owner">锁定者：${this.escapeHtml(lock.owner)}</span>
          <span class="lfs-lock-time">${this.escapeHtml(lock.lockedAt)}</span>
        </div>
      `;

      listContainer.appendChild(item);
    });
  }

  /**
   * 处理初始化 LFS
   */
  private async handleInstall(): Promise<void> {
    try {
      await repoService.lfsInstall(this.repoPath);
      alert('LFS 已初始化');
      this.onSuccess();
    } catch (err) {
      console.error('初始化 LFS 失败:', err);
      alert(`初始化 LFS 失败: ${String(err)}`);
    }
  }

  /**
   * 处理拉取 LFS 对象
   */
  private async handlePull(): Promise<void> {
    try {
      await repoService.lfsPull(this.repoPath);
      alert('LFS 对象拉取完成');
      this.onSuccess();
    } catch (err) {
      console.error('拉取 LFS 对象失败:', err);
      alert(`拉取 LFS 对象失败: ${String(err)}`);
    }
  }

  /**
   * 处理推送 LFS 对象
   */
  private async handlePush(): Promise<void> {
    try {
      await repoService.lfsPush(this.repoPath);
      alert('LFS 对象推送完成');
      this.onSuccess();
    } catch (err) {
      console.error('推送 LFS 对象失败:', err);
      alert(`推送 LFS 对象失败: ${String(err)}`);
    }
  }

  /**
   * 处理添加跟踪规则
   */
  private async handleTrack(): Promise<void> {
    if (!this.overlay) return;

    const input = this.overlay.querySelector('#lfs-track-pattern') as HTMLInputElement;
    const pattern = input.value.trim();

    if (!pattern) {
      alert('请输入要跟踪的文件模式');
      return;
    }

    try {
      await repoService.lfsTrack(this.repoPath, pattern);
      alert(`已添加跟踪规则: ${pattern}`);
      input.value = '';
      await this.loadPatterns();
      this.onSuccess();
    } catch (err) {
      console.error('添加 LFS 跟踪规则失败:', err);
      alert(`添加 LFS 跟踪规则失败: ${String(err)}`);
    }
  }

  /**
   * 处理移除跟踪规则
   *
   * @param pattern - 要移除的文件模式
   */
  private async handleUntrack(pattern: string): Promise<void> {
    const confirmed = confirm(`确定要移除跟踪规则 "${pattern}" 吗？`);
    if (!confirmed) return;

    try {
      await repoService.lfsUntrack(this.repoPath, pattern);
      alert(`已移除跟踪规则: ${pattern}`);
      await this.loadPatterns();
      this.onSuccess();
    } catch (err) {
      console.error('移除 LFS 跟踪规则失败:', err);
      alert(`移除 LFS 跟踪规则失败: ${String(err)}`);
    }
  }

  /**
   * 关闭对话框
   *
   * 从 DOM 中移除模态对话框
   */
  close(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  /**
   * HTML 转义
   *
   * 防止 XSS 攻击，转义特殊字符
   *
   * @param text - 要转义的文本
   * @returns 转义后的文本
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
