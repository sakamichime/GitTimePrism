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
   * 将提交节点列表渲染为可视化的彩色节点图（类似 Git Graph）。
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

    // 生成 SVG 节点图
    const svgContent = this.renderVisualGraph();

    // 生成 HTML
    let html = `
      <div class="commit-graph-container">
        <div class="commit-graph-header">
          <span class="commit-graph-title">提交历史 (${this.graphData.total_count})</span>
        </div>
        <div class="commit-graph-visual" style="overflow-x: auto;">
          ${svgContent}
        </div>
    `;

    for (const commit of this.graphData.commits) {
      html += this.renderCommitInfo(commit);
    }

    html += `</div>`;

    this.container.innerHTML = html;

    // 绑定事件
    this.bindEvents();
  }

  /**
   * 渲染可视化节点图（SVG）
   * 
   * 解析 ASCII 图形线，生成彩色的 SVG 节点图。
   */
  private renderVisualGraph(): string {
    if (!this.graphData) return '';

    const CELL_SIZE = 20; // 每个网格单元的大小
    const DOT_RADIUS = 5; // 节点圆点半径
    const LINE_WIDTH = 2; // 线条宽度
    
    // 定义分支颜色（循环使用）
    const BRANCH_COLORS = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
    ];

    // 分析所有行的图形字符，确定最大列数
    let maxColumns = 0;
    const parsedLines: Array<Array<{char: string, col: number}>> = [];
    
    for (const commit of this.graphData.commits) {
      const lineChars = this.parseGraphLine(commit.graph_line);
      parsedLines.push(lineChars);
      if (lineChars.length > 0) {
        const lastCol = lineChars[lineChars.length - 1].col;
        maxColumns = Math.max(maxColumns, lastCol + 1);
      }
    }

    if (maxColumns === 0) maxColumns = 1;

    const svgWidth = maxColumns * CELL_SIZE + 40;
    const svgHeight = this.graphData.commits.length * CELL_SIZE + 20;

    let svg = `<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">`;

    // 绘制线条和节点
    for (let row = 0; row < this.graphData.commits.length; row++) {
      const commit = this.graphData.commits[row];
      const chars = parsedLines[row] || [];
      const y = row * CELL_SIZE + 10;

      // 绘制垂直线和斜线
      for (const item of chars) {
        const x = item.col * CELL_SIZE + CELL_SIZE / 2;
        const colorIndex = item.col % BRANCH_COLORS.length;
        const color = BRANCH_COLORS[colorIndex];

        if (item.char === '|') {
          // 垂直线
          svg += `<line x1="${x}" y1="${y - CELL_SIZE/2}" x2="${x}" y2="${y + CELL_SIZE/2}" stroke="${color}" stroke-width="${LINE_WIDTH}" />`;
        } else if (item.char === '\\') {
          // 向右下的斜线
          svg += `<line x1="${x}" y1="${y - CELL_SIZE/2}" x2="${x + CELL_SIZE}" y2="${y + CELL_SIZE/2}" stroke="${color}" stroke-width="${LINE_WIDTH}" />`;
        } else if (item.char === '/') {
          // 向左下的斜线
          svg += `<line x1="${x}" y1="${y - CELL_SIZE/2}" x2="${x - CELL_SIZE}" y2="${y + CELL_SIZE/2}" stroke="${color}" stroke-width="${LINE_WIDTH}" />`;
        } else if (item.char === '-') {
          // 水平线
          svg += `<line x1="${x - CELL_SIZE/2}" y1="${y}" x2="${x + CELL_SIZE/2}" y2="${y}" stroke="${color}" stroke-width="${LINE_WIDTH}" />`;
        }
      }

      // 找到提交标记 (*) 的位置并绘制圆点
      const commitChar = chars.find(c => c.char === '*');
      if (commitChar) {
        const x = commitChar.col * CELL_SIZE + CELL_SIZE / 2;
        const colorIndex = commitChar.col % BRANCH_COLORS.length;
        const color = BRANCH_COLORS[colorIndex];
        
        // 绘制圆点
        svg += `<circle cx="${x}" cy="${y}" r="${DOT_RADIUS}" fill="${color}" stroke="#fff" stroke-width="1.5" data-hash="${commit.hash}" class="graph-node" style="cursor: pointer;" />`;
      }
    }

    svg += `</svg>`;
    return svg;
  }

  /**
   * 解析图形行，返回每个字符及其列位置
   * 
   * git log --graph 的图形字符：
   * - '*' : 提交节点
   * - '|' : 垂直线
   * - '\\' : 向右下的斜线（分支）
   * - '/' : 向左下的斜线（合并）
   * - '-' : 水平线
   * - ' ' : 空格（用于对齐）
   */
  private parseGraphLine(graphLine: string): Array<{char: string, col: number}> {
    const result: Array<{char: string, col: number}> = [];
    
    // 遍历字符串，提取图形字符
    for (let i = 0; i < graphLine.length; i++) {
      const char = graphLine[i];
      if ('*|\\/\\- '.includes(char)) {
        result.push({ char, col: i });
      }
    }
    
    return result;
  }

  /**
   * 渲染单个提交的信息（文本部分）
   */
  private renderCommitInfo(commit: GraphCommit): string {
    const date = new Date(commit.date);
    const dateStr = date.toLocaleDateString('zh-CN');
    const isMerge = commit.parents.length > 1;
    const mergeIcon = isMerge ? '🔀 ' : '';

    return `
      <div class="commit-info-row" data-hash="${commit.hash}">
        <div class="commit-info-left">
          <span class="commit-hash" title="${commit.hash}">${commit.short_hash}</span>
          <span class="commit-message">${mergeIcon}${this.escapeHtml(commit.message)}</span>
        </div>
        <div class="commit-info-right">
          <span class="commit-author">${this.escapeHtml(commit.author)}</span>
          <span class="commit-date">${dateStr}</span>
        </div>
      </div>
    `;
  }

  /**
   * 绑定事件监听器
   * 
   * 为 SVG 圆点和提交信息行绑定点击事件。
   */
  private bindEvents(): void {
    if (!this.container) return;

    // SVG 圆点点击
    const svgNodes = this.container.querySelectorAll('.graph-node');
    for (const node of svgNodes) {
      node.addEventListener('click', () => {
        const hash = node.getAttribute('data-hash') || '';
        const commit = this.graphData?.commits.find(c => c.hash === hash);
        if (commit) {
          this.onCommitSelect(commit);
        }
      });
    }

    // 提交信息行点击
    const infoRows = this.container.querySelectorAll('.commit-info-row');
    for (const row of infoRows) {
      row.addEventListener('click', () => {
        const hash = row.getAttribute('data-hash') || '';
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
