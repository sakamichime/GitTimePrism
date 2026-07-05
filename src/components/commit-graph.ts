/*
 * 提交节点图组件
 * 
 * 渲染 Git 提交历史的 ASCII 节点图，展示分支和合并关系。
 * 每个节点显示图形线、提交哈希、作者和消息。
 * 支持点击节点查看详情。
 * 
 * 使用方式：
 * const commitGraph = new CommitGraph('center-body', repoPath, onCommitSelect);
 * await commitGraph.refresh();
 */

import { repoService, type CommitGraph as CommitGraphData, type GraphCommit } from '../services/repo-service.js';

/**
 * 提交节点图组件类
 * 
 * 管理节点图的显示和交互，包括：
 * - 获取并渲染节点图数据
 * - 显示提交节点（图形线 + 哈希 + 消息）
 * - 点击节点触发回调（用于显示详情）
 */
export class CommitGraph {
  /** 容器 DOM 元素的 ID */
  private containerId: string;
  /** 仓库路径 */
  private repoPath: string;
  /** 节点选择回调函数 */
  private onCommitSelect: (commit: GraphCommit) => void;
  /** 容器 DOM 元素引用 */
  private container: HTMLElement | null = null;
  /** 当前节点图数据 */
  private graphData: CommitGraphData | null = null;

  /**
   * 创建提交节点图组件
   * 
   * @param containerId - 容器 DOM 元素的 ID
   * @param repoPath - 仓库路径
   * @param onCommitSelect - 节点选择回调函数
   */
  constructor(containerId: string, repoPath: string, onCommitSelect: (commit: GraphCommit) => void) {
    this.containerId = containerId;
    this.repoPath = repoPath;
    this.onCommitSelect = onCommitSelect;
    this.container = document.getElementById(containerId);
  }

  /**
   * 刷新节点图
   * 
   * 从后端获取最新的节点图数据，并重新渲染。
   * 每次提交或切换分支后应调用此方法刷新显示。
   */
  async refresh(): Promise<void> {
    console.log('[CommitGraph] refresh() 开始执行');
    if (!this.container) {
      console.error('[CommitGraph] container 为 null，无法刷新');
      return;
    }

    try {
      // 获取节点图数据（最近 50 条提交）
      console.log('[CommitGraph] 开始获取节点图数据...');
      this.graphData = await repoService.getCommitGraph(this.repoPath, 50);
      console.log('[CommitGraph] 节点图数据获取成功，提交数:', this.graphData.commits.length);

      // 渲染节点图
      console.log('[CommitGraph] 开始渲染节点图...');
      this.render();
      console.log('[CommitGraph] 节点图渲染完成');
    } catch (err) {
      console.error('[CommitGraph] 获取节点图失败:', err);
      this.container.innerHTML = `<p style="color: var(--error); padding: 16px;">获取节点图失败</p>`;
    }
  }

  /**
   * 渲染节点图
   * 
   * 将提交节点列表渲染为可视化的 ASCII 节点图。
   */
  private render(): void {
    if (!this.container || !this.graphData) return;

    // 如果没有提交，显示空状态
    if (this.graphData.commits.length === 0) {
      this.container.innerHTML = `
        <p style="color: var(--text-muted); padding: 16px; text-align: center;">
          暂无提交记录
        </p>
      `;
      return;
    }

    // 生成 HTML
    let html = `
      <div class="commit-graph-container">
        <div class="commit-graph-header">
          <span class="commit-graph-title">提交历史 (${this.graphData.total_count})</span>
        </div>
        <div class="commit-graph-list">
    `;

    // 渲染每个提交节点
    for (const commit of this.graphData.commits) {
      html += this.renderCommitNode(commit);
    }

    html += `
        </div>
      </div>
    `;

    this.container.innerHTML = html;

    // 绑定事件
    this.bindEvents();
  }

  /**
   * 渲染单个提交节点
   * 
   * @param commit - 提交节点数据
   * @returns 节点的 HTML 字符串
   */
  private renderCommitNode(commit: GraphCommit): string {
    // 格式化日期（只显示日期部分）
    const date = new Date(commit.date);
    const dateStr = date.toLocaleDateString('zh-CN');

    // 判断是否是合并提交（有多个父提交）
    const isMerge = commit.parents.length > 1;
    const mergeIcon = isMerge ? '🔀 ' : '';

    return `
      <div class="commit-node" data-hash="${commit.hash}">
        <div class="commit-graph-line">
          <pre class="graph-ascii">${this.escapeHtml(commit.graph_line)}</pre>
        </div>
        <div class="commit-info">
          <div class="commit-header">
            <span class="commit-hash" title="${commit.hash}">${commit.short_hash}</span>
            <span class="commit-author">${commit.author}</span>
            <span class="commit-date">${dateStr}</span>
          </div>
          <div class="commit-message">
            ${mergeIcon}${this.escapeHtml(commit.message)}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 绑定事件监听器
   * 
   * 为每个提交节点绑定点击事件。
   */
  private bindEvents(): void {
    if (!this.container) return;

    const nodes = this.container.querySelectorAll('.commit-node');
    for (const node of nodes) {
      node.addEventListener('click', () => {
        const hash = node.getAttribute('data-hash') || '';
        const commit = this.graphData?.commits.find(c => c.hash === hash);
        if (commit) {
          this.onCommitSelect(commit);
        }
      });
    }
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
