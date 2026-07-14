/*
 * 配置服务模块（Config Service）
 *
 * 此模块负责管理两类配置：
 * 1. Git 仓库配置：通过 Tauri IPC 命令与 Rust 后端交互（get_config / set_config_value / unset_config_value）
 *    包括分支跟踪、远程仓库地址、用户身份（user.name/email）、推送默认模式、差异工具等
 * 2. 前端应用配置：持久化到 localStorage（后续可替换为 Tauri Store 插件）
 *    包括提交详情视图、日期格式、对话框默认值、图形样式、键盘快捷键、文件编码、Markdown 渲染等
 *
 * 设计说明：
 * - Git 仓库配置是"仓库级别"的，存储在 .git/config 或 ~/.gitconfig 中
 * - 前端应用配置是"应用级别"的，存储在浏览器 localStorage 中（键名前缀 'gittimeprism:'）
 * - 两类配置分离，互不干扰
 *
 * 参考实现：docs/git/src/config.ts（gitgraph 项目的 Config 类）
 *
 * 使用方式：
 * ```typescript
 * import { configService } from './config-service';
 * // 加载 Git 仓库配置
 * await configService.loadRepoConfig('/path/to/repo');
 * // 获取应用配置
 * const dateFormat = configService.getAppConfig('date.format');
 * // 设置应用配置
 * configService.setAppConfig('date.format', 'relative');
 * ```
 */

import { invoke } from '@tauri-apps/api/core';

/* ========================================================================== *
 * 第一部分：Git 仓库配置类型定义（与 Rust 后端 RepoConfig 结构一一对应）
 * ========================================================================== */

/**
 * 配置位置类型
 * - 'local'：仓库级配置（.git/config），只对当前仓库生效
 * - 'global'：用户级配置（~/.gitconfig），对当前用户的所有仓库生效
 */
export type ConfigLocation = 'local' | 'global';

/**
 * 单个分支的跟踪配置
 * 对应 Rust 后端的 BranchConfig 结构体
 */
export interface BranchConfig {
  /** 分支的拉取来源远程仓库名（branch.<name>.remote） */
  remote: string | null;
  /** 分支的推送目标远程仓库名（branch.<name>.pushremote），为 null 时使用 remote */
  push_remote: string | null;
}

/**
 * 单个远程仓库的配置
 * 对应 Rust 后端的 RemoteConfig 结构体
 */
export interface RemoteConfig {
  /** 远程仓库名称（如 "origin"） */
  name: string;
  /** 拉取地址（fetch URL） */
  url: string | null;
  /** 推送地址（push URL），为 null 时与 url 相同 */
  push_url: string | null;
}

/**
 * 用户身份配置
 * 对应 Rust 后端的 UserConfig 结构体
 */
export interface UserConfig {
  /** 提交者姓名（user.name） */
  name: string | null;
  /** 提交者邮箱（user.email） */
  email: string | null;
}

/**
 * 用户身份的完整配置（含 local 和 global 两级）
 * 对应 Rust 后端的 UserInfoConfig 结构体
 */
export interface UserInfoConfig {
  /** 仓库级用户配置（.git/config） */
  local: UserConfig;
  /** 用户级用户配置（~/.gitconfig） */
  global: UserConfig;
}

/**
 * 仓库配置的完整数据结构
 * 对应 Rust 后端的 RepoConfig 结构体
 *
 * 这是 get_config 命令的返回值，包含仓库的所有关键配置信息。
 */
export interface RepoConfig {
  /** 所有本地分支的跟踪配置（键为分支名） */
  branches: Record<string, BranchConfig>;
  /** 差异工具名称（diff.tool） */
  diff_tool: string | null;
  /** GUI 差异工具名称（diff.guitool） */
  gui_diff_tool: string | null;
  /** 推送默认模式（push.default） */
  push_default: string | null;
  /** 所有远程仓库的配置列表 */
  remotes: RemoteConfig[];
  /** 用户身份配置（含 local 和 global 两级） */
  user: UserInfoConfig;
}

/* ========================================================================== *
 * 第二部分：前端应用配置类型定义（参考 gitgraph config.ts）
 * ========================================================================== */

/**
 * 提交详情视图配置
 * 控制提交详情面板的显示行为
 */
export interface CommitDetailsViewConfig {
  /** 是否自动滚动到居中位置 */
  autoCenter: boolean;
  /** 文件树是否启用紧凑文件夹（合并单子文件夹） */
  fileTreeCompactFolders: boolean;
  /** 文件视图类型：'tree'=文件树 / 'list'=文件列表 */
  fileViewType: 'tree' | 'list';
  /** 面板位置：'inline'=内联 / 'docked'=停靠在底部 */
  location: 'inline' | 'docked';
}

/**
 * 日期格式配置
 */
export interface DateConfig {
  /** 日期格式类型：'relative'=相对时间 / 'dateOnly'=仅日期 / 'dateAndTime'=日期和时间 */
  format: 'relative' | 'dateOnly' | 'dateAndTime';
  /** 是否使用 ISO 格式 */
  iso: boolean;
  /** 日期类型：'authorDate'=作者日期 / 'commitDate'=提交日期 */
  type: 'authorDate' | 'commitDate';
}

/**
 * 对话框默认值配置
 * 控制各类对话框打开时的默认选项
 */
export interface DialogDefaultsConfig {
  /** 重置提交的默认模式：'soft' / 'mixed' / 'hard' */
  resetCommitMode: 'soft' | 'mixed' | 'hard';
  /** 重置未提交变更的默认模式 */
  resetUncommittedMode: 'mixed' | 'hard';
  /** 创建分支时是否默认切换到新分支 */
  createBranchCheckout: boolean;
  /** 删除分支时是否默认使用强制删除 */
  deleteBranchForce: boolean;
  /** 创建标签时是否默认推送到远程 */
  addTagPushToRemote: boolean;
  /** 创建标签的默认类型：'annotated'=附注标签 / 'lightweight'=轻量标签 */
  addTagType: 'annotated' | 'lightweight';
  /** Fetch 远程时是否默认启用 prune */
  fetchRemotePrune: boolean;
  /** Fetch 远程时是否默认启用 prune-tags */
  fetchRemotePruneTags: boolean;
  /** 合并时是否默认启用 --no-commit */
  mergeNoCommit: boolean;
  /** 合并时是否默认启用 --no-ff */
  mergeNoFastForward: boolean;
  /** 合并时是否默认启用 squash */
  mergeSquash: boolean;
  /** 拉取时是否默认启用 --no-ff */
  pullNoFastForward: boolean;
  /** 拉取时是否默认启用 squash */
  pullSquash: boolean;
  /** Stash 时是否默认包含未跟踪文件 */
  stashIncludeUntracked: boolean;
  /** Apply/Pop stash 时是否默认恢复暂存区状态（--index） */
  stashReinstateIndex: boolean;
}

/**
 * 提交节点图配置
 */
export interface GraphConfig {
  /** 分支颜色列表（CSS 颜色值，如 '#0085d9'） */
  colours: string[];
  /** 图形样式：'rounded'=圆角曲线 / 'angular'=折线 */
  style: 'rounded' | 'angular';
  /** 未提交变更的显示样式 */
  uncommittedChanges: 'openCircleAtUncommitted' | 'openCircleAtCheckedOut';
}

/**
 * 键盘快捷键配置（Task 11.3 扩展）
 *
 * 每个值是一个快捷键字符串，格式如：
 *   - "Ctrl+F"：Ctrl/Cmd + 字母
 *   - "Ctrl+Shift+S"：Ctrl/Cmd + Shift + 字母
 *   - "Up" / "Down"：方向键
 *   - "Ctrl+Up"：Ctrl + 方向键
 *   - "Enter" / "Escape"：单键
 * null 表示禁用该快捷键。
 *
 * 支持的修饰键前缀：Ctrl（macOS 上为 Cmd）、Alt、Shift
 */
export interface KeyboardShortcutsConfig {
  /** 查找快捷键（默认 "Ctrl+F"），null 表示禁用 */
  find: string | null;
  /** 刷新快捷键（默认 "Ctrl+R"），null 表示禁用 */
  refresh: string | null;
  /** 滚动到 HEAD 快捷键（默认 "Ctrl+H"），null 表示禁用 */
  scrollToHead: string | null;
  /** 滚动到第一个 Stash 快捷键（默认 "Ctrl+S"），null 表示禁用 */
  scrollToStash: string | null;
  /** 滚动到上一个 Stash 快捷键（默认 "Ctrl+Shift+S"），null 表示禁用 */
  scrollToPrevStash: string | null;
  /** 切换到上一个提交（默认 "Up"），null 表示禁用 */
  navigateUp: string | null;
  /** 切换到下一个提交（默认 "Down"），null 表示禁用 */
  navigateDown: string | null;
  /** 沿同一分支向上导航（默认 "Ctrl+Up"），null 表示禁用 */
  navigateSameBranchUp: string | null;
  /** 沿同一分支向下导航（默认 "Ctrl+Down"），null 表示禁用 */
  navigateSameBranchDown: string | null;
  /** 沿替代分支向上导航（默认 "Ctrl+Shift+Up"），null 表示禁用 */
  navigateAltBranchUp: string | null;
  /** 沿替代分支向下导航（默认 "Ctrl+Shift+Down"），null 表示禁用 */
  navigateAltBranchDown: string | null;
  /** 打开提交对话框（默认 "Enter"），null 表示禁用 */
  commitDialog: string | null;
  /** 关闭菜单/对话框/详情视图（默认 "Escape"），null 表示禁用 */
  closeOverlay: string | null;
  /** 切换终端面板显示（默认 "Ctrl+`"），null 表示禁用 */
  toggleTerminal: string | null;
}

/**
 * 仓库加载与显示配置
 */
export interface RepositoryConfig {
  /** 初始加载的提交数量 */
  initialLoadCommits: number;
  /** 点击"加载更多"时加载的提交数量 */
  loadMoreCommits: number;
  /** 是否自动加载更多提交（滚动到底部时） */
  loadMoreCommitsAutomatically: boolean;
  /** 是否显示标签 */
  showTags: boolean;
  /** 是否显示远程分支 */
  showRemoteBranches: boolean;
  /** 是否显示 Stash */
  showStashes: boolean;
  /** 是否显示未提交变更 */
  showUncommittedChanges: boolean;
  /** 是否显示未跟踪文件 */
  showUntrackedFiles: boolean;
  /** 是否只跟随第一个父提交（--first-parent） */
  onlyFollowFirstParent: boolean;
  /** 提交排序方式：'date'=按日期 / 'author-date'=按作者日期 / 'topo'=拓扑排序 */
  commitOrder: 'date' | 'author-date' | 'topo';
  /** 加载时是否滚动到 HEAD */
  onLoadScrollToHead: boolean;
  /** 加载时是否显示当前分支 */
  onLoadShowCheckedOutBranch: boolean;
  /** Task 13.7：是否显示 Reflog（git reflog 记录的本地操作历史） */
  showReflogs: boolean;
  /** Task 13.7：初始分支名（新建仓库时默认创建的分支名，空字符串表示使用 Git 默认值 main/master） */
  initialBranch: string;
}

/**
 * 引用标签（分支/标签）显示配置
 */
export interface ReferenceLabelsConfig {
  /** 分支标签是否对齐到图形 */
  branchLabelsAlignedToGraph: boolean;
  /** 是否合并本地和远程分支标签 */
  combineLocalAndRemoteBranchLabels: boolean;
  /** 标签是否显示在右侧 */
  tagLabelsOnRight: boolean;
}

/**
 * 6 类上下文菜单的可见性配置（Task 13.2）
 *
 * 控制每类右键菜单中每个菜单项的显隐。
 * 用户可在设置面板的"Context Menu Visibility"分组中调整。
 * 设置为 false 的菜单项不会渲染在菜单中。
 *
 * 6 类菜单：
 *   1. commit：提交右键菜单（11 项）
 *   2. branch：本地分支右键菜单（8 项）
 *   3. remoteBranch：远程分支右键菜单（7 项）
 *   4. tag：标签右键菜单（4 项）
 *   5. stash：Stash 右键菜单（6 项）
 *   6. uncommitted：未提交变更右键菜单（4 项）
 */
export interface ContextMenuActionsVisibilityConfig {
  /** 提交菜单的可见性配置（右键点击提交节点时显示） */
  commit: {
    /** Add Tag...（添加标签） */
    addTag: boolean;
    /** Create Branch...（创建分支） */
    createBranch: boolean;
    /** Checkout（检出） */
    checkout: boolean;
    /** Cherry Pick（拣选） */
    cherryPick: boolean;
    /** Revert（还原） */
    revert: boolean;
    /** Drop（丢弃） */
    drop: boolean;
    /** Merge...（合并） */
    merge: boolean;
    /** Rebase...（变基） */
    rebase: boolean;
    /** Reset...（重置） */
    reset: boolean;
    /** Copy Hash（复制哈希） */
    copyHash: boolean;
    /** Copy Subject（复制标题） */
    copySubject: boolean;
  };
  /** 本地分支菜单的可见性配置（右键点击本地分支标签时显示） */
  branch: {
    /** Checkout（切换到该分支） */
    checkout: boolean;
    /** Rename...（重命名） */
    rename: boolean;
    /** Delete...（删除） */
    delete: boolean;
    /** Merge...（合并） */
    merge: boolean;
    /** Rebase...（变基） */
    rebase: boolean;
    /** Push...（推送） */
    push: boolean;
    /** Create Pull Request（创建 Pull Request） */
    createPullRequest: boolean;
    /** Copy Name（复制分支名） */
    copyName: boolean;
  };
  /** 远程分支菜单的可见性配置（右键点击远程跟踪分支标签时显示） */
  remoteBranch: {
    /** Checkout（检出为本地分支） */
    checkout: boolean;
    /** Delete（删除远程分支） */
    delete: boolean;
    /** Fetch into local（拉取到本地分支） */
    fetchIntoLocal: boolean;
    /** Merge...（合并） */
    merge: boolean;
    /** Pull（拉取并合并） */
    pull: boolean;
    /** Create Pull Request（创建 Pull Request） */
    createPullRequest: boolean;
    /** Copy Name（复制远程分支名） */
    copyName: boolean;
  };
  /** 标签菜单的可见性配置（右键点击标签时显示） */
  tag: {
    /** View Details（查看详情） */
    viewDetails: boolean;
    /** Delete（删除标签） */
    delete: boolean;
    /** Push（推送标签到远程） */
    push: boolean;
    /** Copy Name（复制标签名） */
    copyName: boolean;
  };
  /** Stash 菜单的可见性配置（右键点击 stash 标签时显示） */
  stash: {
    /** Apply...（应用 stash） */
    apply: boolean;
    /** Pop...（弹出 stash） */
    pop: boolean;
    /** Drop...（丢弃 stash） */
    drop: boolean;
    /** Create Branch...（从 stash 创建分支） */
    createBranch: boolean;
    /** Copy Name（复制 stash 选择器） */
    copyName: boolean;
    /** Copy Hash（复制 stash 哈希） */
    copyHash: boolean;
  };
  /** 未提交变更菜单的可见性配置（右键点击虚拟 UNCOMMITTED 节点时显示） */
  uncommitted: {
    /** Stash...（暂存变更） */
    stash: boolean;
    /** Reset...（重置） */
    reset: boolean;
    /** Clean...（清理未跟踪文件） */
    clean: boolean;
    /** Open SCM（打开 SCM 工具） */
    openScm: boolean;
  };
}

/**
 * Task 13.7：Pull Request 创建配置
 *
 * 存储 PR 创建向导中用户配置的源/目标分支信息。
 * 当用户在分支右键菜单点击"Create Pull Request"时，使用此配置预填表单。
 *
 * 配置流程（两步向导）：
 *   1. 第一步：选择 Provider（GitHub/GitLab/Bitbucket/Custom）或自动检测
 *   2. 第二步：填写源分支和目标分支信息
 */
export interface PrCreationConfig {
  /** PR 提供商：'github' / 'gitlab' / 'bitbucket' / 'custom' / 'auto'（'auto'=自动检测） */
  provider: 'github' | 'gitlab' | 'bitbucket' | 'custom' | 'auto';
  /** 源仓库的 owner（用户名或组织名），空字符串表示使用当前仓库的 owner */
  sourceOwner: string;
  /** 源仓库名，空字符串表示使用当前仓库名 */
  sourceRepo: string;
  /** 源分支名（PR 的来源分支），空字符串表示使用当前分支 */
  sourceBranch: string;
  /** 目标仓库的 owner（通常与 sourceOwner 相同，fork 场景下不同） */
  destOwner: string;
  /** 目标仓库名 */
  destRepo: string;
  /** 目标分支名（PR 合并到的分支，如 'main'） */
  destBranch: string;
}

/**
 * 前端应用配置的完整结构
 * 包含所有应用级别的配置项
 */
export interface AppConfig {
  /** 提交详情视图配置 */
  commitDetailsView: CommitDetailsViewConfig;
  /** 日期格式配置 */
  date: DateConfig;
  /** 对话框默认值配置 */
  dialog: DialogDefaultsConfig;
  /** 提交节点图配置 */
  graph: GraphConfig;
  /** 键盘快捷键配置 */
  keyboardShortcuts: KeyboardShortcutsConfig;
  /** 仓库加载与显示配置 */
  repository: RepositoryConfig;
  /** 引用标签显示配置 */
  referenceLabels: ReferenceLabelsConfig;
  /** 6 类上下文菜单可见性配置（Task 13.2） */
  contextMenuActionsVisibility: ContextMenuActionsVisibilityConfig;
  /** 文件编码（如 'utf8'、'gbk'、'shift_jis'） */
  fileEncoding: string;
  /** 是否渲染 Markdown（提交消息中的强调、代码块等） */
  markdown: boolean;
  /** 是否启用增强无障碍模式 */
  enhancedAccessibility: boolean;
  /** 是否显示 Issue 链接（提交消息中 #123 转超链接） */
  issueLinking: boolean;
  /** Issue 链接的正则表达式（用于匹配 #123 格式的 issue 引用） */
  issueLinkingPattern: string;
  /** Issue 链接的 URL 模板（用 $1 替换 issue 编号） */
  issueLinkingUrl: string;
  /** Task 13.7：Issue Linking 是否全局使用（true=所有仓库使用同一配置，false=仅当前仓库） */
  issueLinkingUseGlobally: boolean;
  /** Task 13.7：PR 创建配置（两步向导中配置的源/目标分支信息） */
  prCreation: PrCreationConfig;
}

/**
 * 前端应用配置的默认值
 *
 * 参考gitgraph config.ts 的默认值设置。
 * 当 localStorage 中没有存储某个配置项时，使用这些默认值。
 */
const DEFAULT_APP_CONFIG: AppConfig = {
  commitDetailsView: {
    autoCenter: true,
    fileTreeCompactFolders: true,
    fileViewType: 'tree',
    location: 'inline',
  },
  date: {
    format: 'dateAndTime',
    iso: false,
    type: 'authorDate',
  },
  dialog: {
    resetCommitMode: 'mixed',
    resetUncommittedMode: 'mixed',
    createBranchCheckout: false,
    deleteBranchForce: false,
    addTagPushToRemote: false,
    addTagType: 'annotated',
    fetchRemotePrune: false,
    fetchRemotePruneTags: false,
    mergeNoCommit: false,
    mergeNoFastForward: true,
    mergeSquash: false,
    pullNoFastForward: false,
    pullSquash: false,
    stashIncludeUntracked: true,
    stashReinstateIndex: false,
  },
  graph: {
    colours: [
      '#0085d9', '#d9008f', '#00d90a', '#d98500', '#a300d9',
      '#ff0000', '#00d9cc', '#e138e8', '#85d900', '#dc5b23',
      '#6f24d6', '#ffcc00',
    ],
    style: 'rounded',
    uncommittedChanges: 'openCircleAtUncommitted',
  },
  keyboardShortcuts: {
    /* Task 11.3：扩展为完整快捷键配置，使用快捷键字符串格式 */
    find: 'Ctrl+F',                 /* 查找（默认 Ctrl+F） */
    refresh: 'Ctrl+R',              /* 刷新节点图（默认 Ctrl+R） */
    scrollToHead: 'Ctrl+H',         /* 滚动到 HEAD（默认 Ctrl+H） */
    scrollToStash: 'Ctrl+S',        /* 滚动到第一个 Stash（默认 Ctrl+S） */
    scrollToPrevStash: 'Ctrl+Shift+S', /* 滚动到上一个 Stash（默认 Ctrl+Shift+S） */
    navigateUp: 'Up',               /* 切换到上一个提交（默认 Up） */
    navigateDown: 'Down',           /* 切换到下一个提交（默认 Down） */
    navigateSameBranchUp: 'Ctrl+Up', /* 沿同一分支向上导航（默认 Ctrl+Up） */
    navigateSameBranchDown: 'Ctrl+Down', /* 沿同一分支向下导航（默认 Ctrl+Down） */
    navigateAltBranchUp: 'Ctrl+Shift+Up', /* 沿替代分支向上导航（默认 Ctrl+Shift+Up） */
    navigateAltBranchDown: 'Ctrl+Shift+Down', /* 沿替代分支向下导航（默认 Ctrl+Shift+Down） */
    commitDialog: 'Enter',          /* 打开提交对话框（默认 Enter） */
    closeOverlay: 'Escape',         /* 关闭菜单/对话框/详情视图（默认 Escape） */
    toggleTerminal: 'Ctrl+`',       /* 切换终端面板（默认 Ctrl+`） */
  },
  repository: {
    initialLoadCommits: 300,
    loadMoreCommits: 100,
    loadMoreCommitsAutomatically: true,
    showTags: true,
    showRemoteBranches: true,
    showStashes: true,
    showUncommittedChanges: true,
    showUntrackedFiles: true,
    onlyFollowFirstParent: false,
    commitOrder: 'date',
    onLoadScrollToHead: false,
    onLoadShowCheckedOutBranch: false,
    /* Task 13.7：默认不显示 Reflog（避免节点图过于拥挤） */
    showReflogs: false,
    /* Task 13.7：默认初始分支名为空（使用 Git 默认值，通常是 main 或 master） */
    initialBranch: '',
  },
  referenceLabels: {
    branchLabelsAlignedToGraph: false,
    combineLocalAndRemoteBranchLabels: true,
    tagLabelsOnRight: false,
  },
  /* Task 13.2：6 类上下文菜单可见性默认值（全部默认可见） */
  contextMenuActionsVisibility: {
    commit: {
      addTag: true,
      createBranch: true,
      checkout: true,
      cherryPick: true,
      revert: true,
      drop: true,
      merge: true,
      rebase: true,
      reset: true,
      copyHash: true,
      copySubject: true,
    },
    branch: {
      checkout: true,
      rename: true,
      delete: true,
      merge: true,
      rebase: true,
      push: true,
      createPullRequest: true,
      copyName: true,
    },
    remoteBranch: {
      checkout: true,
      delete: true,
      fetchIntoLocal: true,
      merge: true,
      pull: true,
      createPullRequest: true,
      copyName: true,
    },
    tag: {
      viewDetails: true,
      delete: true,
      push: true,
      copyName: true,
    },
    stash: {
      apply: true,
      pop: true,
      drop: true,
      createBranch: true,
      copyName: true,
      copyHash: true,
    },
    uncommitted: {
      stash: true,
      reset: true,
      clean: true,
      openScm: true,
    },
  },
  fileEncoding: 'utf8',
  markdown: true,
  enhancedAccessibility: false,
  issueLinking: true,
  // 默认匹配 #123 格式的 issue 引用
  issueLinkingPattern: '#([0-9]+)',
  // 默认使用 GitHub 风格的 issue URL（可被仓库级配置覆盖）
  issueLinkingUrl: 'https://github.com/owner/repo/issues/$1',
  /* Task 13.7：默认 Issue Linking 全局使用（所有仓库共享同一配置） */
  issueLinkingUseGlobally: true,
  /* Task 13.7：PR 创建默认配置（provider='auto' 表示自动检测，分支字段为空表示使用当前值） */
  prCreation: {
    provider: 'auto',
    sourceOwner: '',
    sourceRepo: '',
    sourceBranch: '',
    destOwner: '',
    destRepo: '',
    destBranch: '',
  },
};

/**
 * localStorage 存储键前缀
 * 所有应用配置项都以此前缀存储，避免与其他应用冲突
 */
const STORAGE_KEY_PREFIX = 'gittimeprism:config';

/**
 * 应用配置在 localStorage 中的存储键
 */
const APP_CONFIG_STORAGE_KEY = STORAGE_KEY_PREFIX;

/* ========================================================================== *
 * 第三部分：配置服务实现
 * ========================================================================== */

/**
 * 配置服务类
 *
 * 管理 Git 仓库配置和前端应用配置的加载、读取、修改和持久化。
 *
 * 使用方式：
 * ```typescript
 * import { configService } from './config-service';
 *
 * // 加载 Git 仓库配置（在打开仓库时调用）
 * await configService.loadRepoConfig('/path/to/repo');
 *
 * // 获取 Git 仓库配置
 * const repoConfig = configService.getRepoConfig();
 *
 * // 设置 Git 配置项（在 local 或 global 层级）
 * await configService.setConfigValue('user.name', '张三', 'local');
 *
 * // 获取应用配置
 * const dateFormat = configService.getAppConfigValue('date.format');
 *
 * // 设置应用配置（自动持久化到 localStorage）
 * configService.setAppConfigValue('date.format', 'relative');
 *
 * // 重置应用配置为默认值
 * configService.resetAppConfig();
 * ```
 */
class ConfigService {
  /** 当前加载的 Git 仓库配置（通过 get_config 命令从后端获取） */
  private repoConfig: RepoConfig | null = null;

  /** 当前应用配置（从 localStorage 加载，或使用默认值） */
  private appConfig: AppConfig = this.loadAppConfigFromStorage();

  /* ---------- Git 仓库配置相关方法 ---------- */

  /**
   * 加载 Git 仓库配置
   *
   * 调用后端 get_config 命令获取仓库的完整配置信息。
   * 应在打开仓库时调用。
   *
   * @param repoPath - 仓库根目录路径
   * @returns 仓库配置信息
   */
  async loadRepoConfig(repoPath: string): Promise<RepoConfig> {
    // 调用后端 get_config 命令
    this.repoConfig = await invoke<RepoConfig>('get_config', { repoPath });
    return this.repoConfig;
  }

  /**
   * 获取当前加载的 Git 仓库配置
   *
   * 返回上次 loadRepoConfig 加载的配置。
   * 如果尚未加载，返回 null。
   *
   * @returns 仓库配置，或 null（未加载）
   */
  getRepoConfig(): RepoConfig | null {
    return this.repoConfig;
  }

  /**
   * 设置 Git 配置项的值
   *
   * 调用后端 set_config_value 命令，在指定位置设置配置项。
   * 设置后会自动重新加载仓库配置以刷新缓存。
   *
   * @param repoPath - 仓库根目录路径
   * @param key - 配置键名（如 "user.name"、"remote.origin.url"）
   * @param value - 配置值
   * @param location - 配置位置（'local' 或 'global'）
   */
  async setConfigValue(
    repoPath: string,
    key: string,
    value: string,
    location: ConfigLocation,
  ): Promise<void> {
    // 调用后端 set_config_value 命令
    await invoke('set_config_value', { repoPath, location, key, value });
    // 设置成功后重新加载仓库配置以刷新缓存
    // 注意：如果 repoPath 与当前加载的仓库不同，这里会切换到新仓库的配置
    if (this.repoConfig !== null) {
      await this.loadRepoConfig(repoPath);
    }
  }

  /**
   * 删除 Git 配置项
   *
   * 调用后端 unset_config_value 命令，删除指定位置的配置项。
   * 删除后会自动重新加载仓库配置以刷新缓存。
   *
   * @param repoPath - 仓库根目录路径
   * @param key - 要删除的配置键名
   * @param location - 配置位置（'local' 或 'global'）
   */
  async unsetConfigValue(
    repoPath: string,
    key: string,
    location: ConfigLocation,
  ): Promise<void> {
    // 调用后端 unset_config_value 命令
    await invoke('unset_config_value', { repoPath, location, key });
    // 删除成功后重新加载仓库配置以刷新缓存
    if (this.repoConfig !== null) {
      await this.loadRepoConfig(repoPath);
    }
  }

  /* ---------- 前端应用配置相关方法 ---------- */

  /**
   * 从 localStorage 加载应用配置
   *
   * 如果 localStorage 中没有存储配置，返回默认值。
   * 如果存储的配置部分缺失，用默认值填充缺失部分（深度合并）。
   *
   * @returns 加载的应用配置
   */
  private loadAppConfigFromStorage(): AppConfig {
    try {
      // 从 localStorage 读取配置 JSON
      const stored = localStorage.getItem(APP_CONFIG_STORAGE_KEY);
      if (!stored) {
        // 没有存储过配置，返回默认值
        return this.deepClone(DEFAULT_APP_CONFIG);
      }
      // 解析 JSON 并与默认值深度合并（确保新增的配置项有默认值）
      const parsed = JSON.parse(stored) as Partial<AppConfig>;
      return this.deepMerge(this.deepClone(DEFAULT_APP_CONFIG), parsed);
    } catch (e) {
      // 解析失败（如 JSON 格式错误），返回默认值
      console.warn('[ConfigService] 加载应用配置失败，使用默认值:', e);
      return this.deepClone(DEFAULT_APP_CONFIG);
    }
  }

  /**
   * 将当前应用配置保存到 localStorage
   */
  private saveAppConfigToStorage(): void {
    try {
      // 将配置序列化为 JSON 并存储
      localStorage.setItem(APP_CONFIG_STORAGE_KEY, JSON.stringify(this.appConfig));
    } catch (e) {
      // 存储失败（如 localStorage 已满），打印警告
      console.warn('[ConfigService] 保存应用配置到 localStorage 失败:', e);
    }
  }

  /**
   * 获取完整的应用配置对象
   *
   * @returns 当前应用配置
   */
  getAppConfig(): AppConfig {
    return this.appConfig;
  }

  /**
   * 获取应用配置中指定路径的值
   *
   * 支持点分路径访问嵌套属性，例如：
   * - 'fileEncoding' → appConfig.fileEncoding
   * - 'date.format' → appConfig.date.format
   * - 'dialog.resetCommitMode' → appConfig.dialog.resetCommitMode
   *
   * @param key - 点分配置路径（如 'date.format'）
   * @returns 配置值（类型不确定，由调用方判断）
   */
  getAppConfigValue(key: string): unknown {
    return this.getNestedValue(this.appConfig, key);
  }

  /**
   * 设置应用配置中指定路径的值
   *
   * 支持点分路径访问嵌套属性。设置后自动持久化到 localStorage。
   *
   * @param key - 点分配置路径（如 'date.format'）
   * @param value - 配置值
   */
  setAppConfigValue(key: string, value: unknown): void {
    // 设置嵌套属性值
    this.setNestedValue(this.appConfig, key, value);
    // 自动持久化到 localStorage
    this.saveAppConfigToStorage();
  }

  /**
   * 批量更新应用配置
   *
   * 接受一个部分配置对象，深度合并到当前配置中。
   * 设置后自动持久化到 localStorage。
   *
   * @param partial - 要更新的配置项（部分 AppConfig 对象）
   */
  updateAppConfig(partial: Partial<AppConfig>): void {
    // 深度合并到当前配置
    this.appConfig = this.deepMerge(this.appConfig, partial);
    // 自动持久化
    this.saveAppConfigToStorage();
  }

  /**
   * 重置应用配置为默认值
   *
   * 将所有应用配置恢复为 DEFAULT_APP_CONFIG 中定义的默认值，
   * 并持久化到 localStorage。
   */
  resetAppConfig(): void {
    // 重置为默认值的深拷贝（避免修改默认值常量）
    this.appConfig = this.deepClone(DEFAULT_APP_CONFIG);
    // 持久化
    this.saveAppConfigToStorage();
  }

  /* ---------- 工具方法 ---------- */

  /**
   * 深度克隆对象
   *
   * 使用 JSON 序列化/反序列化实现深拷贝。
   * 适用于纯数据对象（不含函数、Date、RegExp 等特殊类型）。
   *
   * @param obj - 要克隆的对象
   * @returns 克隆后的对象
   */
  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * 深度合并两个对象
   *
   * 将 source 对象的属性递归合并到 target 对象中：
   * - 如果两者都是对象，递归合并
   * - 否则用 source 的值覆盖 target 的值
   * - source 中不存在的属性保留 target 的原值
   *
   * @param target - 目标对象（会被修改）
   * @param source - 源对象（提供新值）
   * @returns 合并后的对象（即 target）
   */
  private deepMerge<T extends object>(target: T, source: Partial<T> | null | undefined): T {
    // 如果 source 为 null 或 undefined，直接返回 target
    if (!source) return target;

    // 遍历 source 的所有属性
    for (const key of Object.keys(source) as Array<keyof T>) {
      const targetVal = target[key];
      const sourceVal = source[key];

      // 如果两者都是普通对象（非数组、非 null），递归合并
      if (
        typeof targetVal === 'object' &&
        targetVal !== null &&
        !Array.isArray(targetVal) &&
        typeof sourceVal === 'object' &&
        sourceVal !== null &&
        !Array.isArray(sourceVal)
      ) {
        // 递归合并子对象
        target[key] = this.deepMerge(
          targetVal as unknown as Record<string, unknown>,
          sourceVal as unknown as Record<string, unknown>,
        ) as unknown as T[keyof T];
      } else if (sourceVal !== undefined) {
        // 否则直接用 source 的值覆盖（数组、原始类型等）
        target[key] = sourceVal as T[keyof T];
      }
    }

    return target;
  }

  /**
   * 获取对象中指定点分路径的值
   *
   * 例如：getNestedValue({a: {b: 1}}, 'a.b') 返回 1
   *
   * @param obj - 目标对象
   * @param path - 点分路径（如 'a.b.c'）
   * @returns 路径对应的值，如果路径不存在返回 undefined
   */
  private getNestedValue(obj: object, path: string): unknown {
    // 按点分割路径
    const keys = path.split('.');
    // 从根对象开始逐层访问
    let current: unknown = obj;
    for (const key of keys) {
      // 如果当前值不是对象，或属性不存在，返回 undefined
      if (typeof current !== 'object' || current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }

  /**
   * 设置对象中指定点分路径的值
   *
   * 例如：setNestedValue(obj, 'a.b', 1) 会设置 obj.a.b = 1
   * 如果中间层级的对象不存在，会自动创建。
   *
   * @param obj - 目标对象
   * @param path - 点分路径（如 'a.b.c'）
   * @param value - 要设置的值
   */
  private setNestedValue(obj: object, path: string, value: unknown): void {
    // 按点分割路径
    const keys = path.split('.');
    // 逐层访问，直到倒数第二层
    let current: Record<string, unknown> = obj as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      // 如果中间层不存在或不是对象，创建一个空对象
      if (typeof current[key] !== 'object' || current[key] === null) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }
    // 在最后一层设置值
    current[keys[keys.length - 1]] = value;
  }
}

/**
 * 配置服务全局单例
 *
 * 整个应用共享一个 ConfigService 实例。
 * 通过 import { configService } from './config-service' 使用。
 */
export const configService = new ConfigService();
