/**
 * ============================================================
 * 图形类型定义模块（TypeScript 版本）
 * ============================================================
 *
 * 这个模块定义了 GitTimePrism 提交节点图渲染所需的类型接口。
 * 类型定义参考了 gitgraph 项目的 web/graph.ts，将其中的类
 * （Vertex、Branch、Graph）提取为接口形式，以便：
 *   1. 其他模块可以用类型注解引用这些类型，而不依赖具体实现
 *   2. 便于将来替换图形渲染引擎（只需实现相同接口）
 *   3. 便于单元测试（可以使用 mock 对象）
 *
 * 模块内容包括：
 *   - Point、Line、Pixel、PlacedLine：基础几何数据接口
 *   - Vertex：提交节点接口（描述图中的一个提交顶点）
 *   - Branch：分支接口（描述图中的一个分支线条）
 *   - Graph：提交图接口（描述整个提交图的渲染和管理）
 *
 * 使用示例：
 *   import { Point, Vertex, Graph } from '../utils/graph-types.js';
 * ============================================================
 */

// 导入 Git 相关类型（用于 Graph 接口的方法签名）
// GitCommit 用于 loadCommits 方法的参数类型
// GraphConfig 用于 Branch.draw 和 Vertex.draw 方法的参数类型
import type { GitCommit, GraphConfig } from './git-types.js';


/**
 * ============================================================
 * 基础几何数据接口
 * ============================================================
 */

/**
 * 点（逻辑坐标）
 *
 * 表示提交图中的一个逻辑坐标点。
 * x 是列索引（水平方向），y 是提交索引（垂直方向）。
 * 注意：这些是逻辑坐标，不是像素坐标，渲染时会根据网格配置转换为像素坐标。
 */
export interface Point {
	/** 列索引（水平方向，从 0 开始） */
	readonly x: number;
	/** 提交索引（垂直方向，对应提交在列表中的位置） */
	readonly y: number;
}

/**
 * 线段（逻辑坐标）
 *
 * 表示提交图中的一条连线，连接两个逻辑坐标点。
 * 用于描述分支线段，lockedFirst 表示线段在过渡时锁定哪个端点。
 */
export interface Line {
	/** 线段的起点（逻辑坐标） */
	readonly p1: Point;
	/** 线段的终点（逻辑坐标） */
	readonly p2: Point;
	/**
	 * 线段是否锁定在起点
	 * TRUE => 过渡（分支转折）保持在起点侧，终点延伸
	 * FALSE => 过渡保持在终点侧，起点延伸
	 * 这影响分支转折处的曲线绘制方向
	 */
	readonly lockedFirst: boolean;
}

/**
 * 像素点（屏幕坐标）
 *
 * 表示渲染后的屏幕像素坐标。
 * 与 Point（逻辑坐标）不同，这是实际绘制到 Canvas/SVG 上的坐标。
 */
export interface Pixel {
	/** 水平像素坐标 */
	x: number;
	/** 垂直像素坐标 */
	y: number;
}

/**
 * 已放置的线段（屏幕坐标）
 *
 * 表示已经转换为屏幕像素坐标的线段，用于实际渲染。
 * 比 Line 多了 isCommitted 属性，用于区分已提交和未提交的线段。
 */
export interface PlacedLine {
	/** 线段起点（像素坐标） */
	readonly p1: Pixel;
	/** 线段终点（像素坐标） */
	readonly p2: Pixel;
	/**
	 * 是否是已提交的线段
	 * TRUE => 已提交的提交之间的连线
	 * FALSE => 未提交变更的连线（用不同样式绘制）
	 */
	readonly isCommitted: boolean;
	/**
	 * 线段是否锁定在起点（同 Line.lockedFirst）
	 * 影响分支转折处的曲线绘制方向
	 */
	readonly lockedFirst: boolean;
}


/**
 * ============================================================
 * 辅助类型
 * ============================================================
 */

/**
 * 顶点或 null
 *
 * 表示一个顶点引用，可能为 null（用于表示不存在的顶点，如根提交的父顶点）。
 */
export type VertexOrNull = Vertex | null;

/**
 * 不可用点信息
 *
 * 描述一个被其他分支占用的坐标点。
 * 当一个顶点需要连接到某个位置，但该位置已被其他分支占用时，
 * 记录这个信息以便找到其他可用位置。
 */
export interface UnavailablePoint {
	/** 该不可用点连接到的顶点（可能为 null） */
	readonly connectsTo: VertexOrNull;
	/** 该不可用点所在的分支 */
	readonly onBranch: Branch;
}


/**
 * ============================================================
 * Branch 接口：分支
 * ============================================================
 */

/**
 * 分支接口
 *
 * 表示提交图中的一个分支。
 * 一个分支包含一组线段（Line），用于在图中绘制分支的连线。
 * 每个分支有一个颜色索引，用于确定其绘制颜色。
 *
 * 注意：这是接口形式，描述了分支的公共方法。
 * 具体实现见 commit-graph 组件或图形渲染引擎。
 */
export interface Branch {
	/**
	 * 向分支添加一条线段
	 *
	 * @param p1 - 线段起点（逻辑坐标）
	 * @param p2 - 线段终点（逻辑坐标）
	 * @param isCommitted - 是否是已提交的线段
	 * @param lockedFirst - 是否锁定在起点（影响转折绘制）
	 */
	addLine(p1: Point, p2: Point, isCommitted: boolean, lockedFirst: boolean): void;

	/**
	 * 获取分支的颜色索引
	 *
	 * 颜色索引用于从颜色列表中选择该分支的绘制颜色。
	 *
	 * @returns 颜色索引
	 */
	getColour(): number;

	/**
	 * 获取分支的结束位置
	 *
	 * @returns 结束位置的 y 坐标（提交索引）
	 */
	getEnd(): number;

	/**
	 * 设置分支的结束位置
	 *
	 * @param end - 结束位置的 y 坐标（提交索引）
	 */
	setEnd(end: number): void;

	/**
	 * 将分支绘制到 SVG 元素
	 *
	 * 将分支的所有线段转换为像素坐标并绘制为 SVG 路径。
	 *
	 * @param svg - 目标 SVG 元素
	 * @param config - 图形配置（包含颜色、网格、样式等）
	 * @param expandAt - 展开的提交索引（-1 表示没有展开的提交）；
	 *                   当某个提交详情展开时，需要拉伸图形以腾出空间
	 */
	draw(svg: SVGElement, config: GraphConfig, expandAt: number): void;
}


/**
 * ============================================================
 * Vertex 接口：顶点
 * ============================================================
 */

/**
 * 顶点接口
 *
 * 表示提交图中的一个提交顶点。
 * 每个顶点对应一个提交，包含父提交和子提交的引用，
 * 以及该顶点在图中的位置信息。
 *
 * 顶点是构建提交图的基本单元：
 *   - 通过 parents/children 关系形成有向图
 *   - 通过 onBranch 确定所属分支
 *   - 通过 x 坐标确定在图中的列位置
 *
 * 注意：这是接口形式，描述了顶点的公共属性和方法。
 */
export interface Vertex {
	/** 顶点的唯一 ID（通常等于提交在列表中的索引） */
	readonly id: number;
	/** 是否是 stash 顶点（stash 提交用特殊样式绘制） */
	readonly isStash: boolean;

	/* ---- 子顶点（children）相关 ---- */

	/**
	 * 添加一个子顶点（即当前顶点是 parent 的提交）
	 *
	 * @param vertex - 子顶点
	 */
	addChild(vertex: Vertex): void;

	/**
	 * 获取所有子顶点
	 *
	 * @returns 子顶点数组（只读）
	 */
	getChildren(): ReadonlyArray<Vertex>;

	/* ---- 父顶点（parents）相关 ---- */

	/**
	 * 添加一个父顶点（即当前顶点的 parent 提交）
	 *
	 * @param vertex - 父顶点
	 */
	addParent(vertex: Vertex): void;

	/**
	 * 获取所有父顶点
	 *
	 * 普通提交有一个父顶点，合并提交有多个父顶点。
	 *
	 * @returns 父顶点数组（只读）
	 */
	getParents(): ReadonlyArray<Vertex>;

	/**
	 * 检查是否有父顶点
	 *
	 * @returns TRUE => 有父顶点，FALSE => 没有父顶点（如根提交）
	 */
	hasParents(): boolean;

	/**
	 * 获取下一个待处理的父顶点
	 *
	 * 用于遍历父顶点时的状态追踪。每次调用 registerParentProcessed 后，
	 * getNextParent 会返回下一个未处理的父顶点。
	 *
	 * @returns 下一个待处理的父顶点；如果都已处理完则返回 null
	 */
	getNextParent(): Vertex | null;

	/**
	 * 获取上一个已处理的父顶点
	 *
	 * @returns 上一个已处理的父顶点；如果没有则返回 null
	 */
	getLastParent(): Vertex | null;

	/**
	 * 标记一个父顶点已处理
	 *
	 * 将下一个待处理的父顶点指针向前移动一位。
	 */
	registerParentProcessed(): void;

	/**
	 * 检查是否是合并提交
	 *
	 * 合并提交有多个父顶点。
	 *
	 * @returns TRUE => 是合并提交，FALSE => 不是
	 */
	isMerge(): boolean;

	/* ---- 分支（branch）相关 ---- */

	/**
	 * 将顶点添加到分支
	 *
	 * 如果顶点还未归属任何分支，则将其添加到指定分支并设置 x 坐标。
	 * 已归属分支的顶点不会被重复添加。
	 *
	 * @param branch - 要添加到的分支
	 * @param x - 顶点在图中的列位置（x 坐标）
	 */
	addToBranch(branch: Branch, x: number): void;

	/**
	 * 检查顶点是否未归属任何分支
	 *
	 * @returns TRUE => 未归属分支，FALSE => 已归属分支
	 */
	isNotOnBranch(): boolean;

	/**
	 * 检查顶点是否在指定分支上
	 *
	 * @param branch - 要检查的分支
	 * @returns TRUE => 在该分支上，FALSE => 不在该分支上
	 */
	isOnThisBranch(branch: Branch): boolean;

	/**
	 * 获取顶点所属的分支
	 *
	 * @returns 所属分支；如果未归属任何分支则返回 null
	 */
	getBranch(): Branch | null;

	/* ---- 坐标点（point）相关 ---- */

	/**
	 * 获取顶点在图中的坐标点
	 *
	 * @returns 逻辑坐标点（x 为列位置，y 为提交索引）
	 */
	getPoint(): Point;

	/**
	 * 获取顶点的下一个可用坐标点
	 *
	 * 用于确定顶点在图中的最终列位置。
	 * nextX 会随着 registerUnavailablePoint 调用而递增。
	 *
	 * @returns 下一个可用坐标点
	 */
	getNextPoint(): Point;

	/**
	 * 获取连接到指定顶点和分支的不可用点坐标
	 *
	 * @param vertex - 目标顶点（可能为 null）
	 * @param onBranch - 目标分支
	 * @returns 连接点坐标；如果不存在则返回 null
	 */
	getPointConnectingTo(vertex: VertexOrNull, onBranch: Branch): Point | null;

	/**
	 * 注册一个不可用点
	 *
	 * 当某个 x 坐标位置被其他连接占用时，记录该信息并递增 nextX。
	 *
	 * @param x - 被占用的 x 坐标
	 * @param connectsToVertex - 该点连接到的顶点
	 * @param onBranch - 该点所在的分支
	 */
	registerUnavailablePoint(x: number, connectsToVertex: VertexOrNull, onBranch: Branch): void;

	/* ---- 状态获取/设置 ---- */

	/**
	 * 获取顶点的颜色索引
	 *
	 * 颜色从所属分支继承。
	 *
	 * @returns 颜色索引；如果未归属分支则返回 0
	 */
	getColour(): number;

	/**
	 * 检查顶点是否已提交
	 *
	 * @returns TRUE => 已提交，FALSE => 未提交（工作区变更）
	 */
	getIsCommitted(): boolean;

	/**
	 * 标记顶点为未提交状态
	 *
	 * 用于表示工作区中的未提交变更。
	 */
	setNotCommitted(): void;

	/**
	 * 标记顶点为当前顶点
	 *
	 * 当前顶点（通常是 HEAD）会用特殊样式绘制（空心圆）。
	 */
	setCurrent(): void;

	/* ---- 渲染 ---- */

	/**
	 * 将顶点绘制到 SVG 元素
	 *
	 * 在指定位置绘制一个圆点表示提交，并注册鼠标事件监听器。
	 *
	 * @param svg - 目标 SVG 元素
	 * @param config - 图形配置
	 * @param expandOffset - 是否向下偏移（当展开的提交在此顶点之前时为 true）
	 * @param overListener - 鼠标悬停事件监听器
	 * @param outListener - 鼠标移出事件监听器
	 */
	draw(svg: SVGElement, config: GraphConfig, expandOffset: boolean, overListener: (event: MouseEvent) => void, outListener: (event: MouseEvent) => void): void;
}


/**
 * ============================================================
 * Graph 接口：提交图
 * ============================================================
 */

/**
 * 展开提交信息（简化版）
 *
 * 描述当前展开显示详情的提交。
 * 这是简化版本，只包含 Graph 接口方法用到的 index 字段。
 * 完整版本还包含提交详情、文件变更、头像等信息。
 */
export interface ExpandedCommitInfo {
	/** 展开提交在提交列表中的索引 */
	index: number;
}

/**
 * 提交图接口
 *
 * 表示整个提交图，负责管理顶点和分支，并渲染到 SVG。
 *
 * 工作流程：
 *   1. loadCommits()：加载提交数据，构建顶点和分支关系
 *   2. render()：将图渲染到 SVG 元素
 *   3. 通过各种 get* 方法查询图的信息（宽度、高度、颜色等）
 *
 * 注意：这是接口形式，描述了提交图的公共方法。
 * 具体实现见 commit-graph 组件或图形渲染引擎。
 */
export interface Graph {
	/* ---- 图操作 ---- */

	/**
	 * 加载提交数据并构建图
	 *
	 * 根据提交列表创建顶点，建立父子关系，然后确定每个顶点的分支和位置。
	 *
	 * @param commits - 提交列表（按时间倒序，最新的在前）
	 * @param commitHead - HEAD 提交的哈希；如果没有 HEAD 则为 null
	 * @param commitLookup - 提交哈希到索引的映射（用于快速查找）
	 * @param onlyFollowFirstParent - 是否只跟随第一父提交（忽略合并提交的其他父提交）
	 */
	loadCommits(commits: ReadonlyArray<GitCommit>, commitHead: string | null, commitLookup: { [hash: string]: number }, onlyFollowFirstParent: boolean): void;

	/**
	 * 渲染图到 SVG
	 *
	 * 将所有分支和顶点绘制到 SVG 元素。
	 *
	 * @param expandedCommit - 当前展开的提交信息；如果没有展开的提交则为 null
	 */
	render(expandedCommit: ExpandedCommitInfo | null): void;

	/* ---- 获取尺寸和颜色 ---- */

	/**
	 * 获取图的内容宽度
	 *
	 * 根据顶点的最右位置计算图的总宽度。
	 *
	 * @returns 图的宽度（像素）
	 */
	getContentWidth(): number;

	/**
	 * 获取图的高度
	 *
	 * 根据顶点数量和展开提交计算图的总高度。
	 *
	 * @param expandedCommit - 当前展开的提交信息；如果没有展开的提交则为 null
	 * @returns 图的高度（像素）
	 */
	getHeight(expandedCommit: ExpandedCommitInfo | null): number;

	/**
	 * 获取所有顶点的颜色索引数组
	 *
	 * @returns 颜色索引数组，索引对应顶点 ID
	 */
	getVertexColours(): number[];

	/**
	 * 获取各顶点位置的宽度
	 *
	 * 用于确定分支标签的对齐位置。
	 *
	 * @returns 宽度数组，索引对应顶点 ID
	 */
	getWidthsAtVertices(): number[];

	/* ---- 图查询 ---- */

	/**
	 * 判断指定提交是否可以被丢弃（drop）
	 *
	 * 一个提交可以被丢弃的条件：
	 *   1. 不是合并提交
	 *   2. 只有一个子提交
	 *   3. 其子提交链最终到达 HEAD
	 *
	 * @param i - 提交索引
	 * @returns TRUE => 可以丢弃，FALSE => 不能丢弃
	 */
	dropCommitPossible(i: number): boolean;

	/**
	 * 获取需要静音（低亮度显示）的提交列表
	 *
	 * 根据 muteConfig 配置，返回哪些提交应该以低亮度显示。
	 * 静音条件包括：是合并提交、不是 HEAD 的祖先。
	 *
	 * @param currentHash - 当前 HEAD 的哈希；如果没有则为 null
	 * @returns 布尔数组，true 表示对应索引的提交应该被静音
	 */
	getMutedCommits(currentHash: string | null): boolean[];

	/**
	 * 获取提交的第一父提交索引
	 *
	 * @param i - 提交索引
	 * @returns 第一父提交的索引；如果没有父提交则返回 -1
	 */
	getFirstParentIndex(i: number): number;

	/**
	 * 获取提交的替代父提交索引
	 *
	 * 对于合并提交，返回第二及之后的父提交索引。
	 * 用于在 diff 比较时选择正确的父提交。
	 *
	 * @param i - 提交索引
	 * @returns 替代父提交的索引；如果没有则返回 -1
	 */
	getAlternativeParentIndex(i: number): number;

	/**
	 * 获取提交的第一个子提交索引
	 *
	 * @param i - 提交索引
	 * @returns 第一个子提交的索引；如果没有子提交则返回 -1
	 */
	getFirstChildIndex(i: number): number;
}
