/**
 * 子模块管理组件（阶段 9：Task 9.2）
 *
 * 提供 Git 子模块的完整管理功能，包括：
 * - 显示仓库中所有子模块的列表（路径、URL、当前提交、差异状态）
 * - 添加新子模块（git submodule add）
 * - 初始化/更新子模块（git submodule update --init --recursive）
 * - 删除子模块（git submodule deinit + git rm）
 *
 * 使用模态对话框形式展示，点击工具栏的"子模块"按钮后弹出
 */

import { repoService, type SubmoduleInfo } from '../services/repo-service.js';

/**
 * 子模块管理组件类
 *
 * 负责创建和管理子模块管理的模态对话框 UI
 */
export class SubmoduleManager {
  /** 当前仓库路径 */
  private repoPath: string;
  /** 操作成功后的回调函数（用于刷新主界面） */
  private onSuccess: () => void;
  /** 模态对话框的 DOM 容器 */
  private overlay: HTMLElement | null = null;
  /** 子模块列表数据 */
  private submodules: SubmoduleInfo[] = [];

  /**
   * 构造函数
   *
   * @param repoPath - 当前仓库的路径
   * @param onSuccess - 子模块操作成功后的回调函数
   */
  constructor(repoPath: string, onSuccess: () => void) {
    this.repoPath = repoPath;
    this.onSuccess = onSuccess;
  }

  /**
   * 显示子模块管理对话框
   *
   * 创建模态对话框并加载子模块列表
   */
  async show(): Promise<void> {
    // 创建模态对话框的 DOM 结构
    this.createOverlay();
    // 加载子模块列表
    await this.loadSubmodules();
  }

  /**
   * 创建模态对话框的 DOM 结构
   *
   * 包含遮罩层、对话框容器、子模块列表、添加表单等
   */
  private createOverlay(): void {
    // 创建遮罩层（覆盖整个窗口）
    this.overlay = document.createElement('div');
    this.overlay.className = 'submodule-manager-overlay';

    // 创建对话框容器
    this.overlay.innerHTML = `
      <div class="submodule-manager-dialog">
        <!-- 对话框头部：标题和关闭按钮 -->
        <div class="submodule-manager-header">
          <h2 class="submodule-manager-title">子模块管理</h2>
          <button class="submodule-manager-close-btn" id="submodule-manager-close">&times;</button>
        </div>

        <!-- 对话框主体：子模块列表和操作按钮 -->
        <div class="submodule-manager-body">
          <!-- 子模块列表区域 -->
          <div class="submodule-manager-section">
            <div class="submodule-manager-section-header">
              <h3 class="submodule-manager-section-title">现有子模块</h3>
              <button class="btn btn-small btn-primary" id="btn-update-all-submodules" title="初始化并递归更新所有子模块">更新所有子模块</button>
            </div>
            <div class="submodule-list" id="submodule-list">
              <p class="submodule-manager-loading">加载中...</p>
            </div>
          </div>

          <!-- 添加子模块表单 -->
          <div class="submodule-manager-section">
            <h3 class="submodule-manager-section-title">添加新子模块</h3>
            <form class="submodule-create-form" id="submodule-create-form">
              <div class="form-group">
                <label class="form-label" for="submodule-url">远程仓库 URL</label>
                <input type="text" class="form-input" id="submodule-url" placeholder="例如：https://github.com/user/repo.git" required>
              </div>

              <div class="form-group">
                <label class="form-label" for="submodule-path">本地路径</label>
                <input type="text" class="form-input" id="submodule-path" placeholder="例如：vendor/lib（留空则使用仓库名）">
              </div>

              <div class="form-group">
                <label class="form-label" for="submodule-branch">跟踪分支</label>
                <input type="text" class="form-input" id="submodule-branch" placeholder="留空则使用默认分支">
              </div>

              <button type="submit" class="btn btn-primary" id="btn-add-submodule">添加子模块</button>
            </form>
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
   * 处理关闭按钮、表单提交、更新所有子模块等交互
   */
  private bindEvents(): void {
    if (!this.overlay) return;

    // 关闭按钮点击事件
    const closeBtn = this.overlay.querySelector('#submodule-manager-close');
    closeBtn?.addEventListener('click', () => this.close());

    // 点击遮罩层关闭对话框
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    // 更新所有子模块按钮
    const updateAllBtn = this.overlay.querySelector('#btn-update-all-submodules');
    updateAllBtn?.addEventListener('click', () => this.handleUpdateAll());

    // 添加子模块表单提交事件
    const form = this.overlay.querySelector('#submodule-create-form') as HTMLFormElement;
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleAddSubmodule();
    });
  }

  /**
   * 加载子模块列表
   *
   * 从后端获取所有子模块信息并渲染到列表中
   */
  private async loadSubmodules(): Promise<void> {
    const listContainer = this.overlay?.querySelector('#submodule-list');
    if (!listContainer) return;

    try {
      // 调用后端 API 获取子模块列表
      this.submodules = await repoService.listSubmodules(this.repoPath);

      // 如果没有子模块，显示提示信息
      if (this.submodules.length === 0) {
        listContainer.innerHTML = '<p class="submodule-manager-empty">暂无子模块</p>';
        return;
      }

      // 渲染子模块列表
      this.renderSubmoduleList();
    } catch (err) {
      console.error('加载子模块列表失败:', err);
      listContainer.innerHTML = `<p class="submodule-manager-error">加载失败: ${String(err)}</p>`;
    }
  }

  /**
   * 渲染子模块列表
   *
   * 将子模块数据转换为 DOM 元素显示
   */
  private renderSubmoduleList(): void {
    const listContainer = this.overlay?.querySelector('#submodule-list');
    if (!listContainer) return;

    // 清空容器
    listContainer.innerHTML = '';

    // 为每个子模块创建列表项
    this.submodules.forEach(sub => {
      const item = document.createElement('div');
      item.className = 'submodule-item';

      // 子模块状态标记（根据 status 字段显示不同样式）
      const statusBadge = this.getStatusBadge(sub.status, sub.isInitialized);

      // 子模块项内容
      item.innerHTML = `
        <div class="submodule-item-info">
          <div class="submodule-item-path">${this.escapeHtml(sub.path)}</div>
          <div class="submodule-item-url">${this.escapeHtml(sub.url)}</div>
          <div class="submodule-item-meta">
            <span class="submodule-item-commit">${sub.shortCommit}</span>
            ${sub.branch ? `<span class="submodule-item-branch">${this.escapeHtml(sub.branch)}</span>` : ''}
            ${statusBadge}
          </div>
        </div>
        <div class="submodule-item-actions">
          <button class="btn btn-small btn-update" data-submodule-path="${this.escapeHtml(sub.path)}" title="更新此子模块">更新</button>
          <button class="btn btn-small btn-danger btn-delete" data-submodule-path="${this.escapeHtml(sub.path)}">删除</button>
        </div>
      `;

      listContainer.appendChild(item);
    });

    // 绑定更新和删除按钮的事件
    this.bindSubmoduleActions();
  }

  /**
   * 获取子模块状态标记的 HTML
   *
   * @param status - 状态字符（空格/+/-/U）
   * @param isInitialized - 是否已初始化
   * @returns 状态标记 HTML
   */
  private getStatusBadge(status: string, isInitialized: boolean): string {
    if (!isInitialized || status === '-') {
      return '<span class="submodule-status-badge submodule-status-uninitialized">未初始化</span>';
    }
    if (status === '+') {
      return '<span class="submodule-status-badge submodule-status-modified">已修改</span>';
    }
    if (status === 'U') {
      return '<span class="submodule-status-badge submodule-status-conflict">合并冲突</span>';
    }
    return '<span class="submodule-status-badge submodule-status-ok">正常</span>';
  }

  /**
   * 绑定子模块操作按钮的事件
   *
   * 处理更新子模块和删除子模块的点击事件
   */
  private bindSubmoduleActions(): void {
    if (!this.overlay) return;

    // 更新子模块按钮
    const updateBtns = this.overlay.querySelectorAll('.btn-update');
    updateBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const path = (btn as HTMLElement).dataset.submodulePath;
        if (path) {
          await this.handleUpdateSubmodule(path);
        }
      });
    });

    // 删除子模块按钮
    const deleteBtns = this.overlay.querySelectorAll('.btn-delete');
    deleteBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const path = (btn as HTMLElement).dataset.submodulePath;
        if (path) {
          await this.handleDeleteSubmodule(path);
        }
      });
    });
  }

  /**
   * 处理添加子模块
   *
   * 从表单获取数据，调用后端 API 添加子模块
   */
  private async handleAddSubmodule(): Promise<void> {
    if (!this.overlay) return;

    // 获取表单数据
    const urlInput = this.overlay.querySelector('#submodule-url') as HTMLInputElement;
    const pathInput = this.overlay.querySelector('#submodule-path') as HTMLInputElement;
    const branchInput = this.overlay.querySelector('#submodule-branch') as HTMLInputElement;

    const url = urlInput.value.trim();
    const path = pathInput.value.trim();
    const branch = branchInput.value.trim();

    // 验证输入
    if (!url) {
      alert('请输入远程仓库 URL');
      return;
    }

    try {
      // 禁用按钮，防止重复提交
      const submitBtn = this.overlay.querySelector('#btn-add-submodule') as HTMLButtonElement;
      submitBtn.disabled = true;
      submitBtn.textContent = '添加中...';

      // 调用后端 API 添加子模块
      await repoService.addSubmodule(this.repoPath, url, path, branch);

      // 添加成功提示
      alert('子模块添加成功！');

      // 清空表单
      urlInput.value = '';
      pathInput.value = '';
      branchInput.value = '';

      // 重新加载子模块列表
      await this.loadSubmodules();

      // 触发成功回调，刷新主界面
      this.onSuccess();
    } catch (err) {
      console.error('添加子模块失败:', err);
      alert(`添加子模块失败: ${String(err)}`);
    } finally {
      // 恢复按钮状态
      const submitBtn = this.overlay?.querySelector('#btn-add-submodule') as HTMLButtonElement;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '添加子模块';
      }
    }
  }

  /**
   * 处理更新所有子模块
   *
   * 执行 git submodule update --init --recursive
   */
  private async handleUpdateAll(): Promise<void> {
    try {
      // 确认对话框
      const confirmed = confirm('确定要初始化并递归更新所有子模块吗？\n这将执行 git submodule update --init --recursive');
      if (!confirmed) return;

      // 调用后端 API 更新所有子模块
      await repoService.updateSubmodules(this.repoPath);

      // 更新成功提示
      alert('所有子模块已更新');

      // 重新加载子模块列表
      await this.loadSubmodules();

      // 触发成功回调，刷新主界面
      this.onSuccess();
    } catch (err) {
      console.error('更新所有子模块失败:', err);
      alert(`更新所有子模块失败: ${String(err)}`);
    }
  }

  /**
   * 处理更新单个子模块
   *
   * @param path - 要更新的子模块路径
   */
  private async handleUpdateSubmodule(path: string): Promise<void> {
    try {
      // 调用后端 API 更新所有子模块（后端暂不支持单个更新，统一执行 update --init）
      await repoService.updateSubmodules(this.repoPath);

      // 更新成功提示
      alert(`子模块 "${path}" 已更新`);

      // 重新加载子模块列表
      await this.loadSubmodules();

      // 触发成功回调，刷新主界面
      this.onSuccess();
    } catch (err) {
      console.error('更新子模块失败:', err);
      alert(`更新子模块失败: ${String(err)}`);
    }
  }

  /**
   * 处理删除子模块
   *
   * 确认后调用后端 API 删除子模块
   *
   * @param path - 要删除的子模块路径
   */
  private async handleDeleteSubmodule(path: string): Promise<void> {
    // 确认对话框
    const confirmed = confirm(`确定要删除子模块 "${path}" 吗？\n此操作将执行 git submodule deinit + git rm，不可撤销。`);
    if (!confirmed) return;

    try {
      // 调用后端 API 删除子模块
      await repoService.deleteSubmodule(this.repoPath, path);

      // 删除成功提示
      alert(`子模块 "${path}" 已删除`);

      // 重新加载子模块列表
      await this.loadSubmodules();

      // 触发成功回调，刷新主界面
      this.onSuccess();
    } catch (err) {
      console.error('删除子模块失败:', err);
      alert(`删除子模块失败: ${String(err)}`);
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
