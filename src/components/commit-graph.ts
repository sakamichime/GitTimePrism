/*
 * 提交节点图组件
 * 
 * 渲染 Git 提交历史的可视化节点图，展示分支和合并关系。
 * 采用一体化布局：每行左侧为彩色 SVG 圆点+分支线，右侧为提交信息文字。
 * 类似 VS Code Git Graph 插件的显示效果。
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
 * - 一体化渲染（左侧 SVG 图形 + 右侧提交文字）
 * - 按分支列位置分配不同颜色
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
   * 采用一体化布局：每行左侧 SVG 圆点+分支线，右侧提交信息文字。
   * 类似 Git Graph 插件的显示效果。
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

    // 定义分支颜色（循环使用，最多 10 种颜色）
    const BRANCH_COLORS = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
    ];

    // 每个网格单元的大小（像素）
    const CELL_SIZE = 20;
    // 节点圆点半径（像素）
    const DOT_RADIUS = 5;
    // 线条宽度（像素）
    const LINE_WIDTH = 2;

    // 第一步：解析所有行的图形字符，确定最大列数
    let maxColumns = 0;
    const parsedLines: Array<Array<{char: string, col: number}>> = [];

    for (const commit of this.graphData.commits) {
      const lineChars = this.parseGraphLine(commit.graph_line);
      parsedLines.push(lineChars);
      if (lineChars.length > 0) {
        // 取该行最右边的列位置 +1 作为列数
        const lastCol = lineChars[lineChars.length - 1].col;
        maxColumns = Math.max(maxColumns, lastCol + 1);
      }
    }

    // 至少 1 列
    if (maxColumns === 0) maxColumns = 1;

    // 左侧 SVG 区域的宽度 = 列数 × 单元大小
    const svgWidth = maxColumns * CELL_SIZE;

    // 第二步：生成 HTML，每行一体化渲染
    let html = `
      <div class="commit-graph-container">
        <div class="commit-graph-header">
          <span class="commit-graph-title">提交历史 (${this.graphData.total_count})</span>
        </div>
        <div class="commit-graph-body">
    `;

    // 对每个提交生成一行
    for (let row = 0; row < this.graphData.commits.length; row++) {
      const commit = this.graphData.commits[row];
      const chars = parsedLines[row] || [];

      // 生成该行的 SVG 内容（圆点 + 线条）
      const rowSvg = this.renderRowSvg(chars, commit, row, CELL_SIZE, DOT_RADIUS, LINE_WIDTH, BRANCH_COLORS, svgWidth);

      // 生成该行的文字信息
      const rowInfo = this.renderRowInfo(commit);

      // 组合为一行（左侧 SVG + 右侧文字）
      html += `
        <div class="commit-graph-row" data-hash="${commit.hash}">
          <div class="commit-graph-row-visual" style="width: ${svgWidth}px; flex-shrink: 0;">
            ${rowSvg}
          </div>
          <div class="commit-graph-row-info">
            ${rowInfo}
          </div>
        </div>
      `;
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
   * 渲染单行的 SVG 内容（圆点 + 分支线）
   * 
   * 为该提交行生成一个小型 SVG，包含：
   * - 分支线（|、\\、/、-）
   * - 提交圆点（*）
   * 
   * 颜色根据列位置分配，同一列使用相同颜色。
   * 
   * @param chars - 该行的图形字符列表
   * @param commit - 当前提交数据
   * @param row - 行索引（用于计算 y 坐标）
   * @param cellSize - 网格单元大小
   * @param dotRadius - 圆点半径
   * @param lineWidth - 线条宽度
   * @param colors - 分支颜色数组
   * @param svgWidth - SVG 宽度
   * @returns SVG HTML 字符串
   */
  private renderRowSvg(
    chars: Array<{char: string, col: number}>,
    commit: GraphCommit,
    row: number,
    cellSize: number,
    dotRadius: number,
    lineWidth: number,
    colors: string[],
    svgWidth: number
  ): string {
    // 每行 SVG 高度等于一个单元大小
    const svgHeight = cellSize;
    // 圆点的 y 坐标（垂直居中）
    const y = svgHeight / 2;

    let svg = `<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">`;

    // 绘制线条
    for (const item of chars) {
      // 根据列位置分配颜色（同一列 = 同一分支 = 同一颜色）
      const colorIndex = item.col % colors.length;
      const color = colors[colorIndex];
      // x 坐标 = 列位置 × 单元大小 + 单元中心
      const x = item.col * cellSize + cellSize / 2;

      if (item.char === '|') {
        // 垂直线：从上一行中心到下一行中心
        svg += `<line x1="${x}" y1="0" x2="${x}" y2="${svgHeight}" stroke="${color}" stroke-width="${lineWidth}" />`;
      } else if (item.char === '\\') {
        // 向右下的斜线（分支）：从左上到右下
        svg += `<line x1="${x}" y1="0" x2="${x + cellSize}" y2="${svgHeight}" stroke="${color}" stroke-width="${lineWidth}" />`;
      } else if (item.char === '/') {
        // 向左下的斜线（合并）：从右上到左下
        svg += `<line x1="${x}" y1="0" x2="${x - cellSize}" y2="${svgHeight}" stroke="${color}" stroke-width="${lineWidth}" />`;
      } else if (item.char === '-') {
        // 水平线：从左到右
        svg += `<line x1="${x - cellSize / 2}" y1="${y}" x2="${x + cellSize / 2}" y2="${y}" stroke="${color}" stroke-width="${lineWidth}" />`;
      }
    }

    // 绘制提交圆点（* 字符位置）
    const commitChar = chars.find(c => c.char === '*');
    if (commitChar) {
      const x = commitChar.col * cellSize + cellSize / 2;
      // 圆点颜色跟随所在列
      const colorIndex = commitChar.col % colors.length;
      const color = colors[colorIndex];

      // 绘制圆点，带白色描边使其更醒目
      svg += `<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="${color}" stroke="#fff" stroke-width="1.5" class="graph-node" style="cursor: pointer;" />`;
    }

    svg += `</svg>`;
    return svg;
  }

  /**
   * 渲染单行的提交信息文字
   * 
   * 显示提交短哈希、消息、作者和日期。
   * 合并提交显示 🔀 图标。
   * 
   * @param commit - 提交数据
   * @returns 文字信息 HTML 字符串
   */
  private renderRowInfo(commit: GraphCommit): string {
    // 格式化日期（只显示日期部分）
    const date = new Date(commit.date);
    const dateStr = date.toLocaleDateString('zh-CN');
    // 判断是否是合并提交（有多个父提交）
    const isMerge = commit.parents.length > 1;
    const mergeIcon = isMerge ? '🔀 ' : '';

    return `
      <div class="commit-graph-row-info-left">
        <span class="commit-hash" title="${commit.hash}">${commit.short_hash}</span>
        <span class="commit-message">${mergeIcon}${this.escapeHtml(commit.message)}</span>
      </div>
      <div class="commit-graph-row-info-right">
        <span class="commit-author">${this.escapeHtml(commit.author)}</span>
        <span class="commit-date">${dateStr}</span>
      </div>
    `;
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
   * 
   * @param graphLine - 图形线字符串（如 "* "、"| * "、"|\\ " 等）
   * @returns 字符及其列位置的数组
   */
  private parseGraphLine(graphLine: string): Array<{char: string, col: number}> {
    const result: Array<{char: string, col: number}> = [];

    // 遍历字符串，提取图形字符
    for (let i = 0; i < graphLine.length; i++) {
      const char = graphLine[i];
      // 只处理图形相关字符：*|\/- 和空格
      if ('*|\\/\\- '.includes(char)) {
        result.push({ char, col: i });
      }
    }

    return result;
  }

  /**
   * 绑定事件监听器
   * 
   * 为每一行（包含 SVG 圆点和提交信息）绑定点击事件。
   * 点击行的任何位置都会触发 onCommitSelect 回调。
   */
  private bindEvents(): void {
    if (!this.container) return;

    // 为每一行绑定点击事件
    const rows = this.container.querySelectorAll('.commit-graph-row');
    for (const row of rows) {
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
   * 用于处理用户输入的内容（如提交消息、作者名）。
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
