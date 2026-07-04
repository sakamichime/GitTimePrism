/**
 * 标签管理组件
 * 
 * 提供 Git 标签的完整管理功能，包括：
 * - 显示仓库中所有标签的列表（名称、类型、对应提交）
 * - 创建新标签（支持轻量标签和附注标签两种类型）
 * - 删除现有标签
 * - 切换到指定标签（checkout）
 * 
 * 使用模态对话框形式展示，点击工具栏的"标签"按钮后弹出
 */

import { repoService, type TagInfo } from '../services/repo-service.js';

/**
 * 标签管理组件类
 * 
 * 负责创建和管理标签管理的模态对话框 UI
 */
export class TagManager {
  /** 当前仓库路径 */
  private repoPath: string;
  /** 操作成功后的回调函数（用于刷新主界面） */
  private onSuccess: () => void;
  /** 模态对话框的 DOM 容器 */
  private overlay: HTMLElement | null = null;
  /** 标签列表数据 */
  private tags: TagInfo[] = [];

  /**
   * 构造函数
   * 
   * @param repoPath - 当前仓库的路径
   * @param onSuccess - 标签操作成功后的回调函数
   */
  constructor(repoPath: string, onSuccess: () => void) {
    this.repoPath = repoPath;
    this.onSuccess = onSuccess;
  }

  /**
   * 显示标签管理对话框
   * 
   * 创建模态对话框并加载标签列表
   */
  async show(): Promise<void> {
    // 创建模态对话框的 DOM 结构
    this.createOverlay();
    // 加载标签列表
    await this.loadTags();
  }

  /**
   * 创建模态对话框的 DOM 结构
   * 
   * 包含遮罩层、对话框容器、标签列表、创建表单等
   */
  private createOverlay(): void {
    // 创建遮罩层（覆盖整个窗口）
    this.overlay = document.createElement('div');
    this.overlay.className = 'tag-manager-overlay';
    
    // 创建对话框容器
    this.overlay.innerHTML = `
      <div class="tag-manager-dialog">
        <!-- 对话框头部：标题和关闭按钮 -->
        <div class="tag-manager-header">
          <h2 class="tag-manager-title">标签管理</h2>
          <button class="tag-manager-close-btn" id="tag-manager-close">&times;</button>
        </div>
        
        <!-- 对话框主体：标签列表和创建表单 -->
        <div class="tag-manager-body">
          <!-- 标签列表区域 -->
          <div class="tag-manager-section">
            <h3 class="tag-manager-section-title">现有标签</h3>
            <div class="tag-list" id="tag-list">
              <p class="tag-manager-loading">加载中...</p>
            </div>
          </div>
          
          <!-- 创建标签表单 -->
          <div class="tag-manager-section">
            <h3 class="tag-manager-section-title">创建新标签</h3>
            <form class="tag-create-form" id="tag-create-form">
              <div class="form-group">
                <label class="form-label" for="tag-name">标签名称</label>
                <input type="text" class="form-input" id="tag-name" placeholder="例如：v1.0.0" required>
              </div>
              
              <div class="form-group">
                <label class="form-label" for="tag-commit">提交哈希</label>
                <input type="text" class="form-input" id="tag-commit" placeholder="留空则使用 HEAD" value="HEAD">
              </div>
              
              <div class="form-group">
                <label class="form-label" for="tag-mode">标签类型</label>
                <select class="form-select" id="tag-mode">
                  <option value="lightweight">轻量标签 (lightweight)</option>
                  <option value="annotated">附注标签 (annotated)</option>
                </select>
              </div>
              
              <div class="form-group" id="tag-message-group" style="display: none;">
                <label class="form-label" for="tag-message">标签消息</label>
                <textarea class="form-textarea" id="tag-message" placeholder="输入标签说明（仅附注标签需要）" rows="3"></textarea>
              </div>
              
              <button type="submit" class="btn btn-primary" id="btn-create-tag">创建标签</button>
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
   * 处理关闭按钮、表单提交、标签类型切换等交互
   */
  private bindEvents(): void {
    if (!this.overlay) return;

    // 关闭按钮点击事件
    const closeBtn = this.overlay.querySelector('#tag-manager-close');
    closeBtn?.addEventListener('click', () => this.close());

    // 点击遮罩层关闭对话框
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    // 标签类型切换事件（显示/隐藏消息输入框）
    const modeSelect = this.overlay.querySelector('#tag-mode') as HTMLSelectElement;
    const messageGroup = this.overlay.querySelector('#tag-message-group') as HTMLElement;
    
    modeSelect?.addEventListener('change', () => {
      if (modeSelect.value === 'annotated') {
        messageGroup.style.display = 'block';
      } else {
        messageGroup.style.display = 'none';
      }
    });

    // 创建标签表单提交事件
    const form = this.overlay.querySelector('#tag-create-form') as HTMLFormElement;
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleCreateTag();
    });
  }

  /**
   * 加载标签列表
   * 
   * 从后端获取所有标签信息并渲染到列表中
   */
  private async loadTags(): Promise<void> {
    const listContainer = this.overlay?.querySelector('#tag-list');
    if (!listContainer) return;

    try {
      // 调用后端 API 获取标签列表
      this.tags = await repoService.getTags(this.repoPath);
      
      // 如果没有标签，显示提示信息
      if (this.tags.length === 0) {
        listContainer.innerHTML = '<p class="tag-manager-empty">暂无标签</p>';
        return;
      }
      
      // 渲染标签列表
      this.renderTagList();
    } catch (err) {
      console.error('加载标签列表失败:', err);
      listContainer.innerHTML = `<p class="tag-manager-error">加载失败: ${String(err)}</p>`;
    }
  }

  /**
   * 渲染标签列表
   * 
   * 将标签数据转换为 DOM 元素显示
   */
  private renderTagList(): void {
    const listContainer = this.overlay?.querySelector('#tag-list');
    if (!listContainer) return;

    // 清空容器
    listContainer.innerHTML = '';

    // 为每个标签创建列表项
    this.tags.forEach(tag => {
      const item = document.createElement('div');
      item.className = 'tag-item';
      
      // 标签类型标记（附注标签显示特殊样式）
      const typeBadge = tag.is_annotated 
        ? '<span class="tag-type-badge tag-type-annotated">附注</span>'
        : '<span class="tag-type-badge tag-type-lightweight">轻量</span>';
      
      // 标签项内容
      item.innerHTML = `
        <div class="tag-item-info">
          <span class="tag-item-name">${this.escapeHtml(tag.name)}</span>
          ${typeBadge}
        </div>
        <div class="tag-item-commit">${tag.commit.substring(0, 7)}</div>
        <div class="tag-item-actions">
          <button class="btn btn-small btn-checkout" data-tag-name="${this.escapeHtml(tag.name)}">切换</button>
          <button class="btn btn-small btn-danger btn-delete" data-tag-name="${this.escapeHtml(tag.name)}">删除</button>
        </div>
      `;
      
      listContainer.appendChild(item);
    });

    // 绑定切换和删除按钮的事件
    this.bindTagActions();
  }

  /**
   * 绑定标签操作按钮的事件
   * 
   * 处理切换标签和删除标签的点击事件
   */
  private bindTagActions(): void {
    if (!this.overlay) return;

    // 切换标签按钮
    const checkoutBtns = this.overlay.querySelectorAll('.btn-checkout');
    checkoutBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const tagName = (btn as HTMLElement).dataset.tagName;
        if (tagName) {
          await this.handleCheckoutTag(tagName);
        }
      });
    });

    // 删除标签按钮
    const deleteBtns = this.overlay.querySelectorAll('.btn-delete');
    deleteBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const tagName = (btn as HTMLElement).dataset.tagName;
        if (tagName) {
          await this.handleDeleteTag(tagName);
        }
      });
    });
  }

  /**
   * 处理创建标签
   * 
   * 从表单获取数据，调用后端 API 创建标签
   */
  private async handleCreateTag(): Promise<void> {
    if (!this.overlay) return;

    // 获取表单数据
    const nameInput = this.overlay.querySelector('#tag-name') as HTMLInputElement;
    const commitInput = this.overlay.querySelector('#tag-commit') as HTMLInputElement;
    const modeSelect = this.overlay.querySelector('#tag-mode') as HTMLSelectElement;
    const messageInput = this.overlay.querySelector('#tag-message') as HTMLTextAreaElement;

    const tagName = nameInput.value.trim();
    const commit = commitInput.value.trim() || 'HEAD';
    const mode = modeSelect.value;
    const message = messageInput.value.trim();

    // 验证输入
    if (!tagName) {
      alert('请输入标签名称');
      return;
    }

    // 附注标签必须有消息
    if (mode === 'annotated' && !message) {
      alert('附注标签必须填写标签消息');
      return;
    }

    try {
      // 禁用按钮，防止重复提交
      const submitBtn = this.overlay.querySelector('#btn-create-tag') as HTMLButtonElement;
      submitBtn.disabled = true;
      submitBtn.textContent = '创建中...';

      // 调用后端 API 创建标签
      await repoService.createTag(this.repoPath, tagName, commit, mode, message);
      
      // 创建成功提示
      alert(`标签 "${tagName}" 创建成功！`);
      
      // 清空表单
      nameInput.value = '';
      commitInput.value = 'HEAD';
      messageInput.value = '';
      
      // 重新加载标签列表
      await this.loadTags();
      
      // 触发成功回调，刷新主界面
      this.onSuccess();
    } catch (err) {
      console.error('创建标签失败:', err);
      alert(`创建标签失败: ${String(err)}`);
    } finally {
      // 恢复按钮状态
      const submitBtn = this.overlay?.querySelector('#btn-create-tag') as HTMLButtonElement;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '创建标签';
      }
    }
  }

  /**
   * 处理删除标签
   * 
   * 确认后调用后端 API 删除标签
   * 
   * @param tagName - 要删除的标签名称
   */
  private async handleDeleteTag(tagName: string): Promise<void> {
    // 确认对话框
    const confirmed = confirm(`确定要删除标签 "${tagName}" 吗？\n此操作不可撤销。`);
    if (!confirmed) return;

    try {
      // 调用后端 API 删除标签
      await repoService.deleteTag(this.repoPath, tagName);
      
      // 删除成功提示
      alert(`标签 "${tagName}" 已删除`);
      
      // 重新加载标签列表
      await this.loadTags();
      
      // 触发成功回调，刷新主界面
      this.onSuccess();
    } catch (err) {
      console.error('删除标签失败:', err);
      alert(`删除标签失败: ${String(err)}`);
    }
  }

  /**
   * 处理切换标签
   * 
   * 调用后端 API 切换到指定标签
   * 
   * @param tagName - 要切换到的标签名称
   */
  private async handleCheckoutTag(tagName: string): Promise<void> {
    // 确认对话框
    const confirmed = confirm(`确定要切换到标签 "${tagName}" 吗？\n切换后将进入 detached HEAD 状态。`);
    if (!confirmed) return;

    try {
      // 调用后端 API 切换标签
      await repoService.checkoutTag(this.repoPath, tagName);
      
      // 切换成功提示
      alert(`已切换到标签 "${tagName}"`);
      
      // 触发成功回调，刷新主界面
      this.onSuccess();
      
      // 关闭对话框
      this.close();
    } catch (err) {
      console.error('切换标签失败:', err);
      alert(`切换标签失败: ${String(err)}`);
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
   * @returns 转义后的安全文本
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
