/**
 * ============================================================
 * 右键菜单组件（context-menu.ts）
 * ============================================================
 *
 * 这个组件实现了 GitTimePrism 的全局右键菜单。
 * 移植自 gitgraph 项目的 web/contextMenu.ts，做了以下调整：
 *
 * 1. 改为 TypeScript 显式类型注解（gitgraph 是 JS + JSDoc）
 * 2. 移除了 gitgraph 内部依赖（如 TargetType 全局枚举、
 *    findCommitElemWithId、getCommitElems、alterClassOfCollection），
 *    改为通过参数传入或使用项目内已有的 git-utils 工具函数
 * 3. 适配项目 DOM 结构：commit-graph.ts 渲染的提交行使用
 *    .commit-row[data-hash] 类名，ref 标签使用
 *    .ref-label[data-ref-name] 类名
 * 4. 增加 ESC 键关闭菜单的支持（gitgraph 原版只支持点击外部关闭）
 * 5. 适配毛玻璃效果：菜单容器使用 backdrop-filter 实现毛玻璃背景
 *
 * 架构设计：
 *   - ContextMenu 类管理菜单的显示、关闭、刷新
 *   - 全局单例 contextMenu 在模块加载时创建一次
 *   - 智能定位算法：默认右下展开，空间不够时自动切换到左/上展开
 *   - 动态目标重绑定：commits 列表重渲染后通过 refresh() 重新定位元素
 *
 * DOM 结构：
 *   <ul class="context-menu">
 *     <li class="context-menu-item" data-index="0">菜单项 1</li>
 *     <li class="context-menu-item" data-index="1">菜单项 2</li>
 *     <li class="context-menu-separator"></li>
 *     <li class="context-menu-item" data-index="2">菜单项 3</li>
 *   </ul>
 *
 * 使用示例：
 *   contextMenu.show(actions, false, target, event, frameElem, () => {
 *     // 菜单关闭后的回调
 *   });
 *
 *   // commits 重渲染后刷新菜单的目标元素
 *   contextMenu.refresh(commits);
 * ============================================================
 */

// 导入工具函数
// SVG_ICONS：内联 SVG 图标（用于勾选标记）
// alterClass：修改元素的类名（添加或移除）
// 注意：不使用 findCommitElemWithId，因为它检查 dataset.id，
// 而 commit-graph.ts 渲染的提交行使用 data-row 属性。
// 这里通过 data-row 属性直接查找元素。
// 菜单项 title 已是 HTML 字符串（可能包含图标），不需要 escapeHtml。
import { SVG_ICONS, alterClass } from '../utils/git-utils.js';
// 导入 Git 提交类型（用于 refresh 方法的参数类型）
import type { GitCommit } from '../utils/git-types.js';


/**
 * ============================================================
 * 类型定义
 * ============================================================
 */

/**
 * 单个右键菜单项
 *
 * 描述菜单中的一项操作，包括显示文字、可见性、点击回调和勾选状态。
 */
export interface ContextMenuAction {
	/** 菜单项显示的文字（支持 HTML，因为可能包含图标或快捷键提示） */
	readonly title: string;
	/** 是否可见（由 contextMenuActionsVisibility 配置控制）；不可见的菜单项不会渲染 */
	readonly visible: boolean;
	/** 点击菜单项时执行的回调函数；可选是因为分隔线不需要回调 */
	readonly onClick?: () => void;
	/** 是否勾选（用于切换类菜单，如"显示远程分支"开关）；仅在 show() 的 checked 参数为 true 时显示 */
	readonly checked?: boolean;
}

/**
 * 右键菜单项的二维数组
 *
 * 外层数组代表"组"，内层数组代表组内的"项"。
 * 不同组之间会渲染一条分隔线（context-menu-separator）。
 * 例如：[[项1, 项2], [项3]] 会渲染为"项1 项2 | 分隔线 | 项3"
 */
export type ContextMenuActions = ReadonlyArray<ReadonlyArray<ContextMenuAction>>;

/**
 * 右键菜单的目标类型
 *
 * 描述右键菜单被触发的对象类型：
 *   - Commit：右键点击了提交节点
 *   - Ref：右键点击了 ref 标签（分支/标签/远程/stash）
 *   - CommitDetailsView：右键点击了提交详情视图中的元素
 *   - Repo：右键点击了仓库背景（与具体提交无关，如空白区域）
 */
export type ContextMenuTargetType = 'Commit' | 'Ref' | 'CommitDetailsView' | 'Repo';

/**
 * 仓库级别的右键菜单目标
 *
 * 当右键点击仓库背景（不是具体提交或 ref）时使用。
 * 不与具体的 DOM 元素绑定，因此不需要 refresh 重新查找。
 */
export interface RepoTarget {
	/** 目标类型：仓库 */
	readonly type: 'Repo';
	/** 触发右键的元素（通常是 commit-graph 容器） */
	readonly elem: HTMLElement;
}

/**
 * 提交级别的右键菜单目标
 *
 * 当右键点击某个提交节点时使用。
 * 包含提交的哈希值，用于在 commits 列表刷新后重新查找元素。
 */
export interface CommitTarget {
	/** 目标类型：提交 */
	readonly type: 'Commit';
	/** 触发右键的提交行 DOM 元素（commit-graph 渲染的 <tr class="commit-row">） */
	elem: HTMLElement;
	/** 提交的完整哈希值（用于 refresh 时重新查找元素） */
	readonly hash: string;
	/** 提交在 commits 数组中的索引（用于在原数组中查找） */
	readonly index: number;
}

/**
 * 引用级别的右键菜单目标
 *
 * 当右键点击某个 ref 标签（分支/标签/远程/stash）时使用。
 * 包含提交哈希和 ref 完整名称，用于在 commits 列表刷新后重新查找元素。
 */
export interface RefTarget {
	/** 目标类型：引用 */
	readonly type: 'Ref';
	/** 触发右键的 ref 标签 DOM 元素（commit-graph 渲染的 <span class="ref-label">） */
	elem: HTMLElement;
	/** ref 所在提交的完整哈希值 */
	readonly hash: string;
	/** 提交在 commits 数组中的索引 */
	readonly index: number;
	/** ref 的完整名称（如 "origin/main"、"v1.0.0"），用于 refresh 时重新查找 */
	readonly ref: string;
}

/**
 * 提交详情视图的右键菜单目标
 *
 * 当右键点击提交详情视图中的元素时使用。
 * 与 CommitTarget 类似，但 elem 是详情视图内的元素，而不是提交行。
 */
export interface CommitDetailsViewTarget {
	/** 目标类型：提交详情视图 */
	readonly type: 'CommitDetailsView';
	/** 触发右键的详情视图元素（refresh 时会重新绑定到对应的提交行或 ref 标签） */
	elem: HTMLElement;
	/** 关联提交的完整哈希值 */
	readonly hash: string;
	/** 提交在 commits 数组中的索引 */
	readonly index: number;
	/** 关联的 ref 完整名称（如果详情视图是针对某个 ref 打开的） */
	readonly ref?: string;
}

/**
 * 右键菜单目标的联合类型
 *
 * 包含 RepoTarget 和三种动态目标（Commit/Ref/CommitDetailsView）。
 * 只有 Commit/Ref/CommitDetailsView 类型的目标需要 refresh 重新查找元素。
 */
export type ContextMenuTarget = RepoTarget | CommitTarget | RefTarget | CommitDetailsViewTarget;


/**
 * ============================================================
 * 常量定义
 * ============================================================
 */

/**
 * 高亮活动目标的 CSS 类名
 *
 * 当右键菜单打开时，被右键的目标元素会添加这个类名，
 * 用于在 CSS 中实现高亮效果（如背景色变化）。
 */
const CLASS_CONTEXT_MENU_ACTIVE: string = 'context-menu-active';


/**
 * ============================================================
 * ContextMenu 类：右键菜单管理器
 * ============================================================
 */

/**
 * 右键菜单管理器
 *
 * 负责在 GitTimePrism 中显示、定位和关闭右键菜单。
 * 全局单例（应用启动时创建一次），通过 contextMenu 单例导出使用。
 *
 * 工作原理：
 *   1. 构造时注册全局 click 和 contextmenu 监听器，用于点击外部关闭菜单
 *   2. show() 方法接收菜单项、目标、事件等参数，构建 DOM 并显示
 *   3. 智能定位算法根据 frameElem 的边界和菜单尺寸选择展开方向
 *   4. 点击菜单项时执行对应回调并关闭菜单
 *   5. 点击外部、ESC 键或再次右键时关闭菜单
 *   6. close() 方法移除 DOM 并清理状态，触发 onClose 回调
 *
 * 智能定位算法：
 *   - 默认在鼠标点击位置的右下方展开
 *   - 如果右侧空间不够，改为左下方展开
 *   - 如果下方空间不够，改为右上方展开
 *   - 如果右侧和下方都不够，改为左上方展开
 *   - 极端情况下（菜单比整个 frame 还大），允许菜单覆盖鼠标位置
 */
export class ContextMenu {
	/** 当前显示的菜单 DOM 元素（<ul>）；如果没有菜单打开则为 null */
	private elem: HTMLElement | null = null;
	/** 菜单关闭时的回调函数；如果没有回调则为 null */
	private onClose: (() => void) | null = null;
	/** 当前菜单的目标（被右键的对象）；如果没有菜单打开则为 null */
	private target: ContextMenuTarget | null = null;

	/** ESC 键关闭菜单的监听器引用（用于在 close 时移除） */
	private escListener: ((e: KeyboardEvent) => void) | null = null;

	/**
	 * 构造一个新的 ContextMenu 实例
	 *
	 * 注册全局事件监听器：
	 *   - click：点击页面任何位置时关闭菜单（除非点击的是菜单本身）
	 *   - contextmenu：再次右键时关闭当前菜单（让新菜单可以打开）
	 *
	 * 注意：构造函数只注册监听器，不创建 DOM 元素。
	 * DOM 元素在 show() 时按需创建，在 close() 时移除。
	 */
	constructor() {
		/* 点击页面任何位置时关闭菜单 */
		const closeHandler = (): void => this.close();
		document.addEventListener('click', closeHandler);
		document.addEventListener('contextmenu', closeHandler);
	}

	/**
	 * 显示右键菜单
	 *
	 * 在指定位置创建并显示菜单。如果已有菜单打开，会先关闭旧菜单。
	 * 菜单创建后会立即测量尺寸，然后通过智能定位算法选择最佳展开方向。
	 *
	 * @param actions - 菜单项的二维数组（组 + 项），组间渲染分隔线
	 * @param checked - 是否显示勾选标记（用于切换类菜单，如"显示远程分支"开关）
	 * @param target - 菜单的目标（被右键的对象）；可为 null（表示无特定目标）
	 * @param event - 触发右键的鼠标事件（用于获取点击位置）
	 * @param frameElem - 菜单渲染的容器元素（菜单定位相对于此元素的坐标）
	 * @param onClose - 菜单关闭时的回调函数；可选
	 * @param className - 额外的 CSS 类名（用于自定义菜单样式）；可选
	 */
	public show(
		actions: ContextMenuActions,
		checked: boolean,
		target: ContextMenuTarget | null,
		event: MouseEvent,
		frameElem: HTMLElement,
		onClose: (() => void) | null = null,
		className: string | null = null
	): void {
		/* 用于构建菜单项 HTML 的字符串和对应回调的数组 */
		let html: string = '';
		/* handlers[i] 对应 data-index="i" 的菜单项的点击回调 */
		const handlers: (() => void)[] = [];
		/* handlerId 是 handlers 数组的当前索引，用于生成 data-index */
		let handlerId: number = 0;

		/* 如果已有菜单打开，先关闭（清空旧状态） */
		this.close();

		/* 遍历菜单项的二维数组，构建 HTML */
		for (let i = 0; i < actions.length; i++) {
			/* 当前组的 HTML（一组内的菜单项） */
			let groupHtml: string = '';
			for (let j = 0; j < actions[i].length; j++) {
				/* 只渲染 visible 为 true 的菜单项 */
				if (actions[i][j].visible) {
					/* 构建菜单项 HTML：
					 *   - context-menu-item 类用于 CSS 样式
					 *   - data-index 用于点击时查找对应回调
					 *   - 如果 checked 为 true，显示勾选标记（context-menu-item-check 容器）
					 *     如果该项的 checked 也为 true，显示对勾图标；否则为空
					 */
					groupHtml += '<li class="context-menu-item" data-index="' + handlerId + '">'
						+ (checked ? '<span class="context-menu-item-check">' + (actions[i][j].checked ? SVG_ICONS.check : '') + '</span>' : '')
						+ actions[i][j].title
						+ '</li>';
					/* 如果有 onClick 回调，添加到 handlers 数组 */
					if (actions[i][j].onClick !== undefined) {
						handlers.push(actions[i][j].onClick as () => void);
					}
					handlerId++;
				}
			}

			/* 如果当前组有内容，添加到总 HTML；并在组之间添加分隔线 */
			if (groupHtml !== '') {
				if (html !== '') {
					/* 不是第一组，先添加分隔线 */
					html += '<li class="context-menu-separator"></li>';
				}
				html += groupHtml;
			}
		}

		/* 如果没有任何可见菜单项，直接返回（不显示空菜单） */
		if (handlers.length === 0) return;

		/* 创建菜单容器 <ul> 元素 */
		const menu = document.createElement('ul');
		/* 设置类名：
		 *   - context-menu：基础样式
		 *   - checked：显示勾选标记的菜单（CSS 中可调整 padding）
		 *   - 如果传入了额外的 className，追加到末尾
		 */
		menu.className = 'context-menu'
			+ (checked ? ' checked' : '')
			+ (className !== null ? ' ' + className : '');
		/* 初始透明度为 0，定位计算完成后再设为 1，避免闪烁 */
		menu.style.opacity = '0';
		/* 设置菜单内容 */
		menu.innerHTML = html;
		/* 添加到 frameElem 中（菜单相对于 frameElem 定位） */
		frameElem.appendChild(menu);

		/* 测量菜单和 frameElem 的尺寸，用于智能定位 */
		const menuBounds: DOMRect = menu.getBoundingClientRect();
		const frameBounds: DOMRect = frameElem.getBoundingClientRect();

		/* ============================================================
		 * 智能定位算法：根据可用空间选择展开方向
		 * ============================================================
		 *
		 * 对于水平方向（relativeX）：
		 *   - 如果鼠标右侧有足够空间（event.pageX + 菜单宽度 < frameBounds.right），
		 *     菜单在鼠标右侧展开，relativeX = -2（少量左偏，避免鼠标压住菜单边缘）
		 *   - 否则，如果鼠标左侧有足够空间（event.pageX - 菜单宽度 > frameBounds.left），
		 *     菜单在鼠标左侧展开，relativeX = 2 - 菜单宽度（菜单右边缘距鼠标 2px）
		 *   - 否则（左右都不够），菜单覆盖鼠标位置，向右偏移到刚好在 frameElem 内
		 *
		 * 垂直方向（relativeY）同理。
		 */
		const relativeX: number = event.pageX + menuBounds.width < frameBounds.right
			? -2  /* 右侧空间足够，菜单在鼠标右侧展开 */
			: event.pageX - menuBounds.width > frameBounds.left
				? 2 - menuBounds.width  /* 左侧空间足够，菜单在鼠标左侧展开 */
				: -2 - (menuBounds.width - (frameBounds.width - (event.pageX - frameBounds.left)));  /* 左右都不够，覆盖鼠标位置 */
		const relativeY: number = event.pageY + menuBounds.height < frameBounds.bottom
			? -2  /* 下方空间足够，菜单在鼠标下方展开 */
			: event.pageY - menuBounds.height > frameBounds.top
				? 2 - menuBounds.height  /* 上方空间足够，菜单在鼠标上方展开 */
				: -2 - (menuBounds.height - (frameBounds.height - (event.pageY - frameBounds.top)));  /* 上下都不够，覆盖鼠标位置 */

		/* 计算最终的 left 和 top 坐标（相对于 frameElem 的内容区）
		 *   - 加上 frameElem.scrollLeft/Top 是因为 frameElem 可能可滚动
		 *   - Math.max(..., 2) 确保菜单不会超出 frameElem 的左/上边界
		 */
		menu.style.left = (frameElem.scrollLeft + Math.max(event.pageX - frameBounds.left + relativeX, 2)) + 'px';
		menu.style.top = (frameElem.scrollTop + Math.max(event.pageY - frameBounds.top + relativeY, 2)) + 'px';
		/* 定位完成，显示菜单 */
		menu.style.opacity = '1';

		/* 保存菜单元素和回调引用 */
		this.elem = menu;
		this.onClose = onClose;

		/* 注册菜单项点击事件：通过事件委托监听整个 <ul> 的 click */
		menu.addEventListener('click', (e: MouseEvent) => {
			/* 找到被点击的菜单项（可能点击到子元素，需要 closest 向上查找） */
			const target = e.target as HTMLElement;
			const itemElem = target.closest('.context-menu-item') as HTMLElement | null;
			if (itemElem !== null && itemElem.dataset.index !== undefined) {
				/* 阻止事件冒泡，避免触发 document 上的 close 监听器 */
				e.stopPropagation();
				/* 关闭菜单 */
				this.close();
				/* 调用对应 handlerId 的回调 */
				const handlerIndex = parseInt(itemElem.dataset.index as string, 10);
				if (handlerIndex >= 0 && handlerIndex < handlers.length) {
					handlers[handlerIndex]();
				}
			}
		});

		/* 注册 ESC 键关闭菜单 */
		this.escListener = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && this.elem !== null) {
				e.preventDefault();
				e.stopPropagation();
				this.close();
			}
		};
		document.addEventListener('keydown', this.escListener, true);

		/* 高亮被右键的目标元素（添加 context-menu-active 类） */
		this.target = target;
		if (this.target !== null && this.target.type !== 'Repo') {
			/* 只对非 Repo 类型的目标添加高亮（Repo 是背景，无需高亮） */
			alterClass(this.target.elem, CLASS_CONTEXT_MENU_ACTIVE, true);
		}
	}

	/**
	 * 关闭右键菜单
	 *
	 * 如果当前有菜单打开：
	 *   1. 移除菜单 DOM 元素
	 *   2. 移除所有元素的高亮类（context-menu-active）
	 *   3. 触发 onClose 回调（如果有）
	 *   4. 移除 ESC 监听器
	 *   5. 清空 target 引用
	 */
	public close(): void {
		/* 移除菜单 DOM 元素 */
		if (this.elem !== null) {
			this.elem.remove();
			this.elem = null;
		}

		/* 移除所有元素的高亮类（查找所有带 context-menu-active 类的元素） */
		const activeElems = document.getElementsByClassName(CLASS_CONTEXT_MENU_ACTIVE) as HTMLCollectionOf<HTMLElement>;
		for (let i = 0; i < activeElems.length; i++) {
			alterClass(activeElems[i], CLASS_CONTEXT_MENU_ACTIVE, false);
		}

		/* 移除 ESC 监听器 */
		if (this.escListener !== null) {
			document.removeEventListener('keydown', this.escListener, true);
			this.escListener = null;
		}

		/* 触发 onClose 回调 */
		if (this.onClose !== null) {
			this.onClose();
			this.onClose = null;
		}

		/* 清空 target 引用 */
		this.target = null;
	}

	/**
	 * 刷新右键菜单的目标
	 *
	 * 当提交列表重新渲染后，原 target.elem 引用的 DOM 元素可能已经被销毁。
	 * 此方法在新提交列表中查找 target 对应的新元素，更新 target.elem 引用。
	 *
	 * 刷新逻辑：
	 *   1. 如果菜单未打开、target 为 null 或 target.type 为 Repo，无需刷新
	 *   2. 在新的 commits 数组中查找 target.hash 对应的提交
	 *   3. 如果提交仍存在，通过 data-hash 属性在 DOM 中查找新元素
	 *      - 如果 target 有 ref（Ref 类型），还要在提交元素内查找对应 ref-label
	 *      - 找到则更新 target.elem 并重新高亮
	 *   4. 如果提交已不存在或元素找不到，关闭菜单（目标已消失）
	 *
	 * @param commits - 新的提交数组（已重新渲染到 DOM 中）
	 */
	public refresh(commits: ReadonlyArray<GitCommit>): void {
		/* 如果菜单未打开、无 target、或 target 是 Repo 类型，无需刷新 */
		if (!this.isOpen() || this.target === null || this.target.type === 'Repo') {
			return;
		}

		/* 此时 target 是 CommitTarget | RefTarget | CommitDetailsViewTarget 之一 */
		const typedTarget = this.target as CommitTarget | RefTarget | CommitDetailsViewTarget;

		/* 在新 commits 数组中查找原 target 的提交（通过 hash 匹配） */
		const commitIndex = commits.findIndex((commit) => commit.hash === typedTarget.hash);

		if (commitIndex > -1) {
			/* 提交仍存在 */

			/* 通过 data-row 属性查找对应的提交行 DOM 元素
			 * commit-graph.ts 渲染的提交行格式：
			 *   <tr class="commit-row" data-hash="..." data-row="N">
			 * 这里用 querySelector 精确查找 data-row 等于 commitIndex 的元素
			 */
			const commitElem = document.querySelector('.commit-row[data-row="' + commitIndex + '"]') as HTMLElement | null;
			if (commitElem !== null) {
				/* 提交行元素找到 */

				/* 用 'ref' in 收窄类型，避免访问 CommitTarget 上不存在的 ref 属性 */
			const refValue = 'ref' in typedTarget ? typedTarget.ref : undefined;
			if (refValue === undefined) {
				/* target 没有 ref，说明是针对提交本身的菜单
					 * （Commit 类型，或 CommitDetailsView 类型但无 ref 关联）
					 * 对于 CommitDetailsView 类型，elem 是详情视图内的元素，不重新绑定
					 */
					if (typedTarget.type !== 'CommitDetailsView') {
						/* Commit 类型：更新 elem 引用为新的提交行元素 */
						(this.target as CommitTarget).elem = commitElem;
						alterClass((this.target as CommitTarget).elem, CLASS_CONTEXT_MENU_ACTIVE, true);
					}
					return;
				} else {
					/* target 有 ref，说明是针对某个 ref 标签的菜单（Ref 类型，或 CommitDetailsView + ref）
					 * 需要在提交行内查找对应的 .ref-label 元素
					 */
					const refElems = commitElem.querySelectorAll('[data-ref-name]') as NodeListOf<HTMLElement>;
					for (let i = 0; i < refElems.length; i++) {
						if (refElems[i].dataset.refName === refValue) {
							/* 找到匹配的 ref 标签元素 */
							if (typedTarget.type === 'Ref') {
								/* Ref 类型：elem 更新为 ref 标签元素 */
								(this.target as RefTarget).elem = refElems[i];
							} else {
								/* CommitDetailsView 类型：elem 更新为提交行元素（不是 ref 标签） */
								(this.target as CommitDetailsViewTarget).elem = commitElem;
							}
							alterClass(this.target.elem, CLASS_CONTEXT_MENU_ACTIVE, true);
							return;
						}
					}
				}
			}
		}

		/* 提交已不存在，或对应的 DOM 元素找不到 → 关闭菜单 */
		this.close();
	}

	/**
	 * 判断右键菜单是否打开
	 *
	 * @returns TRUE => 菜单已打开，FALSE => 菜单未打开
	 */
	public isOpen(): boolean {
		return this.elem !== null;
	}

	/**
	 * 判断右键菜单的目标是否是动态源
	 *
	 * 动态源是指 target 与提交/ref 等动态对象绑定（需要 refresh 重新查找）。
	 * Repo 类型不是动态源（与具体提交无关）。
	 *
	 * @returns TRUE => 是动态源（需要 refresh），FALSE => 不是动态源
	 */
	public isTargetDynamicSource(): boolean {
		return this.isOpen() && this.target !== null;
	}
}


/**
 * ============================================================
 * 全局单例导出
 * ============================================================
 */

/**
 * 右键菜单的全局单例
 *
 * 整个应用共享一个 ContextMenu 实例。
 * 在 app.ts 启动时直接使用，无需手动创建。
 *
 * 使用示例：
 *   import { contextMenu } from './components/context-menu.js';
 *   contextMenu.show(actions, false, target, event, frameElem);
 */
export const contextMenu: ContextMenu = new ContextMenu();
