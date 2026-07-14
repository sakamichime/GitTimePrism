/*
 * 文件历史查看组件
 * 
 * 显示单个文件的提交历史列表，每个提交显示：
 * - 短哈希（可点击查看详情）
 * - 作者名字
 * - 提交日期（本地化格式）
 * - 提交消息
 * 
 * 点击某个提交后，会在右侧详情面板中显示该提交的 diff 内容。
 * 
 * 数据来源：
 * - repoService.getFileHistory() → 获取该文件的所有提交记录
 * 
 * 使用方式：
 * const fileHistory = new FileHistory('detail-body', diffViewer);
 * await fileHistory.showHistory(repoPath, filePath);
 */

import { repoService, type CommitInfo } from '../services/repo-service.js';
import { DiffViewer } from './diff-viewer.js';
// 引入文件图标服务，用于根据文件路径获取对应的 vscode-icons 文件类型 SVG 图标 URL
import { fileIconService } from '../services/file-icon-service.js';

/**
 * 文件历史查看组件类
 * 
 * 管理文件提交历史的显示和交互，包括：
 * - 从后端获取文件的提交历史列表
 * - 渲染提交历史列表视图
 * - 点击提交时显示该提交的 diff
 */
export class FileHistory {
  /** 容器 DOM 元素的 ID */
  private containerId: string;
  /** diff 视图组件引用，用于显示提交的 diff */
  private diffViewer: DiffViewer;
  /** 当前仓库路径 */
  private repoPath: string | null = null;

  /**
   * 创建文件历史查看组件
   * 
   * @param containerId - 容器 DOM 元素的 ID（通常是 detail-body）
   * @param diffViewer - diff 视图组件实例，用于点击提交时显示 diff
   */
  constructor(containerId: string, diffViewer: DiffViewer) {
    this.containerId = containerId;
    this.diffViewer = diffViewer;
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
   * 显示文件的提交历史
   * 
   * 从后端获取指定文件的所有提交记录，并渲染历史列表视图。
   * 
   * @param repoPath - 仓库路径
   * @param filePath - 文件路径（相对于仓库根目录）
   */
  async showHistory(repoPath: string, filePath: string): Promise<void> {
    if (!this.container) return;

    // 保存仓库路径，供后续点击提交时使用
    this.repoPath = repoPath;

    // 显示加载状态
    this.container.innerHTML = `
      <div class="file-history-container">
        <div class="file-history-header">
          <img class="file-history-icon" src="${fileIconService.getFileIconUrl(filePath)}" alt="">
          <span class="file-history-title">文件历史</span>
          <span class="file-history-path" title="${this.escapeHtml(filePath)}">${this.escapeHtml(filePath)}</span>
        </div>
        <div class="file-history-loading">加载中...</div>
      </div>
    `;

    try {
      // 调用后端 API 获取文件的提交历史
      const commits = await repoService.getFileHistory(repoPath, filePath);

      if (commits.length === 0) {
        this.container.innerHTML = `
          <div class="file-history-container">
            <div class="file-history-header">
              <img class="file-history-icon" src="${fileIconService.getFileIconUrl(filePath)}" alt="">
              <span class="file-history-title">文件历史</span>
              <span class="file-history-path" title="${this.escapeHtml(filePath)}">${this.escapeHtml(filePath)}</span>
            </div>
            <div class="file-history-empty">该文件没有提交历史</div>
          </div>
        `;
        return;
      }

      // 渲染提交历史列表
      this.render(commits, filePath);
    } catch (err) {
      console.error('获取文件历史失败:', err);
      this.container.innerHTML = `
        <div class="file-history-container">
          <div class="file-history-header">
            <img class="file-history-icon" src="${fileIconService.getFileIconUrl(filePath)}" alt="">
            <span class="file-history-title">文件历史</span>
            <span class="file-history-path" title="${this.escapeHtml(filePath)}">${this.escapeHtml(filePath)}</span>
          </div>
          <div class="file-history-error">获取文件历史失败: ${err}</div>
        </div>
      `;
    }
  }

  /**
   * 渲染文件提交历史列表
   * 
   * 生成完整的 HTML 视图，包括头部信息（文件路径）和提交列表。
   * 每个提交项显示短哈希、作者、日期和提交消息。
   * 
   * @param commits - 提交历史列表
   * @param filePath - 文件路径（用于头部显示）
   */
  private render(commits: CommitInfo[], filePath: string): void {
    if (!this.container) return;

    let html = `
      <div class="file-history-container">
        <!-- 头部区域：显示文件路径和提交数量 -->
        <div class="file-history-header">
          <img class="file-history-icon" src="${fileIconService.getFileIconUrl(filePath)}" alt="">
          <span class="file-history-title">文件历史</span>
          <span class="file-history-path" title="${this.escapeHtml(filePath)}">${this.escapeHtml(filePath)}</span>
          <span class="file-history-count">${commits.length} 个提交</span>
        </div>
        <!-- 提交列表 -->
        <div class="file-history-list">
    `;

    // 遍历每个提交，生成列表项
    for (const commit of commits) {
      const dateStr = this.formatDate(commit.date);
      const safeAuthor = this.escapeHtml(commit.author);
      const safeMessage = this.escapeHtml(commit.message.split('\n')[0] || '(无提交消息)');

      html += `
        <div class="file-history-item" data-hash="${commit.hash}">
          <!-- 提交信息区域 -->
          <div class="file-history-item-info">
            <!-- 第一行：短哈希 + 作者 + 日期 -->
            <div class="file-history-item-row">
              <span class="file-history-item-hash" title="${commit.hash}">${commit.short_hash}</span>
              <span class="file-history-item-author">${safeAuthor}</span>
              <span class="file-history-item-date">${dateStr}</span>
            </div>
            <!-- 第二行：提交消息 -->
            <div class="file-history-item-message">${safeMessage}</div>
          </div>
        </div>
      `;
    }

    html += `
        </div>
      </div>
    `;

    this.container.innerHTML = html;

    // 绑定提交项的点击事件
    this.bindEvents();
  }

  /**
   * 绑定提交项的点击事件
   * 
   * 为每个提交项绑定点击事件，点击后在右侧面板显示该提交的 diff。
   */
  private bindEvents(): void {
    if (!this.container) return;

    const items = this.container.querySelectorAll('.file-history-item');
    for (const item of items) {
      item.addEventListener('click', () => {
        const hash = item.getAttribute('data-hash') || '';
        if (hash && this.repoPath) {
          // 使用 diffViewer 显示该提交的 diff
          this.diffViewer.showCommitDiff(this.repoPath, hash);
        }
      });
    }
  }

  /**
   * 将 ISO 8601 格式的日期字符串转为本地可读格式
   * 
   * @param isoDate - ISO 8601 格式的日期字符串
   * @returns 本地化的日期字符串
   */
  private formatDate(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      if (isNaN(date.getTime())) {
        return isoDate;
      }
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      return isoDate;
    }
  }

  /**
   * HTML 转义，防止 XSS 攻击
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
