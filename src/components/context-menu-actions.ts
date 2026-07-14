/**
 * ============================================================
 * 右键菜单动作生成器（context-menu-actions.ts）
 * ============================================================
 *
 * 这个模块负责生成 6 类上下文菜单的菜单项（actions），
 * 以及一个通用执行器 runAction。
 *
 * 6 类菜单分别是：
 *   1. 提交菜单（Commit）—— 右键点击提交节点时显示
 *   2. 本地分支菜单（Branch）—— 右键点击本地分支标签时显示
 *   3. 远程分支菜单（Remote Branch）—— 右键点击远程跟踪分支标签时显示
 *   4. 标签菜单（Tag）—— 右键点击标签时显示
 *   5. Stash 菜单—— 右键点击 stash 标签时显示
 *   6. 未提交变更菜单（Uncommitted Changes）—— 右键点击虚拟 UNCOMMITTED 节点时显示
 *
 * 每个菜单生成函数返回 ContextMenuActions（二维数组），
 * 外层数组代表"组"，组与组之间会渲染分隔线。
 *
 * 通用执行器 runAction 负责：
 *   - 显示"操作进行中"的 loading 对话框
 *   - 执行传入的异步操作（调用后端命令）
 *   - 成功后关闭 loading 并刷新节点图
 *   - 失败后关闭 loading 并显示错误对话框
 *   - 对于后端尚未实现的命令，显示"此功能正在开发中"的友好提示
 *
 * 架构说明：
 *   - 本模块不直接引用 app.ts（避免循环依赖）
 *   - 通过 setRefreshCallback / setViewCommitCallback / setRepoPath
 *     由 app.ts 注入所需的回调函数和状态
 *   - 剪贴板操作使用浏览器原生 navigator.clipboard.writeText API
 *   - 后端已实现的命令通过 repoService 调用
 *   - 后端尚未实现的命令通过 invoke() 直接调用（会触发"not found"错误，
 *     被 runAction 捕获后显示友好提示）
 *
 * 使用示例：
 *   // 在 app.ts 中初始化
 *   setRefreshCallback(() => this.refreshAllComponents());
 *   setViewCommitCallback((hash) => this.showCommitDetailByHash(hash));
 *   setRepoPath(info.path);
 *
 *   // 在右键事件回调中生成菜单
 *   const actions = getCommitContextMenuActions(commit, target);
 *   contextMenu.show(actions, false, target, event, frameElem);
 * ============================================================
 */

// 导入 Tauri 的 invoke 函数，用于直接调用后端命令（包括尚未在 repoService 中封装的命令）
import { invoke } from '@tauri-apps/api/core';

// 导入右键菜单的类型定义
// ContextMenuActions：菜单项的二维数组类型（组 + 项）
// ContextMenuTarget：菜单目标的联合类型（Repo/Commit/Ref/CommitDetailsView）
import type {
	ContextMenuActions,
	ContextMenuTarget,
} from './context-menu.js';

// 导入对话框全局单例（用于显示确认对话框、表单、loading、错误等）
import { dialog } from './dialog.js';
// 导入对话框的输入类型枚举（用于构建表单输入项）
import { DialogInputType } from './dialog.js';
// 导入对话框下拉选项的类型定义（用于构建 Select 输入的选项列表）
import type {
	DialogSelectInputOption,
} from './dialog.js';

// 导入仓库服务（封装了已实现的后端命令，如 checkoutBranch、createTag 等）
import { repoService } from '../services/repo-service.js';

// 导入 Git 类型定义
// GitCommit：带 heads/tags/remotes/stash 注解的提交数据
// GitResetMode：重置模式枚举（Soft/Mixed/Hard）
// GitPushBranchMode：推送模式枚举（Normal/Force/ForceWithLease）
import type { GitCommit } from '../utils/git-types.js';
import { GitResetMode } from '../utils/git-types.js';

// 导入 Pull Request 创建工具（Task 7.5：用于分支右键菜单"Create Pull Request"）
// createPullRequest：生成 PR URL 并在浏览器中打开
// buildPullRequestConfigFromRemote：从远程 URL 自动构建 PR 配置（含 Provider 检测）
import { createPullRequest, buildPullRequestConfigFromRemote } from '../utils/pr-utils.js';

// 导入配置服务（Task 7.5：用于获取仓库的远程仓库列表，以构建 PR 配置）
// Task 13.2：读取 contextMenuActionsVisibility 配置控制菜单项显隐
// Task 13.3：读取 dialog.* 配置作为对话框默认值
import { configService } from '../services/config-service.js';
// 导入上下文菜单可见性配置类型（Task 13.2）
import type { ContextMenuActionsVisibilityConfig } from '../services/config-service.js';


/**
 * ============================================================
 * 模块级状态（由 app.ts 通过 setter 函数注入）
 * ============================================================
 */

/**
 * 刷新回调函数
 *
 * 在操作成功完成后调用，用于刷新节点图和其他相关组件。
 * 由 app.ts 通过 setRefreshCallback() 设置。
 * 例如：() => this.refreshAllComponents()
 */
let refreshCallback: (() => Promise<void>) | null = null;

/**
 * 查看提交详情回调函数
 *
 * 在用户选择"View Details"等操作时调用，用于显示指定提交的详情。
 * 参数是提交的完整哈希值。
 * 由 app.ts 通过 setViewCommitCallback() 设置。
 */
let viewCommitCallback: ((hash: string) => void) | null = null;

/**
 * 当前打开的仓库路径
 *
 * 所有后端命令都需要这个参数。
 * 由 app.ts 通过 setRepoPath() 设置。
 */
let currentRepoPath: string = '';


/**
 * ============================================================
 * Setter 函数（由 app.ts 调用以注入依赖）
 * ============================================================
 */

/**
 * 设置刷新回调函数
 *
 * 在操作成功完成后，runAction 会调用此回调来刷新节点图。
 * app.ts 应在仓库打开时调用此函数，传入 refreshAllComponents 方法。
 *
 * @param cb - 刷新回调函数，返回 Promise
 */
export function setRefreshCallback(cb: () => Promise<void>): void {
	refreshCallback = cb;
}

/**
 * 设置查看提交详情的回调函数
 *
 * 当用户在标签菜单中选择"View Details"时，需要显示该标签指向的提交详情。
 * app.ts 应传入一个接受提交哈希的回调函数。
 *
 * @param cb - 回调函数，参数是提交哈希
 */
export function setViewCommitCallback(cb: (hash: string) => void): void {
	viewCommitCallback = cb;
}

/**
 * 设置当前仓库路径
 *
 * 所有后端命令都需要仓库路径参数。
 * app.ts 应在仓库打开时调用此函数。
 *
 * @param path - 仓库的绝对路径
 */
export function setRepoPath(path: string): void {
	currentRepoPath = path;
}


/**
 * ============================================================
 * 辅助函数
 * ============================================================
 */

/**
 * 复制文本到剪贴板
 *
 * 使用浏览器原生的 navigator.clipboard.writeText API。
 * 如果复制失败（如用户拒绝了剪贴板权限），在控制台记录错误。
 *
 * @param text - 要复制的文本
 */
function copyToClipboard(text: string): void {
	/* navigator.clipboard 是现代浏览器提供的剪贴板 API */
	navigator.clipboard.writeText(text).then(() => {
		/* 复制成功，不做任何操作（可以考虑显示一个 toast 提示） */
		console.log('[ContextMenuActions] 已复制到剪贴板:', text);
	}).catch((err: unknown) => {
		/* 复制失败，记录错误 */
		console.error('[ContextMenuActions] 复制到剪贴板失败:', err);
	});
}

/**
 * 判断错误是否表示"后端命令尚未实现"
 *
 * 当 Tauri 后端没有注册某个命令时，invoke() 会抛出包含
 * "not found" 或类似关键词的错误。此函数用于检测这种情况，
 * 以便显示"此功能正在开发中"的友好提示。
 *
 * @param err - 捕获到的错误对象
 * @returns 如果错误表示命令未实现，返回 true；否则返回 false
 */
function isNotImplementedError(err: unknown): boolean {
	/* 将错误对象转为字符串，方便检查 */
	const errMsg: string = String(err).toLowerCase();
	/* Tauri 命令未注册时，错误消息通常包含 "not found" */
	/* 也检查 "not implemented" 和 "missing" 以覆盖其他可能的情况 */
	return errMsg.includes('not found') ||
		errMsg.includes('not implemented') ||
		errMsg.includes('missing') ||
		errMsg.includes('unhandled') ||
		errMsg.includes('command') && errMsg.includes('exist');
}


/**
 * ============================================================
 * Task 13.2 / 13.3：配置读取辅助函数
 * ============================================================
 */

/**
 * 获取上下文菜单可见性配置（Task 13.2）
 *
 * 从 configService 读取 contextMenuActionsVisibility 配置对象，
 * 用于控制 6 类菜单中每个菜单项的显隐。
 *
 * 如果配置加载失败（理论上不会发生，因为 configService 有默认值），
 * 返回一个所有项都可见的兜底配置。
 *
 * @returns 上下文菜单可见性配置对象
 */
function getContextMenuVisibilityConfig(): ContextMenuActionsVisibilityConfig {
	/* 直接从 configService 获取完整的应用配置中的 contextMenuActionsVisibility 字段 */
	return configService.getAppConfig().contextMenuActionsVisibility;
}

/**
 * 获取对话框默认值（Task 13.3）
 *
 * 从 configService 读取 dialog.* 配置，作为对话框打开时的默认选项。
 * 替代原本硬编码的默认值（如 false、'annotated'、GitResetMode.Mixed 等）。
 *
 * 支持的配置路径（点分路径）：
 *   - 'dialog.resetCommitMode'：重置提交的默认模式（'soft'/'mixed'/'hard'）
 *   - 'dialog.resetUncommittedMode'：重置未提交变更的默认模式（'mixed'/'hard'）
 *   - 'dialog.createBranchCheckout'：创建分支时是否默认切换
 *   - 'dialog.deleteBranchForce'：删除分支时是否默认强制删除
 *   - 'dialog.addTagPushToRemote'：创建标签时是否默认推送
 *   - 'dialog.addTagType'：创建标签的默认类型（'annotated'/'lightweight'）
 *   - 'dialog.fetchRemotePrune'：Fetch 时是否默认启用 prune
 *   - 'dialog.fetchRemotePruneTags'：Fetch 时是否默认启用 prune-tags
 *   - 'dialog.mergeNoCommit'：合并时是否默认启用 --no-commit
 *   - 'dialog.mergeNoFastForward'：合并时是否默认启用 --no-ff
 *   - 'dialog.mergeSquash'：合并时是否默认启用 squash
 *   - 'dialog.pullNoFastForward'：拉取时是否默认启用 --no-ff
 *   - 'dialog.pullSquash'：拉取时是否默认启用 squash
 *   - 'dialog.stashIncludeUntracked'：Stash 时是否默认包含未跟踪文件
 *   - 'dialog.stashReinstateIndex'：Apply/Pop stash 时是否默认恢复暂存区
 *
 * @param key - 点分配置路径（如 'dialog.resetCommitMode'）
 * @param fallback - 配置不存在时的兜底默认值
 * @returns 配置值，或兜底默认值
 */
function getDialogDefault<T>(key: string, fallback: T): T {
	/* 从 configService 读取配置值 */
	const value: unknown = configService.getAppConfigValue(key);
	/* 如果配置值为 undefined（理论上有默认值不会发生），返回兜底值 */
	if (value === undefined || value === null) {
		return fallback;
	}
	/* 返回配置值（类型由调用方保证） */
	return value as T;
}


/**
 * ============================================================
 * 通用执行器 runAction
 * ============================================================
 */

/**
 * 通用操作执行器
 *
 * 这是所有菜单动作的统一执行入口。它负责：
 *   1. 静音文件监听器（muteWatcher），避免 GitTimePrism 自身的 Git 操作触发刷新
 *   2. 显示"操作进行中"的 loading 对话框（dialog.showActionRunning）
 *   3. 执行传入的异步操作（action 函数，通常包含 invoke 调用）
 *   4. 取消静音文件监听器（unmuteWatcher），恢复正常监听
 *   5. 操作成功：关闭 loading 对话框，检测合并冲突，调用 refreshCallback 刷新节点图
 *   6. 操作失败：关闭 loading 对话框，检测合并冲突（失败可能因冲突引起），
 *      如果有冲突则自动打开合并编辑器；否则显示错误对话框
 *      - 如果错误表示后端命令未实现，显示"此功能正在开发中"
 *      - 其他错误显示操作名称和错误原因
 *
 * 阶段 12 集成点：
 *   - mute/unmute 文件监听（阶段 10 已实现 watcher，此处包裹所有 Git 操作）
 *   - 合并冲突自动检测 + 合并编辑器自动打开（阶段 8 已实现 MergeEditor）
 *
 * @param actionName - 操作名称，显示在 loading 对话框中（如 "拉取"、"推送"、"创建标签"）
 * @param msg - 操作的描述信息（用于日志记录，不显示给用户）
 * @param action - 实际执行的异步操作，返回 Promise
 */
export async function runAction(
	actionName: string,
	msg: string,
	action: () => Promise<void>
): Promise<void> {
	/* 在控制台记录操作开始（用于调试） */
	console.log(`[ContextMenuActions] 开始执行操作: ${actionName}`, msg);

	/* 显示 loading 对话框，告知用户操作正在进行 */
	dialog.showActionRunning(actionName);

	/* 阶段 12：Git 操作前静音文件监听器，避免自身操作触发 repo_changed 事件导致重复刷新 */
	try {
		await repoService.muteWatcher();
	} catch (muteErr) {
		/* 静音失败不影响操作执行，仅记录警告 */
		console.warn('[ContextMenuActions] 静音文件监听器失败:', muteErr);
	}

	try {
		/* 执行传入的异步操作 */
		await action();

		/* 操作成功：取消静音文件监听器（1.5 秒内的事件仍被忽略） */
		try {
			await repoService.unmuteWatcher();
		} catch (unmuteErr) {
			console.warn('[ContextMenuActions] 取消静音文件监听器失败:', unmuteErr);
		}

		/* 操作成功：关闭 loading 对话框 */
		dialog.closeActionRunning();

		/* 阶段 12：检测合并冲突，如果有冲突文件则自动打开合并编辑器 */
		await checkConflictsAndOpenMergeEditor(actionName);

		/* 刷新节点图和其他组件 */
		if (refreshCallback) {
			await refreshCallback();
		}

		console.log(`[ContextMenuActions] 操作完成: ${actionName}`);
	} catch (err) {
		/* 操作失败：也要取消静音文件监听器 */
		try {
			await repoService.unmuteWatcher();
		} catch (unmuteErr) {
			console.warn('[ContextMenuActions] 取消静音文件监听器失败:', unmuteErr);
		}

		/* 操作失败：先关闭 loading 对话框 */
		dialog.closeActionRunning();

		console.error(`[ContextMenuActions] 操作失败: ${actionName}`, err);

		/* 阶段 12：检测合并冲突（操作失败可能是因为产生了冲突，如 merge/rebase/pull 冲突） */
		const hasConflicts: boolean = await checkConflictsAndOpenMergeEditor(actionName);

		/* 如果检测到冲突并已打开合并编辑器，不再显示错误对话框（冲突是预期内的结果） */
		if (hasConflicts) {
			/* 有冲突已被处理，刷新组件显示冲突状态 */
			if (refreshCallback) {
				await refreshCallback();
			}
			return;
		}

		/* 判断是否是后端命令未实现的错误 */
		if (isNotImplementedError(err)) {
			/* 显示"此功能正在开发中"的友好提示 */
			dialog.showError(
				'此功能正在开发中',
				`"${actionName}" 功能的后端命令尚未实现，敬请期待。\n\n技术详情: ${String(err)}`,
				'确定',
				() => { /* 用户点击确定后不做额外操作 */ }
			);
		} else {
			/* 显示操作失败的错误对话框 */
			dialog.showError(
				`${actionName}失败`,
				String(err),
				'确定',
				() => { /* 用户点击确定后不做额外操作 */ }
			);
		}
	}
}

/**
 * 检测合并冲突并自动打开合并编辑器（阶段 12 集成点）
 *
 * 在可能产生冲突的 Git 操作（merge/rebase/pull/cherry-pick/revert）后调用，
 * 检测仓库中是否存在合并冲突文件。如果存在冲突，自动打开合并编辑器
 * 让用户解决第一个冲突文件。
 *
 * 此函数使用动态导入 merge-editor 组件，避免循环依赖。
 *
 * @param actionName - 操作名称（用于判断是否需要检测冲突）
 * @returns true = 检测到冲突并已打开合并编辑器；false = 无冲突或不需要检测
 */
async function checkConflictsAndOpenMergeEditor(actionName: string): Promise<boolean> {
	/* 只有可能产生冲突的操作才检测，避免不必要的后端调用 */
	/* 可能产生冲突的操作：合并、变基、拉取、拣选、还原 */
	const conflictProneKeywords: string[] = ['合并', '变基', '拉取', '拣选', '还原', 'merge', 'rebase', 'pull', 'cherry', 'revert'];
	const actionLower: string = actionName.toLowerCase();
	const isConflictProne: boolean = conflictProneKeywords.some(
		(keyword: string) => actionLower.includes(keyword.toLowerCase())
	);

	/* 不是可能产生冲突的操作，跳过检测 */
	if (!isConflictProne) {
		return false;
	}

	/* 没有仓库路径，无法检测 */
	if (!currentRepoPath) {
		return false;
	}

	try {
		/* 调用后端检测冲突文件列表 */
		const conflicts = await repoService.detectConflicts(currentRepoPath);

		/* 有冲突文件：自动打开合并编辑器 */
		if (conflicts.length > 0) {
			console.log(`[ContextMenuActions] 检测到 ${conflicts.length} 个冲突文件，自动打开合并编辑器`);

			/* 动态导入合并编辑器单例（避免循环依赖） */
			const { mergeEditor } = await import('./merge-editor.js');

			/* 打开第一个冲突文件的合并编辑器 */
			await mergeEditor.open(currentRepoPath, conflicts[0].path);

			/* 返回 true 表示检测到冲突并已处理 */
			return true;
		}
	} catch (err) {
		/* 检测冲突失败不影响正常流程，仅记录警告 */
		console.warn('[ContextMenuActions] 检测合并冲突失败:', err);
	}

	/* 无冲突 */
	return false;
}


/**
 * ============================================================
 * 1. 提交菜单（Commit Context Menu）
 * ============================================================
 */

/**
 * 生成提交右键菜单的菜单项
 *
 * 当用户右键点击提交节点时显示此菜单。
 * 包含 11 个菜单项，分为 3 组：
 *   - 组 1：Add Tag...（添加标签）、Create Branch...（创建分支）
 *   - 组 2：Checkout（检出）、Cherry Pick（拣选）、Revert（还原）、
 *           Drop（丢弃）、Merge...（合并）、Rebase...（变基）、Reset...（重置）
 *   - 组 3：Copy Hash（复制哈希）、Copy Subject（复制标题）
 *
 * @param commit - 被右键的提交对象（包含哈希、作者、消息等信息）
 * @param target - 右键菜单的目标（用于对话框高亮）；可为 null
 * @returns 菜单项的二维数组
 */
export function getCommitContextMenuActions(
	commit: GitCommit,
	target: ContextMenuTarget | null
): ContextMenuActions {
	/* 提取提交哈希，后续多个菜单项需要用到 */
	const hash: string = commit.hash;
	/* 提取提交消息（第一行，即 subject），用于复制 */

	/* Task 13.2：从 configService 读取提交菜单的可见性配置 */
	const vis = getContextMenuVisibilityConfig().commit;

	/* Task 13.3：从 configService 读取对话框默认值 */
	/* addTag 对话框的默认类型（annotated / lightweight） */
	const defaultTagType: string = getDialogDefault<string>('dialog.addTagType', 'annotated');
	/* merge 对话框的默认选项 */
	const defaultMergeSquash: boolean = getDialogDefault<boolean>('dialog.mergeSquash', false);
	const defaultMergeNoFastForward: boolean = getDialogDefault<boolean>('dialog.mergeNoFastForward', false);
	const defaultMergeNoCommit: boolean = getDialogDefault<boolean>('dialog.mergeNoCommit', false);
	/* reset 对话框的默认模式 */
	const defaultResetMode: string = getDialogDefault<string>('dialog.resetCommitMode', GitResetMode.Mixed);

	const subject: string = commit.message;

	/* 返回菜单项的二维数组 */
	return [
		/* ===== 第 1 组：标签和分支操作 ===== */
		[
			{
				/* 添加标签：让用户输入标签名和选择类型，然后在当前提交上创建标签 */
				title: '添加标签...',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.addTag,
				onClick: () => {
					/* 显示表单对话框，包含：
					 *   1. 标签名输入框（TextRef 类型，会自动验证 Git 引用名称合法性）
					 *   2. 标签类型单选（附注标签 / 轻量标签）
					 *   3. 标签消息输入框（仅附注标签需要，但始终显示）
					 */
					dialog.showForm(
						`在提交 ${hash.substring(0, 7)} 上添加标签`,
						[
							/* 标签名输入：TextRef 类型会实时验证引用名称 */
							{
								type: DialogInputType.TextRef,
								name: '标签名',
								default: '',
								info: '标签名称只能包含字母、数字、连字符和点'
							},
							/* 标签类型选择：单选按钮组 */
							/* Task 13.3：默认值从 dialog.addTagType 配置读取 */
							{
								type: DialogInputType.Radio,
								name: '类型',
								options: [
									{ name: '附注标签（包含创建者、日期、消息等元数据）', value: 'annotated' },
									{ name: '轻量标签（只是指向提交的简单指针）', value: 'lightweight' }
								],
								default: defaultTagType
							},
							/* 标签消息输入：仅附注标签会使用此消息 */
							{
								type: DialogInputType.Text,
								name: '消息（仅附注标签）',
								default: '',
								placeholder: '输入标签消息...'
							}
						],
						'创建标签',
						(values) => {
							/* values[0] 是标签名 */
							const tagName: string = values[0] as string;
							/* values[1] 是标签类型（'annotated' 或 'lightweight'） */
							const tagType: string = values[1] as string;
							/* values[2] 是标签消息 */
							const tagMessage: string = values[2] as string;

							/* 调用 runAction 执行创建标签操作 */
							runAction('创建标签', `createTag ${tagName} on ${hash}`, async () => {
								/* repoService.createTag 已实现 */
								/* 参数：仓库路径、标签名、提交哈希、模式（lightweight/annotated）、消息（仅 annotated） */
								await repoService.createTag(
									currentRepoPath,
									tagName,
									hash,
									tagType,
									tagType === 'annotated' ? tagMessage : undefined
								);
							});
						},
						target
					);
				}
			},
			{
				/* 创建分支：让用户输入分支名，从当前提交创建新分支并切换过去 */
				title: '创建分支...',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.createBranch,
				onClick: () => {
					/* 显示引用名输入对话框（TextRef 类型，自动验证分支名合法性） */
					dialog.showRefInput(
						`从提交 ${hash.substring(0, 7)} 创建新分支`,
						'',
						'创建分支',
						(branchName: string) => {
							/* 调用 runAction 执行创建分支操作 */
							runAction('创建分支', `createBranch ${branchName} from ${hash}`, async () => {
								/* Task 6.2 已实现 create_branch 命令，通过 repoService 调用 */
								/* 参数：仓库路径、分支名、提交哈希、是否切换、是否强制 */
								/* Task 13.3：是否切换从 dialog.createBranchCheckout 配置读取 */
								const checkout: boolean = getDialogDefault<boolean>('dialog.createBranchCheckout', true);
								await repoService.createBranch(
									currentRepoPath,
									branchName,
									hash,
									checkout,
									false  /* force: 不强制创建 */
								);
							});
						},
						target
					);
				}
			}
		],

		/* ===== 第 2 组：提交操作 ===== */
		[
			{
				/* 检出：将 HEAD 切换到该提交（进入 detached HEAD 状态） */
				title: '检出',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.checkout,
				onClick: () => {
					/* 调用 runAction 执行检出操作 */
					runAction('检出提交', `checkout ${hash}`, async () => {
						/* Task 6.2 已实现 checkout_commit 命令，通过 repoService 调用 */
						await repoService.checkoutCommit(currentRepoPath, hash);
					});
				}
			},
			{
				/* 拣选：将该提交的变更应用到当前分支 */
				title: '拣选',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.cherryPick,
				onClick: () => {
					/* 显示复选框对话框，让用户选择拣选选项 */
					dialog.showCheckbox(
						`拣选提交 ${hash.substring(0, 7)}？`,
						'不自动提交（No Commit）—— 将变更应用到暂存区但不创建提交',
						false,
						'拣选',
						(noCommit: boolean) => {
							runAction('拣选提交', `cherrypick ${hash}`, async () => {
								/* Task 6.1 已实现 cherrypick 命令，通过 repoService 调用 */
								await repoService.cherrypick(
									currentRepoPath,
									hash,
									noCommit,
									false,  /* recordOrigin: 不附加来源标记 */
									false,  /* sign: 不签名 */
									0       /* mainline: 不指定父提交索引 */
								);
							});
						},
						target
					);
				}
			},
			{
				/* 还原：创建一个反向提交，撤销该提交的变更 */
				title: '还原',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.revert,
				onClick: () => {
					runAction('还原提交', `revert ${hash}`, async () => {
						/* Task 6.1 已实现 revert 命令，通过 repoService 调用 */
						await repoService.revert(
							currentRepoPath,
							hash,
							false,  /* sign: 不签名 */
							0       /* mainline: 不指定父提交索引 */
						);
					});
				}
			},
			{
				/* 丢弃：从历史中移除该提交（改写历史，危险操作） */
				title: '丢弃',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.drop,
				onClick: () => {
					/* 显示确认对话框，因为丢弃提交是危险操作 */
					dialog.showConfirmation(
						`确定要丢弃提交 ${hash.substring(0, 7)} 吗？\n\n这将改写 Git 历史，如果该提交已推送到远程，可能导致其他协作者的问题。`,
						'丢弃',
						() => {
							runAction('丢弃提交', `drop ${hash}`, async () => {
								/* Task 6.1 已实现 drop_commit 命令，通过 repoService 调用 */
								await repoService.dropCommit(
									currentRepoPath,
									hash,
									false  /* sign: 不签名 */
								);
							});
						},
						target
					);
				}
			},
			{
				/* 合并：将该提交所在分支合并到当前分支 */
				title: '合并...',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.merge,
				onClick: () => {
					/* 显示表单对话框，让用户选择合并选项 */
					/* Task 13.3：默认值从 dialog.merge* 配置读取 */
					dialog.showForm(
						`合并提交 ${hash.substring(0, 7)} 到当前分支`,
						[
							{
								type: DialogInputType.Checkbox,
								name: '压缩合并（Squash）—— 将所有提交合并为一个',
								value: defaultMergeSquash
							},
							{
								type: DialogInputType.Checkbox,
								name: '禁止快进（No Fast Forward）—— 强制创建合并提交',
								value: defaultMergeNoFastForward
							},
							{
								type: DialogInputType.Checkbox,
								name: '不自动提交（No Commit）—— 合并但不创建提交',
								value: defaultMergeNoCommit
							}
						],
						'合并',
						(values) => {
							const squash: boolean = values[0] as boolean;
							const noFastForward: boolean = values[1] as boolean;
							const noCommit: boolean = values[2] as boolean;

							runAction('合并', `merge ${hash}`, async () => {
								/* Task 6.1 已实现 merge 命令，通过 repoService 调用 */
								await repoService.merge(
									currentRepoPath,
									hash,
									squash,
									noFastForward,
									noCommit,
									false  /* sign: 不签名 */
								);
							});
						},
						target
					);
				}
			},
			{
				/* 变基：将当前分支的提交变基到该提交之上 */
				title: '变基...',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.rebase,
				onClick: () => {
					/* 显示表单对话框，让用户选择变基选项 */
					dialog.showForm(
						`将当前分支变基到提交 ${hash.substring(0, 7)} 之上`,
						[
							{
								type: DialogInputType.Checkbox,
								name: '忽略日期（Ignore Date）—— 保持原始提交日期不变',
								value: false
							},
							{
								type: DialogInputType.Checkbox,
								name: '启动交互式变基（Interactive Rebase）—— 在终端中打开',
								value: false
							}
						],
						'变基',
						(values) => {
							const ignoreDate: boolean = values[0] as boolean;
							const interactive: boolean = values[1] as boolean;

							runAction('变基', `rebase ${hash}`, async () => {
								/* Task 6.1 已实现 rebase 命令，通过 repoService 调用 */
								/* 注意：交互式变基由后端返回特殊标记，前端可选择在 PTY 终端启动 */
								await repoService.rebase(
									currentRepoPath,
									hash,
									ignoreDate,
									false,        /* sign: 不签名 */
									interactive
								);
							});
						},
						target
					);
				}
			},
			{
				/* 重置：将当前分支重置到该提交（支持 Soft/Mixed/Hard 三种模式） */
				title: '重置...',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.reset,
				onClick: () => {
					/* 显示下拉选择对话框，让用户选择重置模式 */
					const resetOptions: ReadonlyArray<DialogSelectInputOption> = [
						{ name: 'Soft —— 保留暂存区和工作区变更（最安全）', value: GitResetMode.Soft },
						{ name: 'Mixed —— 重置暂存区，保留工作区变更（默认）', value: GitResetMode.Mixed },
						{ name: 'Hard —— 丢弃所有变更（危险操作）', value: GitResetMode.Hard }
					];

					/* Task 13.3：默认模式从 dialog.resetCommitMode 配置读取 */
					dialog.showSelect(
						`将当前分支重置到提交 ${hash.substring(0, 7)}`,
						defaultResetMode,
						resetOptions,
						'重置',
						(mode: string) => {
							runAction('重置', `reset ${mode} to ${hash}`, async () => {
								/* Task 6.3 已扩展 reset_commit 命令支持任意 commit，通过 repoService 调用 */
								/* 传入目标提交哈希，后端会重置到指定的 commit */
								await repoService.resetCommit(currentRepoPath, mode, hash);
							});
						},
						target
					);
				}
			}
		],

		/* ===== 第 3 组：复制操作 ===== */
		[
			{
				/* 复制提交哈希到剪贴板 */
				title: '复制哈希',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.copyHash,
				onClick: () => {
					copyToClipboard(hash);
				}
			},
			{
				/* 复制提交标题（消息第一行）到剪贴板 */
				title: '复制提交信息',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.copySubject,
				onClick: () => {
					copyToClipboard(subject);
				}
			}
		]
	];
}


/**
 * ============================================================
 * 2. 本地分支菜单（Branch Context Menu）
 * ============================================================
 */

/**
 * 生成本地分支右键菜单的菜单项
 *
 * 当用户右键点击本地分支标签时显示此菜单。
 * 包含 8 个菜单项，分为 5 组：
 *   - 组 1：Checkout（切换到该分支）
 *   - 组 2：Rename...（重命名）、Delete...（删除）
 *   - 组 3：Merge...（合并）、Rebase...（变基）、Push...（推送）
 *   - 组 4：Create Pull Request（创建 Pull Request）
 *   - 组 5：Copy Name（复制分支名）
 *
 * @param branch - 分支名称
 * @param target - 右键菜单的目标；可为 null
 * @returns 菜单项的二维数组
 */
export function getBranchContextMenuActions(
	branch: string,
	target: ContextMenuTarget | null
): ContextMenuActions {
	/* Task 13.2：从 configService 读取分支菜单的可见性配置 */
	const vis = getContextMenuVisibilityConfig().branch;

	/* Task 13.3：从 configService 读取对话框默认值 */
	const defaultMergeSquash: boolean = getDialogDefault<boolean>('dialog.mergeSquash', false);
	const defaultMergeNoFastForward: boolean = getDialogDefault<boolean>('dialog.mergeNoFastForward', false);
	const defaultMergeNoCommit: boolean = getDialogDefault<boolean>('dialog.mergeNoCommit', false);

	return [
		/* ===== 第 1 组：切换分支 ===== */
		[
			{
				/* 切换到该分支：执行 git checkout <branch> */
				title: '检出',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.checkout,
				onClick: () => {
					runAction('切换分支', `checkout ${branch}`, async () => {
						/* repoService.checkoutBranch 已实现 */
						await repoService.checkoutBranch(currentRepoPath, branch);
					});
				}
			}
		],

		/* ===== 第 2 组：重命名和删除 ===== */
		[
			{
				/* 重命名分支：让用户输入新分支名 */
				title: '重命名...',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.rename,
				onClick: () => {
					dialog.showRefInput(
						`将分支 "${branch}" 重命名为：`,
						branch,
						'重命名',
						(newName: string) => {
							runAction('重命名分支', `rename ${branch} -> ${newName}`, async () => {
								/* Task 6.2 已实现 rename_branch 命令，通过 repoService 调用 */
								/* 参数：仓库路径、旧分支名、新分支名 */
								await repoService.renameBranch(currentRepoPath, branch, newName);
							});
						},
						target
					);
				}
			},
			{
				/* 删除分支：显示确认对话框 */
				title: '删除...',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.delete,
				onClick: () => {
					dialog.showConfirmation(
						`确定要删除分支 "${branch}" 吗？\n\n如果分支包含未合并的提交，删除可能导致数据丢失。`,
						'删除',
						() => {
							runAction('删除分支', `delete ${branch}`, async () => {
								/* Task 6.2 已实现 delete_branch 命令，通过 repoService 调用 */
								/* Task 13.3：是否强制删除从 dialog.deleteBranchForce 配置读取 */
								const force: boolean = getDialogDefault<boolean>('dialog.deleteBranchForce', false);
								await repoService.deleteBranch(currentRepoPath, branch, force);
							});
						},
						target
					);
				}
			}
		],

		/* ===== 第 3 组：合并、变基、推送 ===== */
		[
			{
				/* 合并该分支到当前分支 */
				title: '合并...',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.merge,
				onClick: () => {
					/* Task 13.3：默认值从 dialog.merge* 配置读取 */
					dialog.showForm(
						`合并分支 "${branch}" 到当前分支`,
						[
							{
								type: DialogInputType.Checkbox,
								name: '压缩合并（Squash）',
								value: defaultMergeSquash
							},
							{
								type: DialogInputType.Checkbox,
								name: '禁止快进（No Fast Forward）',
								value: defaultMergeNoFastForward
							},
							{
								type: DialogInputType.Checkbox,
								name: '不自动提交（No Commit）',
								value: defaultMergeNoCommit
							}
						],
						'合并',
						(values) => {
							const squash: boolean = values[0] as boolean;
							const noFastForward: boolean = values[1] as boolean;
							const noCommit: boolean = values[2] as boolean;

							runAction('合并', `merge ${branch}`, async () => {
								/* Task 6.1 已实现 merge 命令，通过 repoService 调用 */
								/* 参数：仓库路径、合并对象（分支名）、是否压缩、是否禁止快进、是否不提交、是否签名 */
								await repoService.merge(
									currentRepoPath,
									branch,
									squash,
									noFastForward,
									noCommit,
									false  /* sign: 不签名 */
								);
							});
						},
						target
					);
				}
			},
			{
				/* 将当前分支变基到该分支 */
				title: '变基...',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.rebase,
				onClick: () => {
					dialog.showForm(
						`将当前分支变基到 "${branch}" 之上`,
						[
							{
								type: DialogInputType.Checkbox,
								name: '忽略日期（Ignore Date）',
								value: false
							},
							{
								type: DialogInputType.Checkbox,
								name: '启动交互式变基（Interactive Rebase）',
								value: false
							}
						],
						'变基',
						(values) => {
							const ignoreDate: boolean = values[0] as boolean;
							const interactive: boolean = values[1] as boolean;

							runAction('变基', `rebase ${branch}`, async () => {
								/* Task 6.1 已实现 rebase 命令，通过 repoService 调用 */
								/* 参数：仓库路径、变基对象（分支名）、是否忽略日期、是否签名、是否交互式 */
								await repoService.rebase(
									currentRepoPath,
									branch,
									ignoreDate,
									false,        /* sign: 不签名 */
									interactive
								);
							});
						},
						target
					);
				}
			},
			{
				/* 推送该分支到远程仓库 */
				title: '推送...',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.push,
				onClick: () => {
					/* 显示下拉选择对话框，让用户选择推送模式 */
					const pushOptions: ReadonlyArray<DialogSelectInputOption> = [
						{ name: '普通推送（Normal）', value: '' },
						{ name: '强制推送（Force）—— 覆盖远程历史，危险操作', value: 'force' },
						{ name: '带租约的强制推送（Force with Lease）—— 更安全', value: 'force-with-lease' }
					];

					dialog.showSelect(
						`推送分支 "${branch}" 到远程仓库`,
						'',
						pushOptions,
						'推送',
						(pushMode: string) => {
							runAction('推送', `push ${branch} (${pushMode})`, async () => {
								/* Task 6.4 已扩展 push 命令支持 force/force-with-lease/set-upstream，通过 repoService 调用 */
								/* 根据 pushMode 设置 force 和 forceWithLease 参数 */
								/* setUpstream=true 以便首次推送时建立跟踪关系 */
								const force: boolean = pushMode === 'force';
								const forceWithLease: boolean = pushMode === 'force-with-lease';
								await repoService.pushWithOptions(
									currentRepoPath,
									'origin',
									branch,
									true,            /* setUpstream: 建立跟踪关系 */
									force,
									forceWithLease
								);
							});
						},
						target
					);
				}
			}
		],

		/* ===== 第 4 组：创建 Pull Request ===== */
		[
			{
				/* 创建 Pull Request：根据远程仓库 URL 自动检测 Provider 并打开 PR 创建页面 */
				title: '创建 Pull Request',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.createPullRequest,
				onClick: () => {
					runAction('创建 Pull Request', `createPR ${branch}`, async () => {
						/* Task 7.5：从 configService 获取仓库配置（含远程仓库列表） */
						const repoConfig = configService.getRepoConfig();
						if (!repoConfig || repoConfig.remotes.length === 0) {
							throw new Error('仓库没有配置远程仓库，无法创建 Pull Request');
						}

						/* 优先使用 origin 远程，否则使用第一个远程 */
						const originRemote = repoConfig.remotes.find((r) => r.name === 'origin');
						const remote = originRemote ?? repoConfig.remotes[0];
						const remoteUrl = remote.url;
						if (!remoteUrl) {
							throw new Error(`远程仓库 "${remote.name}" 没有配置 URL`);
						}

						/* 从远程 URL 自动构建 PR 配置（含 Provider 自动检测） */
						/* 目标分支默认使用当前检出的分支（即 branch 参数） */
						const prConfig = buildPullRequestConfigFromRemote(remoteUrl, branch, branch);
						if (!prConfig) {
							throw new Error(`无法解析远程仓库 URL: ${remoteUrl}`);
						}

						/* 生成 PR URL 并在浏览器中打开 */
						await createPullRequest(prConfig);
					});
				}
			}
		],

		/* ===== 第 5 组：复制操作 ===== */
		[
			{
				/* 复制分支名到剪贴板 */
				title: '复制名称',
				/* Task 13.2：从配置读取可见性 */
				visible: vis.copyName,
				onClick: () => {
					copyToClipboard(branch);
				}
			}
		]
	];
}


/**
 * ============================================================
 * 3. 远程分支菜单（Remote Branch Context Menu）
 * ============================================================
 */

/**
 * 解析远程分支名，提取远程仓库名和分支名
 *
 * 远程分支名格式为 "remote/branch"（如 "origin/main"），
 * 此函数将其拆分为远程仓库名（"origin"）和分支名（"main"）。
 *
 * @param remoteBranch - 远程分支全名（如 "origin/main"）
 * @returns 包含 remote（远程仓库名）和 branch（分支名）的对象
 */
function parseRemoteBranch(remoteBranch: string): { remote: string; branch: string } {
	/* 查找第一个 "/" 的位置 */
	const slashIndex: number = remoteBranch.indexOf('/');
	if (slashIndex < 0) {
		/* 如果没有 "/"，假设远程名为 origin，整个字符串为分支名 */
		return { remote: 'origin', branch: remoteBranch };
	}
	/* "/" 之前是远程仓库名，之后是分支名 */
	return {
		remote: remoteBranch.substring(0, slashIndex),
		branch: remoteBranch.substring(slashIndex + 1)
	};
}

/**
 * 生成远程分支右键菜单的菜单项
 *
 * 当用户右键点击远程跟踪分支标签时显示此菜单。
 * 包含 7 个菜单项，分为 5 组：
 *   - 组 1：Checkout（检出为本地分支）
 *   - 组 2：Delete（删除远程分支）
 *   - 组 3：Fetch into local（拉取到本地分支）、Merge...（合并）、Pull（拉取并合并）
 *   - 组 4：Create Pull Request（创建 Pull Request）
 *   - 组 5：Copy Name（复制远程分支名）
 *
 * @param remoteBranch - 远程分支全名（如 "origin/main"）
 * @param target - 右键菜单的目标；可为 null
 * @returns 菜单项的二维数组
 */
export function getRemoteBranchContextMenuActions(
	remoteBranch: string,
	target: ContextMenuTarget | null
): ContextMenuActions {
	/* 解析远程分支名，提取远程仓库名和分支名 */
	const { remote, branch } = parseRemoteBranch(remoteBranch);

	/* Task 13.2：从 configService 读取远程分支菜单的可见性配置 */
	const vis = getContextMenuVisibilityConfig().remoteBranch;

	/* Task 13.3：从 configService 读取对话框默认值 */
	const defaultMergeSquash: boolean = getDialogDefault<boolean>('dialog.mergeSquash', false);
	const defaultMergeNoFastForward: boolean = getDialogDefault<boolean>('dialog.mergeNoFastForward', false);
	const defaultMergeNoCommit: boolean = getDialogDefault<boolean>('dialog.mergeNoCommit', false);

	return [
		/* ===== 第 1 组：检出 ===== */
		[
			{
				/* 检出远程分支：创建本地分支跟踪该远程分支 */
				title: '检出',
				visible: vis.checkout,
				onClick: () => {
					runAction('检出远程分支', `checkout ${remoteBranch}`, async () => {
						/* 尝试通过 checkoutBranch 检出远程分支 */
						/* git checkout origin/main 会创建本地跟踪分支 */
						await repoService.checkoutBranch(currentRepoPath, remoteBranch);
					});
				}
			}
		],

		/* ===== 第 2 组：删除 ===== */
		[
			{
				/* 删除远程分支：执行 git push <remote> --delete <branch> */
				title: '删除',
				visible: vis.delete,
				onClick: () => {
					dialog.showConfirmation(
						`确定要删除远程分支 "${remoteBranch}" 吗？\n\n这将影响所有协作者。`,
						'删除',
						() => {
							runAction('删除远程分支', `delete ${remoteBranch}`, async () => {
								/* Task 6.2 已实现 delete_remote_branch 命令，通过 repoService 调用 */
								/* 参数：仓库路径、远程仓库名、分支名 */
								await repoService.deleteRemoteBranch(currentRepoPath, remote, branch);
							});
						},
						target
					);
				}
			}
		],

		/* ===== 第 3 组：拉取、合并、变基 ===== */
		[
			{
				/* 拉取到本地分支：从远程获取并创建/更新本地分支 */
				title: '拉取到本地',
				visible: vis.fetchIntoLocal,
				onClick: () => {
					runAction('拉取到本地分支', `fetchIntoLocal ${remoteBranch}`, async () => {
						/* Task 5.2 已实现 fetch_into_local_branch 命令，通过 repoService 调用 */
						/* 参数：仓库路径、远程仓库名、远程分支名、本地分支名（这里与远程分支同名） */
						await repoService.fetchIntoLocalBranch(currentRepoPath, remote, branch, branch);
					});
				}
			},
			{
				/* 合并该远程分支到当前分支 */
				title: '合并...',
				visible: vis.merge,
				onClick: () => {
					dialog.showForm(
						`合并远程分支 "${remoteBranch}" 到当前分支`,
						[
							{
								type: DialogInputType.Checkbox,
								name: '压缩合并（Squash）',
								value: defaultMergeSquash
							},
							{
								type: DialogInputType.Checkbox,
								name: '禁止快进（No Fast Forward）',
								value: defaultMergeNoFastForward
							},
							{
								type: DialogInputType.Checkbox,
								name: '不自动提交（No Commit）',
								value: defaultMergeNoCommit
							}
						],
						'合并',
						(values) => {
							const squash: boolean = values[0] as boolean;
							const noFastForward: boolean = values[1] as boolean;
							const noCommit: boolean = values[2] as boolean;

							runAction('合并', `merge ${remoteBranch}`, async () => {
								/* Task 6.1 已实现 merge 命令，通过 repoService 调用 */
								/* 参数：仓库路径、合并对象（远程分支名）、是否压缩、是否禁止快进、是否不提交、是否签名 */
								await repoService.merge(
									currentRepoPath,
									remoteBranch,
									squash,
									noFastForward,
									noCommit,
									false  /* sign: 不签名 */
								);
							});
						},
						target
					);
				}
			},
			{
				/* 拉取：从远程获取最新提交并合并到当前分支 */
				title: '拉取',
				visible: vis.pull,
				onClick: () => {
					runAction('拉取', `pull ${remoteBranch}`, async () => {
						/* repoService.pull 已实现 */
						await repoService.pull(currentRepoPath, remote, branch);
					});
				}
			}
		],

		/* ===== 第 4 组：创建 Pull Request ===== */
		[
			{
				/* 创建 Pull Request：根据远程仓库 URL 自动检测 Provider 并打开 PR 创建页面 */
				title: '创建 Pull Request',
				visible: vis.createPullRequest,
				onClick: () => {
					runAction('创建 Pull Request', `createPR ${remoteBranch}`, async () => {
						/* Task 7.5：从 configService 获取仓库配置（含远程仓库列表） */
						const repoConfig = configService.getRepoConfig();
						if (!repoConfig || repoConfig.remotes.length === 0) {
							throw new Error('仓库没有配置远程仓库，无法创建 Pull Request');
						}

						/* 优先使用 origin 远程，否则使用第一个远程 */
						const originRemote = repoConfig.remotes.find((r) => r.name === 'origin');
						const remote = originRemote ?? repoConfig.remotes[0];
						const remoteUrl = remote.url;
						if (!remoteUrl) {
							throw new Error(`远程仓库 "${remote.name}" 没有配置 URL`);
						}

						/* 从远程 URL 自动构建 PR 配置（含 Provider 自动检测） */
						/* 远程分支格式为 "remote/branch"，提取纯分支名作为源分支 */
						const pureBranchName = branch.includes('/') ? branch.split('/').slice(1).join('/') : branch;
						const prConfig = buildPullRequestConfigFromRemote(remoteUrl, pureBranchName, pureBranchName);
						if (!prConfig) {
							throw new Error(`无法解析远程仓库 URL: ${remoteUrl}`);
						}

						/* 生成 PR URL 并在浏览器中打开 */
						await createPullRequest(prConfig);
					});
				}
			}
		],

		/* ===== 第 5 组：复制操作 ===== */
		[
			{
				/* 复制远程分支名到剪贴板 */
				title: '复制名称',
				visible: vis.copyName,
				onClick: () => {
					copyToClipboard(remoteBranch);
				}
			}
		]
	];
}


/**
 * ============================================================
 * 4. 标签菜单（Tag Context Menu）
 * ============================================================
 */

/**
 * 生成标签右键菜单的菜单项
 *
 * 当用户右键点击标签时显示此菜单。
 * 包含 4 个菜单项，分为 3 组：
 *   - 组 1：View Details（查看详情）、Delete（删除）
 *   - 组 2：Push（推送标签到远程）
 *   - 组 3：Copy Name（复制标签名）
 *
 * @param tag - 标签名称
 * @param target - 右键菜单的目标；可为 null
 * @returns 菜单项的二维数组
 */
export function getTagContextMenuActions(
	tag: string,
	target: ContextMenuTarget | null
): ContextMenuActions {
	/* Task 13.2：从 configService 读取标签菜单的可见性配置 */
	const vis = getContextMenuVisibilityConfig().tag;

	return [
		/* ===== 第 1 组：查看和删除 ===== */
		[
			{
				/* 查看详情：显示该标签指向的提交的详情 */
				title: '查看详情',
				visible: vis.viewDetails,
				onClick: () => {
					/* 由于菜单生成时只有标签名，需要异步查找标签指向的提交哈希 */
					/* 使用 repoService.getTags() 获取所有标签信息，找到匹配的提交 */
					repoService.getTags(currentRepoPath).then((tags) => {
						/* 在标签列表中查找匹配的标签 */
						const tagInfo = tags.find(t => t.name === tag);
						if (tagInfo && viewCommitCallback) {
							/* 找到标签并设置了回调：显示该提交的详情 */
							viewCommitCallback(tagInfo.commit);
						} else if (!tagInfo) {
							/* 未找到标签：显示错误 */
							dialog.showError(
								'查看详情失败',
								`未找到标签 "${tag}"`,
								'确定',
								() => {}
							);
						}
					}).catch((err: unknown) => {
						console.error('[ContextMenuActions] 获取标签信息失败:', err);
					});
				}
			},
			{
				/* 删除标签：显示确认对话框 */
				title: '删除',
				visible: true,
				onClick: () => {
					dialog.showConfirmation(
						`确定要删除标签 "${tag}" 吗？\n\n这不会影响标签指向的提交。`,
						'删除',
						() => {
							runAction('删除标签', `deleteTag ${tag}`, async () => {
								/* repoService.deleteTag 已实现 */
								await repoService.deleteTag(currentRepoPath, tag);
							});
						},
						target
					);
				}
			}
		],

		/* ===== 第 2 组：推送 ===== */
		[
			{
				/* 推送标签到远程仓库 */
				title: '推送',
				visible: vis.push,
				onClick: () => {
					runAction('推送标签', `pushTag ${tag}`, async () => {
						/* Task 6.4 已实现 push_tag 命令，通过 repoService 调用 */
						/* 参数：仓库路径、远程仓库名（默认 origin）、标签名 */
						await repoService.pushTag(currentRepoPath, 'origin', tag);
					});
				}
			}
		],

		/* ===== 第 3 组：复制操作 ===== */
		[
			{
				/* 复制标签名到剪贴板 */
				title: '复制名称',
				visible: vis.copyName,
				onClick: () => {
					copyToClipboard(tag);
				}
			}
		]
	];
}


/**
 * ============================================================
 * 5. Stash 菜单（Stash Context Menu）
 * ============================================================
 */

/**
 * 生成 Stash 右键菜单的菜单项
 *
 * 当用户右键点击 stash 标签时显示此菜单。
 * 包含 6 个菜单项，分为 3 组：
 *   - 组 1：Apply...（应用）、Pop...（弹出）、Drop...（丢弃）
 *   - 组 2：Create Branch...（从 stash 创建分支）
 *   - 组 3：Copy Name（复制选择器）、Copy Hash（复制哈希）
 *
 * @param stashSelector - stash 的选择器（如 "stash@{0}"）
 * @param stashHash - stash 的完整哈希值（用于复制）
 * @param target - 右键菜单的目标；可为 null
 * @returns 菜单项的二维数组
 */
export function getStashContextMenuActions(
	stashSelector: string,
	stashHash: string,
	target: ContextMenuTarget | null
): ContextMenuActions {
	/* Task 13.2：从 configService 读取 Stash 菜单的可见性配置 */
	const vis = getContextMenuVisibilityConfig().stash;

	/* Task 13.3：从 configService 读取对话框默认值 */
	/* Apply/Pop stash 时是否默认恢复暂存区索引（--index） */
	const defaultReinstateIndex: boolean = getDialogDefault<boolean>('dialog.stashReinstateIndex', false);

	return [
		/* ===== 第 1 组：应用、弹出、丢弃 ===== */
		[
			{
				/* 应用 stash：将 stash 的变更应用到工作区，但不删除 stash */
				title: '应用...',
				visible: vis.apply,
				onClick: () => {
					/* 显示复选框对话框，让用户选择是否恢复暂存区 */
					/* Task 13.3：默认值从 dialog.stashReinstateIndex 配置读取 */
					dialog.showCheckbox(
						`应用 stash "${stashSelector}"？`,
						'恢复暂存区索引（Reinstate Index）—— 尝试恢复暂存区的状态',
						defaultReinstateIndex,
						'应用',
						(reinstateIndex: boolean) => {
							runAction('应用 Stash', `applyStash ${stashSelector}`, async () => {
								/* Task 4.1 已实现 apply_stash 命令，通过 repoService 调用 */
								/* 参数：仓库路径、stash 选择器、是否恢复暂存区索引 */
								await repoService.applyStash(currentRepoPath, stashSelector, reinstateIndex);
							});
						},
						target
					);
				}
			},
			{
				/* 弹出 stash：应用 stash 并删除它 */
				title: '弹出...',
				visible: vis.pop,
				onClick: () => {
					dialog.showCheckbox(
						`弹出 stash "${stashSelector}"？\n\n这将应用 stash 并删除它。`,
						'恢复暂存区索引（Reinstate Index）',
						defaultReinstateIndex,
						'弹出',
						(reinstateIndex: boolean) => {
							runAction('弹出 Stash', `popStash ${stashSelector}`, async () => {
								/* Task 4.1 已实现 pop_stash 命令，通过 repoService 调用 */
								/* 参数：仓库路径、stash 选择器、是否恢复暂存区索引 */
								await repoService.popStash(currentRepoPath, stashSelector, reinstateIndex);
							});
						},
						target
					);
				}
			},
			{
				/* 丢弃 stash：直接删除 stash，不应用变更 */
				title: '丢弃...',
				visible: vis.drop,
				onClick: () => {
					dialog.showConfirmation(
						`确定要丢弃 stash "${stashSelector}" 吗？\n\n这将永久删除此 stash，无法恢复。`,
						'丢弃',
						() => {
							runAction('丢弃 Stash', `dropStash ${stashSelector}`, async () => {
								/* Task 4.1 已实现 drop_stash 命令，通过 repoService 调用 */
								/* 参数：仓库路径、stash 选择器 */
								await repoService.dropStash(currentRepoPath, stashSelector);
							});
						},
						target
					);
				}
			}
		],

		/* ===== 第 2 组：创建分支 ===== */
		[
			{
				/* 从 stash 创建分支：在 stash 基于的提交上创建新分支并应用 stash 变更 */
				title: '创建分支...',
				visible: vis.createBranch,
				onClick: () => {
					dialog.showRefInput(
						`从 stash "${stashSelector}" 创建新分支：`,
						'',
						'创建分支',
						(branchName: string) => {
							runAction('从 Stash 创建分支', `branchFromStash ${stashSelector} -> ${branchName}`, async () => {
								/* Task 4.1 已实现 branch_from_stash 命令，通过 repoService 调用 */
								/* 参数：仓库路径、新分支名、stash 选择器 */
								await repoService.branchFromStash(currentRepoPath, branchName, stashSelector);
							});
						},
						target
					);
				}
			}
		],

		/* ===== 第 3 组：复制操作 ===== */
		[
			{
				/* 复制 stash 选择器（如 "stash@{0}"）到剪贴板 */
				title: '复制名称',
				visible: vis.copyName,
				onClick: () => {
					copyToClipboard(stashSelector);
				}
			},
			{
				/* 复制 stash 哈希到剪贴板 */
				title: '复制哈希',
				visible: vis.copyHash,
				onClick: () => {
					copyToClipboard(stashHash);
				}
			}
		]
	];
}


/**
 * ============================================================
 * 6. 未提交变更菜单（Uncommitted Changes Context Menu）
 * ============================================================
 */

/**
 * 生成未提交变更右键菜单的菜单项
 *
 * 当用户右键点击虚拟 UNCOMMITTED 节点时显示此菜单。
 * 包含 4 个菜单项，分为 2 组：
 *   - 组 1：Stash...（暂存变更）、Reset...（重置）、Clean...（清理未跟踪文件）
 *   - 组 2：Open SCM（打开 SCM 工具）
 *
 * @param target - 右键菜单的目标；可为 null
 * @returns 菜单项的二维数组
 */
export function getUncommittedChangesContextMenuActions(
	target: ContextMenuTarget | null
): ContextMenuActions {
	/* Task 13.2：从 configService 读取未提交变更菜单的可见性配置 */
	const vis = getContextMenuVisibilityConfig().uncommitted;

	/* Task 13.3：从 configService 读取对话框默认值 */
	/* Stash 时是否默认包含未跟踪文件 */
	const defaultIncludeUntracked: boolean = getDialogDefault<boolean>('dialog.stashIncludeUntracked', true);
	/* 重置未提交变更的默认模式 */
	const defaultResetUncommittedMode: string = getDialogDefault<string>('dialog.resetUncommittedMode', GitResetMode.Mixed);

	return [
		/* ===== 第 1 组：暂存、重置、清理 ===== */
		[
			{
				/* 暂存变更：执行 git stash push，将工作区变更保存到 stash */
				title: '暂存...',
				visible: vis.stash,
				onClick: () => {
					/* 显示表单对话框，让用户选择选项和输入消息 */
					/* Task 13.3：默认值从 dialog.stashIncludeUntracked 配置读取 */
					dialog.showForm(
						'暂存未提交的变更（Stash）',
						[
							{
								type: DialogInputType.Checkbox,
								name: '包含未跟踪文件（Include Untracked）',
								value: defaultIncludeUntracked
							},
							{
								type: DialogInputType.Text,
								name: '消息（可选）',
								default: '',
								placeholder: '输入 stash 描述消息...'
							}
						],
						'暂存',
						(values) => {
							const includeUntracked: boolean = values[0] as boolean;
							const message: string = values[1] as string;

							runAction('暂存变更', `pushStash`, async () => {
								/* Task 4.1 已实现 push_stash 命令，通过 repoService 调用 */
								/* 参数：仓库路径、是否包含未跟踪文件、可选的描述消息 */
								/* 如果消息为空字符串，传 undefined 让后端不使用 -m 选项 */
								await repoService.pushStash(
									currentRepoPath,
									includeUntracked,
									message.trim() === '' ? undefined : message
								);
							});
						},
						target
					);
				}
			},
			{
				/* 重置：将当前分支重置到 HEAD（撤销未提交的变更） */
				title: '重置...',
				visible: vis.reset,
				onClick: () => {
					/* 显示下拉选择对话框，让用户选择重置模式 */
					const resetOptions: ReadonlyArray<DialogSelectInputOption> = [
						{ name: 'Soft —— 保留暂存区和工作区变更', value: GitResetMode.Soft },
						{ name: 'Mixed —— 重置暂存区，保留工作区变更', value: GitResetMode.Mixed },
						{ name: 'Hard —— 丢弃所有变更（危险操作）', value: GitResetMode.Hard }
					];

					/* Task 13.3：默认模式从 dialog.resetUncommittedMode 配置读取 */
					dialog.showSelect(
						'重置未提交的变更',
						defaultResetUncommittedMode,
						resetOptions,
						'重置',
						(mode: string) => {
							runAction('重置', `reset ${mode}`, async () => {
								/* Task 6.3 已扩展 reset_commit 命令支持任意 commit，通过 repoService 调用 */
								/* 对于未提交变更，重置到 HEAD（传 'HEAD' 作为 commit 参数） */
								/* 这样 Soft/Mixed/Hard 模式分别保留/重置暂存区/丢弃所有工作区变更 */
								await repoService.resetCommit(currentRepoPath, mode, 'HEAD');
							});
						},
						target
					);
				}
			},
			{
				/* 清理：删除未跟踪的文件和目录 */
				title: '清理...',
				visible: vis.clean,
				onClick: () => {
					/* 显示确认对话框，因为清理是危险操作 */
					dialog.showConfirmation(
						'确定要清理未跟踪的文件吗？\n\n这将永久删除所有未跟踪的文件和目录，无法恢复。',
						'清理',
						() => {
							runAction('清理未跟踪文件', `clean`, async () => {
								/* 后端的 clean_untracked_files 命令尚未实现（Task 7.2） */
								await invoke('clean_untracked_files', {
									repoPath: currentRepoPath,
									directories: false
								});
							});
						},
						target
					);
				}
			}
		],

		/* ===== 第 2 组：打开 SCM 工具 ===== */
		[
			{
				/* 打开 SCM：在外部工具中打开仓库（如 VS Code 的 SCM 视图） */
				title: '打开 SCM',
				visible: vis.openScm,
				onClick: () => {
					runAction('打开 SCM', `openSCM`, async () => {
						/* 后端的 open_scm 命令尚未实现 */
						await invoke('open_scm', {
							repoPath: currentRepoPath
						});
					});
				}
			}
		]
	];
}
