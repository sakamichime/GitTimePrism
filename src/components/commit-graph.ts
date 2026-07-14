/**
 * ============================================================
 * 提交节点图组件（commit-graph.ts）
 * ============================================================
 *
 * 这个组件是 GitTimePrism 提交历史的可视化主视图。
 * 它从后端获取带 ref 注解的提交列表（AnnotatedCommitGraph），
 * 使用 Canvas 2D Context 绘制分支节点图，并用 HTML 表格覆盖文字信息。
 *
 * 架构设计：
 *   1. 数据层：通过 repoService.getCommitGraph() 获取 AnnotatedCommitGraph
 *      （包含 commits 数组 + head 哈希 + moreCommitsAvailable 标志）
 *   2. 图形层：使用 graph-canvas.ts 的 Graph 类渲染 Canvas
 *      （Branch/Vertex/Graph 三类核心算法，移植自 gitgraph）
 *   3. 表格层：HTML <table> 显示日期、作者、提交消息等文字信息
 *      （覆盖在 Canvas 上方，graph-cell 透明以显示下方的 Canvas 节点）
 *
 * DOM 结构：
 *   <div class="commit-graph-container">
 *     <div class="commit-graph-scroll-area">
 *       <table class="commit-graph-table">
 *         <colgroup>...</colgroup>
 *         <thead>...</thead>
 *         <tbody>
 *           <tr class="commit-row" data-hash="..." data-row="0">
 *             <td class="graph-cell"></td>   <!-- 透明，让 Canvas 显示 -->
 *             <td class="date-cell">日期</td>
 *             <td class="author-cell">作者</td>
 *             <td class="commit-cell">分支标签 + 提交消息</td>
 *           </tr>
 *         </tbody>
 *       </table>
 *       <canvas class="commit-graph-canvas"></canvas>  <!-- 绝对定位，覆盖表格左侧 -->
 *     </div>
 *     <div class="commit-graph-load-more">加载更多按钮</div>
 *     <div class="commit-graph-tooltip"></div>          <!-- 悬停提示 -->
 *   </div>
 *
 * 交互功能：
 *   - 单击节点/行：触发 onCommitSelect 回调（显示提交详情）
 *   - Ctrl/Cmd + 点击：触发 onCommitCtrlClick 回调（打开对比视图，暂只触发事件）
 *   - 双击 ref 标签：触发 onRefDoubleClick 回调（暂只触发事件）
 *   - 右键节点/ref：触发 onContextMenu 回调（暂只触发事件）
 *   - 节点悬停：100ms 延迟后显示 tooltip（含 hash、是否 HEAD、所有 ref）
 *   - 列宽拖拽：拖动列头右侧手柄调整列宽，持久化到 localStorage
 *   - 分页加载：滚动到底自动加载 + 手动"加载更多"按钮
 *   - 滚动到 HEAD/Stash：通过方法调用，便于快捷键集成
 *
 * 接口兼容性：
 *   保持 new CommitGraph(containerId, repoPath, onCommitSelect) 构造签名，
 *   保持 async refresh(): Promise<void> 方法签名，
 *   以便 app.ts 无需修改即可继续使用。
 *
 * 使用示例：
 *   const commitGraph = new CommitGraph('center-body', repoPath, (commit) => {
 *     console.log('点击了提交：', commit.hash);
 *   });
 *   await commitGraph.refresh();
 * ============================================================
 */

// 导入仓库服务（用于获取节点图数据、切换分支等）
import { repoService } from '../services/repo-service.js';
// 导入 Canvas 图形引擎核心类（Graph 管理整个图，Vertex 是单个提交顶点）
import { Graph, Vertex } from './graph-canvas.js';
// 导入 Git 相关类型定义
// GitCommit：带 heads/tags/remotes/stash 注解的提交数据
// GraphConfig：图形渲染配置（颜色、样式、网格）
// MuteCommitsConfig：静音提交配置
// AnnotatedCommitGraph：节点图返回数据（commits + head + moreCommitsAvailable）
import type {
  GitCommit,
  GraphConfig,
  MuteCommitsConfig,
  AnnotatedCommitGraph,
} from '../utils/git-types.js';
// 导入枚举值（运行时需要其值，不能用 type-only import）
import {
  GraphStyle,
  GraphUncommittedChangesStyle,
} from '../utils/git-types.js';
// 导入工具函数和类
// UNCOMMITTED：未提交变更的占位哈希 '*'
// escapeHtml：HTML 转义，防止 XSS
// EventOverlay：全屏事件遮罩，用于列宽拖拽时捕获鼠标事件
import { UNCOMMITTED, escapeHtml, EventOverlay } from '../utils/git-utils.js';


/**
 * 默认分支颜色列表
 *
 * 节点图中不同分支使用的颜色循环。颜色按顺序分配给新分支，
 * 分支结束后颜色回到回收池供后续分支复用。
 * 颜色选择参考 gitgraph 默认配色，确保在深色和浅色背景下都可读。
 */
const DEFAULT_COLOURS: ReadonlyArray<string> = [
  '#4ECDC4', // 青绿色（主分支）
  '#FF6B6B', // 珊瑚红
  '#45B7D1', // 天蓝色
  '#FFEAA7', // 浅黄色
  '#DDA0DD', // 梅红色
  '#98D8C8', // 薄荷绿
  '#F7DC6F', // 金黄色
  '#BB8FCE', // 紫色
  '#85C1E9', // 浅蓝色
  '#F8B739', // 橙色
];

/**
 * Tooltip 显示延迟（毫秒）
 *
 * 鼠标悬停在节点上后，等待 100ms 才显示 tooltip。
 * 这样可以避免鼠标快速划过时频繁弹出 tooltip。
 */
const TOOLTIP_DELAY_MS: number = 100;

/**
 * 默认每页加载的提交数量
 *
 * 初次加载和"加载更多"时获取的提交数。
 * 选择 50 是为了在性能和可用性之间平衡：
 *   - 太少（如 20）需要频繁加载
 *   - 太多（如 200）初次加载慢，渲染压力大
 */
const COMMITS_PER_PAGE: number = 50;

/**
 * 表头高度（像素）
 *
 * 用于 Canvas 的 offsetY，使第一个节点绘制在表头下方。
 * 该值需要与 CSS 中 thead th 的实际高度匹配。
 */
const HEADER_HEIGHT_PX: number = 32;

/**
 * 网格单元的水平间距（像素）
 *
 * 决定相邻列之间的水平距离，影响 Canvas 宽度。
 */
const GRID_X: number = 22;

/**
 * 网格单元的垂直间距（像素）
 *
 * 决定相邻提交行之间的垂直距离，影响行高和 Canvas 高度。
 * 该值需要与 CSS 中 .commit-row 的实际高度匹配。
 */
const GRID_Y: number = 28;

/**
 * 网格水平偏移（像素）
 *
 * Canvas 左侧的留白，使第一个列的节点不紧贴左边缘。
 */
const GRID_OFFSET_X: number = 12;

/**
 * 展开提交时的额外高度（像素）
 *
 * 当某个提交展开显示详情时，下方腾出的额外空间。
 * 当前阶段未使用展开功能，固定为 0。
 */
const GRID_EXPAND_Y: number = 0;

/**
 * localStorage 中存储列宽的键名前缀
 *
 * 每个仓库的列宽配置单独存储，键名格式为：
 *   gittimeprism:columnWidths:<仓库路径>
 * 这样切换仓库时不会互相影响。
 */
const COLUMN_WIDTHS_STORAGE_PREFIX: string = 'gittimeprism:columnWidths:';

/**
 * localStorage 中存储列可见性的键名前缀
 *
 * 每个仓库的列可见性配置单独存储。
 */
const COLUMN_VISIBILITY_STORAGE_PREFIX: string = 'gittimeprism:columnVisibility:';


/**
 * 列标识枚举
 *
 * 用于标识表格中的可调整列。Graph 列（节点图）宽度由 Canvas 自动决定，
 * 不可调整；Date/Author/Commit 三列可以由用户拖拽调整宽度。
 */
type ColumnId = 'date' | 'author' | 'commit';

/**
 * 列宽配置
 *
 * 描述三列（日期、作者、提交）的宽度（像素）。
 * Graph 列的宽度由 Canvas 内容决定，不在此配置中。
 */
interface ColumnWidths {
  /** 日期列宽度（像素） */
  date: number;
  /** 作者列宽度（像素） */
  author: number;
  /** 提交列宽度（像素）；-1 表示占据剩余空间 */
  commit: number;
}

/**
 * 列可见性配置
 *
 * 描述三列是否可见。用户可以通过列头右键菜单切换。
 */
interface ColumnVisibility {
  /** 日期列是否可见 */
  date: boolean;
  /** 作者列是否可见 */
  author: boolean;
  /** 提交列是否可见 */
  commit: boolean;
}

/**
 * 默认列宽配置
 *
 * 初次打开仓库时使用的默认列宽（像素）。
 */
const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  date: 110,   // 日期列：足够显示 "2026-07-14"
  author: 120, // 作者列：足够显示常见作者名
  commit: -1,  // 提交列：占据剩余空间
};

/**
 * 默认列可见性配置
 *
 * 初次打开仓库时所有可调列都可见。
 */
const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = {
  date: true,
  author: true,
  commit: true,
};


/**
 * 提交节点图组件类
 *
 * 管理提交历史的可视化显示和交互。
 *
 * 主要职责：
 *   1. 从后端获取带 ref 注解的提交数据
 *   2. 调用 Graph 类渲染 Canvas 节点图
 *   3. 生成 HTML 表格显示文字信息
 *   4. 处理用户交互（点击、悬停、拖拽、右键）
 *   5. 管理列宽和列可见性的持久化
 *   6. 支持分页加载更多提交
 *
 * 生命周期：
 *   1. 构造：保存参数，初始化 EventOverlay
 *   2. refresh()：从后端加载数据并渲染
 *   3. 渲染过程中：构建 DOM、绑定事件、绘制 Canvas
 *   4. 用户交互：触发回调或更新视图
 *   5. 切换仓库/关闭：由 app.ts 重新创建实例
 */
export class CommitGraph {
  /** 容器 DOM 元素的 ID（由 app.ts 传入，通常是 'center-body'） */
  private readonly containerId: string;
  /** 仓库路径（用于调用后端 API 和 localStorage 键名） */
  private readonly repoPath: string;
  /** 节点选择回调函数（单击节点时触发，参数为被点击的提交数据） */
  private readonly onCommitSelect: (commit: GitCommit) => void;

  /**
   * Ctrl/Cmd + 点击节点的回调函数
   *
   * 用于打开对比视图。当前阶段仅触发事件，由 app.ts 决定如何处理。
   * 默认实现是调用 onCommitSelect，子类或调用方可以覆盖。
   */
  private readonly onCommitCtrlClick: (commit: GitCommit) => void;

  /**
   * 双击 ref 标签的回调函数
   *
   * 用于直接 checkout 到该分支/标签。当前阶段仅触发事件。
   *
   * @param refType - ref 类型：'branch' | 'tag' | 'remote'
   * @param refName - ref 名称（如 'main'、'v1.0.0'、'origin/main'）
   * @param commit - 该 ref 指向的提交
   */
  private readonly onRefDoubleClick: (refType: 'branch' | 'tag' | 'remote', refName: string, commit: GitCommit) => void;

  /**
   * 右键菜单回调函数
   *
   * 用于显示上下文菜单。当前阶段仅触发事件。
   *
   * @param target - 右键目标类型：'commit' | 'branch' | 'tag' | 'remote'
   * @param data - 相关数据（提交或 ref 名称）
   * @param event - 鼠标事件（用于定位菜单）
   */
  private readonly onContextMenu: (target: 'commit' | 'branch' | 'tag' | 'remote', data: GitCommit | string, event: MouseEvent) => void;

  /** 当前节点图数据（含 commits 数组、head 哈希、是否还有更多提交标志） */
  private graphData: AnnotatedCommitGraph | null = null;

  /** Canvas 图形引擎实例（管理 Branch/Vertex/Graph 算法） */
  private graph: Graph | null = null;

  /** 当前已加载的提交数量（用于分页加载） */
  private loadedCount: number = COMMITS_PER_PAGE;

  /** 是否正在加载更多提交（防止重复请求） */
  private isLoadingMore: boolean = false;

  /** 列宽配置（持久化到 localStorage） */
  private columnWidths: ColumnWidths = { ...DEFAULT_COLUMN_WIDTHS };

  /** 列可见性配置（持久化到 localStorage） */
  private columnVisibility: ColumnVisibility = { ...DEFAULT_COLUMN_VISIBILITY };

  /** 全屏事件遮罩实例（用于列宽拖拽时捕获鼠标事件） */
  private readonly eventOverlay: EventOverlay = new EventOverlay();

  /** Tooltip 显示定时器（用于实现 100ms 延迟显示） */
  private tooltipTimer: number | null = null;

  /** 当前显示的 tooltip 对应的提交哈希（用于避免重复显示） */
  private currentTooltipHash: string | null = null;

  /** Canvas DOM 元素引用（render 时创建，事件绑定和重绘时使用） */
  private canvas: HTMLCanvasElement | null = null;

  /** 表格 tbody DOM 元素引用（用于追加加载更多行） */
  private tbody: HTMLTableSectionElement | null = null;

  /** 滚动区域 DOM 元素引用（用于监听滚动事件实现自动加载） */
  private scrollArea: HTMLElement | null = null;


  /**
   * 创建提交节点图组件
   *
   * @param containerId - 容器 DOM 元素的 ID
   * @param repoPath - 仓库路径
   * @param onCommitSelect - 节点选择回调函数（单击节点时触发）
   */
  constructor(containerId: string, repoPath: string, onCommitSelect: (commit: GitCommit) => void) {
    this.containerId = containerId;
    this.repoPath = repoPath;
    this.onCommitSelect = onCommitSelect;

    /* 默认情况下，Ctrl+点击和单击行为一致（由 app.ts 覆盖以实现对比视图） */
    this.onCommitCtrlClick = onCommitSelect;
    /* 默认情况下，双击 ref 和右键菜单只打印日志（由 app.ts 覆盖以实现实际功能） */
    this.onRefDoubleClick = (refType, refName) => {
      console.log(`[CommitGraph] 双击 ref（暂未实现 checkout）: ${refType} = ${refName}`);
    };
    this.onContextMenu = (target, data, event) => {
      console.log(`[CommitGraph] 右键菜单（暂未实现）: target=${target}`, data, event);
    };

    /* 从 localStorage 加载之前保存的列宽和列可见性 */
    this.columnWidths = this.loadColumnWidths();
    this.columnVisibility = this.loadColumnVisibility();
  }


  /**
   * 获取容器 DOM 元素
   *
   * 每次使用时重新查询 DOM，避免 app.render() 重新渲染后引用失效。
   * 这是因为 app.ts 可能在切换仓库时整体重建 DOM 结构。
   *
   * @returns 容器 DOM 元素，如果不存在则返回 null
   */
  private get container(): HTMLElement | null {
    return document.getElementById(this.containerId);
  }


  /* ============================================================
   * 公开方法（接口兼容）
   * ============================================================ */

  /**
   * 刷新节点图
   *
   * 从后端获取最新的提交数据（带 ref 注解），并重新渲染整个组件。
   * 每次提交、切换分支、暂存变更后都应调用此方法刷新显示。
   *
   * 重置加载计数为初始值（COMMITS_PER_PAGE），重新开始分页。
   *
   * @returns Promise，完成后节点图已更新
   */
  async refresh(): Promise<void> {
    console.log('[CommitGraph] refresh() 开始执行');
    /* 重置分页计数 */
    this.loadedCount = COMMITS_PER_PAGE;

    if (!this.container) {
      console.error('[CommitGraph] container 为 null，无法刷新');
      return;
    }

    try {
      /* 获取带注解的节点图数据 */
      console.log('[CommitGraph] 开始获取节点图数据...');
      this.graphData = await repoService.getCommitGraph(this.repoPath, this.loadedCount);
      console.log('[CommitGraph] 节点图数据获取成功，提交数:', this.graphData.commits.length,
        'head:', this.graphData.head, 'moreCommitsAvailable:', this.graphData.moreCommitsAvailable);

      /* 渲染整个组件 */
      console.log('[CommitGraph] 开始渲染节点图...');
      this.render();
      console.log('[CommitGraph] 节点图渲染完成');
    } catch (err) {
      console.error('[CommitGraph] 获取节点图失败:', err);
      if (this.container) {
        this.container.innerHTML = `<p style="color: var(--error, #f44); padding: 16px;">获取节点图失败: ${escapeHtml(String(err))}</p>`;
      }
    }
  }

  /**
   * 滚动到 HEAD 提交
   *
   * 将滚动区域滚动到 HEAD 提交所在行。
   * 用于快捷键 Ctrl+H 触发。
   */
  public scrollToHead(): void {
    if (!this.graphData || !this.graphData.head || !this.scrollArea) return;

    /* 查找 HEAD 提交的索引 */
    const headHash = this.graphData.head;
    let headIndex = -1;
    for (let i = 0; i < this.graphData.commits.length; i++) {
      if (this.graphData.commits[i].hash === headHash) {
        headIndex = i;
        break;
      }
    }

    if (headIndex === -1) {
      console.log('[CommitGraph] HEAD 不在已加载提交中，无法滚动');
      return;
    }

    /* 滚动到对应位置（每行高度 = GRID_Y） */
    this.scrollArea.scrollTop = headIndex * GRID_Y;
    console.log('[CommitGraph] 已滚动到 HEAD（行', headIndex, '）');
  }

  /**
   * 滚动到第一个 Stash 提交
   *
   * 将滚动区域滚动到第一个 stash 节点所在行。
   * 用于快捷键 Ctrl+S 触发。
   */
  public scrollToStash(): void {
    if (!this.graphData || !this.scrollArea) return;

    /* 查找第一个 stash 提交的索引 */
    let stashIndex = -1;
    for (let i = 0; i < this.graphData.commits.length; i++) {
      if (this.graphData.commits[i].stash !== null) {
        stashIndex = i;
        break;
      }
    }

    if (stashIndex === -1) {
      console.log('[CommitGraph] 没有找到 stash，无法滚动');
      return;
    }

    /* 滚动到对应位置 */
    this.scrollArea.scrollTop = stashIndex * GRID_Y;
    console.log('[CommitGraph] 已滚动到 stash（行', stashIndex, '）');
  }


  /* ============================================================
   * 渲染主流程
   * ============================================================ */

  /**
   * 渲染整个节点图组件
   *
   * 这是渲染的入口方法，负责：
   *   1. 构建基础 DOM 结构（容器、表格、Canvas、tooltip）
   *   2. 调用 Graph 类加载提交数据并渲染 Canvas
   *   3. 生成表格行 HTML
   *   4. 绑定所有交互事件
   *
   * 如果没有提交数据，显示空状态提示。
   */
  private render(): void {
    if (!this.container || !this.graphData) return;

    /* 如果没有提交，显示空状态 */
    if (this.graphData.commits.length === 0) {
      this.container.innerHTML = `
        <div class="commit-graph-container">
          <p class="commit-graph-empty">暂无提交记录</p>
        </div>
      `;
      return;
    }

    /* 第一步：创建图形配置 */
    const config = this.createGraphConfig();
    const muteConfig: MuteCommitsConfig = {
      commitsNotAncestorsOfHead: false, /* 不静音非 HEAD 祖先的提交（保持所有提交可见） */
      mergeCommits: false,              /* 不静音合并提交（保持合并提交可见） */
    };

    /* 第二步：构建基础 DOM 结构（先构建表格，Canvas 后添加） */
    const html = this.buildContainerHtml(config);
    this.container.innerHTML = html;

    /* 第三步：获取 DOM 元素引用 */
    this.canvas = this.container.querySelector('.commit-graph-canvas');
    this.tbody = this.container.querySelector('.commit-graph-table tbody');
    this.scrollArea = this.container.querySelector('.commit-graph-scroll-area');

    if (!this.canvas || !this.tbody || !this.scrollArea) {
      console.error('[CommitGraph] 无法找到必要的 DOM 元素');
      return;
    }

    /* 第四步：创建 Graph 实例并加载提交数据 */
    this.graph = new Graph(this.canvas, config, muteConfig);
    this.graph.loadCommits(this.graphData.commits, this.graphData.head, DEFAULT_COLOURS);

    /* 设置 Canvas 的宽度限制（如果有） */
    /* 当前不限制最大宽度，让所有列都完整显示 */

    /* 第五步：渲染 Canvas */
    this.graph.render(-1); /* -1 表示没有展开的提交 */

    /* 第六步：调整 Canvas 位置（覆盖表格的 graph-col 区域） */
    this.positionCanvas(config);

    /* 第七步：绑定所有交互事件 */
    this.bindEvents();
  }

  /**
   * 创建图形配置
   *
   * 根据当前组件状态生成 GraphConfig 对象。
   * 包含颜色列表、样式、网格尺寸和未提交变更显示方式。
   *
   * @returns GraphConfig 配置对象
   */
  private createGraphConfig(): GraphConfig {
    return {
      colours: DEFAULT_COLOURS,
      style: GraphStyle.Rounded, /* 使用圆角样式（贝塞尔曲线）绘制分支转折 */
      grid: {
        x: GRID_X,           /* 列间距 */
        y: GRID_Y,           /* 行间距 */
        offsetX: GRID_OFFSET_X, /* 左侧偏移 */
        offsetY: HEADER_HEIGHT_PX + 4, /* 顶部偏移（避开表头） */
        expandY: GRID_EXPAND_Y, /* 展开高度（未使用） */
      },
      uncommittedChanges: GraphUncommittedChangesStyle.OpenCircleAtTheUncommittedChanges,
    };
  }

  /**
   * 构建容器 HTML
   *
   * 生成整个组件的 HTML 结构，包括：
   *   - 滚动区域
   *   - 表格（thead + tbody）
   *   - Canvas 元素
   *   - 加载更多按钮
   *   - tooltip 元素
   *
   * Canvas 的宽度和位置在 positionCanvas() 中调整。
   *
   * @param config - 图形配置（用于计算 Canvas 宽度）
   * @returns 容器 HTML 字符串
   */
  private buildContainerHtml(config: GraphConfig): string {
    /* 计算图形列的宽度（Canvas 宽度） */
    const canvasWidth = this.calculateCanvasWidth(config);

    /* 生成表头 HTML */
    const headerHtml = this.buildTableHeader();

    /* 生成表格行 HTML */
    const rowsHtml = this.buildTableRows();

    /* 生成加载更多按钮（仅当还有更多提交时显示） */
    const loadMoreHtml = this.graphData!.moreCommitsAvailable
      ? `<div class="commit-graph-load-more">
           <button class="load-more-btn">加载更多提交</button>
         </div>`
      : '';

    return `
      <div class="commit-graph-container">
        <div class="commit-graph-scroll-area">
          <table class="commit-graph-table" style="--graph-col-width: ${canvasWidth}px;">
            <colgroup>
              <col class="graph-col" style="width: ${canvasWidth}px;" />
              ${this.columnVisibility.date ? `<col class="date-col" style="width: ${this.columnWidths.date}px;" />` : ''}
              ${this.columnVisibility.author ? `<col class="author-col" style="width: ${this.columnWidths.author}px;" />` : ''}
              ${this.columnVisibility.commit ? `<col class="commit-col" />` : ''}
            </colgroup>
            <thead>
              <tr>
                <th class="graph-header" data-col="graph">图形</th>
                ${this.columnVisibility.date ? `<th class="date-header column-resizable" data-col="date">日期<span class="resize-handle"></span></th>` : ''}
                ${this.columnVisibility.author ? `<th class="author-header column-resizable" data-col="author">作者<span class="resize-handle"></span></th>` : ''}
                ${this.columnVisibility.commit ? `<th class="commit-header column-resizable" data-col="commit">提交<span class="resize-handle"></span></th>` : ''}
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <canvas class="commit-graph-canvas"></canvas>
        </div>
        ${loadMoreHtml}
        <div class="commit-graph-tooltip"></div>
      </div>
    `;
  }

  /**
   * 计算图形列的宽度（即 Canvas 的宽度）
   *
   * 根据提交数据预估最大列数，计算 Canvas 所需宽度。
   * 由于 Graph 类的 determinePath 算法在 loadCommits 后才能知道实际列数，
   * 这里使用一个保守的估计值：基于合并提交数量估算。
   *
   * 实际渲染后，会通过 Graph.getContentWidth() 获取真实宽度并调整。
   *
   * @param config - 图形配置（用于获取 grid.x 和 offsetX）
   * @returns Canvas 宽度（像素）
   */
  private calculateCanvasWidth(config: GraphConfig): number {
    if (!this.graphData || this.graphData.commits.length === 0) {
      /* 没有提交时，使用最小宽度 */
      return 2 * config.grid.offsetX + config.grid.x;
    }

    /* 估算最大列数：每个合并提交可能引入一个新列 */
    let maxColumns = 1;
    for (const commit of this.graphData.commits) {
      /* 合并提交的额外父提交会增加列数 */
      const extraParents = Math.max(0, commit.parents.length - 1);
      maxColumns = Math.max(maxColumns, extraParents + 1);
    }

    /* 限制最大列数，避免图形过宽 */
    maxColumns = Math.min(maxColumns, 10);

    return 2 * config.grid.offsetX + maxColumns * config.grid.x;
  }

  /**
   * 构建表头 HTML
   *
   * 生成表格的 <thead> 部分。
   * 当前 buildContainerHtml 中已直接生成 thead，此方法保留为占位。
   *
   * @returns 表头 HTML 字符串
   */
  private buildTableHeader(): string {
    /* 表头已在 buildContainerHtml 中直接生成，这里返回空字符串 */
    return '';
  }

  /**
   * 构建表格行 HTML
   *
   * 为每个提交生成一个 <tr> 行，包含：
   *   - graph-cell：透明单元格，让 Canvas 显示
   *   - date-cell：日期文字
   *   - author-cell：作者文字
   *   - commit-cell：ref 标签 + 提交消息
   *
   * @returns 表格行 HTML 字符串
   */
  private buildTableRows(): string {
    if (!this.graphData) return '';

    let html = '';
    for (let i = 0; i < this.graphData.commits.length; i++) {
      const commit = this.graphData.commits[i];
      html += this.buildRowHtml(commit, i);
    }
    return html;
  }

  /**
   * 构建单行 HTML
   *
   * 为单个提交生成一个 <tr> 元素。
   *
   * @param commit - 提交数据
   * @param index - 提交在列表中的索引（用于关联 Canvas 中的顶点）
   * @returns 行 HTML 字符串
   */
  private buildRowHtml(commit: GitCommit, index: number): string {
    /* 截取短哈希（前 7 位） */
    const shortHash = commit.hash.substring(0, 7);
    /* 格式化日期：commit.date 是 Unix 时间戳（秒），转为本地日期字符串 */
    const date = new Date(commit.date * 1000);
    const dateStr = date.toLocaleDateString('zh-CN');
    /* 生成 ref 注解（分支头、标签、远程分支、stash） */
    const annotationsHtml = this.buildAnnotations(commit);

    /* 根据列可见性生成对应的单元格 */
    const dateCellHtml = this.columnVisibility.date
      ? `<td class="date-cell">${dateStr}</td>`
      : '';
    const authorCellHtml = this.columnVisibility.author
      ? `<td class="author-cell">${escapeHtml(commit.author)}</td>`
      : '';
    const commitCellHtml = this.columnVisibility.commit
      ? `<td class="commit-cell">
           <span class="commit-hash" title="完整哈希: ${escapeHtml(commit.hash)}">${shortHash}</span>
           ${annotationsHtml}
           <span class="commit-message">${escapeHtml(commit.message)}</span>
         </td>`
      : '';

    return `
      <tr class="commit-row" data-hash="${escapeHtml(commit.hash)}" data-row="${index}">
        <td class="graph-cell"></td>
        ${dateCellHtml}
        ${authorCellHtml}
        ${commitCellHtml}
      </tr>
    `;
  }

  /**
   * 构建提交上的 ref 注解 HTML
   *
   * 将提交的 heads（本地分支）、tags（标签）、remotes（远程跟踪分支）、stash
   * 注解渲染为彩色小标签，显示在提交消息前面。
   *
   * 不同类型的 ref 使用不同的 CSS 类，以便应用不同颜色：
   *   - annotation-branch：本地分支（蓝色）
   *   - annotation-remote：远程跟踪分支（紫色）
   *   - annotation-tag：标签（绿色）
   *   - annotation-stash：stash（橙色）
   *
   * @param commit - 提交数据（含 heads/tags/remotes/stash 注解）
   * @returns 注解 HTML 字符串（如无注解则返回空字符串）
   */
  private buildAnnotations(commit: GitCommit): string {
    let html = '';

    /* 渲染本地分支头注解 */
    for (const head of commit.heads) {
      html += `<span class="ref-label annotation-branch" data-ref-type="branch" data-ref-name="${escapeHtml(head)}" title="本地分支: ${escapeHtml(head)}">${escapeHtml(head)}</span>`;
    }

    /* 渲染远程跟踪分支注解 */
    for (const remote of commit.remotes) {
      /* 显示格式：remote/name（如 origin/main） */
      const remoteName = remote.remote ? `${remote.remote}/${remote.name}` : remote.name;
      html += `<span class="ref-label annotation-remote" data-ref-type="remote" data-ref-name="${escapeHtml(remoteName)}" title="远程分支: ${escapeHtml(remoteName)}">${escapeHtml(remoteName)}</span>`;
    }

    /* 渲染标签注解 */
    for (const tag of commit.tags) {
      /* 附注标签用 🏷 图标前缀，轻量标签无图标 */
      const icon = tag.annotated ? '🏷 ' : '';
      html += `<span class="ref-label annotation-tag" data-ref-type="tag" data-ref-name="${escapeHtml(tag.name)}" title="标签: ${escapeHtml(tag.name)}">${icon}${escapeHtml(tag.name)}</span>`;
    }

    /* 渲染 stash 注解 */
    if (commit.stash) {
      html += `<span class="ref-label annotation-stash" data-ref-type="stash" data-ref-name="${escapeHtml(commit.stash.selector)}" title="Stash: ${escapeHtml(commit.stash.selector)}">📦 stash</span>`;
    }

    return html;
  }

  /**
   * 定位 Canvas 元素
   *
   * 将 Canvas 绝对定位在表格的 graph-col 区域上方。
   * Canvas 的宽度和高度由 Graph.render() 设置，这里只调整位置。
   *
   * Canvas 通过 CSS position: absolute 定位在 .commit-graph-scroll-area 内，
   * top 和 left 都为 0，与表格对齐。
   * 表格的 graph-cell 设置 background: transparent 和 pointer-events: none，
   * 让 Canvas 上的节点和分支线可见且可点击。
   *
   * @param config - 图形配置
   */
  private positionCanvas(config: GraphConfig): void {
    if (!this.canvas || !this.graph) return;

    /* 获取 Graph 计算的实际内容宽度 */
    const contentWidth = this.graph.getContentWidth();
    /* 设置表格 graph-col 的宽度与 Canvas 一致 */
    const graphCol = this.container?.querySelector('.graph-col') as HTMLElement | null;
    if (graphCol) {
      graphCol.style.width = contentWidth + 'px';
    }

    /* Canvas 的宽高已由 Graph.render() 设置，这里无需重复设置 */
    /* Canvas 的 CSS position: absolute 在 CSS 文件中定义 */
  }


  /* ============================================================
   * 事件绑定
   * ============================================================ */

  /**
   * 绑定所有交互事件
   *
   * 为组件内的 DOM 元素绑定事件监听器：
   *   1. 行点击事件（单击触发 onCommitSelect，Ctrl+点击触发 onCommitCtrlClick）
   *   2. 行右键事件（触发 onContextMenu）
   *   3. ref 标签双击事件（触发 onRefDoubleClick）
   *   4. ref 标签右键事件（触发 onContextMenu）
   *   5. 节点悬停事件（显示 tooltip）
   *   6. 列宽拖拽事件（调整列宽）
   *   7. 滚动事件（自动加载更多）
   *   8. 加载更多按钮点击事件
   */
  private bindEvents(): void {
    if (!this.container) return;

    /* 绑定行点击和右键事件 */
    this.bindRowEvents();

    /* 绑定 ref 标签双击和右键事件 */
    this.bindRefEvents();

    /* 绑定节点悬停事件（显示 tooltip） */
    this.bindHoverEvents();

    /* 绑定列宽拖拽事件 */
    this.bindColumnResizeEvents();

    /* 绑定滚动自动加载事件 */
    this.bindScrollLoadEvent();

    /* 绑定加载更多按钮点击事件 */
    this.bindLoadMoreButtonEvent();
  }

  /**
   * 绑定行点击和右键事件
   *
   * 为每个 .commit-row 绑定：
   *   - click 事件：根据是否按住 Ctrl/Cmd 决定触发 onCommitSelect 或 onCommitCtrlClick
   *   - contextmenu 事件：触发 onContextMenu('commit', ...)
   */
  private bindRowEvents(): void {
    if (!this.container) return;

    const rows = this.container.querySelectorAll('.commit-row');
    for (const row of rows) {
      /* 行点击事件 */
      row.addEventListener('click', (event: Event) => {
        const mouseEvent = event as MouseEvent;
        const hash = row.getAttribute('data-hash') || '';
        const commit = this.graphData?.commits.find(c => c.hash === hash);
        if (!commit) return;

        /* Ctrl/Cmd + 点击：触发对比视图回调 */
        if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
          console.log('[CommitGraph] Ctrl+点击节点，hash:', commit.hash);
          this.onCommitCtrlClick(commit);
        } else {
          /* 普通点击：触发选择回调 */
          console.log('[CommitGraph] 点击节点，hash:', commit.hash);
          this.onCommitSelect(commit);
        }
      });

      /* 行右键事件 */
      row.addEventListener('contextmenu', (event: Event) => {
        const mouseEvent = event as MouseEvent;
        const hash = row.getAttribute('data-hash') || '';
        const commit = this.graphData?.commits.find(c => c.hash === hash);
        if (!commit) return;

        /* 阻止默认右键菜单 */
        mouseEvent.preventDefault();
        /* 触发右键菜单回调 */
        this.onContextMenu('commit', commit, mouseEvent);
      });
    }
  }

  /**
   * 绑定 ref 标签双击和右键事件
   *
   * 为每个 .ref-label 绑定：
   *   - dblclick 事件：触发 onRefDoubleClick
   *   - contextmenu 事件：触发 onContextMenu（target 为对应类型）
   */
  private bindRefEvents(): void {
    if (!this.container) return;

    const refs = this.container.querySelectorAll('.ref-label');
    for (const ref of refs) {
      /* ref 双击事件 */
      ref.addEventListener('dblclick', (event: Event) => {
        const mouseEvent = event as MouseEvent;
        mouseEvent.stopPropagation(); /* 阻止事件冒泡到行 */

        const refType = ref.getAttribute('data-ref-type') as 'branch' | 'tag' | 'remote' | 'stash';
        const refName = ref.getAttribute('data-ref-name') || '';

        /* 查找该 ref 所属的提交 */
        const row = ref.closest('.commit-row') as HTMLElement | null;
        const hash = row?.getAttribute('data-hash') || '';
        const commit = this.graphData?.commits.find(c => c.hash === hash);
        if (!commit) return;

        console.log(`[CommitGraph] 双击 ref: ${refType} = ${refName}`);
        /* stash 类型不直接 checkout，转为触发普通回调 */
        if (refType === 'stash') {
          this.onCommitSelect(commit);
        } else {
          this.onRefDoubleClick(refType as 'branch' | 'tag' | 'remote', refName, commit);
        }
      });

      /* ref 右键事件 */
      ref.addEventListener('contextmenu', (event: Event) => {
        const mouseEvent = event as MouseEvent;
        mouseEvent.preventDefault();
        mouseEvent.stopPropagation(); /* 阻止事件冒泡到行 */

        const refType = ref.getAttribute('data-ref-type') as 'branch' | 'tag' | 'remote';
        const refName = ref.getAttribute('data-ref-name') || '';

        /* 触发右键菜单回调，data 为 ref 名称 */
        this.onContextMenu(refType, refName, mouseEvent);
      });
    }
  }

  /**
   * 绑定节点悬停事件
   *
   * 监听表格的 mousemove 事件，根据鼠标位置判断是否悬停在某个节点上。
   * 如果悬停超过 100ms，显示 tooltip。
   *
   * 由于 Canvas 在表格下方（z-index 较低），鼠标事件由表格接收。
   * 通过比较鼠标位置与节点坐标来判断是否悬停在节点上。
   */
  private bindHoverEvents(): void {
    if (!this.container || !this.graph || !this.canvas) return;

    const scrollArea = this.scrollArea;
    if (!scrollArea) return;

    /* 鼠标移动事件：判断是否悬停在节点上 */
    scrollArea.addEventListener('mousemove', (event: MouseEvent) => {
      if (!this.graph || !this.canvas) return;

      /* 获取 Canvas 相对于视口的位置 */
      const canvasRect = this.canvas.getBoundingClientRect();
      /* 计算鼠标相对于 Canvas 的坐标 */
      const mouseX = event.clientX - canvasRect.left;
      const mouseY = event.clientY - canvasRect.top;

      /* 查找鼠标位置附近的节点（距离 < 8 像素） */
      const vertices = this.graph.getVertices();
      let hoveredVertex: Vertex | null = null;
      for (const vertex of vertices) {
        const vx = vertex.getPixelX();
        const vy = vertex.getPixelY();
        const dx = mouseX - vx;
        const dy = mouseY - vy;
        if (dx * dx + dy * dy < 64) { /* 8 像素半径 */
          hoveredVertex = vertex;
          break;
        }
      }

      if (hoveredVertex) {
        /* 悬停在节点上：启动定时器显示 tooltip */
        const hash = hoveredVertex.commit.hash;
        if (this.currentTooltipHash !== hash) {
          this.currentTooltipHash = hash;
          this.clearTooltipTimer();
          this.tooltipTimer = window.setTimeout(() => {
            this.showTooltip(hoveredVertex!, event.clientX, event.clientY);
          }, TOOLTIP_DELAY_MS);
        }
      } else {
        /* 不在节点上：清除 tooltip */
        this.clearTooltipTimer();
        this.hideTooltip();
        this.currentTooltipHash = null;
      }
    });

    /* 鼠标离开滚动区域时隐藏 tooltip */
    scrollArea.addEventListener('mouseleave', () => {
      this.clearTooltipTimer();
      this.hideTooltip();
      this.currentTooltipHash = null;
    });
  }

  /**
   * 绑定列宽拖拽事件
   *
   * 为每个可调整列的表头绑定 mousedown 事件，启动拖拽。
   * 拖拽过程中使用 EventOverlay 捕获鼠标事件，避免鼠标移出表头后丢失事件。
   * 拖拽结束时保存列宽到 localStorage。
   */
  private bindColumnResizeEvents(): void {
    if (!this.container) return;

    const handles = this.container.querySelectorAll('.column-resizable');
    for (const handle of handles) {
      const colId = handle.getAttribute('data-col') as ColumnId;
      if (!colId) continue;

      /* 鼠标按下事件：开始拖拽 */
      handle.addEventListener('mousedown', (event: Event) => {
        const mouseEvent = event as MouseEvent;
        mouseEvent.preventDefault();
        this.startColumnResize(colId, mouseEvent);
      });
    }
  }

  /**
   * 开始列宽拖拽
   *
   * 创建全屏事件遮罩，捕获鼠标移动和松开事件。
   * 拖拽过程中实时更新列宽和对应的 <col> 元素宽度。
   * 拖拽结束时保存列宽到 localStorage。
   *
   * @param colId - 要调整的列 ID
   * @param startEvent - 鼠标按下事件
   */
  private startColumnResize(colId: ColumnId, startEvent: MouseEvent): void {
    /* 记录起始位置和初始列宽 */
    const startX = startEvent.clientX;
    const startWidth = this.columnWidths[colId];

    /* 鼠标移动事件处理函数：实时更新列宽 */
    const onMouseMove = (moveEvent: Event) => {
      const e = moveEvent as MouseEvent;
      /* 计算列宽变化（向右拖增加宽度） */
      const delta = e.clientX - startX;
      const newWidth = Math.max(40, startWidth + delta); /* 最小宽度 40 像素 */

      /* 更新列宽配置 */
      this.columnWidths[colId] = newWidth;

      /* 实时更新对应的 <col> 元素宽度 */
      const col = this.container?.querySelector(`.${colId}-col`) as HTMLElement | null;
      if (col) {
        col.style.width = newWidth + 'px';
      }
    };

    /* 鼠标松开事件处理函数：结束拖拽并保存 */
    const onMouseUp = () => {
      /* 移除事件遮罩 */
      this.eventOverlay.remove();
      /* 保存列宽到 localStorage */
      this.saveColumnWidths();
      console.log(`[CommitGraph] 列宽已保存: ${colId} = ${this.columnWidths[colId]}px`);
    };

    /* 创建全屏事件遮罩，捕获后续鼠标事件 */
    this.eventOverlay.create('column-resize-overlay', onMouseMove, onMouseUp);
  }

  /**
   * 绑定滚动自动加载事件
   *
   * 监听滚动区域的 scroll 事件，当滚动到底部时自动加载更多提交。
   * 通过 isLoadingMore 标志防止重复请求。
   */
  private bindScrollLoadEvent(): void {
    if (!this.scrollArea) return;

    this.scrollArea.addEventListener('scroll', () => {
      if (!this.scrollArea || this.isLoadingMore || !this.graphData) return;

      /* 如果没有更多提交可加载，不处理 */
      if (!this.graphData.moreCommitsAvailable) return;

      /* 判断是否滚动到底部（距离底部 < 50 像素） */
      const scrollTop = this.scrollArea.scrollTop;
      const scrollHeight = this.scrollArea.scrollHeight;
      const clientHeight = this.scrollArea.clientHeight;

      if (scrollTop + clientHeight >= scrollHeight - 50) {
        /* 滚动到底部，自动加载更多 */
        console.log('[CommitGraph] 滚动到底部，自动加载更多');
        this.loadMoreCommits();
      }
    });
  }

  /**
   * 绑定加载更多按钮点击事件
   */
  private bindLoadMoreButtonEvent(): void {
    if (!this.container) return;

    const button = this.container.querySelector('.load-more-btn');
    if (!button) return;

    button.addEventListener('click', () => {
      console.log('[CommitGraph] 点击加载更多按钮');
      this.loadMoreCommits();
    });
  }


  /* ============================================================
   * Tooltip 显示
   * ============================================================ */

  /**
   * 显示 tooltip
   *
   * 在指定位置显示提交的详细信息：
   *   - 完整哈希
   *   - 是否在 HEAD 中
   *   - 所有包含此提交的本地分支
   *   - 所有指向此提交的标签
   *   - 所有指向此提交的远程跟踪分支
   *   - 是否是 stash
   *
   * @param vertex - 要显示 tooltip 的顶点
   * @param x - 鼠标的视口 x 坐标
   * @param y - 鼠标的视口 y 坐标
   */
  private showTooltip(vertex: Vertex, x: number, y: number): void {
    if (!this.container) return;

    const tooltip = this.container.querySelector('.commit-graph-tooltip') as HTMLElement | null;
    if (!tooltip) return;

    const commit = vertex.commit;
    const isHead = this.graphData?.head === commit.hash;
    const isStash = commit.stash !== null;

    /* 构建 tooltip 内容 */
    let html = `<div class="tooltip-hash">${escapeHtml(commit.hash)}</div>`;

    /* 是否在 HEAD */
    if (isHead) {
      html += `<div class="tooltip-head">HEAD</div>`;
    }

    /* 是否是 stash */
    if (isStash && commit.stash) {
      html += `<div class="tooltip-stash">Stash: ${escapeHtml(commit.stash.selector)}</div>`;
    }

    /* 本地分支列表 */
    if (commit.heads.length > 0) {
      html += `<div class="tooltip-section"><span class="tooltip-label">分支:</span> ${commit.heads.map(h => escapeHtml(h)).join(', ')}</div>`;
    }

    /* 远程跟踪分支列表 */
    if (commit.remotes.length > 0) {
      const remoteNames = commit.remotes.map(r => r.remote ? `${r.remote}/${r.name}` : r.name);
      html += `<div class="tooltip-section"><span class="tooltip-label">远程:</span> ${remoteNames.map(n => escapeHtml(n)).join(', ')}</div>`;
    }

    /* 标签列表 */
    if (commit.tags.length > 0) {
      html += `<div class="tooltip-section"><span class="tooltip-label">标签:</span> ${commit.tags.map(t => escapeHtml(t.name)).join(', ')}</div>`;
    }

    /* 设置 tooltip 内容和位置 */
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';

    /* 计算位置：默认显示在鼠标右下方，避免遮挡节点 */
    const tooltipRect = tooltip.getBoundingClientRect();
    let posX = x + 12;
    let posY = y + 12;

    /* 如果超出右侧，显示在鼠标左下方 */
    if (posX + tooltipRect.width > window.innerWidth) {
      posX = x - tooltipRect.width - 12;
    }
    /* 如果超出底部，显示在鼠标上方 */
    if (posY + tooltipRect.height > window.innerHeight) {
      posY = y - tooltipRect.height - 12;
    }

    tooltip.style.left = posX + 'px';
    tooltip.style.top = posY + 'px';
  }

  /**
   * 隐藏 tooltip
   */
  private hideTooltip(): void {
    if (!this.container) return;

    const tooltip = this.container.querySelector('.commit-graph-tooltip') as HTMLElement | null;
    if (tooltip) {
      tooltip.style.display = 'none';
      tooltip.innerHTML = '';
    }
  }

  /**
   * 清除 tooltip 定时器
   *
   * 取消尚未触发的 tooltip 显示定时器，
   * 用于鼠标快速移动时避免频繁显示。
   */
  private clearTooltipTimer(): void {
    if (this.tooltipTimer !== null) {
      window.clearTimeout(this.tooltipTimer);
      this.tooltipTimer = null;
    }
  }


  /* ============================================================
   * 分页加载
   * ============================================================ */

  /**
   * 加载更多提交
   *
   * 增加加载计数并重新获取提交数据。
   * 新数据会替换当前数据并重新渲染整个组件。
   *
   * 注意：这里采用"重新渲染整个组件"的简单实现。
   * 更高级的实现可以只追加新行并增量更新 Canvas，
   * 但那需要更复杂的 DOM 操作和 Canvas 增量绘制逻辑。
   */
  private async loadMoreCommits(): Promise<void> {
    if (this.isLoadingMore || !this.graphData) return;
    if (!this.graphData.moreCommitsAvailable) return;

    this.isLoadingMore = true;

    try {
      /* 增加加载计数 */
      this.loadedCount += COMMITS_PER_PAGE;
      console.log('[CommitGraph] 加载更多提交，总数:', this.loadedCount);

      /* 重新获取数据 */
      this.graphData = await repoService.getCommitGraph(this.repoPath, this.loadedCount);

      /* 重新渲染 */
      this.render();
    } catch (err) {
      console.error('[CommitGraph] 加载更多提交失败:', err);
      /* 加载失败时回退计数 */
      this.loadedCount -= COMMITS_PER_PAGE;
    } finally {
      this.isLoadingMore = false;
    }
  }


  /* ============================================================
   * 列宽和列可见性持久化
   * ============================================================ */

  /**
   * 保存列宽到 localStorage
   *
   * 将当前列宽配置序列化为 JSON 并存储。
   * 键名包含仓库路径，以便不同仓库的配置互不影响。
   */
  private saveColumnWidths(): void {
    const key = COLUMN_WIDTHS_STORAGE_PREFIX + this.repoPath;
    try {
      localStorage.setItem(key, JSON.stringify(this.columnWidths));
    } catch (err) {
      console.warn('[CommitGraph] 保存列宽失败:', err);
    }
  }

  /**
   * 从 localStorage 加载列宽
   *
   * 如果之前保存过列宽配置，加载并返回；否则返回默认配置。
   *
   * @returns 列宽配置
   */
  private loadColumnWidths(): ColumnWidths {
    const key = COLUMN_WIDTHS_STORAGE_PREFIX + this.repoPath;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ColumnWidths>;
        /* 合并默认配置，确保所有字段都有值 */
        return {
          date: typeof parsed.date === 'number' ? parsed.date : DEFAULT_COLUMN_WIDTHS.date,
          author: typeof parsed.author === 'number' ? parsed.author : DEFAULT_COLUMN_WIDTHS.author,
          commit: typeof parsed.commit === 'number' ? parsed.commit : DEFAULT_COLUMN_WIDTHS.commit,
        };
      }
    } catch (err) {
      console.warn('[CommitGraph] 加载列宽失败:', err);
    }
    return { ...DEFAULT_COLUMN_WIDTHS };
  }

  /**
   * 保存列可见性到 localStorage
   */
  private saveColumnVisibility(): void {
    const key = COLUMN_VISIBILITY_STORAGE_PREFIX + this.repoPath;
    try {
      localStorage.setItem(key, JSON.stringify(this.columnVisibility));
    } catch (err) {
      console.warn('[CommitGraph] 保存列可见性失败:', err);
    }
  }

  /**
   * 从 localStorage 加载列可见性
   *
   * @returns 列可见性配置
   */
  private loadColumnVisibility(): ColumnVisibility {
    const key = COLUMN_VISIBILITY_STORAGE_PREFIX + this.repoPath;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ColumnVisibility>;
        return {
          date: typeof parsed.date === 'boolean' ? parsed.date : DEFAULT_COLUMN_VISIBILITY.date,
          author: typeof parsed.author === 'boolean' ? parsed.author : DEFAULT_COLUMN_VISIBILITY.author,
          commit: typeof parsed.commit === 'boolean' ? parsed.commit : DEFAULT_COLUMN_VISIBILITY.commit,
        };
      }
    } catch (err) {
      console.warn('[CommitGraph] 加载列可见性失败:', err);
    }
    return { ...DEFAULT_COLUMN_VISIBILITY };
  }


  /* ============================================================
   * 公开配置方法（供 app.ts 集成右键菜单时使用）
   * ============================================================ */

  /**
   * 设置 Ctrl+点击回调
   *
   * 允许 app.ts 覆盖默认的 Ctrl+点击行为，以实现打开对比视图等功能。
   *
   * @param callback - Ctrl+点击回调函数
   */
  public setOnCommitCtrlClick(callback: (commit: GitCommit) => void): void {
    (this as { onCommitCtrlClick: (commit: GitCommit) => void }).onCommitCtrlClick = callback;
  }

  /**
   * 设置 ref 双击回调
   *
   * 允许 app.ts 覆盖默认的双击 ref 行为，以实现 checkout 等功能。
   *
   * @param callback - 双击 ref 回调函数
   */
  public setOnRefDoubleClick(callback: (refType: 'branch' | 'tag' | 'remote', refName: string, commit: GitCommit) => void): void {
    (this as { onRefDoubleClick: (refType: 'branch' | 'tag' | 'remote', refName: string, commit: GitCommit) => void }).onRefDoubleClick = callback;
  }

  /**
   * 设置右键菜单回调
   *
   * 允许 app.ts 覆盖默认的右键行为，以实现显示上下文菜单等功能。
   *
   * @param callback - 右键菜单回调函数
   */
  public setOnContextMenu(callback: (target: 'commit' | 'branch' | 'tag' | 'remote', data: GitCommit | string, event: MouseEvent) => void): void {
    (this as { onContextMenu: (target: 'commit' | 'branch' | 'tag' | 'remote', data: GitCommit | string, event: MouseEvent) => void }).onContextMenu = callback;
  }

  /**
   * 获取当前加载的提交列表
   *
   * 返回当前节点图中已加载的提交数据。主要用于在 app.ts 中
   * 刷新右键菜单（contextMenu.refresh）和对话框（dialog.refresh）的目标绑定。
   * 当节点图重新渲染后，右键菜单和对话框需要重新绑定目标元素，
   * 此方法提供所需的提交数据。
   *
   * @returns 当前加载的提交数组；如果尚未加载数据则返回空数组
   */
  public getCommits(): ReadonlyArray<GitCommit> {
    return this.graphData?.commits ?? [];
  }


  /**
   * 切换列可见性
   *
   * 切换指定列的显示/隐藏状态，并重新渲染。
   *
   * @param colId - 列 ID
   */
  public toggleColumnVisibility(colId: ColumnId): void {
    this.columnVisibility[colId] = !this.columnVisibility[colId];
    this.saveColumnVisibility();
    /* 重新渲染以应用新的列可见性 */
    if (this.graphData) {
      this.render();
    }
  }
}
