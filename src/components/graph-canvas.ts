/**
 * ============================================================
 * Canvas 图形引擎核心模块（graph-canvas.ts）
 * ============================================================
 *
 * 这个模块是 GitTimePrism 提交节点图的 Canvas 绘制核心。
 * 移植自 gitgraph 项目的 web/graph.ts（原版使用 SVG 渲染），
 * 改为使用 Canvas 2D Context API 渲染，以获得更好的性能。
 *
 * 包含三个核心类：
 *   - Branch（分支）：管理分支的生命周期（颜色分配、路径追踪、路径绘制）
 *   - Vertex（顶点）：表示提交节点在图中的位置和连接关系
 *   - Graph（提交图）：管理整个节点图的数据和渲染
 *
 * 核心算法（移植自 gitgraph）：
 *   1. 分支列分配：每个分支分配一个列号，merge 时释放列
 *      —— 通过 Vertex 的 nextX / connections 机制避免列冲突
 *   2. 路径追踪（determinePath）：从子 commit 追踪到父 commit，
 *      沿途为每个经过的顶点占用列号，形成分支线条
 *   3. Bezier 曲线绘制（rounded 样式）：使用 quadraticCurveTo 绘制平滑转折
 *   4. 折线绘制（angular 样式）：使用 lineTo 绘制尖角转折
 *   5. 颜色回收池：分支结束时释放颜色索引，供新分支复用
 *
 * 与原版 gitgraph 的主要差异：
 *   - 渲染目标从 SVG 改为 Canvas 2D Context
 *   - Branch 用路径点列表（path）替代原版的线段列表（lines）
 *   - 增加 limitMaxWidth 的渐变淡出（使用 Canvas 合成模式实现 mask）
 *   - 增加 getCommitIndexFromHash / getVertexFromRow 等便捷查询方法
 *
 * 使用示例：
 *   const graph = new Graph(canvas, config, muteConfig);
 *   graph.loadCommits(commits, headHash, colours);
 *   graph.render(-1);  // -1 表示没有展开的提交
 * ============================================================
 */

// 导入 Git 相关类型定义
// GitCommit：提交数据（包含 hash、parents、heads、tags 等注解）
// GraphConfig：图形渲染配置（颜色、样式、网格）
// MuteCommitsConfig：静音提交配置（哪些提交变灰显示）
// GraphStyle：图形样式枚举（圆角 / 尖角）
import type { GitCommit, GraphConfig, MuteCommitsConfig } from '../utils/git-types.js';
import { GraphStyle } from '../utils/git-types.js';
// 导入工具函数：UNCOMMITTED 常量（未提交变更的占位哈希 '*'）
import { UNCOMMITTED } from '../utils/git-utils.js';


/**
 * 空顶点 ID
 *
 * 表示不存在的顶点，用于根提交的父顶点（根提交没有父提交）。
 * 使用 -1 与正常的顶点 ID（>= 0）区分。
 */
const NULL_VERTEX_ID: number = -1;


/**
 * ============================================================
 * 基础几何类型
 * ============================================================
 */

/**
 * 逻辑坐标点
 *
 * 表示提交图中的一个逻辑坐标（非像素坐标）。
 * x 是列索引（水平方向，从 0 开始），
 * y 是提交索引（垂直方向，对应提交在列表中的行号）。
 * 渲染时会根据 GraphConfig.grid 配置转换为像素坐标。
 */
export interface Point {
	/** 列索引（水平方向，0 = 最左边的列） */
	readonly x: number;
	/** 提交索引（垂直方向，对应提交在列表中的行号） */
	readonly y: number;
}

/**
 * 路径点（携带线段元信息）
 *
 * 表示分支路径上的一个点。除了坐标外，还携带该点与上一个点之间
 * 线段的元信息：
 *   - isCommitted：是否是已提交的线段（未提交变更用不同样式）
 *   - lockedFirst：转折锁定方向（影响曲线绘制的控制点位置）
 *
 * Branch.path 数组中的第一个点是路径起点，其 isCommitted / lockedFirst
 * 不会被使用（因为它没有"上一个点"）。
 */
export interface PathPoint {
	/** 列索引（逻辑坐标） */
	readonly x: number;
	/** 提交索引（逻辑坐标） */
	readonly y: number;
	/**
	 * 该点与上一个点之间的线段是否是已提交的
	 * TRUE => 两个已提交提交之间的连线（用分支颜色绘制）
	 * FALSE => 未提交变更的连线（用灰色绘制）
	 */
	readonly isCommitted: boolean;
	/**
	 * 该线段的转折是否锁定在起点侧
	 * TRUE => 转折（分支转折曲线）保持在起点侧，终点延伸
	 * FALSE => 转折保持在终点侧，起点延伸
	 * 这影响 rounded 样式下曲线控制点的位置
	 */
	readonly lockedFirst: boolean;
}

/**
 * 像素坐标点（屏幕坐标）
 *
 * 表示渲染后的屏幕像素坐标，用于实际 Canvas 绘制。
 */
export interface Pixel {
	/** 水平像素坐标 */
	x: number;
	/** 垂直像素坐标 */
	y: number;
}

/**
 * 不可用点信息
 *
 * 描述一个被某个分支占用的坐标点。
 * 当一个顶点需要连接到某位置，但该位置已被其他分支占用时，
 * 记录这个信息，以便 determinePath 算法找到可复用的连接点或选择下一个可用列。
 */
interface UnavailablePoint {
	/** 该不可用点连接到的目标顶点（可能为 null） */
	readonly connectsTo: Vertex | null;
	/** 占用该点的分支 */
	readonly onBranch: Branch;
}


/**
 * ============================================================
 * Branch 类：分支
 * ============================================================
 */

/**
 * 分支类
 *
 * 表示提交图中的一个分支线条。
 * 一个分支由一条路径（path 点列表）组成，从子 commit 延伸到父 commit。
 * 每个分支有一个颜色索引，用于从颜色列表中选择绘制颜色。
 *
 * 分支的生命周期：
 *   1. 创建：在 determinePath 中创建，分配颜色（pullAvailableColours）
 *   2. 追踪路径：addPathPoint 逐个添加路径点
 *   3. 结束：到达父 commit 或图末尾，释放颜色（pushAvailableColours）
 *   4. 渲染：renderPath 将路径绘制到 Canvas
 *
 * 颜色回收机制：
 *   - 分支创建时从颜色回收池获取一个可用颜色索引
 *   - 分支结束后将颜色索引放回回收池，供新分支复用
 *   - 这样可以避免颜色数量无限增长，保持视觉效果一致
 */
export class Branch {
	/** 分支的颜色索引（从颜色回收池分配，用于从 colours 数组取色） */
	private readonly colour: number;
	/** 分支名称（用于合并标签显示，可选） */
	private name: string | null = null;
	/** 分支的目标列号（分支希望所在的列，用于路径优化） */
	private targetColumn: number = -1;
	/** 分支的当前列号（路径中最后一个点的列号） */
	private column: number = 0;
	/** 分支的结束位置（y 坐标，即最后一个路径点的提交索引） */
	private end: number = 0;
	/** 路径点列表（按时间顺序，从子 commit 到父 commit） */
	private path: PathPoint[] = [];
	/** 未提交线段的数量（用于区分已提交和未提交部分） */
	private numUncommitted: number = 0;
	/** 分支的结束行号（用于颜色回收：该颜色在此行之后可被复用） */
	private endRow: number = 0;


	/**
	 * 创建分支
	 *
	 * @param colour - 颜色索引（从颜色回收池获取）
	 */
	constructor(colour: number) {
		this.colour = colour;
	}


	/* ---- 颜色回收池相关 ---- */

	/**
	 * 从颜色回收池获取一个可用的颜色索引
	 *
	 * 遍历颜色回收池，找到第一个在 startAt 行之后可用的颜色索引。
	 * 如果没有可用颜色，则扩展颜色池（添加新颜色）。
	 *
	 * 注意：此方法是静态方法，由 Graph 调用，因为颜色池由 Graph 持有。
	 * 这里保留方法名以符合接口设计，实际的颜色池管理在 Graph.getAvailableColour 中。
	 *
	 * @param availableColours - 颜色回收池数组（索引 = 颜色索引，值 = 该颜色可被复用的起始行号）
	 * @param startAt - 开始查找的行号（只有可复用行号 < startAt 的颜色才被视为可用）
	 * @returns 可用的颜色索引
	 */
	public static pullAvailableColours(availableColours: number[], startAt: number): number {
		/* 遍历颜色池，找到第一个可用的颜色 */
		for (let i = 0; i < availableColours.length; i++) {
			if (startAt > availableColours[i]) {
				return i;
			}
		}
		/* 没有可用颜色，扩展颜色池 */
		availableColours.push(0);
		return availableColours.length - 1;
	}

	/**
	 * 释放颜色到回收池
	 *
	 * 分支结束时调用，将该分支的颜色索引放回回收池，
	 * 标记为在 endRow 行之后可被复用。
	 *
	 * @param availableColours - 颜色回收池数组
	 * @param endRow - 分支结束的行号（该颜色在此行之后可被复用）
	 */
	public pushAvailableColours(availableColours: number[]): void {
		/* 将该分支的颜色标记为在 endRow 之后可复用 */
		availableColours[this.colour] = this.endRow;
	}


	/* ---- 路径点管理 ---- */

	/**
	 * 应用路径偏移
	 *
	 * 将路径中所有点的 x 坐标加上偏移量。
	 * 用于在分支列分配后调整整体位置。
	 *
	 * @param offset - x 方向的偏移量（列数）
	 */
	public applyPathOffset(offset: number): void {
		/* 如果没有偏移，直接返回 */
		if (offset === 0) return;
		/* 遍历所有路径点，调整 x 坐标 */
		for (let i = 0; i < this.path.length; i++) {
			(this.path[i] as { x: number }).x = this.path[i].x + offset;
		}
	}

	/**
	 * 添加路径点
	 *
	 * 向分支路径添加一个点。每个点携带与上一个点之间线段的元信息。
	 * 第一个点是路径起点，其 isCommitted / lockedFirst 不使用。
	 *
	 * @param point - 要添加的逻辑坐标点
	 * @param isCommitted - 该点与上一个点之间的线段是否已提交
	 * @param lockedFirst - 该线段的转折是否锁定在起点侧
	 * @param maxBranchCols - 分支最大列数限制（<= 0 表示不限制）
	 */
	public addPathPoint(point: Point, isCommitted: boolean, lockedFirst: boolean, maxBranchCols: number): void {
		/* 如果有列数限制且该点超出限制，不添加 */
		if (maxBranchCols > 0 && point.x >= maxBranchCols) return;

		/* 添加路径点 */
		this.path.push({
			x: point.x,
			y: point.y,
			isCommitted: isCommitted,
			lockedFirst: lockedFirst
		});

		/* 更新当前列号 */
		this.column = point.x;

		/* 统计未提交线段数量（用于渲染时区分样式） */
		if (!isCommitted) {
			this.numUncommitted++;
		}
	}


	/* ---- 渲染 ---- */

	/**
	 * 渲染分支路径到 Canvas
	 *
	 * 将路径点列表转换为像素坐标，并用 Canvas 2D Context 绘制。
	 * 根据样式配置选择绘制方式：
	 *   - Rounded（圆角）：使用 quadraticCurveTo 绘制平滑贝塞尔曲线
	 *   - Angular（尖角）：使用 lineTo 绘制折线
	 *
	 * 绘制逻辑：
	 *   1. 将逻辑坐标转为像素坐标
	 *   2. 处理展开提交的偏移（expandAt）
	 *   3. 简化连续的垂直直线（合并中间点）
	 *   4. 逐段绘制路径，区分已提交/未提交样式
	 *
	 * @param ctx - Canvas 2D 绘图上下文
	 * @param config - 图形配置（包含网格、样式、颜色等）
	 * @param colours - 颜色字符串数组（HEX 格式）
	 * @param expandAt - 展开的提交索引（-1 表示没有展开）；展开时需要拉伸图形
	 */
	public renderPath(ctx: CanvasRenderingContext2D, config: GraphConfig, colours: ReadonlyArray<string>, expandAt: number): void {
		/* 如果路径少于 2 个点，无法绘制线段 */
		if (this.path.length < 2) return;

		/* 获取分支颜色（取模防止越界） */
		const colour = colours[this.colour % colours.length];
		/* 曲线控制点的偏移量：rounded 样式用 0.8 倍行高，angular 用 0.38 倍 */
		const d = config.grid.y * (config.style === GraphStyle.Angular ? 0.38 : 0.8);

		/* 第一步：将逻辑坐标转为像素坐标，并处理展开提交的偏移 */
		const placedPoints: Array<{ x: number; y: number; isCommitted: boolean; lockedFirst: boolean }> = [];
		for (let i = 0; i < this.path.length; i++) {
			const p = this.path[i];
			/* 逻辑坐标 → 像素坐标 */
			let px = p.x * config.grid.x + config.grid.offsetX;
			let py = p.y * config.grid.y + config.grid.offsetY;

			/* 如果有展开的提交，且该点的 y 大于展开位置，需要向下偏移 */
			if (expandAt > -1 && p.y > expandAt) {
				py += config.grid.expandY;
			}

			placedPoints.push({
				x: px,
				y: py,
				isCommitted: p.isCommitted,
				lockedFirst: p.lockedFirst
			});
		}

		/* 第二步：简化连续的垂直直线（合并同列同类型的中间点，减少绘制开销） */
		let i = 0;
		while (i < placedPoints.length - 2) {
			const cur = placedPoints[i];
			const next = placedPoints[i + 1];
			const after = placedPoints[i + 2];
			/* 如果三个点在同一列，且类型相同，可以合并中间点 */
			if (cur.x === next.x && next.x === after.x && cur.isCommitted === next.isCommitted) {
				(placedPoints[i + 1] as { y: number }).y = after.y;
				placedPoints.splice(i + 2, 1);
			} else {
				i++;
			}
		}

		/* 第三步：逐段绘制路径 */
		/* 记录当前路径段的提交状态，状态变化时需要结束当前路径并开始新路径 */
		let curCommitted: boolean | null = null;
		ctx.beginPath();

		for (i = 0; i < placedPoints.length - 1; i++) {
			const p1 = placedPoints[i];
			const p2 = placedPoints[i + 1];

			/* 如果提交状态变化，结束当前路径并开始新路径（用不同颜色/样式） */
			if (curCommitted !== null && curCommitted !== p2.isCommitted) {
				this.strokePathSegment(ctx, curCommitted, colour, config);
				ctx.beginPath();
			}
			curCommitted = p2.isCommitted;

			/* 如果是路径的起点或断点，先 moveTo 到 p1 */
			if (i === 0 || placedPoints[i].x !== placedPoints[i - 1].x || placedPoints[i].y !== placedPoints[i - 1].y) {
				ctx.moveTo(p1.x, p1.y);
			}

			if (p1.x === p2.x) {
				/* 垂直线段：直接画直线 */
				ctx.lineTo(p2.x, p2.y);
			} else {
				/* 水平移动的线段（分支转折）：根据样式绘制曲线或折线 */
				if (config.style === GraphStyle.Angular) {
					/* 尖角样式：用两段直线绘制转折 */
					if (p2.lockedFirst) {
						/* 转折锁定在起点侧：先竖直走到接近终点，再水平走到终点 */
						ctx.lineTo(p2.x, p2.y - d);
					} else {
						/* 转折锁定在终点侧：先竖直走一段，再水平走到终点的 x，再竖直走到终点 */
						ctx.lineTo(p1.x, p1.y + d);
					}
					ctx.lineTo(p2.x, p2.y);
				} else {
					/* 圆角样式：用二次贝塞尔曲线绘制平滑转折 */
					/* 控制点设在转折的角点位置，曲线从 p1 平滑过渡到 p2 */
					const cpX = p1.x;
					const cpY = p1.y + d;
					/* 先画一段直线到曲线起点 */
					ctx.lineTo(p1.x, p1.y + d);
					/* 用二次贝塞尔曲线连接到 p2 */
					ctx.quadraticCurveTo(cpX, p2.y - d, p2.x, p2.y);
				}
			}
		}

		/* 绘制最后一段路径 */
		if (curCommitted !== null) {
			this.strokePathSegment(ctx, curCommitted, colour, config);
		}
	}

	/**
	 * 绘制单段路径（设置颜色和线宽并 stroke）
	 *
	 * 已提交的线段用分支颜色，未提交的线段用灰色。
	 *
	 * @param ctx - Canvas 2D 绘图上下文
	 * @param isCommitted - 是否是已提交的线段
	 * @param colour - 分支颜色
	 * @param config - 图形配置
	 */
	private strokePathSegment(ctx: CanvasRenderingContext2D, isCommitted: boolean, colour: string, config: GraphConfig): void {
		/* 设置线宽和颜色 */
		ctx.lineWidth = 2;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.strokeStyle = isCommitted ? colour : '#808080';
		/* 未提交的线段可以用虚线样式（如果配置了） */
		if (!isCommitted) {
			ctx.setLineDash([3, 3]);
		} else {
			ctx.setLineDash([]);
		}
		ctx.stroke();
		ctx.setLineDash([]);
	}

	/**
	 * 渲染合并标签
	 *
	 * 在合并提交的位置渲染分支名标签。
	 * （此功能为预留，当前阶段仅实现基础结构）
	 *
	 * @param ctx - Canvas 2D 绘图上下文
	 * @param config - 图形配置
	 * @param colours - 颜色数组
	 * @param offset - 像素偏移
	 * @param mergeCommits - 合并提交的 Vertex 数组
	 */
	public renderMergeTag(ctx: CanvasRenderingContext2D, config: GraphConfig, colours: ReadonlyArray<string>, offset: Pixel, mergeCommits: Vertex[]): void {
		/* 如果分支没有名称，不渲染标签 */
		if (this.name === null) return;

		/* 遍历合并提交，在对应位置渲染标签 */
		for (const vertex of mergeCommits) {
			/* 计算标签位置（节点右侧） */
			const x = vertex.col * config.grid.x + config.grid.offsetX + offset.x + 10;
			const y = vertex.row * config.grid.y + config.grid.offsetY + offset.y;

			/* 设置字体和颜色 */
			ctx.font = '11px sans-serif';
			ctx.fillStyle = colours[this.colour % colours.length];

			/* 绘制标签背景 */
			const textWidth = ctx.measureText(this.name).width;
			ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
			ctx.fillRect(x - 3, y - 8, textWidth + 6, 16);

			/* 绘制标签文字 */
			ctx.fillStyle = colours[this.colour % colours.length];
			ctx.fillText(this.name, x, y + 4);
		}
	}


	/* ---- Get / Set ---- */

	/** 获取分支的颜色索引 */
	public getColour(): number {
		return this.colour;
	}

	/** 获取分支的结束位置（y 坐标） */
	public getEnd(): number {
		return this.end;
	}

	/** 设置分支的结束位置 */
	public setEnd(end: number): void {
		this.end = end;
		this.endRow = end;
	}

	/** 设置分支的结束行号（用于颜色回收） */
	public setEndRow(endRow: number): void {
		this.endRow = endRow;
	}

	/** 获取分支名称 */
	public getName(): string | null {
		return this.name;
	}

	/** 设置分支名称 */
	public setName(name: string | null): void {
		this.name = name;
	}

	/** 获取当前列号 */
	public getColumn(): number {
		return this.column;
	}

	/** 设置目标列号 */
	public setTargetColumn(targetColumn: number): void {
		this.targetColumn = targetColumn;
	}
}


/**
 * ============================================================
 * Vertex 类：顶点
 * ============================================================
 */

/**
 * 顶点类
 *
 * 表示提交图中的一个提交顶点。
 * 每个顶点对应一个 GitCommit，包含：
 *   - 提交数据（commit）
 *   - 在图中的位置（row 行号、col 列号、x/y 像素坐标）
 *   - 父子顶点关系（parents / children）
 *   - 所属分支（onBranch）
 *   - 内部状态（用于 determinePath 算法的列分配）
 *
 * 顶点是构建提交图的基本单元：
 *   - 通过 parents/children 关系形成有向图
 *   - 通过 onBranch 确定所属分支
 *   - 通过 col 确定在图中的列位置
 */
export class Vertex {
	/** 顶点的唯一 ID（等于提交在列表中的索引） */
	public readonly id: number;
	/** 是否是 stash 顶点（stash 提交用特殊样式绘制） */
	public readonly isStash: boolean;
	/** 对应的提交数据 */
	public readonly commit: GitCommit;

	/** 行号（提交在列表中的索引，等于 id） */
	private row: number;
	/** 列号（在图中的水平位置，由 determinePath 分配） */
	private col: number = 0;
	/** 像素 x 坐标（渲染时计算） */
	private x: number = 0;
	/** 像素 y 坐标（渲染时计算） */
	private y: number = 0;

	/** 子顶点列表（指向当前顶点的提交） */
	private children: Vertex[] = [];
	/** 父顶点列表（当前顶点的 parent 提交） */
	private parents: Vertex[] = [];
	/** 下一个待处理的父顶点索引（用于 determinePath 遍历） */
	private nextParent: number = 0;
	/** 所属分支（null 表示还未归属任何分支） */
	private onBranch: Branch | null = null;
	/** 是否已提交（false 表示未提交变更的工作区节点） */
	private isCommitted: boolean = true;
	/** 是否是当前顶点（HEAD，用空心圆特殊样式绘制） */
	private isCurrent: boolean = false;
	/** 下一个可用列号（用于 registerUnavailablePoint 递增） */
	private nextX: number = 0;
	/** 被占用的列点信息（connections[x] = 该列被哪个分支占用及连接目标） */
	private connections: UnavailablePoint[] = [];


	/**
	 * 创建顶点
	 *
	 * @param id - 顶点唯一 ID（等于提交索引）
	 * @param isStash - 是否是 stash 顶点
	 * @param commit - 对应的提交数据
	 */
	constructor(id: number, isStash: boolean, commit: GitCommit) {
		this.id = id;
		this.isStash = isStash;
		this.commit = commit;
		this.row = id;
	}


	/* ---- 子顶点（children）相关 ---- */

	/** 添加一个子顶点 */
	public addChild(vertex: Vertex): void {
		this.children.push(vertex);
	}

	/** 获取所有子顶点（只读数组） */
	public getChildren(): ReadonlyArray<Vertex> {
		return this.children;
	}


	/* ---- 父顶点（parents）相关 ---- */

	/** 添加一个父顶点 */
	public addParent(vertex: Vertex): void {
		this.parents.push(vertex);
	}

	/** 获取所有父顶点（只读数组） */
	public getParents(): ReadonlyArray<Vertex> {
		return this.parents;
	}

	/** 检查是否有父顶点 */
	public hasParents(): boolean {
		return this.parents.length > 0;
	}

	/**
	 * 获取下一个待处理的父顶点
	 *
	 * determinePath 算法逐个处理父顶点。每次调用 registerParentProcessed 后，
	 * 此方法返回下一个未处理的父顶点。
	 *
	 * @returns 下一个待处理的父顶点；如果都已处理完则返回 null
	 */
	public getNextParent(): Vertex | null {
		if (this.nextParent < this.parents.length) {
			return this.parents[this.nextParent];
		}
		return null;
	}

	/** 获取上一个已处理的父顶点 */
	public getLastParent(): Vertex | null {
		if (this.nextParent < 1) return null;
		return this.parents[this.nextParent - 1];
	}

	/** 标记一个父顶点已处理（将 nextParent 指针前移） */
	public registerParentProcessed(): void {
		this.nextParent++;
	}

	/** 检查是否是合并提交（有多个父顶点） */
	public isMerge(): boolean {
		return this.parents.length > 1;
	}


	/* ---- 分支（branch）相关 ---- */

	/**
	 * 将顶点添加到分支
	 *
	 * 如果顶点还未归属任何分支，则将其添加到指定分支并设置列号。
	 * 已归属分支的顶点不会被重复添加。
	 *
	 * @param branch - 要添加到的分支
	 * @param col - 顶点在图中的列号
	 */
	public addToBranch(branch: Branch, col: number): void {
		if (this.onBranch === null) {
			this.onBranch = branch;
			this.col = col;
		}
	}

	/** 检查顶点是否未归属任何分支 */
	public isNotOnBranch(): boolean {
		return this.onBranch === null;
	}

	/** 检查顶点是否在指定分支上 */
	public isOnThisBranch(branch: Branch): boolean {
		return this.onBranch === branch;
	}

	/** 获取顶点所属的分支 */
	public getBranch(): Branch | null {
		return this.onBranch;
	}


	/* ---- 坐标点（point）相关 ---- */

	/** 获取顶点的逻辑坐标点（x = 列号，y = 行号） */
	public getPoint(): Point {
		return { x: this.col, y: this.id };
	}

	/** 获取顶点的下一个可用坐标点（nextX = 下一个可用列） */
	public getNextPoint(): Point {
		return { x: this.nextX, y: this.id };
	}

	/**
	 * 获取连接到指定顶点和分支的不可用点坐标
	 *
	 * 用于 merge 提交的路径追踪：查找是否已有路径点连接到目标父顶点。
	 *
	 * @param vertex - 目标顶点
	 * @param onBranch - 目标分支
	 * @returns 连接点坐标；如果不存在则返回 null
	 */
	public getPointConnectingTo(vertex: Vertex | null, onBranch: Branch): Point | null {
		for (let i = 0; i < this.connections.length; i++) {
			if (this.connections[i] !== undefined && this.connections[i].connectsTo === vertex && this.connections[i].onBranch === onBranch) {
				return { x: i, y: this.id };
			}
		}
		return null;
	}

	/**
	 * 注册一个不可用点（占用一个列）
	 *
	 * 当某列被某分支的路径占用时，记录该信息。
	 * 如果占用的是 nextX 位置，则递增 nextX。
	 *
	 * @param x - 被占用的列号
	 * @param connectsToVertex - 该点连接到的目标顶点
	 * @param onBranch - 占用该点的分支
	 */
	public registerUnavailablePoint(x: number, connectsToVertex: Vertex | null, onBranch: Branch): void {
		if (x === this.nextX) {
			this.nextX = x + 1;
		}
		this.connections[x] = { connectsTo: connectsToVertex, onBranch: onBranch };
	}


	/* ---- 状态获取/设置 ---- */

	/** 获取顶点颜色索引（从所属分支继承） */
	public getColour(): number {
		return this.onBranch !== null ? this.onBranch.getColour() : 0;
	}

	/** 检查顶点是否已提交 */
	public getIsCommitted(): boolean {
		return this.isCommitted;
	}

	/** 标记顶点为未提交状态（工作区变更） */
	public setNotCommitted(): void {
		this.isCommitted = false;
	}

	/** 标记顶点为当前顶点（HEAD） */
	public setCurrent(): void {
		this.isCurrent = true;
	}

	/** 检查是否是当前顶点（HEAD） */
	public isCurrentVertex(): boolean {
		return this.isCurrent;
	}

	/** 获取行号 */
	public getRow(): number {
		return this.row;
	}

	/** 获取列号 */
	public getCol(): number {
		return this.col;
	}

	/** 设置像素坐标（渲染时由 Graph 计算） */
	public setPixelPosition(x: number, y: number): void {
		this.x = x;
		this.y = y;
	}

	/** 获取像素 x 坐标 */
	public getPixelX(): number {
		return this.x;
	}

	/** 获取像素 y 坐标 */
	public getPixelY(): number {
		return this.y;
	}


	/* ---- 渲染 ---- */

	/**
	 * 渲染节点圆点到 Canvas
	 *
	 * 在顶点位置绘制一个圆点表示提交。绘制规则：
	 *   - HEAD 顶点：空心圆（用分支颜色描边，内部透明）
	 *   - stash 顶点：双层圆（外圈 + 内圈）
	 *   - 普通顶点：实心圆（用分支颜色填充）
	 *   - muted 顶点：用灰色绘制
	 *
	 * @param ctx - Canvas 2D 绘图上下文
	 * @param config - 图形配置
	 * @param colours - 颜色数组
	 * @param muted - 是否静音（变灰显示）
	 * @param offset - 像素偏移
	 * @param expandOffset - 是否因展开提交而向下偏移
	 */
	public render(ctx: CanvasRenderingContext2D, config: GraphConfig, colours: ReadonlyArray<string>, muted: boolean, offset: Pixel, expandOffset: boolean): void {
		/* 如果未归属分支，不绘制 */
		if (this.onBranch === null) return;

		/* 计算颜色：已提交用分支颜色，未提交用灰色；muted 用灰色 */
		const colourIndex = this.onBranch.getColour() % colours.length;
		const colour = muted ? '#808080' : (this.isCommitted ? colours[colourIndex] : '#808080');

		/* 计算像素坐标 */
		const cx = this.col * config.grid.x + config.grid.offsetX + offset.x;
		const cy = this.row * config.grid.y + config.grid.offsetY + offset.y + (expandOffset ? config.grid.expandY : 0);

		/* 保存像素坐标（供 tooltip 等使用） */
		this.setPixelPosition(cx, cy);

		/* 根据顶点类型绘制圆点 */
		if (this.isCurrent) {
			/* HEAD 顶点：空心圆（描边） */
			ctx.beginPath();
			ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
			ctx.fillStyle = '#ffffff';
			ctx.fill();
			ctx.lineWidth = 2;
			ctx.strokeStyle = colour;
			ctx.stroke();
		} else {
			/* 普通顶点：实心圆 */
			ctx.beginPath();
			ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
			ctx.fillStyle = colour;
			ctx.fill();
			/* 白色描边使圆点更醒目 */
			ctx.lineWidth = 1.5;
			ctx.strokeStyle = '#ffffff';
			ctx.stroke();
		}

		/* stash 顶点：绘制双层圆（外圈 + 内圈） */
		if (this.isStash && !this.isCurrent) {
			ctx.beginPath();
			ctx.arc(cx, cy, 4.5, 0, 2 * Math.PI);
			ctx.lineWidth = 1.5;
			ctx.strokeStyle = colour;
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(cx, cy, 2, 0, 2 * Math.PI);
			ctx.fillStyle = colour;
			ctx.fill();
		}
	}

	/**
	 * 获取合并到该顶点的所有分支颜色列表
	 *
	 * 对于合并提交，返回该顶点所属分支颜色 + 所有父顶点所属分支颜色（去重）。
	 * 用于在合并节点绘制多色圆环（如果需要）。
	 *
	 * @param colours - 颜色数组
	 * @returns 颜色字符串列表
	 */
	public getMergedColours(colours: ReadonlyArray<string>): string[] {
		const result: string[] = [];
		const seenIndices = new Set<number>();

		/* 添加自身分支颜色 */
		if (this.onBranch !== null) {
			const idx = this.onBranch.getColour() % colours.length;
			if (!seenIndices.has(idx)) {
				seenIndices.add(idx);
				result.push(colours[idx]);
			}
		}

		/* 添加所有父顶点的分支颜色 */
		for (const parent of this.parents) {
			const branch = parent.getBranch();
			if (branch !== null) {
				const idx = branch.getColour() % colours.length;
				if (!seenIndices.has(idx)) {
					seenIndices.add(idx);
					result.push(colours[idx]);
				}
			}
		}

		return result;
	}
}


/**
 * ============================================================
 * Graph 类：提交图
 * ============================================================
 */

/**
 * 展开提交信息（简化版）
 *
 * 描述当前展开显示详情的提交索引。
 */
export interface ExpandedCommit {
	/** 展开提交在提交列表中的索引 */
	readonly index: number;
}

/**
 * 提交图类
 *
 * 管理整个提交节点图的数据和渲染。
 *
 * 工作流程：
 *   1. 构造：传入 Canvas 元素和配置
 *   2. loadCommits：加载提交数据，构建 Vertex 和 Branch（执行 determinePath 算法）
 *   3. render：将所有分支和顶点绘制到 Canvas
 *
 * 核心功能：
 *   - 分支列分配与路径追踪（determinePath）
 *   - 颜色回收池管理（availableColours）
 *   - Canvas 渲染（分支线 + 节点圆点）
 *   - 最大宽度限制与渐变淡出（limitMaxWidth）
 *   - 静音提交计算（getMutedCommits）
 *   - 拓扑检查（dropCommitPossible）
 *   - 键盘导航辅助（getFirstParentIndex 等）
 */
export class Graph {
	/** Canvas 元素 */
	private readonly canvas: HTMLCanvasElement;
	/** Canvas 2D 绘图上下文 */
	private readonly ctx: CanvasRenderingContext2D;
	/** 图形配置（颜色、样式、网格） */
	private readonly config: GraphConfig;
	/** 静音提交配置 */
	private readonly muteConfig: MuteCommitsConfig;

	/** 顶点列表（索引 = 提交索引） */
	private vertices: Vertex[] = [];
	/** 分支列表 */
	private branches: Branch[] = [];
	/** 颜色回收池（索引 = 颜色索引，值 = 该颜色可被复用的起始行号） */
	private availableColours: number[] = [];
	/** 最大宽度限制（-1 表示不限制） */
	private maxWidth: number = -1;

	/** 提交数据列表 */
	private commits: ReadonlyArray<GitCommit> = [];
	/** HEAD 提交的哈希 */
	private commitHead: string | null = null;
	/** 提交哈希到索引的映射（用于快速查找） */
	private commitLookup: { [hash: string]: number } = {};
	/** 是否只跟随第一父提交 */
	private onlyFollowFirstParent: boolean = false;
	/** 颜色字符串数组 */
	private colours: ReadonlyArray<string> = [];
	/** 当前展开的提交索引（-1 表示没有展开） */
	private expandedCommitIndex: number = -1;


	/**
	 * 创建提交图
	 *
	 * @param canvas - Canvas DOM 元素
	 * @param config - 图形配置
	 * @param muteConfig - 静音提交配置
	 */
	constructor(canvas: HTMLCanvasElement, config: GraphConfig, muteConfig: MuteCommitsConfig) {
		this.canvas = canvas;
		this.config = config;
		this.muteConfig = muteConfig;
		/* 获取 2D 绘图上下文 */
		const ctx = canvas.getContext('2d');
		if (ctx === null) {
			throw new Error('无法获取 Canvas 2D 绘图上下文');
		}
		this.ctx = ctx;
	}


	/* ---- 图操作 ---- */

	/**
	 * 加载提交数据并构建图
	 *
	 * 根据提交列表创建顶点，建立父子关系，然后执行 determinePath 算法
	 * 确定每个顶点的分支归属和列位置。
	 *
	 * @param commits - 提交列表（按时间倒序，最新的在前）
	 * @param head - HEAD 提交的哈希；如果没有则为 null
	 * @param colours - 颜色字符串数组（HEX 格式）
	 */
	public loadCommits(commits: ReadonlyArray<GitCommit>, head: string | null, colours: ReadonlyArray<string>): void {
		this.commits = commits;
		this.commitHead = head;
		this.colours = colours;
		this.vertices = [];
		this.branches = [];
		this.availableColours = [];

		/* 构建哈希到索引的映射 */
		this.commitLookup = {};
		for (let i = 0; i < commits.length; i++) {
			this.commitLookup[commits[i].hash] = i;
		}

		/* 如果没有提交，直接返回 */
		if (commits.length === 0) return;

		/* 创建空顶点（用于表示不存在的父顶点，如根提交的父顶点） */
		const nullVertex = new Vertex(NULL_VERTEX_ID, false, commits[0]);

		/* 第一步：为每个提交创建 Vertex */
		for (let i = 0; i < commits.length; i++) {
			this.vertices.push(new Vertex(i, commits[i].stash !== null, commits[i]));
		}

		/* 第二步：建立父子关系 */
		for (let i = 0; i < commits.length; i++) {
			for (let j = 0; j < commits[i].parents.length; j++) {
				const parentHash = commits[i].parents[j];
				if (typeof this.commitLookup[parentHash] === 'number') {
					/* 父提交在图中：建立双向父子关系 */
					const parentIdx = this.commitLookup[parentHash];
					this.vertices[i].addParent(this.vertices[parentIdx]);
					this.vertices[parentIdx].addChild(this.vertices[i]);
				} else if (!this.onlyFollowFirstParent || j === 0) {
					/* 父提交不在图中，且没有被 onlyFollowFirstParent 隐藏：用空顶点占位 */
					this.vertices[i].addParent(nullVertex);
				}
			}
		}

		/* 第三步：标记未提交变更顶点 */
		if (commits[0].hash === UNCOMMITTED) {
			this.vertices[0].setNotCommitted();
		}

		/* 第四步：标记 HEAD 顶点 */
		if (commits[0].hash === UNCOMMITTED) {
			/* 未提交变更节点标记为当前 */
			this.vertices[0].setCurrent();
		} else if (head !== null && typeof this.commitLookup[head] === 'number') {
			/* HEAD 在图中：标记为当前 */
			this.vertices[this.commitLookup[head]].setCurrent();
		}

		/* 第五步：执行 determinePath 算法，确定分支和列位置 */
		let i = 0;
		while (i < this.vertices.length) {
			if (this.vertices[i].getNextParent() !== null || this.vertices[i].isNotOnBranch()) {
				this.determinePath(i);
			} else {
				i++;
			}
		}
	}

	/**
	 * 渲染整个图到 Canvas
	 *
	 * 将所有分支路径和顶点圆点绘制到 Canvas。
	 * 处理高 DPI 屏幕（按 devicePixelRatio 放大）。
	 *
	 * @param expandedCommitIndex - 展开的提交索引（-1 表示没有展开）
	 */
	public render(expandedCommitIndex: number): void {
		this.expandedCommitIndex = expandedCommitIndex;

		/* 如果没有顶点，清空 Canvas */
		if (this.vertices.length === 0) {
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
			return;
		}

		/* 计算内容宽度和高度 */
		const contentWidth = this.getContentWidth();
		const height = this.getHeight(expandedCommitIndex);

		/* 处理高 DPI 屏幕：按 devicePixelRatio 放大 Canvas 实际像素 */
		const dpr = window.devicePixelRatio || 1;
		const displayWidth = this.maxWidth > -1 ? Math.min(contentWidth, this.maxWidth) : contentWidth;
		this.canvas.width = Math.ceil(displayWidth * dpr);
		this.canvas.height = Math.ceil(height * dpr);
		this.canvas.style.width = displayWidth + 'px';
		this.canvas.style.height = height + 'px';
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		/* 清空 Canvas */
		this.ctx.clearRect(0, 0, displayWidth, height);

		/* 获取需要静音的提交列表 */
		const muted = this.getMutedCommits(this.commitHead);

		/* 偏移量（0,0，因为 Canvas 坐标已包含 offset） */
		const offset: Pixel = { x: 0, y: 0 };

		/* 第一步：渲染所有分支路径 */
		for (let i = 0; i < this.branches.length; i++) {
			this.branches[i].renderPath(this.ctx, this.config, this.colours, expandedCommitIndex);
		}

		/* 第二步：渲染所有顶点圆点 */
		for (let i = 0; i < this.vertices.length; i++) {
			const expandOffset = expandedCommitIndex > -1 && i > expandedCommitIndex;
			this.vertices[i].render(this.ctx, this.config, this.colours, muted[i], offset, expandOffset);
		}

		/* 第三步：应用最大宽度限制（渐变淡出效果） */
		if (this.maxWidth > -1) {
			this.applyMaxWidth(contentWidth, displayWidth, height);
		}
	}


	/* ---- 获取尺寸和颜色 ---- */

	/**
	 * 获取图的内容宽度
	 *
	 * 根据所有顶点的最大列号计算图的总宽度。
	 *
	 * @returns 图的宽度（像素）
	 */
	public getContentWidth(): number {
		let maxX = 0;
		for (let i = 0; i < this.vertices.length; i++) {
			const p = this.vertices[i].getNextPoint();
			if (p.x > maxX) maxX = p.x;
		}
		return 2 * this.config.grid.offsetX + maxX * this.config.grid.x;
	}

	/**
	 * 获取图的高度
	 *
	 * @param expandedCommitIndex - 展开的提交索引（-1 表示没有展开）
	 * @returns 图的高度（像素）
	 */
	public getHeight(expandedCommitIndex: number): number {
		const expandY = expandedCommitIndex > -1 ? this.config.grid.expandY : 0;
		return this.vertices.length * this.config.grid.y + this.config.grid.offsetY - this.config.grid.y / 2 + expandY;
	}

	/**
	 * 获取所有顶点的颜色索引数组
	 *
	 * @returns 颜色索引数组，索引对应顶点 ID
	 */
	public getVertexColours(): number[] {
		const colours: number[] = [];
		for (let i = 0; i < this.vertices.length; i++) {
			colours[i] = this.vertices[i].getColour() % this.colours.length;
		}
		return colours;
	}

	/**
	 * 获取各顶点位置的宽度
	 *
	 * 用于确定分支标签的对齐位置。
	 *
	 * @returns 宽度数组，索引对应顶点 ID
	 */
	public getWidthsAtVertices(): number[] {
		const widths: number[] = [];
		for (let i = 0; i < this.vertices.length; i++) {
			widths[i] = this.config.grid.offsetX + this.vertices[i].getNextPoint().x * this.config.grid.x - 2;
		}
		return widths;
	}


	/* ---- 图查询 ---- */

	/**
	 * 判断指定提交是否可以被丢弃（drop）
	 *
	 * 拓扑检查：一个提交可以被丢弃的条件：
	 *   1. 不是合并提交
	 *   2. 只有一个子提交
	 *   3. 其子提交链最终到达 HEAD
	 *
	 * @param commitHash - 要检查的提交哈希
	 * @returns TRUE => 可以丢弃，FALSE => 不能丢弃
	 */
	public dropCommitPossible(commitHash: string): boolean {
		const idx = this.getCommitIndexFromHash(commitHash);
		if (idx === -1) return false;
		if (!this.vertices[idx].hasParents()) return false;

		/* 递归检查：沿着子提交链查找 HEAD */
		const isPossible = (v: Vertex): boolean | null => {
			if (v.isMerge()) {
				/* 合并提交不能丢弃 */
				return null;
			}
			const children = v.getChildren();
			if (children.length > 1) {
				/* 多个子提交：不能丢弃 */
				return null;
			} else if (children.length === 1) {
				const recursivelyPossible = isPossible(children[0]);
				if (recursivelyPossible !== false) {
					return recursivelyPossible;
				}
			}
			/* 检查当前顶点是否是 HEAD */
			return this.commits[v.id].hash === this.commitHead;
		};

		return isPossible(this.vertices[idx]) || false;
	}

	/**
	 * 获取需要静音（低亮度显示）的提交列表
	 *
	 * 根据 muteConfig 配置，返回哪些提交应该以低亮度显示。
	 * 静音条件：
	 *   - 是合并提交（如果 muteConfig.mergeCommits 为 true）
	 *   - 不是 HEAD 的祖先（如果 muteConfig.commitsNotAncestorsOfHead 为 true）
	 *
	 * @param currentHash - 当前 HEAD 的哈希
	 * @returns 布尔数组，true 表示对应索引的提交应该被静音
	 */
	public getMutedCommits(currentHash: string | null): boolean[] {
		const muted: boolean[] = [];
		for (let i = 0; i < this.commits.length; i++) {
			muted[i] = false;
		}

		/* 静音合并提交 */
		if (this.muteConfig.mergeCommits) {
			for (let i = 0; i < this.commits.length; i++) {
				if (this.vertices[i].isMerge() && this.commits[i].stash === null) {
					muted[i] = true;
				}
			}
		}

		/* 静音非 HEAD 祖先的提交 */
		if (this.muteConfig.commitsNotAncestorsOfHead && currentHash !== null && typeof this.commitLookup[currentHash] === 'number') {
			const ancestor: boolean[] = [];
			for (let i = 0; i < this.commits.length; i++) {
				ancestor[i] = false;
			}

			/* 递归发现 HEAD 的所有祖先 */
			const rec = (vertex: Vertex): void => {
				if (vertex.id === NULL_VERTEX_ID || ancestor[vertex.id]) return;
				ancestor[vertex.id] = true;
				const parents = vertex.getParents();
				for (let i = 0; i < parents.length; i++) {
					rec(parents[i]);
				}
			};
			rec(this.vertices[this.commitLookup[currentHash]]);

			/* 非祖先的提交标记为静音 */
			for (let i = 0; i < this.commits.length; i++) {
				if (!ancestor[i]) {
					muted[i] = true;
				}
			}
		}

		return muted;
	}

	/**
	 * 获取提交的第一父提交索引
	 *
	 * 用于键盘导航（向下移动到父提交）。
	 *
	 * @param index - 提交索引
	 * @returns 第一父提交的索引；如果没有父提交则返回 -1
	 */
	public getFirstParentIndex(index: number): number {
		if (index < 0 || index >= this.vertices.length) return -1;
		const parents = this.vertices[index].getParents();
		return parents.length > 0 ? parents[0].id : -1;
	}

	/**
	 * 获取提交的替代父提交索引
	 *
	 * 对于合并提交，返回第二及之后的父提交索引。
	 * 用于在 diff 比较时选择正确的父提交。
	 *
	 * @param index - 提交索引
	 * @returns 替代父提交的索引；如果没有则返回 -1
	 */
	public getAlternativeParentIndex(index: number): number {
		if (index < 0 || index >= this.vertices.length) return -1;
		const parents = this.vertices[index].getParents();
		if (parents.length > 1) {
			return parents[1].id;
		} else if (parents.length === 1) {
			return parents[0].id;
		}
		return -1;
	}

	/**
	 * 获取提交的第一个子提交索引
	 *
	 * 用于键盘导航（向上移动到子提交）。
	 *
	 * @param index - 提交索引
	 * @returns 第一个子提交的索引；如果没有子提交则返回 -1
	 */
	public getFirstChildIndex(index: number): number {
		if (index < 0 || index >= this.vertices.length) return -1;
		const children = this.vertices[index].getChildren();
		if (children.length > 1) {
			/* 多个子提交：优先返回同分支的子提交 */
			const branch = this.vertices[index].getBranch();
			if (branch !== null) {
				const childOnSameBranch = children.find((child) => child.isOnThisBranch(branch));
				if (childOnSameBranch) {
					return childOnSameBranch.id;
				}
			}
			/* 没有同分支的子提交：返回 ID 最大的 */
			return Math.max(...children.map((child) => child.id));
		} else if (children.length === 1) {
			return children[0].id;
		}
		return -1;
	}

	/**
	 * 根据提交哈希获取索引
	 *
	 * @param hash - 提交哈希
	 * @returns 提交索引；如果不存在则返回 -1
	 */
	public getCommitIndexFromHash(hash: string): number {
		if (typeof this.commitLookup[hash] === 'number') {
			return this.commitLookup[hash];
		}
		return -1;
	}

	/**
	 * 根据行号获取顶点
	 *
	 * @param row - 行号（提交索引）
	 * @returns 对应的顶点；如果不存在则返回 null
	 */
	public getVertexFromRow(row: number): Vertex | null {
		if (row < 0 || row >= this.vertices.length) return null;
		return this.vertices[row];
	}

	/**
	 * 获取所有顶点
	 *
	 * @returns 顶点数组（只读）
	 */
	public getVertices(): ReadonlyArray<Vertex> {
		return this.vertices;
	}

	/**
	 * 获取所有分支
	 *
	 * @returns 分支数组（只读）
	 */
	public getBranches(): ReadonlyArray<Branch> {
		return this.branches;
	}


	/* ---- 宽度调整 ---- */

	/**
	 * 限制图形最大宽度
	 *
	 * 设置最大宽度后，超过该宽度的部分会用渐变淡出效果隐藏。
	 *
	 * @param maxWidth - 最大宽度（像素）；-1 表示不限制
	 */
	public limitMaxWidth(maxWidth: number): void {
		this.maxWidth = maxWidth;
	}


	/**
	 * 应用最大宽度限制（渐变淡出效果）
	 *
	 * 使用 Canvas 的合成模式实现 mask 效果：
	 *   1. 创建从白色（不透明）到黑色（透明）的线性渐变
	 *   2. 用 destination-in 合成模式填充渐变，保留渐变不透明部分的图形
	 *
	 * @param contentWidth - 图的实际内容宽度
	 * @param displayWidth - 显示宽度（限制后的）
	 * @param height - 图的高度
	 */
	private applyMaxWidth(contentWidth: number, displayWidth: number, height: number): void {
		if (contentWidth <= displayWidth) return;

		/* 创建渐变：从左侧不透明到右侧透明 */
		const gradient = this.ctx.createLinearGradient(
			0, 0,
			displayWidth, 0
		);
		/* 左侧大部分区域不透明（白色），右侧快速淡出 */
		const fadeStart = (displayWidth - 12) / displayWidth;
		gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
		gradient.addColorStop(fadeStart, 'rgba(0, 0, 0, 1)');
		gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

		/* 用 destination-in 合成模式应用 mask：只保留渐变不透明部分的图形 */
		this.ctx.save();
		this.ctx.globalCompositeOperation = 'destination-in';
		this.ctx.fillStyle = gradient;
		this.ctx.fillRect(0, 0, displayWidth, height);
		this.ctx.restore();
	}


	/* ---- 图布局算法 ---- */

	/**
	 * 确定路径（determinePath）
	 *
	 * 这是图布局的核心算法。从指定的顶点开始，追踪到其父顶点，
	 * 创建分支并分配列号。
	 *
	 * 算法分两种情况：
	 *
	 * 情况 1：merge 提交且父顶点已在分支上
	 *   - 复用父顶点的分支
	 *   - 从当前顶点追踪路径到父顶点
	 *   - 沿途占用列号
	 *
	 * 情况 2：正常分支
	 *   - 创建新分支，分配颜色
	 *   - 从当前顶点追踪到父顶点，沿途添加路径点
	 *   - 到达父顶点后，将父顶点加入分支，继续追踪父顶点的下一个父顶点
	 *   - 分支结束时释放颜色到回收池
	 *
	 * @param startAt - 开始追踪的顶点索引
	 */
	private determinePath(startAt: number): void {
		let i = startAt;
		let vertex = this.vertices[i];
		let parentVertex = vertex.getNextParent();

		/* lastPoint 是路径追踪的当前起点 */
		let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint();

		if (parentVertex !== null && parentVertex.id !== NULL_VERTEX_ID && vertex.isMerge() && !vertex.isNotOnBranch() && !parentVertex.isNotOnBranch()) {
			/* ===== 情况 1：merge 提交且父顶点已在分支上 ===== */
			/* 复用父顶点的分支，从当前顶点追踪路径到父顶点 */
			let foundPointToParent = false;
			const parentBranch = parentVertex.getBranch()!;

			for (i = startAt + 1; i < this.vertices.length; i++) {
				const curVertex = this.vertices[i];
				/* 检查是否已有路径点连接到目标父顶点 */
				let curPoint = curVertex.getPointConnectingTo(parentVertex, parentBranch);
				if (curPoint !== null) {
					foundPointToParent = true;
				} else {
					/* 没有现成连接点，使用下一个可用点 */
					curPoint = curVertex.getNextPoint();
				}

				/* 添加路径点到父顶点的分支 */
				const lockedFirst = !foundPointToParent && curVertex !== parentVertex ? lastPoint.x < curPoint.x : true;
				parentBranch.addPathPoint(lastPoint, vertex.getIsCommitted() && curVertex.getIsCommitted(), lockedFirst, 0);
				/* 额外的路径点用于连接（如果存在的话） */
				parentBranch.addPathPoint(curPoint, vertex.getIsCommitted() && curVertex.getIsCommitted(), lockedFirst, 0);
				curVertex.registerUnavailablePoint(curPoint.x, parentVertex, parentBranch);
				lastPoint = curPoint;

				if (foundPointToParent) {
					/* 找到父顶点，标记已处理 */
					vertex.registerParentProcessed();
					break;
				}
			}
		} else {
			/* ===== 情况 2：正常分支 ===== */
			/* 创建新分支，分配颜色 */
			const branch = new Branch(Branch.pullAvailableColours(this.availableColours, startAt));
			vertex.addToBranch(branch, lastPoint.x);
			vertex.registerUnavailablePoint(lastPoint.x, vertex, branch);

			/* 添加路径起点 */
			branch.addPathPoint(lastPoint, vertex.getIsCommitted(), true, 0);

			for (i = startAt + 1; i < this.vertices.length; i++) {
				const curVertex = this.vertices[i];
				/* 如果当前顶点就是父顶点且已在分支上，使用其已分配的列；否则使用下一个可用列 */
				const curPoint = parentVertex === curVertex && !parentVertex.isNotOnBranch() ? curVertex.getPoint() : curVertex.getNextPoint();

				/* 添加路径点 */
				const lockedFirst = lastPoint.x < curPoint.x;
				branch.addPathPoint(curPoint, vertex.getIsCommitted() && curVertex.getIsCommitted(), lockedFirst, 0);
				curVertex.registerUnavailablePoint(curPoint.x, parentVertex, branch);
				lastPoint = curPoint;

				if (parentVertex === curVertex) {
					/* 到达父顶点：将父顶点加入分支，继续追踪父顶点的下一个父顶点 */
					vertex.registerParentProcessed();
					const parentVertexOnBranch = !parentVertex.isNotOnBranch();
					parentVertex.addToBranch(branch, curPoint.x);
					vertex = parentVertex;
					parentVertex = vertex.getNextParent();
					if (parentVertex === null || parentVertexOnBranch) {
						/* 没有更多父顶点，或父顶点已在其他分支上：分支结束 */
						break;
					}
				}
			}

			/* 如果到达图末尾且父顶点是空顶点，标记已处理 */
			if (i === this.vertices.length && parentVertex !== null && parentVertex.id === NULL_VERTEX_ID) {
				vertex.registerParentProcessed();
			}

			/* 设置分支结束位置，释放颜色 */
			branch.setEnd(i);
			branch.setEndRow(i);
			branch.pushAvailableColours(this.availableColours);
			this.branches.push(branch);
		}
	}
}
