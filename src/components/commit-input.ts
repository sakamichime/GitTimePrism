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
  /** 容器 DOM 元素引用 */
  private container: HTMLElement | null = null;
  /** 文本输入框 DOM 元素引用 */
  private textarea: HTMLTextAreaElement | null = null;
  /** 提交按钮 DOM 元素引用 */
  private submitBtn: HTMLButtonElement | null = null;
  /** 是否正在提交中 */
  private isCommitting: boolean = false;

  /**
   * 创建提交输入组件
   * 
   * @param containerId - 容器 DOM 元素的 ID
   * @param repoPath - 仓库路径
   * @param onCommitSuccess - 提交成功回调函数
   */
  constructor(containerId: string, repoPath: string, onCommitSuccess: () => void) {
    this.containerId = containerId;
    this.repoPath = repoPath;
    this.onCommitSuccess = onCommitSuccess;
    this.container = document.getElementById(containerId);
    this.render();
  }

  /**
   * 渲染组件 DOM
   * 
   * 创建多行文本输入框和提交按钮。
   */
  private render(): void {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="commit-input-container">
        <textarea 
          class="commit-message-input" 
          placeholder="输入提交消息..."
          rows="3"
        ></textarea>
        <button class="btn btn-primary commit-submit-btn" disabled>
          提交
        </button>
      </div>
    `;

    // 保存 DOM 引用
    this.textarea = this.container.querySelector('.commit-message-input');
    this.submitBtn = this.container.querySelector('.commit-submit-btn');

    // 绑定提交按钮事件
    if (this.submitBtn) {
      this.submitBtn.addEventListener('click', () => this.handleSubmit());
    }

    // 绑定文本框输入事件（启用/禁用按钮）
    if (this.textarea) {
      this.textarea.addEventListener('input', () => this.handleInput());
    }
  }

  /**
   * 处理文本输入
   * 
   * 根据文本框内容启用或禁用提交按钮。
   */
  private handleInput(): void {
    if (!this.submitBtn || !this.textarea) return;

    const hasContent = this.textarea.value.trim().length > 0;
    this.submitBtn.disabled = !hasContent || this.isCommitting;
  }

  /**
   * 启用输入组件
   * 
   * 当有暂存文件时调用，允许用户输入提交消息。
   */
  enable(): void {
    if (this.textarea) {
      this.textarea.disabled = false;
    }
    this.handleInput(); // 重新检查按钮状态
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
   * 验证提交消息，调用后端创建提交，处理成功/失败。
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
