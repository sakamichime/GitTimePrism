/**
 * ============================================================
 * Git 类型定义模块（TypeScript 版本）
 * ============================================================
 *
 * 这个模块定义了 GitTimePrism 前端使用的所有 Git 相关类型和枚举。
 * 类型定义参考了 gitgraph 项目的 types.ts，但做了以下调整：
 * 1. 移除了 gitgraph 的 RequestMessage/ResponseMessage 消息传递类型
 *    （因为 GitTimePrism 使用 Tauri 的 invoke 模式与 Rust 后端通信，
 *     不需要前端消息传递类型）
 * 2. 将 gitgraph 的 `const enum` 改为普通 `enum`
 *    （因为 GitTimePrism 的 tsconfig 启用了 isolatedModules，
 *     不允许使用 const enum）
 * 3. 所有类型和枚举都添加了详细的中文注释
 *
 * 这些类型用于：
 *   - 描述 Git 提交、分支、标签、暂存等数据结构
 *   - 描述仓库配置和状态
 *   - 提供文件状态、签名状态等枚举值
 *
 * 使用示例：
 *   import { GitCommit, GitFileStatus } from '../utils/git-types.js';
 * ============================================================
 */

/**
 * ============================================================
 * 提交（Commit）相关类型
 * ============================================================
 */

/**
 * Git 提交信息
 *
 * 描述一个 Git 提交的完整信息，包括提交哈希、父提交、作者、日期、消息，
 * 以及该提交上的分支头（heads）、标签（tags）、远程跟踪分支（remotes）和暂存（stash）注解。
 *
 * 这是一个只读接口（所有属性都是 readonly），因为提交数据一旦创建就不应该被修改。
 */
export interface GitCommit {
	/** 提交的完整哈希值（40 位 SHA-1） */
	readonly hash: string;
	/** 父提交的哈希值数组（一个普通提交有一个父提交，合并提交有多个父提交） */
	readonly parents: ReadonlyArray<string>;
	/** 提交作者姓名 */
	readonly author: string;
	/** 提交作者邮箱 */
	readonly email: string;
	/** 提交日期（Unix 时间戳，单位：秒） */
	readonly date: number;
	/** 提交消息（第一行，即 subject） */
	readonly message: string;
	/** 指向该提交的本地分支头列表（分支名数组） */
	readonly heads: ReadonlyArray<string>;
	/** 指向该提交的标签列表（包含标签名和是否为附注标签的信息） */
	readonly tags: ReadonlyArray<GitCommitTag>;
	/** 指向该提交的远程跟踪分支列表（如 origin/main） */
	readonly remotes: ReadonlyArray<GitCommitRemote>;
	/** 如果该提交是一个 stash（暂存），则包含 stash 信息；否则为 null */
	readonly stash: GitCommitStash | null;
}

/**
 * 提交上的标签注解
 *
 * 描述指向某个提交的标签的基本信息。
 */
export interface GitCommitTag {
	/** 标签名称 */
	readonly name: string;
	/** 是否是附注标签（annotated tag，包含额外的元数据；lightweight tag 只是简单指针） */
	readonly annotated: boolean;
}

/**
 * 提交上的远程跟踪分支注解
 *
 * 描述指向某个提交的远程跟踪分支。
 */
export interface GitCommitRemote {
	/** 远程跟踪分支名（不含 remote 前缀，如 main 而非 origin/main） */
	readonly name: string;
	/** 所属的远程仓库名（如 "origin"）；如果远程仓库不存在则为 null */
	readonly remote: string | null;
}

/**
 * 提交上的 stash（暂存）注解
 *
 * 当一个提交实际上是一个 git stash 时，包含 stash 的额外信息。
 * stash 是 git stash 命令创建的特殊提交，用于临时保存工作区变更。
 */
export interface GitCommitStash {
	/** stash 选择器（如 "stash@{0}"），用于在 git stash 命令中引用该 stash */
	readonly selector: string;
	/** stash 基于的提交哈希（即 stash 创建时所在分支的 HEAD） */
	readonly baseHash: string;
	/** 未跟踪文件的 stash 哈希（如果 stash 时包含未跟踪文件，则有一个单独的哈希；否则为 null） */
	readonly untrackedFilesHash: string | null;
}

/**
 * Git 提交详情
 *
 * 比 GitCommit 更详细的提交信息，包括完整的作者和提交者信息、
 * 提交正文（body）、签名信息和文件变更列表。
 * 通常在用户点击某个提交查看详情时从后端获取。
 */
export interface GitCommitDetails {
	/** 提交的完整哈希值 */
	readonly hash: string;
	/** 父提交的哈希值数组 */
	readonly parents: ReadonlyArray<string>;
	/** 作者姓名（创建该变更的人） */
	readonly author: string;
	/** 作者邮箱 */
	readonly authorEmail: string;
	/** 作者日期（Unix 时间戳，单位：秒；即变更被创建的时间） */
	readonly authorDate: number;
	/** 提交者姓名（实际执行 commit 操作的人，可能与作者不同，例如 rebase 时） */
	readonly committer: string;
	/** 提交者邮箱 */
	readonly committerEmail: string;
	/** 提交日期（Unix 时间戳，单位：秒；即 commit 操作发生的时间） */
	readonly committerDate: number;
	/** 提交的 GPG 签名信息；如果提交未签名则为 null */
	readonly signature: GitSignature | null;
	/** 提交消息的完整正文（包含 subject 和 body，多行文本） */
	readonly body: string;
	/** 该提交引入的文件变更列表 */
	readonly fileChanges: ReadonlyArray<GitFileChange>;
}


/**
 * ============================================================
 * 签名（Signature）相关类型
 * ============================================================
 */

/**
 * GPG 签名状态枚举
 *
 * 描述 Git 提交或标签的 GPG 签名的验证状态。
 * 这些状态值对应 git log --pretty=format:"%G?" 输出的状态码。
 */
export enum GitSignatureStatus {
	/** 签名有效且可信（状态码 "G"） */
	GoodAndValid = 'G',
	/** 签名有效但可信度未知（状态码 "U"） */
	GoodWithUnknownValidity = 'U',
	/** 签名有效但已过期（状态码 "X"） */
	GoodButExpired = 'X',
	/** 签名有效但签名密钥已过期（状态码 "Y"） */
	GoodButMadeByExpiredKey = 'Y',
	/** 签名有效但签名密钥已被吊销（状态码 "R"） */
	GoodButMadeByRevokedKey = 'R',
	/** 签名无法被检查（状态码 "E"，可能是缺少公钥等原因） */
	CannotBeChecked = 'E',
	/** 签名无效（状态码 "B"，签名与内容不匹配） */
	Bad = 'B'
}

/**
 * GPG 签名信息
 *
 * 描述一个 Git 提交或标签的 GPG 签名详情。
 */
export interface GitSignature {
	/** 用于签名的 GPG 密钥 ID */
	readonly key: string;
	/** 签名者姓名（从 GPG 密钥中提取） */
	readonly signer: string;
	/** 签名的验证状态 */
	readonly status: GitSignatureStatus;
}


/**
 * ============================================================
 * 文件变更（File Change）相关类型
 * ============================================================
 */

/**
 * Git 文件状态枚举
 *
 * 描述一个文件在一次提交中的变更类型。
 * 这些状态码对应 git diff --name-status 的输出。
 */
export enum GitFileStatus {
	/** 文件被新增（状态码 "A"） */
	Added = 'A',
	/** 文件被修改（状态码 "M"） */
	Modified = 'M',
	/** 文件被删除（状态码 "D"） */
	Deleted = 'D',
	/** 文件被重命名（状态码 "R"） */
	Renamed = 'R',
	/** 文件未被跟踪（状态码 "U"） */
	Untracked = 'U'
}

/**
 * 单个文件的变更信息
 *
 * 描述一个文件在一次提交（或两次提交比较）中的变更详情。
 */
export interface GitFileChange {
	/** 变更前的文件路径（重命名前的原名；非重命名文件与 newFilePath 相同） */
	readonly oldFilePath: string;
	/** 变更后的文件路径（重命名后的新名；非重命名文件即原文件名） */
	readonly newFilePath: string;
	/** 文件的变更类型（新增、修改、删除、重命名、未跟踪） */
	readonly type: GitFileStatus;
	/** 新增的行数；如果无法统计则为 null */
	readonly additions: number | null;
	/** 删除的行数；如果无法统计则为 null */
	readonly deletions: number | null;
}


/**
 * ============================================================
 * Stash（暂存）相关类型
 * ============================================================
 */

/**
 * Git Stash（暂存）信息
 *
 * 描述一个 git stash 的完整信息，用于在 stash 列表中展示。
 * 与 GitCommitStash 不同，这个接口包含 stash 的完整元数据。
 */
export interface GitStash {
	/** stash 提交的完整哈希值 */
	readonly hash: string;
	/** stash 基于的提交哈希（即 stash 创建时所在分支的 HEAD） */
	readonly baseHash: string;
	/** 未跟踪文件的 stash 哈希（如果 stash 时包含未跟踪文件；否则为 null） */
	readonly untrackedFilesHash: string | null;
	/** stash 选择器（如 "stash@{0}"），用于在 git stash 命令中引用 */
	readonly selector: string;
	/** 创建 stash 的作者姓名 */
	readonly author: string;
	/** 创建 stash 的作者邮箱 */
	readonly email: string;
	/** stash 创建日期（Unix 时间戳，单位：秒） */
	readonly date: number;
	/** stash 的描述消息 */
	readonly message: string;
}


/**
 * ============================================================
 * 标签（Tag）详情相关类型
 * ============================================================
 */

/**
 * Git 标签详情
 *
 * 描述一个附注标签（annotated tag）的详细信息。
 * 轻量标签（lightweight tag）没有详情，因为它们只是指向提交的简单指针。
 */
export interface GitTagDetails {
	/** 标签对象本身的哈希值（注意：这与标签指向的提交哈希不同） */
	readonly hash: string;
	/** 创建标签的人的姓名 */
	readonly taggerName: string;
	/** 创建标签的人的邮箱 */
	readonly taggerEmail: string;
	/** 标签创建日期（Unix 时间戳，单位：秒） */
	readonly taggerDate: number;
	/** 标签的描述消息 */
	readonly message: string;
	/** 标签的 GPG 签名信息；如果标签未签名则为 null */
	readonly signature: GitSignature | null;
}

/**
 * 标签类型枚举
 *
 * 区分 Git 的两种标签类型。
 */
export enum TagType {
	/** 附注标签（annotated tag）：包含创建者、日期、消息等完整元数据的标签对象 */
	Annotated,
	/** 轻量标签（lightweight tag）：只是一个指向提交的简单指针，没有额外元数据 */
	Lightweight
}


/**
 * ============================================================
 * 推送和重置相关枚举
 * ============================================================
 */

/**
 * Git 推送分支模式枚举
 *
 * 描述推送分支时使用的模式（普通推送、强制推送、带租约的强制推送）。
 */
export enum GitPushBranchMode {
	/** 普通推送（git push） */
	Normal = '',
	/** 强制推送（git push --force），会覆盖远程历史，危险操作 */
	Force = 'force',
	/** 带租约的强制推送（git push --force-with-lease），只有当远程分支没有他人新提交时才强制推送，更安全 */
	ForceWithLease = 'force-with-lease'
}

/**
 * Git 重置模式枚举
 *
 * 描述 git reset 命令的三种模式，控制重置后工作区和暂存区的状态。
 */
export enum GitResetMode {
	/** 软重置（git reset --soft）：只移动 HEAD，保留暂存区和工作区的变更 */
	Soft = 'soft',
	/** 混合重置（git reset --mixed，默认）：移动 HEAD，重置暂存区，但保留工作区的变更 */
	Mixed = 'mixed',
	/** 硬重置（git reset --hard）：移动 HEAD，重置暂存区和工作区，丢弃所有变更（危险操作） */
	Hard = 'hard'
}


/**
 * ============================================================
 * 仓库配置（Repo Config）相关类型
 * ============================================================
 */

/**
 * Git 仓库配置
 *
 * 描述一个 Git 仓库的配置信息，包括分支配置、diff 工具、远程仓库和用户信息。
 * 通常在加载仓库时从后端获取。
 */
export interface GitRepoConfig {
	/** 各分支的配置（以分支名为键） */
	readonly branches: GitRepoConfigBranches;
	/** 配置的 diff 工具名（用于 git difftool）；未配置则为 null */
	readonly diffTool: string | null;
	/** 配置的 GUI diff 工具名；未配置则为 null */
	readonly guiDiffTool: string | null;
	/** push.default 配置值（git push 的默认行为）；未配置则为 null */
	readonly pushDefault: string | null;
	/** 远程仓库列表 */
	readonly remotes: ReadonlyArray<GitRepoSettingsRemote>;
	/** 用户信息（姓名和邮箱，分 local 和 global 两级） */
	readonly user: {
		/** 用户姓名配置 */
		readonly name: {
			/** 仓库级（local）配置的姓名；未配置则为 null */
			readonly local: string | null,
			/** 全局（global）配置的姓名；未配置则为 null */
			readonly global: string | null
		},
		/** 用户邮箱配置 */
		readonly email: {
			/** 仓库级（local）配置的邮箱；未配置则为 null */
			readonly local: string | null,
			/** 全局（global）配置的邮箱；未配置则为 null */
			readonly global: string | null
		}
	};
}

/**
 * 分支配置集合
 *
 * 以分支名为键，分支配置为值的映射对象。
 */
export type GitRepoConfigBranches = { [branchName: string]: GitRepoConfigBranch };

/**
 * 单个分支的配置
 *
 * 描述一个分支的上游（upstream）远程仓库配置。
 */
export interface GitRepoConfigBranch {
	/** 该分支推送（push）时使用的远程仓库名；未配置则为 null */
	readonly pushRemote: string | null;
	/** 该分支拉取（pull/fetch）时使用的远程仓库名；未配置则为 null */
	readonly remote: string | null;
}

/**
 * 远程仓库设置
 *
 * 描述一个已配置的远程仓库的信息。
 */
export interface GitRepoSettingsRemote {
	/** 远程仓库名（如 "origin"） */
	readonly name: string;
	/** 远程仓库的拉取 URL；未配置则为 null */
	readonly url: string | null;
	/** 远程仓库的推送 URL；未配置则为 null（如果为 null，则推送时使用 url） */
	readonly pushUrl: string | null;
}


/**
 * ============================================================
 * 仓库状态（Repo State）相关类型
 * ============================================================
 */

/**
 * 代码审查（Code Review）信息
 *
 * 描述一次代码审查的状态，用于跟踪审查进度。
 */
export interface CodeReview {
	/** 审查的唯一标识符 */
	id: string;
	/** 最后活跃时间（Unix 时间戳，单位：毫秒） */
	lastActive: number;
	/** 最后查看的文件路径；如果还没查看过文件则为 null */
	lastViewedFile: string | null;
	/** 待审查的文件路径列表 */
	remainingFiles: string[];
}

/**
 * 列宽类型别名
 *
 * 表示提交列表中某一列的宽度（像素）。
 * 特殊值见 COLUMN_HIDDEN 和 COLUMN_AUTO 常量。
 */
export type ColumnWidth = number;

/**
 * 仓库集合
 *
 * 以仓库路径为键，仓库状态为值的映射对象。
 */
export type GitRepoSet = { [repo: string]: GitRepoState };

/**
 * Issue 链接配置
 *
 * 配置如何将提交消息中的 issue 编号（如 #123）链接到 issue 跟踪系统。
 */
export interface IssueLinkingConfig {
	/** 用于匹配 issue 编号的正则表达式字符串（如 "#(\d+)"） */
	readonly issue: string;
	/** issue 的 URL 模板（用 {0} 占位 issue 编号，如 "https://github.com/user/repo/issues/{0}"） */
	readonly url: string;
}

/**
 * Git 仓库状态
 *
 * 描述一个仓库在 GitTimePrism 中的状态，包括布局配置、显示选项等。
 * 这些状态会被持久化，以便用户下次打开仓库时恢复。
 */
export interface GitRepoState {
	/** 提交详情视图分隔位置（百分比） */
	cdvDivider: number;
	/** 提交详情视图高度（像素） */
	cdvHeight: number;
	/** 各列的宽度配置；如果使用默认宽度则为 null */
	columnWidths: ColumnWidth[] | null;
	/** 提交排序方式 */
	commitOrdering: RepoCommitOrdering;
	/** 文件查看方式（树形或列表） */
	fileViewType: FileViewType;
	/** 隐藏的远程仓库名列表 */
	hideRemotes: string[];
	/** 是否包含 reflog 中提到的提交（Default/Enabled/Disabled 三态覆盖） */
	includeCommitsMentionedByReflogs: BooleanOverride;
	/** Issue 链接配置；未配置则为 null */
	issueLinkingConfig: IssueLinkingConfig | null;
	/** 上次导入配置的时间（Unix 时间戳，单位：毫秒） */
	lastImportAt: number;
	/** 仓库的显示名称；使用默认名称则为 null */
	name: string | null;
	/** 是否只跟随第一父提交（Default/Enabled/Disabled 三态覆盖） */
	onlyFollowFirstParent: BooleanOverride;
	/** 打开仓库时是否显示当前检出的分支（Default/Enabled/Disabled 三态覆盖） */
	onRepoLoadShowCheckedOutBranch: BooleanOverride;
	/** 打开仓库时显示的特定分支列表；显示所有分支则为 null */
	onRepoLoadShowSpecificBranches: string[] | null;
	/** Pull Request 配置；未配置则为 null */
	pullRequestConfig: PullRequestConfig | null;
	/** 是否显示远程分支 */
	showRemoteBranches: boolean;
	/** 是否显示远程分支（V2，三态覆盖版本） */
	showRemoteBranchesV2: BooleanOverride;
	/** 是否显示 stash（三态覆盖） */
	showStashes: BooleanOverride;
	/** 是否显示标签（三态覆盖） */
	showTags: BooleanOverride;
	/** 工作区文件夹索引；不属于任何工作区文件夹则为 null */
	workspaceFolderIndex: number | null;
}


/**
 * ============================================================
 * Pull Request 配置相关类型
 * ============================================================
 */

/**
 * Pull Request 配置基础接口
 *
 * 描述创建 Pull Request 所需的基本信息。
 */
export interface PullRequestConfigBase {
	/** 托管平台的根 URL（如 "https://github.com"） */
	readonly hostRootUrl: string;
	/** 源远程仓库名 */
	readonly sourceRemote: string;
	/** 源仓库的所有者名 */
	readonly sourceOwner: string;
	/** 源仓库名 */
	readonly sourceRepo: string;
	/** 目标远程仓库名；如果与源相同则为 null */
	readonly destRemote: string | null;
	/** 目标仓库的所有者名 */
	readonly destOwner: string;
	/** 目标仓库名 */
	readonly destRepo: string;
	/** 目标项目 ID（仅 GitLab 使用） */
	readonly destProjectId: string;
	/** 目标分支名 */
	readonly destBranch: string;
}

/**
 * Pull Request 提供商枚举
 *
 * 支持的 Pull Request 托管平台。
 */
export enum PullRequestProvider {
	/** Bitbucket 平台 */
	Bitbucket,
	/** 自定义提供商 */
	Custom,
	/** GitHub 平台 */
	GitHub,
	/** GitLab 平台 */
	GitLab
}

/**
 * 内置 Pull Request 配置
 *
 * 使用内置提供商（GitHub、GitLab、Bitbucket）的配置。
 */
interface PullRequestConfigBuiltIn extends PullRequestConfigBase {
	/** 提供商类型（排除 Custom） */
	readonly provider: Exclude<PullRequestProvider, PullRequestProvider.Custom>;
	/** 自定义配置（内置提供商时为 null） */
	readonly custom: null;
}

/**
 * 自定义 Pull Request 配置
 *
 * 使用自定义 URL 模板的配置。
 */
interface PullRequestConfigCustom extends PullRequestConfigBase {
	/** 提供商类型（Custom） */
	readonly provider: PullRequestProvider.Custom;
	/** 自定义配置（包含名称和 URL 模板） */
	readonly custom: {
		/** 自定义提供商的显示名称 */
		readonly name: string,
		/** URL 模板（用占位符替换分支名等参数） */
		readonly templateUrl: string
	};
}

/**
 * Pull Request 配置
 *
 * 可以是内置提供商配置或自定义提供商配置。
 */
export type PullRequestConfig = PullRequestConfigBuiltIn | PullRequestConfigCustom;


/**
 * ============================================================
 * 配置（Config）相关类型
 * ============================================================
 */

/**
 * 提交详情视图配置
 */
export interface CommitDetailsViewConfig {
	/** 是否自动居中到选中的提交 */
	readonly autoCenter: boolean;
	/** 是否使用紧凑的文件夹显示（自动合并只有单个子文件夹的路径） */
	readonly fileTreeCompactFolders: boolean;
	/** 文件查看方式（树形或列表） */
	readonly fileViewType: FileViewType;
	/** 提交详情视图的位置（内联或停靠在底部） */
	readonly location: CommitDetailsViewLocation;
}

/**
 * 图形配置
 *
 * 描述提交节点图的渲染配置，包括颜色、样式、网格和未提交变更的显示方式。
 */
export interface GraphConfig {
	/** 分支颜色列表（HEX 格式，如 ["#ff0000", "#00ff00"]） */
	readonly colours: ReadonlyArray<string>;
	/** 图形样式（圆角或尖角） */
	readonly style: GraphStyle;
	/** 网格配置（x/y 间距、偏移量、展开高度） */
	readonly grid: { x: number, y: number, offsetX: number, offsetY: number, expandY: number };
	/** 未提交变更的显示样式 */
	readonly uncommittedChanges: GraphUncommittedChangesStyle;
}

/**
 * 快捷键配置
 */
export interface KeybindingConfig {
	/** 查找快捷键；未配置则为 null */
	readonly find: string | null;
	/** 刷新快捷键；未配置则为 null */
	readonly refresh: string | null;
	/** 滚动到 HEAD 快捷键；未配置则为 null */
	readonly scrollToHead: string | null;
	/** 滚动到 stash 快捷键；未配置则为 null */
	readonly scrollToStash: string | null;
}

/**
 * 静音提交配置
 *
 * 控制哪些提交在提交图中以低亮度（静音）显示。
 */
export interface MuteCommitsConfig {
	/** 是否静音非 HEAD 祖先的提交 */
	readonly commitsNotAncestorsOfHead: boolean;
	/** 是否静音合并提交 */
	readonly mergeCommits: boolean;
}

/**
 * 打开仓库时的配置
 */
export interface OnRepoLoadConfig {
	/** 是否滚动到 HEAD 提交 */
	readonly scrollToHead: boolean;
	/** 是否显示当前检出的分支 */
	readonly showCheckedOutBranch: boolean;
	/** 要显示的特定分支列表 */
	readonly showSpecificBranches: ReadonlyArray<string>;
}

/**
 * 引用标签配置
 *
 * 控制分支和标签标签在提交图中的显示方式。
 */
export interface ReferenceLabelsConfig {
	/** 分支标签是否对齐到图形 */
	readonly branchLabelsAlignedToGraph: boolean;
	/** 是否合并显示本地和远程分支标签 */
	readonly combineLocalAndRemoteBranchLabels: boolean;
	/** 标签是否右对齐 */
	readonly tagLabelsOnRight: boolean;
}


/**
 * ============================================================
 * 通用枚举
 * ============================================================
 */

/**
 * 布尔覆盖枚举
 *
 * 用于配置项的三态选择：使用默认值、强制启用或强制禁用。
 */
export enum BooleanOverride {
	/** 使用默认值（继承全局设置） */
	Default,
	/** 强制启用 */
	Enabled,
	/** 强制禁用 */
	Disabled
}

/**
 * 提交详情视图位置枚举
 */
export enum CommitDetailsViewLocation {
	/** 内联显示（在提交列表中展开） */
	Inline,
	/** 停靠在底部 */
	DockedToBottom
}

/**
 * 提交排序方式枚举
 *
 * 描述提交列表的排序方式。
 * 这些值对应 git log 的 --date 选项。
 */
export enum CommitOrdering {
	/** 按提交日期排序（git log --date=date） */
	Date = 'date',
	/** 按作者日期排序（git log --date=author-date） */
	AuthorDate = 'author-date',
	/** 拓扑排序（git log --topo-order，按提交拓扑关系排序） */
	Topological = 'topo'
}

/**
 * 仓库级提交排序方式枚举
 *
 * 与 CommitOrdering 类似，但多了一个 Default 选项（使用全局配置）。
 */
export enum RepoCommitOrdering {
	/** 使用全局默认配置 */
	Default = 'default',
	/** 按提交日期排序 */
	Date = 'date',
	/** 按作者日期排序 */
	AuthorDate = 'author-date',
	/** 拓扑排序 */
	Topological = 'topo'
}

/**
 * 仓库下拉菜单排序方式枚举
 */
export enum RepoDropdownOrder {
	/** 按完整路径排序 */
	FullPath,
	/** 按仓库名称排序 */
	Name,
	/** 按工作区文件夹 + 完整路径排序 */
	WorkspaceFullPath
}

/**
 * 文件查看方式枚举
 *
 * 提交详情中文件变更的显示方式。
 */
export enum FileViewType {
	/** 默认方式 */
	Default,
	/** 树形视图（按文件夹层级显示） */
	Tree,
	/** 列表视图（平铺显示所有文件） */
	List
}

/**
 * 图形样式枚举
 *
 * 提交节点图中分支连线的绘制样式。
 */
export enum GraphStyle {
	/** 圆角样式（使用贝塞尔曲线绘制分支转折） */
	Rounded,
	/** 尖角样式（使用直线绘制分支转折） */
	Angular
}

/**
 * 未提交变更的图形显示样式枚举
 *
 * 控制未提交变更在提交图中的显示位置。
 */
export enum GraphUncommittedChangesStyle {
	/** 在未提交变更位置显示一个空心圆 */
	OpenCircleAtTheUncommittedChanges,
	/** 在当前检出的提交位置显示一个空心圆 */
	OpenCircleAtTheCheckedOutCommit
}

/**
 * 引用标签对齐方式枚举
 */
export enum RefLabelAlignment {
	/** 默认对齐 */
	Normal,
	/** 分支在左，标签在右 */
	BranchesOnLeftAndTagsOnRight,
	/** 分支对齐到图形，标签在右 */
	BranchesAlignedToGraphAndTagsOnRight
}

/**
 * 压缩（Squash）消息格式枚举
 */
export enum SquashMessageFormat {
	/** 默认格式 */
	Default,
	/** Git 压缩消息格式 */
	GitSquashMsg
}

/**
 * 标签页图标颜色主题枚举
 */
export enum TabIconColourTheme {
	/** 彩色 */
	Colour,
	/** 灰色 */
	Grey
}


/**
 * ============================================================
 * 日期格式相关类型
 * ============================================================
 */

/**
 * 日期格式配置
 *
 * 描述日期的显示格式。
 */
export interface DateFormat {
	/** 日期格式类型（日期+时间、仅日期、相对时间） */
	readonly type: DateFormatType;
	/** 是否使用 ISO 8601 格式（如 2024-01-15） */
	readonly iso: boolean;
}

/**
 * 日期格式类型枚举
 */
export enum DateFormatType {
	/** 显示日期和时间 */
	DateAndTime,
	/** 仅显示日期 */
	DateOnly,
	/** 显示相对时间（如 "3 hours ago"） */
	Relative
}

/**
 * 日期类型枚举
 *
 * 区分作者日期和提交日期。
 */
export enum DateType {
	/** 作者日期（变更被创建的时间） */
	Author,
	/** 提交日期（commit 操作发生的时间） */
	Commit
}


/**
 * ============================================================
 * 默认列可见性和对话框默认值
 * ============================================================
 */

/**
 * 默认列可见性配置
 *
 * 控制提交列表中各列默认是否可见。
 */
export interface DefaultColumnVisibility {
	/** 日期列是否可见 */
	readonly date: boolean;
	/** 作者列是否可见 */
	readonly author: boolean;
	/** 提交哈希列是否可见 */
	readonly commit: boolean;
}

/**
 * 自定义分支 glob 模式
 *
 * 用户自定义的分支 glob 模式，用于在分支筛选中使用。
 */
export interface CustomBranchGlobPattern {
	/** 模式名称（显示在下拉菜单中） */
	readonly name: string;
	/** glob 模式字符串（如 "feature/*"） */
	readonly glob: string;
}

/**
 * 自定义 emoji 短码映射
 *
 * 用户自定义的 emoji 短码到 emoji 字符的映射。
 */
export interface CustomEmojiShortcodeMapping {
	/** 短码（如 ":smile:"） */
	readonly shortcode: string;
	/** 对应的 emoji 字符（如 "😄"） */
	readonly emoji: string;
}

/**
 * 自定义 Pull Request 提供商
 *
 * 用户自定义的 Pull Request 提供商配置。
 */
export interface CustomPullRequestProvider {
	/** 提供商名称 */
	readonly name: string;
	/** URL 模板 */
	readonly templateUrl: string;
}

/**
 * 对话框默认值配置
 *
 * 各对话框中选项的默认值。
 */
export interface DialogDefaults {
	/** 添加标签对话框的默认值 */
	readonly addTag: {
		/** 是否默认推送到远程 */
		readonly pushToRemote: boolean,
		/** 默认标签类型 */
		readonly type: TagType
	};
	/** 应用 stash 对话框的默认值 */
	readonly applyStash: {
		/** 是否恢复暂存区（--index 选项） */
		readonly reinstateIndex: boolean
	};
	/** 拣选（cherry-pick）对话框的默认值 */
	readonly cherryPick: {
		/** 是否不自动提交 */
		readonly noCommit: boolean,
		/** 是否记录来源（-x 选项） */
		readonly recordOrigin: boolean
	};
	/** 创建分支对话框的默认值 */
	readonly createBranch: {
		/** 是否创建后立即检出 */
		readonly checkout: boolean
	};
	/** 删除分支对话框的默认值 */
	readonly deleteBranch: {
		/** 是否强制删除（-D 选项） */
		readonly forceDelete: boolean
	};
	/** 拉取到本地分支对话框的默认值 */
	readonly fetchIntoLocalBranch: {
		/** 是否强制拉取 */
		readonly forceFetch: boolean
	};
	/** 拉取远程对话框的默认值 */
	readonly fetchRemote: {
		/** 是否清理（prune）已删除的远程分支 */
		readonly prune: boolean,
		/** 是否清理（prune）已删除的远程标签 */
		readonly pruneTags: boolean
	};
	/** 通用配置 */
	readonly general: {
		/** 引用输入框中空格的替换字符；不替换则为 null */
		readonly referenceInputSpaceSubstitution: string | null
	};
	/** 合并对话框的默认值 */
	readonly merge: {
		/** 是否不自动提交（--no-commit） */
		readonly noCommit: boolean,
		/** 是否禁用快进合并（--no-ff） */
		readonly noFastForward: boolean,
		/** 是否使用压缩合并（--squash） */
		readonly squash: boolean
	};
	/** 弹出 stash 对话框的默认值 */
	readonly popStash: {
		/** 是否恢复暂存区（--index 选项） */
		readonly reinstateIndex: boolean
	};
	/** 拉取分支对话框的默认值 */
	readonly pullBranch: {
		/** 是否禁用快进合并 */
		readonly noFastForward: boolean,
		/** 是否使用压缩合并 */
		readonly squash: boolean
	};
	/** 变基（rebase）对话框的默认值 */
	readonly rebase: {
		/** 是否忽略日期（--ignore-date） */
		readonly ignoreDate: boolean,
		/** 是否交互式变基（-i） */
		readonly interactive: boolean
	};
	/** 重置提交对话框的默认值 */
	readonly resetCommit: {
		/** 默认重置模式 */
		readonly mode: GitResetMode
	};
	/** 重置未提交变更对话框的默认值 */
	readonly resetUncommitted: {
		/** 默认重置模式（不能是 Soft，因为 Soft 不影响工作区） */
		readonly mode: Exclude<GitResetMode, GitResetMode.Soft>
	};
	/** 暂存未提交变更对话框的默认值 */
	readonly stashUncommittedChanges: {
		/** 是否包含未跟踪文件（-u 选项） */
		readonly includeUntracked: boolean
	};
}


/**
 * ============================================================
 * Git 配置位置枚举
 * ============================================================
 */

/**
 * Git 配置位置枚举
 *
 * 描述 Git 配置项的存储位置（配置文件的层级）。
 */
export enum GitConfigLocation {
	/** 仓库级配置（.git/config 文件） */
	Local = 'local',
	/** 用户级配置（~/.gitconfig 文件） */
	Global = 'global',
	/** 系统级配置（/etc/gitconfig 文件） */
	System = 'system'
}


/**
 * ============================================================
 * 合并和变基操作目标枚举
 * ============================================================
 */

/**
 * 合并操作目标类型枚举
 *
 * 描述合并操作的目标对象类型。
 */
export enum MergeActionOn {
	/** 合并本地分支 */
	Branch = 'Branch',
	/** 合并远程跟踪分支 */
	RemoteTrackingBranch = 'Remote-tracking Branch',
	/** 合并提交 */
	Commit = 'Commit'
}

/**
 * 变基操作目标类型枚举
 *
 * 描述变基操作的目标对象类型。
 */
export enum RebaseActionOn {
	/** 基于分支变基 */
	Branch = 'Branch',
	/** 基于提交变基 */
	Commit = 'Commit'
}

/**
 * 错误信息扩展前缀枚举
 *
 * 特殊错误信息的前缀，用于标识特定类型的错误。
 */
export enum ErrorInfoExtensionPrefix {
	/** 推送标签时提交不在远程的错误前缀 */
	PushTagCommitNotOnRemote = 'VSCODE_GIT_GRAPH:PUSH_TAG:COMMIT_NOT_ON_REMOTE:'
}


/**
 * ============================================================
 * 引用（Refs）相关类型
 * ============================================================
 * 以下类型对应 Rust 后端 git/refs.rs 中的结构体，
 * 用于描述 Git 仓库中的所有引用（本地分支、标签、远程分支、HEAD）。
 * 字段名使用 camelCase，与 Rust 后端的 serde 序列化输出匹配。
 */

/**
 * 单个本地分支引用信息
 *
 * 对应 Rust 后端的 RefHead 结构体。
 * 包含分支名和所指向的提交哈希。
 */
export interface RefHead {
	/** 分支名（已去除 refs/heads/ 前缀，如 "main"） */
	readonly name: string;
	/** 该分支所指向的提交的完整哈希值（40 位十六进制） */
	readonly hash: string;
}

/**
 * 单个标签引用信息
 *
 * 对应 Rust 后端的 RefTag 结构体。
 * 包含标签名、所指向的提交哈希以及标签类型（annotated 或 lightweight）。
 */
export interface RefTag {
	/** 标签名（已去除 refs/tags/ 前缀，如 "v1.0.0"） */
	readonly name: string;
	/** 标签所指向的提交的完整哈希值（对于 annotated 标签是解引用后的实际 commit hash） */
	readonly hash: string;
	/** 是否是 annotated（附注）标签；true = annotated，false = lightweight */
	readonly isAnnotated: boolean;
}

/**
 * 单个远程分支引用信息
 *
 * 对应 Rust 后端的 RefRemote 结构体。
 * 包含远程分支名和所指向的提交哈希。
 */
export interface RefRemote {
	/** 远程分支名（已去除 refs/remotes/ 前缀，如 "origin/main"） */
	readonly name: string;
	/** 该远程分支所指向的提交的完整哈希值（40 位十六进制） */
	readonly hash: string;
}

/**
 * Git 仓库中所有引用的集合
 *
 * 对应 Rust 后端的 RefMap 结构体。
 * 包含四类引用：本地分支、标签、远程分支和 HEAD。
 * 这是 get_refs 命令的返回类型。
 */
export interface RefMap {
	/** 所有本地分支列表（refs/heads/* 下的引用） */
	readonly heads: ReadonlyArray<RefHead>;
	/** 所有标签列表（refs/tags/* 下的引用，含 annotated 和 lightweight） */
	readonly tags: ReadonlyArray<RefTag>;
	/** 所有远程分支列表（refs/remotes/* 下的引用，已过滤隐藏的 remote） */
	readonly remotes: ReadonlyArray<RefRemote>;
	/** HEAD 引用指向的提交哈希；空仓库则为 null */
	readonly head: string | null;
}


/**
 * ============================================================
 * 节点图（Graph）相关类型
 * ============================================================
 * 以下类型对应 Rust 后端 git/graph.rs 中的结构体，
 * 用于描述带 ref 注解的提交节点图。
 */

/**
 * 节点图查询参数
 *
 * 对应 Rust 后端的 GraphQueryParams 结构体。
 * 封装了 get_annotated_commit_graph 命令的所有查询参数。
 * 字段名使用 camelCase，与 Rust 后端的 serde 反序列化输入匹配。
 */
export interface GraphQueryParams {
	/** 要查询的分支列表；null 表示显示所有分支的提交 */
	readonly branches: string[] | null;
	/** 最大返回的提交数量（后端内部会 +1 来探测是否还有更多提交） */
	readonly maxCommits: number;
	/** 是否在提交上注解 tags */
	readonly showTags: boolean;
	/** 是否包含远程分支（影响 get_refs 和 get_log_enhanced 的行为） */
	readonly showRemoteBranches: boolean;
	/** 是否包含 reflog 中提到的提交 */
	readonly includeReflogs: boolean;
	/** 是否只跟随第一个 parent（--first-parent） */
	readonly onlyFirstParent: boolean;
	/** 提交排序方式：'default' | 'date' | 'author-date' | 'topo' */
	readonly ordering: CommitOrdering | 'default';
	/** 已知的 remote 名称列表（用于注解 remote 名称和 --glob 过滤） */
	readonly remotes: string[];
	/** 要隐藏的 remote 名称列表 */
	readonly hideRemotes: string[];
	/** 是否启用 mailmap（%aN/%aE 替换 %an/%ae） */
	readonly useMailmap: boolean;
	/** 是否在 HEAD 在已加载提交中时注入 UNCOMMITTED 虚拟节点 */
	readonly showUncommittedChanges: boolean;
}

/**
 * 带注解的提交节点图返回数据
 *
 * 对应 Rust 后端的 AnnotatedCommitGraph 结构体。
 * 包含带 ref 注解的提交列表、HEAD 引用、以及是否还有更多提交的标志。
 * 这是 get_annotated_commit_graph 命令的返回类型。
 *
 * 其中的 commits 字段使用 GitCommit 类型（对应 Rust 的 AnnotatedCommit），
 * 每个提交包含 heads/tags/remotes/stash 注解信息。
 */
export interface AnnotatedCommitGraph {
	/** 带注解的提交列表（按时间倒序，最新的在前） */
	readonly commits: ReadonlyArray<GitCommit>;
	/** HEAD 引用指向的提交哈希；空仓库则为 null */
	readonly head: string | null;
	/** 是否还有更多提交可加载（true = 还有更多，false = 已全部加载） */
	readonly moreCommitsAvailable: boolean;
}


/**
 * ============================================================
 * 提交对比（Commit Comparison）相关类型
 * ============================================================
 */

/**
 * 提交对比结果
 *
 * 对应 Rust 后端的 CommitComparison 结构体。
 * 包含两个提交之间的文件变更列表。
 * 这是 get_commit_comparison 命令的返回类型。
 */
export interface CommitComparison {
	/** 两提交之间的文件变更列表 */
	readonly fileChanges: ReadonlyArray<GitFileChange>;
}


/**
 * ============================================================
 * 历史文件清理（Purge History）相关类型
 * ============================================================
 * 以下类型用于"清理历史文件"功能（Task 1-7）。
 * 这些类型对应 Rust 后端 git/purge.rs 中的结构体，
 * 用于扫描、检测、删除 Git 历史中的大文件。
 * 字段名使用 camelCase，与 Rust 后端的 serde 序列化输出匹配。
 */

/**
 * 历史文件信息（扫描结果）
 *
 * 对应 Rust 后端的 HistoryFileInfo 结构体。
 * 描述一个文件在 Git 历史中所有版本的信息汇总。
 *
 * 字段说明：
 *   - path：文件在仓库中的相对路径（相对于仓库根目录）
 *   - maxSize：该文件所有版本中最大的大小（字节），
 *              用于判断是否为"大文件"
 *   - totalSize：该文件所有版本的总大小（字节），
 *                用于评估清理此文件能节省多少空间
 *   - commitCount：该文件出现在多少个提交中，
 *                   用于评估清理此文件的影响范围
 */
export interface HistoryFileInfo {
	/** 文件在仓库中的相对路径（如 "src/main.rs"） */
	readonly path: string;
	/** 该文件所有版本中最大的大小（字节） */
	readonly maxSize: number;
	/** 该文件所有版本的总大小（字节） */
	readonly totalSize: number;
	/** 该文件出现在多少个提交中 */
	readonly commitCount: number;
}

/**
 * filter-repo 可用性状态
 *
 * 对应 Rust 后端的 FilterRepoStatus 结构体。
 * 描述 git-filter-repo 工具的可用性。
 * 用于决定清理历史时使用 filter-repo（更快）还是 filter-branch（较慢）。
 */
export interface FilterRepoStatus {
	/** 是否可用（true = 已安装 git-filter-repo，false = 未安装） */
	readonly available: boolean;
	/** 版本号字符串（如 "2.38.0"）；如果不可用则为 null */
	readonly version: string | null;
}

/**
 * 历史文件删除结果
 *
 * 对应 Rust 后端的 PurgeResult 结构体。
 * 描述清理历史文件操作的结果，包括操作前后仓库大小对比、
 * 使用的清理方法、备份分支名以及错误信息。
 */
export interface PurgeResult {
	/** 是否成功（true = 清理成功，false = 清理失败） */
	readonly success: boolean;
	/** 操作前仓库大小（人类可读字符串，如 "12.5 MB"） */
	readonly beforeSize: string;
	/** 操作后仓库大小（人类可读字符串，如 "8.3 MB"） */
	readonly afterSize: string;
	/** 备份分支名（如 "backup/pre-purge-1700000000"）；如果未创建备份则为 null */
	readonly backupBranch: string | null;
	/** 使用的方法："filter-repo"（推荐）或 "filter-branch"（兼容） */
	readonly method: string;
	/** 错误信息（操作失败时）；如果成功则为 null */
	readonly error: string | null;
}
