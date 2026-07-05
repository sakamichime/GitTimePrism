/*
 * 提交消息输入组件
 * 
 * 提供多行文本输入框和提交按钮，用于创建 Git 提交。
 * 包含提交消息验证（不能为空）和提交后的回调。
 * 
 * 使用方式：
 * const commitInput = new CommitInput('commit-input-container', repoPath, onCommitSuccess);
 * await commitInput.enable(); // 启用输入（有暂存文件时）
 * await commitInput.disable(); // 禁用输入（无暂存文件时）
 */

import { repoService } from '../services/repo-service.js';

/**
 * 提交消息输入组件类
 * 
 * 管理提交消息的输入和提交操作，包括：
 * - 多行文本输入框
 * - 提交按钮（带加载状态）
 * - 提交消息验证
 * - 提交成功/失败处理
 */
export class CommitInput {
  /** 容器 DOM 元素的 ID */
  private containerId: string;
  /** 仓库路径 */
  private repoPath: string;
  /** 提交成功回调函数 */
  private onCommitSuccess: () => void;
  /** 文本输入框 DOM 元素引用 */
  private textarea: HTMLTextAreaElement | null = null;
  /** 提交按钮 DOM 元素引用 */
  private submitBtn: HTMLButtonElement | null = null;
  /** 提示文字 DOM 元素引用（告诉用户需要先暂存文件） */
  private hintEl: HTMLElement | null = null;
  /** 是否正在提交中 */
  private isCommitting: boolean = false;
  /** 是否有暂存文件（只有暂存了才能提交） */
  private hasStagedFiles: boolean = false;

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
   * 创建提交输入组件
   * 
   * @param containerId - 容器 DOM 元素的 ID
   * @param repoPath - 仓库路径
   * @param onCommitSuccess - 提交成功回调函数
   */
  constructor(containerId: string, repoPath: string, onCommitSuccess: () => void) {
    console.log('[CommitInput] 组件初始化，containerId:', containerId, 'repoPath:', repoPath);
    this.containerId = containerId;
    this.repoPath = repoPath;
    this.onCommitSuccess = onCommitSuccess;
    console.log('[CommitInput] container 元素存在:', !!this.container);
    this.render();
  }

  /**
   * 渲染组件 DOM
   * 
   * 创建多行文本输入框和提交按钮。
   */
  private render(): void {
    console.log('[CommitInput] 开始渲染 DOM');
    if (!this.container) {
      console.error('[CommitInput] container 为 null，无法渲染');
      return;
    }

    this.container.innerHTML = `
      <div class="commit-input-container">
        <textarea 
          class="commit-message-input" 
          placeholder="输入提交消息..."
          rows="3"
        ></textarea>
        <button class="btn btn-primary commit-submit-btn" disabled title="请输入提交消息">
          提交
        </button>
        <div class="commit-hint" style="font-size: var(--font-size-xs); color: var(--text-muted); padding: 4px 0; display: none;">
          💡 提示：提交时会自动暂存所有修改的文件
        </div>
      </div>
    `;

    // 保存 DOM 引用
    this.textarea = this.container.querySelector('.commit-message-input');
    this.submitBtn = this.container.querySelector('.commit-submit-btn');
    this.hintEl = this.container.querySelector('.commit-hint');
    
    console.log('[CommitInput] DOM 引用检查 - textarea:', !!this.textarea, 'submitBtn:', !!this.submitBtn, 'hintEl:', !!this.hintEl);

    // 绑定提交按钮事件
    if (this.submitBtn) {
      this.submitBtn.addEventListener('click', () => this.handleSubmit());
      console.log('[CommitInput] 提交按钮初始 disabled 状态:', this.submitBtn.disabled);
    }

    // 绑定文本框输入事件（启用/禁用按钮）
    if (this.textarea) {
      this.textarea.addEventListener('input', () => this.handleInput());
    }
  }

  /**
   * 处理文本输入
   * 
   * 根据文本框内容和提交状态启用或禁用提交按钮。
   * 按钮启用条件：有文本内容 AND 不在提交中。
   * 注意：不再强制要求有暂存文件，因为 handleSubmit() 会自动暂存。
   */
  private handleInput(): void {
    console.log('[CommitInput] handleInput 开始执行');
    if (!this.submitBtn || !this.textarea) {
      console.error('[CommitInput] submitBtn 或 textarea 为 null');
      return;
    }

    // 检查是否有文本内容
    const hasContent = this.textarea.value.trim().length > 0;
    console.log('[CommitInput] 状态检查 - hasContent:', hasContent, 'isCommitting:', this.isCommitting);
    
    // 按钮启用条件：有文本内容 AND 不在提交中
    // 不再要求 hasStagedFiles，因为 handleSubmit() 会自动暂存
    const shouldDisable = !hasContent || this.isCommitting;
    this.submitBtn.disabled = shouldDisable;
    
    // 更新按钮提示文字
    if (this.submitBtn) {
      this.submitBtn.title = shouldDisable ? '请输入提交消息' : '点击提交';
    }
    
    console.log('[CommitInput] 按钮应该禁用:', shouldDisable, '实际 disabled:', this.submitBtn.disabled);
  }

  /**
   * 启用输入组件
   * 
   * 启用文本输入框，并立即检查按钮状态。
   * 不再依赖 hasStagedFiles，因为提交时会自动暂存。
   */
  enable(): void {
    console.log('[CommitInput] enable() 被调用');
    if (this.textarea) {
      this.textarea.disabled = false;
    }
    // 立即检查按钮状态，让用户可以直接输入并提交
    this.handleInput();
    console.log('[CommitInput] 输入组件已启用，按钮状态已更新');
  }

  /**
   * 设置是否有暂存文件
   * 
   * 由外部调用，用于更新暂存文件状态。当状态改变时重新检查按钮状态。
   * 如果没有暂存文件，显示提示文字告诉用户需要先暂存。
   * 
   * @param has - 是否有暂存文件
   */
  setHasStagedFiles(has: boolean): void {
    console.log('[CommitInput] setHasStagedFiles 被调用，参数:', has, '当前 hasStagedFiles:', this.hasStagedFiles);
    this.hasStagedFiles = has;
    // 显示或隐藏提示文字
    if (this.hintEl) {
      this.hintEl.style.display = has ? 'none' : 'block';
      console.log('[CommitInput] 提示文字显示状态:', has ? '隐藏' : '显示');
    }
    // 重新检查按钮状态
    this.handleInput();
  }

  /**
   * 禁用输入组件
   * 
   * 当没有暂存文件时调用，禁止用户提交。
   */
  disable(): void {
    if (this.textarea) {
      this.textarea.disabled = true;
    }
    if (this.submitBtn) {
      this.submitBtn.disabled = true;
    }
  }

  /**
   * 清空输入框
   * 
   * 提交成功后清空文本框内容。
   */
  clear(): void {
    if (this.textarea) {
      this.textarea.value = '';
    }
    this.handleInput();
  }

  /**
   * 设置加载状态
   * 
   * 提交过程中显示加载状态，禁用按钮和输入框。
   * 
   * @param loading - 是否加载中
   */
  setLoading(loading: boolean): void {
    this.isCommitting = loading;

    if (this.textarea) {
      this.textarea.disabled = loading;
    }

    if (this.submitBtn) {
      this.submitBtn.disabled = loading;
      this.submitBtn.textContent = loading ? '提交中...' : '提交';
    }
  }

  /**
   * 处理提交操作
   * 
   * 验证提交消息，如果没有暂存文件则自动暂存所有文件，
   * 然后调用后端创建提交，处理成功/失败。
   */
  private async handleSubmit(): Promise<void> {
    if (!this.textarea || this.isCommitting) return;

    const message = this.textarea.value.trim();
    if (!message) {
      alert('请输入提交消息');
      return;
    }

    // 设置加载状态
    this.setLoading(true);

    try {
      // 如果没有暂存文件，自动暂存所有文件（方便用户操作）
      if (!this.hasStagedFiles) {
        console.log('[CommitInput] 没有暂存文件，自动暂存所有文件...');
        await repoService.stageAll(this.repoPath);
        console.log('[CommitInput] 自动暂存完成');
        // 更新状态
        this.hasStagedFiles = true;
        if (this.hintEl) {
          this.hintEl.style.display = 'none';
        }
      }

      // 调用后端创建提交
      const commitHash = await repoService.commitChanges(this.repoPath, message);
      console.log('提交成功:', commitHash);

      // 清空输入框
      this.clear();

      // 调用成功回调（刷新文件列表和提交历史）
      this.onCommitSuccess();

      // 显示成功提示
      alert(`提交成功！\n提交哈希: ${commitHash.substring(0, 7)}`);
    } catch (err) {
      console.error('提交失败:', err);
      alert(`提交失败: ${err}`);
    } finally {
      // 恢复按钮状态
      this.setLoading(false);
    }
  }
}
