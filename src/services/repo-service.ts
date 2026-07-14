/*
 * 仓库管理服务模块
 * 
 * 封装前端调用 Tauri IPC 命令的逻辑，提供统一的 Git 仓库操作接口。
 * 所有方法都是异步的，因为底层通过 invoke() 与 Rust 后端通信。
 * 
 * 使用方式：
 * import { repoService } from './services/repo-service';
 * const info = await repoService.openRepo('C:\\projects\\my-repo');
 * 
 * 后端对应的 Rust 命令在 src-tauri/src/commands/repo.rs 中实现，
 * 通过 invoke('命令名', 参数) 进行跨进程通信。
 */

import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';

// 导入与 gitgraph 项目对齐的新增类型定义（引用、Stash、提交详情、提交对比、节点图）
// 这些类型用于描述带 ref 注解的提交节点图等新功能的数据结构
import type {
  RefMap,
  GitStash,
  GitCommitDetails,
  CommitComparison,
  GraphQueryParams,
  AnnotatedCommitGraph,
} from '../utils/git-types';

/**
 * 仓库信息结构
 * 与 Rust 后端的 RepoInfo 结构体字段一一对应
 */
export interface RepoInfo {
  /** 仓库的本地路径 */
  path: string;
  /** 当前所在的分支名（如果没有分支则为 null，比如 detached HEAD） */
  current_branch: string | null;
  /** 是否是裸仓库（没有工作区的仓库，通常用于服务端） */
  is_bare: boolean;
  /** HEAD 指向的提交哈希（如果没有提交则为 null） */
  head_commit: string | null;
}

/**
 * 文件状态类型
 * 对应 git status --porcelain=v2 中的状态码
 */
export type FileStatus =
  | 'Modified'    // 文件被修改了
  | 'Added'       // 文件被添加了（已暂存）
  | 'Deleted'     // 文件被删除了
  | 'Untracked'   // 文件未被 Git 跟踪
  | 'Renamed'     // 文件被重命名了
  | 'Copied'      // 文件被复制了
  | 'Unmerged';   // 文件有合并冲突

/**
 * 单个文件的变更状态
 */
export interface StatusEntry {
  /** 文件路径（相对于仓库根目录） */
  path: string;
  /** 文件的变更类型 */
  status: FileStatus;
  /** 重命名/复制前的原路径（只有重命名/复制时才有值） */
  old_path: string | null;
  /** 是否已暂存（true = 已 git add，false = 仅工作区变更） */
  staged: boolean;
}

/**
 * 整个仓库的工作区状态
 */
export interface RepoStatus {
  /** 当前分支名 */
  branch: string;
  /** 所有变更文件列表 */
  entries: StatusEntry[];
}

/**
 * 单个分支的信息
 */
export interface BranchInfo {
  /** 分支名称 */
  name: string;
  /** 是否是当前检出的分支 */
  is_current: boolean;
  /** 是否是远程分支 */
  is_remote: boolean;
  /** 上游跟踪分支名（如 origin/main） */
  upstream: string | null;
  /** 领先上游的提交数（本地有但远程没有） */
  ahead: number;
  /** 落后上游的提交数（远程有但本地没有） */
  behind: number;
  /** 最新提交的完整哈希 */
  latest_commit: string;
  /** 最新提交的简要消息（第一行） */
  latest_commit_msg: string;
}

/**
 * 分支列表（包含本地和远程分支）
 */
export interface BranchList {
  /** 本地分支列表 */
  local: BranchInfo[];
  /** 远程分支列表 */
  remote: BranchInfo[];
}

/**
 * 单个提交的信息
 */
export interface CommitInfo {
  /** 完整的提交哈希（40 位 SHA-1） */
  hash: string;
  /** 短哈希（通常 7 位，可通过 --abbrev 设置） */
  short_hash: string;
  /** 提交作者姓名 */
  author: string;
  /** 提交作者邮箱 */
  email: string;
  /** 提交日期（ISO 8601 格式） */
  date: string;
  /** 提交消息（完整内容，可能包含多行） */
  message: string;
}

/**
 * 提交历史列表
 */
export interface CommitList {
  /** 提交列表 */
  commits: CommitInfo[];
  /** 符合条件的提交总数 */
  total_count: number;
}

/**
 * 单个 diff hunk（变更块）的信息
 * 对应 Rust 后端的 DiffHunk 结构体
 */
export interface DiffHunk {
  /** 旧文件中的起始行号 */
  old_start: number;
  /** 旧文件中的行数 */
  old_count: number;
  /** 新文件中的起始行号 */
  new_start: number;
  /** 新文件中的行数 */
  new_count: number;
  /** hunk 的所有行内容（包含前缀：+ 新增，- 删除，空格 上下文） */
  lines: string[];
}

/**
 * 单个文件的 diff 信息
 * 对应 Rust 后端的 FileDiff 结构体
 */
export interface FileDiff {
  /** 文件路径（相对于仓库根目录） */
  path: string;
  /** 旧文件路径（仅重命名文件有值） */
  old_path: string | null;
  /** 新增行数 */
  additions: number;
  /** 删除行数 */
  deletions: number;
  /** 是否是新增文件 */
  is_new: boolean;
  /** 是否是删除文件 */
  is_deleted: boolean;
  /** 是否是重命名文件 */
  is_renamed: boolean;
  /** diff hunks 列表 */
  hunks: DiffHunk[];
  /** 原始 diff 文本 */
  raw_diff: string;
}

/**
 * 整个 diff 的结果
 * 对应 Rust 后端的 DiffResult 结构体
 */
export interface DiffResult {
  /** 涉及的文件列表 */
  files: FileDiff[];
  /** 总新增行数 */
  total_additions: number;
  /** 总删除行数 */
  total_deletions: number;
}

/**
 * 提交节点图中的单个提交节点
 * 对应 Rust 后端的 GraphCommit 结构体
 *
 * @deprecated Task 13.8：已弃用。新代码应使用 AnnotatedCommit 类型（带 ref 注解的新版节点图数据结构）。
 * AnnotatedCommit 提供 heads/tags/remotes/stash 注解字段，支持前端 Canvas 渲染。
 * 此接口保留是为了不破坏旧版前端代码，后续版本可能移除。
 */
export interface GraphCommit {
  /** 节点图的 ASCII 线条（如 "* ", "| ", "|\\", "|/" 等） */
  graph_line: string;
  /** 提交的完整哈希值 */
  hash: string;
  /** 提交的短哈希值 */
  short_hash: string;
  /** 父提交的哈希列表 */
  parents: string[];
  /** 作者名字 */
  author: string;
  /** 提交日期（ISO 8601 格式） */
  date: string;
  /** 提交消息（第一行） */
  message: string;
}

/**
 * 完整的提交节点图数据
 * 对应 Rust 后端的 CommitGraph 结构体
 *
 * @deprecated Task 13.8：已弃用。新代码应使用 AnnotatedCommitGraph 类型（带 ref 注解的新版节点图返回数据）。
 * AnnotatedCommitGraph 包含 head 引用和 moreCommitsAvailable 标志，支持增量加载。
 * 此接口保留是为了不破坏旧版前端代码，后续版本可能移除。
 */
export interface CommitGraph {
  /** 所有提交节点列表（按时间倒序，最新的在前） */
  commits: GraphCommit[];
  /** 提交总数 */
  total_count: number;
}

/**
 * 标签信息结构
 * 与 Rust 后端的 TagInfo 结构体字段一一对应
 */
export interface TagInfo {
  /** 标签名称 */
  name: string;
  /** 标签指向的提交哈希值 */
  commit: string;
  /** 是否是附注标签（annotated 标签包含作者、日期、消息等元数据；lightweight 标签只是一个指针） */
  is_annotated: boolean;
  /** 附注标签的消息内容（仅 annotated 标签有值，lightweight 标签为 null） */
  message: string | null;
}

/**
 * 子模块信息结构（阶段 9：Task 9.1）
 * 与 Rust 后端的 SubmoduleInfo 结构体字段一一对应（camelCase）
 */
export interface SubmoduleInfo {
  /** 子模块在主仓库中的相对路径（如 "vendor/lib"） */
  path: string;
  /** 子模块的远程仓库 URL（HTTPS 或 SSH） */
  url: string;
  /** 子模块跟踪的分支名（如 "main"）；未指定分支时为空字符串 */
  branch: string;
  /** 子模块当前检出的完整提交哈希（40 位十六进制） */
  currentCommit: string;
  /** 子模块当前检出的短提交哈希（通常 7 位） */
  shortCommit: string;
  /** 子模块的差异状态（空格=无变更，"+"=提交不一致，"-"=未初始化，"U"=合并冲突） */
  status: string;
  /** 子模块是否已初始化（即 .git/modules/{path} 目录是否存在） */
  isInitialized: boolean;
}

/**
 * LFS 跟踪规则（阶段 9：Task 9.3）
 * 与 Rust 后端的 LfsPattern 结构体字段一一对应（camelCase）
 */
export interface LfsPattern {
  /** 跟踪规则的文件模式（如 "*.psd"、"*.zip"） */
  pattern: string;
  /** 此模式对应的文件是否已被锁定（通过 git lfs locks 查询） */
  isLocked: boolean;
}

/**
 * LFS 文件锁信息（阶段 9：Task 9.3）
 * 与 Rust 后端的 LfsLock 结构体字段一一对应（camelCase）
 */
export interface LfsLock {
  /** 被锁定的文件路径（相对于仓库根目录） */
  path: string;
  /** 锁的唯一 ID */
  id: string;
  /** 锁定此文件的用户名 */
  owner: string;
  /** 锁定时间（ISO 8601 格式字符串，如 "2024-01-15T08:30:00Z"） */
  lockedAt: string;
}

/**
 * GPG 签名状态枚举（阶段 9：Task 9.5）
 * 与 Rust 后端的 SignatureStatus 枚举对应，序列化为单字符（G/U/X/Y/R/E/B）
 * 注意：使用普通 enum（非 const enum），符合项目规范
 */
export enum SignatureStatus {
  /** G - 签名良好且有效 */
  GoodAndValid = 'G',
  /** U - 签名良好但有效性未知 */
  GoodWithUnknownValidity = 'U',
  /** X - 签名良好但已过期 */
  GoodButExpired = 'X',
  /** Y - 签名良好但密钥已过期 */
  GoodButMadeByExpiredKey = 'Y',
  /** R - 签名良好但密钥已被吊销 */
  GoodButMadeByRevokedKey = 'R',
  /** E - 无法检查签名（例如缺少公钥） */
  CannotBeChecked = 'E',
  /** B - 签名错误 */
  Bad = 'B',
}

/**
 * GPG 签名信息（阶段 9：Task 9.5）
 * 与 Rust 后端的 CommitSignature 结构体字段一一对应
 */
export interface CommitSignature {
  /** GPG 密钥 ID（来自 %GK） */
  key: string;
  /** 签名者信息（来自 %GS，通常是 "Name <email>"） */
  signer: string;
  /** 签名状态 */
  status: SignatureStatus;
}

/**
 * 标签详情信息（阶段 9：Task 9.5）
 * 与 Rust 后端的 TagDetails 结构体字段一一对应（camelCase）
 */
export interface TagDetails {
  /** 标签名称（如 "v1.0.0"） */
  name: string;
  /** 标签类型："annotated" = 附注标签，"lightweight" = 轻量标签 */
  type: string;
  /** 标签指向的对象哈希（完整 40 位） */
  object: string;
  /** 附注标签的标签者名字（lightweight 标签为空字符串） */
  taggerName: string;
  /** 附注标签的标签者邮箱（lightweight 标签为空字符串） */
  taggerEmail: string;
  /** 附注标签的标签日期（Unix 时间戳，单位：秒；lightweight 标签为 0） */
  taggerDate: number;
  /** 标签消息（annotated 标签的消息内容；lightweight 标签为空字符串） */
  message: string;
  /** GPG 签名信息（null = 此标签没有签名） */
  signature: CommitSignature | null;
}

/**
 * 凭证信息（阶段 9：Task 9.8）
 * 与 Rust 后端的 Credential 结构体字段一一对应（camelCase）
 */
export interface Credential {
  /** 远程仓库的主机名（如 "github.com"、"gitlab.com"） */
  host: string;
  /** 用户名（HTTPS 认证用户名，或 OAuth token） */
  username: string;
  /** 密码或个人访问令牌（Personal Access Token） */
  password: string;
}

/**
 * 合并冲突文件信息（Task 8.1：与 Rust 后端 ConflictFile 结构体对应）
 *
 * 表示一个存在合并冲突的文件的详细信息。
 * 合并冲突时，Git 索引中会同时存在该文件的三个版本（stage）：
 * - stage 1：base 版本（共同祖先提交中的版本）
 * - stage 2：ours 版本（当前分支的版本）
 * - stage 3：theirs 版本（被合并分支的版本）
 */
export interface ConflictFile {
  /** 冲突文件的路径（相对于仓库根目录） */
  path: string;
  /** ours 版本的 blob hash（stage 2，当前分支版本）；当前分支没有该文件时为 null（如 DU 状态） */
  ours_hash: string | null;
  /** theirs 版本的 blob hash（stage 3，被合并分支版本）；被合并分支没有该文件时为 null（如 UD 状态） */
  theirs_hash: string | null;
  /** base 版本的 blob hash（stage 1，共同祖先版本）；文件是新增的（无共同祖先版本，如 AA 状态）时为 null */
  base_hash: string | null;
}

/**
 * 单行的 Blame 信息（Task 8.3：与 Rust 后端 BlameLine 结构体对应）
 *
 * 表示文件中某一行的提交溯源信息。
 * 包含该行所属提交的哈希、作者、提交者、日期以及行内容。
 */
export interface BlameLine {
  /** 该行所属提交的完整哈希（40 位 SHA-1） */
  commit_hash: string;
  /** 该行所属提交的短哈希（前 7 位，便于显示） */
  short_hash: string;
  /** 作者名字（编写该行代码的人） */
  author: string;
  /** 作者邮箱 */
  author_email: string;
  /** 作者日期（ISO 8601 UTC 格式，如 "2024-01-15T08:30:00Z"） */
  author_date: string;
  /** 提交者名字（创建该提交的人，可能与作者不同，如 rebase 后） */
  committer: string;
  /** 提交者邮箱 */
  committer_email: string;
  /** 提交者日期（ISO 8601 UTC 格式） */
  committer_date: string;
  /** 该行在文件中的最终行号（从 1 开始） */
  line_number: number;
  /** 该行的实际内容（不含换行符） */
  line_content: string;
  /** 是否是边界提交（boundary commit，文件历史中最早可见的提交，blame 无法继续追溯更早的版本） */
  is_boundary: boolean;
}

/**
 * 仓库管理服务
 * 
 * 提供仓库操作的统一接口，所有方法返回 Promise。
 * 调用 Tauri 的 invoke() 与 Rust 后端通信。
 */
export const repoService = {
  /**
   * 打开现有仓库
   * 验证路径是否是有效的 Git 仓库，并获取基本信息
   * 
   * @param path - 仓库的本地目录路径
   * @returns 仓库信息（路径、当前分支等）
   */
  async openRepo(path: string): Promise<RepoInfo> {
    return await invoke<RepoInfo>('open_repo', { path });
  },

  /**
   * 初始化新仓库
   * 在指定路径下执行 git init，创建新的 Git 仓库
   * 
   * @param path - 要初始化的目录路径
   * @returns 新仓库的信息
   */
  async initRepo(path: string): Promise<RepoInfo> {
    return await invoke<RepoInfo>('init_repo', { path });
  },

  /**
   * 克隆远程仓库
   * 从远程 URL 克隆仓库到本地目录
   * 这是一个异步操作，可能需要较长时间（大仓库几分钟到几十分钟）
   * 
   * @param url - 远程仓库的 URL（HTTPS 或 SSH）
   * @param path - 本地目标目录路径
   */
  async cloneRepo(url: string, path: string): Promise<void> {
    await invoke<void>('clone_repo', { url, path });
  },

  /**
   * 获取仓库工作区状态
   * 返回所有变更文件的列表，包括修改、暂存、未跟踪等
   * 
   * @param repoPath - 仓库路径
   * @returns 仓库状态（分支 + 文件列表）
   */
  async getRepoStatus(repoPath: string): Promise<RepoStatus> {
    return await invoke<RepoStatus>('get_repo_status', { repoPath });
  },

  /**
   * 获取分支列表
   * 返回本地分支和远程分支的完整列表
   * 
   * @param repoPath - 仓库路径
   * @returns 分支列表（本地 + 远程）
   */
  async getBranches(repoPath: string): Promise<BranchList> {
    return await invoke<BranchList>('get_branches', { repoPath });
  },

  /**
   * 获取提交历史
   * 返回指定数量的最近提交记录
   * 
   * @param repoPath - 仓库路径
   * @param count - 要获取的提交数量（默认 30）
   * @returns 提交列表
   */
  async getCommitLog(repoPath: string, count: number = 30): Promise<CommitList> {
    return await invoke<CommitList>('get_commit_log', { repoPath, count });
  },

  /**
   * 选择本地目录（打开仓库/初始化仓库时使用）
   * 调用 Tauri 原生文件选择对话框，让用户选择一个文件夹
   * 
   * @returns 用户选择的目录路径，取消则返回 null
   */
  async selectDirectory(): Promise<string | null> {
    const result = await open({ directory: true, multiple: false });
    if (!result) return null;
    // Tauri dialog 的 open 返回 string | string[]
    return typeof result === 'string' ? result : result[0] ?? null;
  },

  /**
   * 暂存单个文件
   * 执行 git add <file>，将指定文件添加到暂存区
   * 
   * @param repoPath - 仓库路径
   * @param filePath - 要暂存的文件路径（相对于仓库根目录）
   */
  async stageFile(repoPath: string, filePath: string): Promise<void> {
    await invoke<void>('stage_file', { repoPath, filePath });
  },

  /**
   * 取消暂存单个文件
   * 执行 git reset HEAD -- <file>，将文件从暂存区移回工作区
   * 
   * @param repoPath - 仓库路径
   * @param filePath - 要取消暂存的文件路径（相对于仓库根目录）
   */
  async unstageFile(repoPath: string, filePath: string): Promise<void> {
    await invoke<void>('unstage_file', { repoPath, filePath });
  },

  /**
   * 暂存所有变更文件
   * 执行 git add -A，将所有工作区和暂存区的变更一次性添加到暂存区
   * 
   * @param repoPath - 仓库路径
   */
  async stageAll(repoPath: string): Promise<void> {
    await invoke<void>('stage_all', { repoPath });
  },

  /**
   * 创建提交
   * 执行 git commit -m "message"，将暂存区的变更提交到仓库
   * 
   * @param repoPath - 仓库路径
   * @param message - 提交消息
   * @returns 新提交的完整哈希值
   */
  async commitChanges(repoPath: string, message: string): Promise<string> {
    return await invoke<string>('commit_changes', { repoPath, message });
  },

  /**
   * 获取工作区与暂存区之间的差异
   * 返回工作区中尚未暂存的变更
   * 
   * @param repoPath - 仓库路径
   * @param filePath - 可选，指定单个文件路径；不传则获取所有文件的 diff
   * @returns diff 结果（包含文件列表和变更统计）
   */
  async getWorkdirDiff(repoPath: string, filePath?: string): Promise<DiffResult> {
    return await invoke<DiffResult>('get_workdir_diff', { repoPath, filePath: filePath || null });
  },

  /**
   * 获取暂存区与 HEAD 之间的差异
   * 返回已暂存但尚未提交的变更
   * 
   * @param repoPath - 仓库路径
   * @returns diff 结果（包含文件列表和变更统计）
   */
  async getStagedDiff(repoPath: string): Promise<DiffResult> {
    return await invoke<DiffResult>('get_staged_diff', { repoPath });
  },

  /**
   * 获取指定提交的差异
   * 返回该提交引入的所有文件变更
   * 
   * @param repoPath - 仓库路径
   * @param commitHash - 提交的哈希值
   * @returns diff 结果（包含文件列表和变更统计）
   */
  async getCommitDiff(repoPath: string, commitHash: string): Promise<DiffResult> {
    return await invoke<DiffResult>('get_commit_diff', { repoPath, commitHash });
  },

  /**
   * 获取提交节点图（新版，与 gitgraph 项目对齐）
   *
   * 改为调用 get_annotated_commit_graph 命令，返回带 ref 注解的提交列表
   * （AnnotatedCommitGraph，包含 commits + head + moreCommitsAvailable）。
   *
   * 与旧版（getCommitGraphLegacy）的区别：
   *   - 旧版返回 ASCII 图形线（graph_line 字段），前端解析字符画线
   *   - 新版返回结构化注解（heads/tags/remotes/stash），前端基于 parents
   *     数组自行计算分支布局，并能显示分支/标签/远程/stash 注解
   *
   * 内部构造 GraphQueryParams 查询参数，使用合理的默认值：
   *   - 显示所有分支、显示标签、显示远程分支、显示未提交变更虚拟节点
   *   - 不包含 reflog、不只跟随第一父提交、不启用 mailmap、默认排序
   *
   * @param repoPath - 仓库路径
   * @param count - 要获取的提交数量（默认 50）
   * @returns 带注解的节点图（commits 数组 + head 哈希 + moreCommitsAvailable 标志）
   */
  async getCommitGraph(repoPath: string, count: number = 50): Promise<AnnotatedCommitGraph> {
    // 构造查询参数：使用合理的默认值，显示完整的分支/标签/远程注解
    const params: GraphQueryParams = {
      branches: null,               // null 表示显示所有分支的提交
      maxCommits: count,            // 最大返回提交数量
      showTags: true,               // 在提交上注解标签
      showRemoteBranches: true,     // 包含远程分支
      includeReflogs: false,        // 不包含 reflog 中提到的提交
      onlyFirstParent: false,       // 不只跟随第一个 parent（显示完整合并历史）
      ordering: 'default',          // 使用默认提交排序
      remotes: [],                  // 已知的 remote 名称列表（空数组，后端自动获取）
      hideRemotes: [],              // 不隐藏任何 remote
      useMailmap: false,            // 不启用 mailmap 替换
      showUncommittedChanges: true, // 当 HEAD 在已加载提交中时注入 UNCOMMITTED 虚拟节点
    };
    return await invoke<AnnotatedCommitGraph>('get_annotated_commit_graph', { repoPath, params });
  },

  /**
   * 获取提交节点图（旧版，保留向后兼容）
   *
   * 调用旧的 get_commit_graph 命令，返回带 ASCII 图形线（graph_line 字段）
   * 的提交历史。新代码应优先使用 getCommitGraph（新版）或 getAnnotatedCommitGraph。
   *
   * 此方法保留是为了兼容可能仍依赖 ASCII graph_line 字段的旧代码，
   * 以及在需要快速回退时使用。
   *
   * @deprecated Task 13.8：已弃用。新代码应使用 getCommitGraph（返回 AnnotatedCommitGraph）。
   * 旧版节点图使用 ASCII 图形线渲染，新版改用 Canvas 渲染并支持 ref 注解。
   * 此方法及关联的 GraphCommit/CommitGraph 类型后续版本可能移除。
   *
   * @param repoPath - 仓库路径
   * @param count - 要获取的提交数量（0 表示全部，默认 50）
   * @returns 旧版节点图数据（包含 ASCII 图形线的提交节点列表和总数）
   */
  async getCommitGraphLegacy(repoPath: string, count: number = 50): Promise<CommitGraph> {
    return await invoke<CommitGraph>('get_commit_graph', { repoPath, count });
  },

  /**
   * 切换到指定分支
   * 执行 git checkout <branchName>，将 HEAD 指向目标分支并更新工作区文件。
   * 如果工作区有未提交的变更且与目标分支冲突，后端会抛出错误。
   *
   * @param repoPath - 仓库路径
   * @param branchName - 要切换到的目标分支名称（必须是已存在的分支）
   */
  async checkoutBranch(repoPath: string, branchName: string): Promise<void> {
    await invoke<void>('checkout_branch', { repoPath, branchName });
  },

  /**
   * 创建新分支并立即切换过去
   * 执行 git checkout -b <branchName>，基于当前 HEAD 创建一个新分支，
   * 然后自动切换到该新分支。适合在开始新功能或修复 bug 时使用。
   *
   * @param repoPath - 仓库路径
   * @param branchName - 要创建的新分支名称（不能与已有分支重名）
   */
  async createAndCheckout(repoPath: string, branchName: string): Promise<void> {
    await invoke<void>('create_and_checkout', { repoPath, branchName });
  },

  /**
   * 撤销提交
   * 执行 git reset，支持三种模式：
   * - soft: 保留更改在暂存区（最安全，只是撤销了 commit，文件修改还在暂存区）
   * - mixed: 保留更改在工作区（撤销 commit 和暂存，文件修改还在工作区但未暂存）
   * - hard: 完全撤销（危险操作，会丢失所有更改，文件恢复到提交前的状态）
   *
   * 此方法已扩展支持 reset 到任意 commit（Task 6.3）。
   * - 不传 commit 参数时，默认重置到 HEAD~1（撤销最近一次提交）
   * - 传入 commit 参数时，重置到指定的 commit
   *
   * @param repoPath - 仓库路径
   * @param mode - 撤销模式（"soft" | "mixed" | "hard"）
   * @param commit - 可选，要重置到的目标 commit（哈希、分支名、HEAD~N 等）
   */
  async resetCommit(repoPath: string, mode: string, commit?: string): Promise<void> {
    await invoke<void>('reset_commit', { repoPath, mode, commit: commit ?? null });
  },

  /**
   * 获取单个文件的提交历史
   * 执行 git log --follow <file_path>，返回该文件的所有提交记录
   * --follow 选项可以跟踪文件重命名，即使文件被重命名过也能找到所有历史
   * 
   * @param repoPath - 仓库路径
   * @param filePath - 文件路径（相对于仓库根目录）
   * @returns 该文件的提交历史列表
   */
  async getFileHistory(repoPath: string, filePath: string): Promise<CommitInfo[]> {
    return await invoke<CommitInfo[]>('get_file_history', { repoPath, filePath });
  },

  /**
   * 获取仓库的所有标签列表
   * 返回仓库中全部标签的信息，包括标签名、对应提交、类型和消息
   * 
   * @param repoPath - 仓库路径
   * @returns 标签信息数组
   */
  async getTags(repoPath: string): Promise<TagInfo[]> {
    return await invoke<TagInfo[]>('get_tags', { repoPath });
  },

  /**
   * 创建标签
   * 支持两种模式：
   * - lightweight: 轻量标签，只是一个指向提交的指针，不包含额外信息
   * - annotated: 附注标签，包含标签创建者、日期、消息等完整元数据
   * 
   * @param repoPath - 仓库路径
   * @param tagName - 标签名称（不能与已有标签重名）
   * @param commit - 要打标签的提交哈希值
   * @param mode - 标签类型（"lightweight" 或 "annotated"）
   * @param message - 附注标签的消息（仅 annotated 模式需要，lightweight 模式忽略）
   */
  async createTag(repoPath: string, tagName: string, commit: string, mode: string, message?: string): Promise<void> {
    await invoke<void>('create_tag', { repoPath, tagName, commit, mode, message: message || null });
  },

  /**
   * 删除标签
   * 从仓库中移除指定的标签，不会影响对应的提交
   * 
   * @param repoPath - 仓库路径
   * @param tagName - 要删除的标签名称
   */
  async deleteTag(repoPath: string, tagName: string): Promise<void> {
    await invoke<void>('delete_tag', { repoPath, tagName });
  },

  /**
   * 切换到标签
   * 执行 git checkout，将工作区切换到指定标签对应的提交
   * 切换后进入 detached HEAD 状态（因为没有分支关联）
   * 
   * @param repoPath - 仓库路径
   * @param tagName - 要切换到的标签名称
   */
  async checkoutTag(repoPath: string, tagName: string): Promise<void> {
    await invoke<void>('checkout_tag', { repoPath, tagName });
  },

  /**
   * 从远程仓库拉取更新
   * 执行 git pull <remote> <branch>，获取远程仓库的最新提交并合并到当前分支
   * 
   * @param repoPath - 仓库路径
   * @param remote - 远程仓库名（通常为 "origin"）
   * @param branch - 分支名
   * @returns 拉取操作的输出信息
   */
  async pull(repoPath: string, remote: string, branch: string): Promise<string> {
    return await invoke<string>('pull_changes', { repoPath, remote, branch });
  },

  /**
   * 推送本地提交到远程仓库
   * 执行 git push <remote> <branch>，将本地分支的提交推送到远程
   * 
   * @param repoPath - 仓库路径
   * @param remote - 远程仓库名（通常为 "origin"）
   * @param branch - 分支名
   * @returns 推送操作的输出信息
   */
  async push(repoPath: string, remote: string, branch: string): Promise<string> {
    return await invoke<string>('push_changes', { repoPath, remote, branch });
  },

  /**
   * 获取工作树中文件的完整内容
   * 直接读取工作目录中的文件
   * 
   * @param repoPath - 仓库路径
   * @param filePath - 文件路径（相对于仓库根目录）
   * @returns 文件内容
   */
  async getWorktreeFileContent(repoPath: string, filePath: string): Promise<string> {
    return await invoke<string>('get_worktree_file_content', { repoPath, filePath });
  },

  /**
   * 获取暂存区中文件的完整内容
   * 使用 git show :file_path 获取暂存区中的文件内容
   * 
   * @param repoPath - 仓库路径
   * @param filePath - 文件路径（相对于仓库根目录）
   * @returns 文件内容
   */
  async getStagedFileContent(repoPath: string, filePath: string): Promise<string> {
    return await invoke<string>('get_staged_file_content', { repoPath, filePath });
  },

  /**
   * 获取 HEAD 提交中文件的完整内容
   * 
   * 使用 git show HEAD:file_path 获取 HEAD 提交中的文件内容
   * 
   * @param repoPath - 仓库路径
   * @param filePath - 文件路径（相对于仓库根目录）
   * @returns 文件内容
   */
  async getHeadFileContent(repoPath: string, filePath: string): Promise<string> {
    return await invoke<string>('get_head_file_content', { repoPath, filePath });
  },

  /**
   * 获取指定提交中文件的完整内容
   * 
   * 使用 git show <commitHash>:file_path 获取指定提交中的文件内容
   * 
   * @param repoPath - 仓库路径
   * @param commitHash - 提交哈希值
   * @param filePath - 文件路径（相对于仓库根目录）
   * @returns 文件内容
   */
  async getFileContentAtCommit(repoPath: string, commitHash: string, filePath: string): Promise<string> {
    return await invoke<string>('get_file_content_at_commit', { repoPath, commitHash, filePath });
  },

  /**
   * 获取仓库中的所有引用（heads/tags/remotes/HEAD）
   *
   * 与 gitgraph 项目对齐的新增命令。
   * 执行 `git show-ref -d --head` 命令，返回结构化的 RefMap。
   * 包含本地分支、标签（含 annotated）、远程分支和 HEAD 引用。
   *
   * @param repoPath - 仓库路径
   * @param hideRemotes - 可选，要隐藏的 remote 名称列表（如 ['upstream']）
   * @returns 引用集合（heads + tags + remotes + head）
   */
  async getRefs(repoPath: string, hideRemotes?: string[]): Promise<RefMap> {
    return await invoke<RefMap>('get_refs', { repoPath, hideRemotes: hideRemotes ?? [] });
  },

  /**
   * 获取仓库中的所有 stash（暂存）记录
   *
   * 与 gitgraph 项目对齐的新增命令。
   * 执行 `git reflog --format=... refs/stash --` 命令，
   * 返回所有 stash 记录列表（按 stash@{0}, stash@{1}, ... 顺序）。
   *
   * @param repoPath - 仓库路径
   * @returns stash 记录列表（无 stash 时返回空数组）
   */
  async getStashes(repoPath: string): Promise<GitStash[]> {
    return await invoke<GitStash[]>('get_stashes', { repoPath });
  },

  /**
   * 应用指定的 stash（保留 stash 记录）
   *
   * 执行 `git stash apply [--index] {selector}` 命令。
   * 与 popStash 的区别：apply 不会从 stash 列表中删除该 stash，
   * 用户需要手动调用 dropStash 删除。
   *
   * @param repoPath - 仓库路径
   * @param selector - stash 选择器（如 "stash@{0}"）
   * @param index - 是否使用 --index 选项尝试恢复暂存区状态
   */
  async applyStash(repoPath: string, selector: string, index: boolean): Promise<void> {
    await invoke<void>('apply_stash', { repoPath, selector, index });
  },

  /**
   * 弹出指定的 stash（应用后自动删除）
   *
   * 执行 `git stash pop [--index] {selector}` 命令。
   * pop = apply + drop，如果应用过程中产生冲突，stash 不会被删除。
   *
   * @param repoPath - 仓库路径
   * @param selector - stash 选择器（如 "stash@{0}"）
   * @param index - 是否使用 --index 选项尝试恢复暂存区状态
   */
  async popStash(repoPath: string, selector: string, index: boolean): Promise<void> {
    await invoke<void>('pop_stash', { repoPath, selector, index });
  },

  /**
   * 删除指定的 stash（不应用变更）
   *
   * 执行 `git stash drop {selector}` 命令。
   * 直接从 stash 列表中删除该 stash，不影响当前工作区。此操作不可逆。
   *
   * @param repoPath - 仓库路径
   * @param selector - stash 选择器（如 "stash@{0}"）
   */
  async dropStash(repoPath: string, selector: string): Promise<void> {
    await invoke<void>('drop_stash', { repoPath, selector });
  },

  /**
   * 将当前未提交的变更保存为新的 stash
   *
   * 执行 `git stash push [--include-untracked] [--message {msg}]` 命令。
   * 该命令会：
   *   1. 保存当前工作区和暂存区的变更到新的 stash
   *   2. 重置工作区和暂存区到 HEAD 状态（clean working tree）
   *
   * @param repoPath - 仓库路径
   * @param includeUntracked - 是否包含未跟踪文件（--include-untracked 选项）
   * @param message - 可选的 stash 描述消息；为空或不传时使用 git 默认消息
   */
  async pushStash(repoPath: string, includeUntracked: boolean, message?: string): Promise<void> {
    // message 为 undefined 时传 null 给后端（Rust 端使用 Option<String> 接收）
    await invoke<void>('push_stash', {
      repoPath,
      includeUntracked,
      message: message ?? null,
    });
  },

  /**
   * 从 stash 创建新分支并切换过去
   *
   * 执行 `git stash branch {branchName} {selector}` 命令。
   * 该命令会：
   *   1. 基于 stash 的 base commit 创建新分支
   *   2. 切换到新分支
   *   3. 应用 stash 中的变更到工作区
   *   4. 如果应用成功，从 stash 列表中删除该 stash
   *
   * 适用场景：当 stash 的 base commit 已落后当前分支很多提交时，
   * 直接 apply 可能产生大量冲突；使用 branch 可以在干净环境中处理 stash 变更。
   *
   * @param repoPath - 仓库路径
   * @param branchName - 要创建的新分支名称（不能与已有分支重名）
   * @param selector - stash 选择器（如 "stash@{0}"）
   */
  async branchFromStash(repoPath: string, branchName: string, selector: string): Promise<void> {
    await invoke<void>('branch_from_stash', { repoPath, branchName, selector });
  },

  /**
   * 获取单个提交的完整详情（含 GPG 签名和文件变更）
   *
   * 与 gitgraph 项目对齐的新增命令。
   * 执行 `git show --quiet --format=... {hash}` 命令，
   * 解析 12 字段输出（含 GPG 签名信息），
   * 并调用 diff 命令获取文件变更列表，返回完整的提交详情。
   *
   * @param repoPath - 仓库路径
   * @param commitHash - 要查询详情的提交哈希值
   * @param hasParents - 此提交是否有父提交（true=普通提交，false=初始提交）
   * @param useMailmap - 可选，是否启用 mailmap（默认 false）
   * @returns 提交详情（含作者、提交者、签名、文件变更等）
   */
  async getCommitDetails(repoPath: string, commitHash: string, hasParents: boolean, useMailmap?: boolean): Promise<GitCommitDetails> {
    return await invoke<GitCommitDetails>('get_commit_details', { repoPath, commitHash, hasParents, useMailmap: useMailmap ?? false });
  },

  /**
   * 获取两个提交之间的对比结果（文件差异）
   *
   * 与 gitgraph 项目对齐的新增命令。
   * 复用 get_diff_name_status + get_diff_num_stat 生成文件变更列表。
   * 当 toHash 为 '*'（UNCOMMITTED 虚拟节点）时，表示与工作区对比。
   *
   * @param repoPath - 仓库路径
   * @param fromHash - 对比的起始提交哈希
   * @param toHash - 对比的目标提交哈希（'*' 表示与工作区对比）
   * @returns 提交对比结果（包含文件变更列表）
   */
  async getCommitComparison(repoPath: string, fromHash: string, toHash: string): Promise<CommitComparison> {
    return await invoke<CommitComparison>('get_commit_comparison', { repoPath, fromHash, toHash });
  },

  /**
   * 获取带 ref 注解的提交节点图（新版，与 gitgraph 项目对齐）
   *
   * 通过并行调用 get_log_enhanced + get_refs + get_stashes 三路数据，
   * 组装出带 heads/tags/remotes/stash 注解的提交列表。
   * 当 HEAD 在已加载提交中且 showUncommittedChanges=true 时，
   * 会在列表头部注入虚拟 UNCOMMITTED 节点（hash 为 '*'）。
   *
   * @param repoPath - 仓库路径
   * @param params - 查询参数（见 GraphQueryParams 类型）
   * @returns 带注解的节点图（commits + head + moreCommitsAvailable）
   */
  async getAnnotatedCommitGraph(repoPath: string, params: GraphQueryParams): Promise<AnnotatedCommitGraph> {
    return await invoke<AnnotatedCommitGraph>('get_annotated_commit_graph', { repoPath, params });
  },

  /**
   * 从远程仓库获取更新（fetch）
   *
   * 与 gitgraph 项目对齐的新增命令。
   * 执行 `git fetch [--all / <remote>] [--prune] [--prune-tags]` 命令，
   * 从远程仓库下载更新到本地的远程跟踪分支，但不自动合并到当前分支。
   *
   * 与 pull 的区别：
   *   - pull = fetch + merge，会自动合并到当前分支
   *   - fetch 只下载，不合并，更安全（适合在查看远程更新后再决定是否合并）
   *
   * @param repoPath - 仓库路径
   * @param remote - 远程仓库名（如 "origin"）；不传（undefined）时使用 --all 拉取所有远程
   * @param prune - 是否启用 --prune（清理远程已删除的本地远程跟踪分支引用）
   * @param pruneTags - 是否启用 --prune-tags（清理远程已删除的本地标签引用）
   * @returns fetch 命令的输出信息
   */
  async fetch(repoPath: string, remote?: string, prune?: boolean, pruneTags?: boolean): Promise<string> {
    // remote 为 undefined 时传 null 给后端（Rust 端使用 Option<String> 接收，null → None → --all）
    // prune 和 pruneTags 为 undefined 时传 false（默认不启用）
    return await invoke<string>('fetch_command', {
      repoPath,
      remote: remote ?? null,
      prune: prune ?? false,
      pruneTags: pruneTags ?? false,
    });
  },

  /**
   * 清理指定远程仓库的本地引用（prune）
   *
   * 与 gitgraph 项目对齐的新增命令。
   * 执行 `git remote prune <name>` 命令，
   * 清理那些在远程仓库中已不存在的分支的本地远程跟踪引用
   * （如 origin/old-branch）。不会删除本地分支，也不会拉取新数据。
   *
   * @param repoPath - 仓库路径
   * @param name - 远程仓库名（如 "origin"）
   * @returns prune 命令的输出信息
   */
  async pruneRemote(repoPath: string, name: string): Promise<string> {
    return await invoke<string>('prune_remote', { repoPath, name });
  },

  /**
   * 添加新的远程仓库
   *
   * 与 gitgraph 项目对齐的新增命令。
   * 执行 `git remote add <name> <url>` 命令，向仓库添加一个新的远程仓库引用。
   * 添加后可通过 fetch 方法拉取该远程的提交。
   *
   * @param repoPath - 仓库路径
   * @param name - 新远程仓库名（不能与已有 remote 重名）
   * @param url - 远程仓库 URL（HTTPS 或 SSH）
   */
  async addRemote(repoPath: string, name: string, url: string): Promise<void> {
    await invoke<void>('add_remote', { repoPath, name, url });
  },

  /**
   * 删除现有远程仓库
   *
   * 与 gitgraph 项目对齐的新增命令。
   * 执行 `git remote remove <name>` 命令，从仓库中删除指定的远程仓库引用。
   * 删除后所有该远程的跟踪分支引用（如 origin/*）也会被删除。
   *
   * @param repoPath - 仓库路径
   * @param name - 要删除的远程仓库名
   */
  async deleteRemote(repoPath: string, name: string): Promise<void> {
    await invoke<void>('delete_remote', { repoPath, name });
  },

  /**
   * 编辑现有远程仓库（重命名 + 修改 fetch/push URL）
   *
   * 与 gitgraph 项目对齐的新增命令。
   * 支持三种编辑操作（按顺序执行）：
   *   1. 如果 newName 与 name 不同：执行 `git remote rename <name> <newName>`
   *   2. 如果 fetchUrl 不为 undefined：执行 `git remote set-url <newName> <fetchUrl>`
   *   3. 如果 pushUrl 不为 undefined：执行 `git remote set-url --push <newName> <pushUrl>`
   *
   * @param repoPath - 仓库路径
   * @param name - 当前远程仓库名
   * @param newName - 新远程仓库名；不传（undefined）时表示不重命名
   * @param fetchUrl - 新 fetch URL；不传（undefined）时表示不修改
   * @param pushUrl - 新 push URL；不传（undefined）时表示不修改
   */
  async editRemote(repoPath: string, name: string, newName?: string, fetchUrl?: string, pushUrl?: string): Promise<void> {
    await invoke<void>('edit_remote', {
      repoPath,
      name,
      newName: newName ?? null,
      fetchUrl: fetchUrl ?? null,
      pushUrl: pushUrl ?? null,
    });
  },

  /**
   * 将远程分支 fetch 到本地分支
   *
   * 与 gitgraph 项目对齐的新增命令。
   * 执行 `git fetch <remote> <remoteBranch>:<localBranch>` 命令。
   * 此命令会将远程分支的内容下载到指定的本地分支，但不切换分支也不合并。
   *
   * 适用场景：
   *   - 查看远程分支的内容而不影响当前工作分支
   *   - 创建本地分支跟踪远程分支
   *
   * @param repoPath - 仓库路径
   * @param remote - 远程仓库名（如 "origin"）
   * @param remoteBranch - 远程分支名（不含 remote 前缀，如 "feature"）
   * @param localBranch - 本地分支名（如 "feature"）
   */
  async fetchIntoLocalBranch(repoPath: string, remote: string, remoteBranch: string, localBranch: string): Promise<void> {
    await invoke<void>('fetch_into_local_branch', { repoPath, remote, remoteBranch, localBranch });
  },

  /**
   * 合并指定对象到当前分支
   *
   * 与 gitgraph 项目对齐的新增命令（Task 6.1）。
   * 执行 `git merge <obj> [--squash] [--no-ff] [--no-commit] [-S]` 命令。
   * 对于 squash 合并（且未指定 --no-commit），会自动创建提交。
   *
   * @param repoPath - 仓库路径
   * @param obj - 要合并的对象（分支名、远程跟踪分支名、或提交哈希）
   * @param squash - 是否启用 --squash（压缩合并）
   * @param noFastForward - 是否启用 --no-ff（禁止快进）
   * @param noCommit - 是否启用 --no-commit（合并不自动提交）
   * @param sign - 是否启用 GPG 签名（-S 选项）
   * @returns 新提交的哈希（如果产生了新提交），否则返回 null
   */
  async merge(repoPath: string, obj: string, squash: boolean, noFastForward: boolean, noCommit: boolean, sign: boolean): Promise<string | null> {
    return await invoke<string | null>('merge', { repoPath, obj, squash, noFastForward, noCommit, sign });
  },

  /**
   * 将当前分支变基到指定对象之上
   *
   * 与 gitgraph 项目对齐的新增命令（Task 6.1）。
   * 执行 `git rebase <obj> [--ignore-date] [-S]` 命令。
   * 注意：交互式变基（interactive=true）由前端在 PTY 终端中执行，不调用此命令。
   *
   * @param repoPath - 仓库路径
   * @param obj - 要变基到的目标对象（分支名、远程跟踪分支名、或提交哈希）
   * @param ignoreDate - 是否启用 --ignore-date（保持原始提交日期不变）
   * @param sign - 是否启用 GPG 签名（-S 选项）
   * @param interactive - 是否启用交互式变基（true 时由前端在 PTY 终端启动）
   */
  async rebase(repoPath: string, obj: string, ignoreDate: boolean, sign: boolean, interactive: boolean): Promise<void> {
    await invoke<void>('rebase', { repoPath, obj, ignoreDate, sign, interactive });
  },

  /**
   * 拣选指定提交的变更到当前分支
   *
   * 与 gitgraph 项目对齐的新增命令（Task 6.1）。
   * 执行 `git cherry-pick [--no-commit] [-x] [-S] [-m <parent>] <hash>` 命令。
   *
   * @param repoPath - 仓库路径
   * @param hash - 要拣选的提交哈希值
   * @param noCommit - 是否启用 --no-commit（拣选但不创建提交）
   * @param recordOrigin - 是否启用 -x（在提交消息中附加来源标记）
   * @param sign - 是否启用 GPG 签名（-S 选项）
   * @param mainline - 父提交索引（用于拣选合并提交，0 表示不指定）
   */
  async cherrypick(repoPath: string, hash: string, noCommit: boolean, recordOrigin: boolean, sign: boolean, mainline: number): Promise<void> {
    await invoke<void>('cherrypick', { repoPath, hash, noCommit, recordOrigin, sign, mainline });
  },

  /**
   * 还原指定提交（创建反向提交）
   *
   * 与 gitgraph 项目对齐的新增命令（Task 6.1）。
   * 执行 `git revert --no-edit [-S] [-m <parent>] <hash>` 命令。
   * 通过创建反向提交来撤销指定提交的变更（不改写历史，安全操作）。
   *
   * @param repoPath - 仓库路径
   * @param hash - 要还原的提交哈希值
   * @param sign - 是否启用 GPG 签名（-S 选项）
   * @param mainline - 父提交索引（用于还原合并提交，0 表示不指定）
   */
  async revert(repoPath: string, hash: string, sign: boolean, mainline: number): Promise<void> {
    await invoke<void>('revert', { repoPath, hash, sign, mainline });
  },

  /**
   * 丢弃指定的提交
   *
   * 与 gitgraph 项目对齐的新增命令（Task 6.1）。
   * 通过 `git rebase [-S] --onto <hash>^ <hash>` 命令实现丢弃提交。
   * ⚠️ 危险操作：此操作会改写 Git 历史。
   * 后端会进行拓扑可行性检查，不能丢弃 HEAD 的祖先提交。
   *
   * @param repoPath - 仓库路径
   * @param hash - 要丢弃的提交哈希值
   * @param sign - 是否启用 GPG 签名（-S 选项）
   */
  async dropCommit(repoPath: string, hash: string, sign: boolean): Promise<void> {
    await invoke<void>('drop_commit', { repoPath, hash, sign });
  },

  /**
   * 重命名分支
   *
   * 与 gitgraph 项目对齐的新增命令（Task 6.2）。
   * 执行 `git branch -m <oldName> <newName>` 命令。
   *
   * @param repoPath - 仓库路径
   * @param oldName - 旧的分支名称
   * @param newName - 新的分支名称
   */
  async renameBranch(repoPath: string, oldName: string, newName: string): Promise<void> {
    await invoke<void>('rename_branch', { repoPath, oldName, newName });
  },

  /**
   * 删除本地分支
   *
   * 与 gitgraph 项目对齐的新增命令（Task 6.2）。
   * 执行 `git branch -d <name>`（安全删除）或 `git branch -D <name>`（强制删除）。
   *
   * @param repoPath - 仓库路径
   * @param name - 要删除的分支名称
   * @param force - 是否强制删除（true 使用 -D，false 使用 -d）
   */
  async deleteBranch(repoPath: string, name: string, force: boolean): Promise<void> {
    await invoke<void>('delete_branch', { repoPath, name, force });
  },

  /**
   * 删除远程分支
   *
   * 与 gitgraph 项目对齐的新增命令（Task 6.2）。
   * 先尝试执行 `git push <remote> --delete <branch>` 删除远程分支。
   * 如果远程分支不存在，则兜底执行 `git branch -d -r <remote>/<branch>` 删除本地远程跟踪引用。
   *
   * @param repoPath - 仓库路径
   * @param remote - 远程仓库名（如 "origin"）
   * @param branch - 要删除的远程分支名（不含 remote 前缀）
   */
  async deleteRemoteBranch(repoPath: string, remote: string, branch: string): Promise<void> {
    await invoke<void>('delete_remote_branch', { repoPath, remote, branch });
  },

  /**
   * 检出到指定提交（进入 detached HEAD 状态）
   *
   * 与 gitgraph 项目对齐的新增命令（Task 6.2）。
   * 执行 `git checkout <hash>` 命令，进入分离头指针状态。
   *
   * @param repoPath - 仓库路径
   * @param hash - 要检出的提交哈希值
   */
  async checkoutCommit(repoPath: string, hash: string): Promise<void> {
    await invoke<void>('checkout_commit', { repoPath, hash });
  },

  /**
   * 创建新分支
   *
   * 与 gitgraph 项目对齐的新增命令（Task 6.2）。
   * 支持以下创建方式：
   * - checkout=true, force=false: 创建并切换（git checkout -b）
   * - checkout=false: 仅创建不切换（git branch）
   * - force=true: 强制创建（git branch -f）
   *
   * @param repoPath - 仓库路径
   * @param name - 新分支的名称
   * @param hash - 新分支要指向的提交哈希（空字符串表示使用当前 HEAD）
   * @param checkout - 创建后是否立即切换到新分支
   * @param force - 是否强制创建（覆盖同名分支）
   */
  async createBranch(repoPath: string, name: string, hash: string, checkout: boolean, force: boolean): Promise<void> {
    await invoke<void>('create_branch', { repoPath, name, hash, checkout, force });
  },

  /**
   * 从远程仓库拉取更新（带选项）
   *
   * 与 gitgraph 项目对齐的新增命令（Task 6.4）。
   * 执行 `git pull <remote> <branch> [--squash|--no-ff] [-S]` 命令。
   * 对于 squash 拉取，会自动检查暂存区是否有变更并创建提交。
   *
   * @param repoPath - 仓库路径
   * @param remote - 远程仓库名（通常为 "origin"）
   * @param branch - 要拉取的分支名
   * @param squash - 是否启用 --squash（压缩拉取）
   * @param noFastForward - 是否启用 --no-ff（禁止快进）
   * @param sign - 是否启用 GPG 签名（-S 选项）
   * @returns 拉取操作的输出信息
   */
  async pullWithOptions(repoPath: string, remote: string, branch: string, squash: boolean, noFastForward: boolean, sign: boolean): Promise<string> {
    return await invoke<string>('pull_changes_with_options', { repoPath, remote, branch, squash, noFastForward, sign });
  },

  /**
   * 推送本地提交到远程仓库（带选项）
   *
   * 与 gitgraph 项目对齐的新增命令（Task 6.4）。
   * 执行 `git push <remote> <branch> [--set-upstream] [--force|--force-with-lease]` 命令。
   *
   * @param repoPath - 仓库路径
   * @param remote - 远程仓库名（通常为 "origin"）
   * @param branch - 要推送的分支名
   * @param setUpstream - 是否启用 --set-upstream
   * @param force - 是否启用 --force（强制推送）
   * @param forceWithLease - 是否启用 --force-with-lease（带租约的强制推送）
   * @returns 推送操作的输出信息
   */
  async pushWithOptions(repoPath: string, remote: string, branch: string, setUpstream: boolean, force: boolean, forceWithLease: boolean): Promise<string> {
    return await invoke<string>('push_changes_with_options', { repoPath, remote, branch, setUpstream, force, forceWithLease });
  },

  /**
   * 推送标签到远程仓库
   *
   * 与 gitgraph 项目对齐的新增命令（Task 6.4）。
   * 执行 `git push <remote> <tag>` 命令，将指定的标签推送到远程仓库。
   *
   * @param repoPath - 仓库路径
   * @param remote - 远程仓库名（通常为 "origin"）
   * @param tag - 要推送的标签名
   * @returns 推送操作的输出信息
   */
  async pushTag(repoPath: string, remote: string, tag: string): Promise<string> {
    return await invoke<string>('push_tag', { repoPath, remote, tag });
  },

  /**
   * 检测仓库中存在合并冲突的文件列表
   *
   * 与 gitgraph 项目对齐的新增命令（Task 8.1）。
   * 执行 `git ls-files -u -z` 命令，返回所有 unmerged 文件的列表，
   * 每个文件包含 path、ours_hash、theirs_hash、base_hash 信息。
   *
   * 使用场景：
   * - merge/pull/rebase 操作后，如果命令返回错误（可能存在冲突），
   *   前端调用此方法获取冲突文件列表，然后打开合并编辑器解决冲突。
   * - 也可以在任意时刻调用此方法检查仓库是否处于冲突状态。
   *
   * @param repoPath - 仓库路径
   * @returns 冲突文件列表（无冲突时返回空数组）
   */
  async detectConflicts(repoPath: string): Promise<ConflictFile[]> {
    return await invoke<ConflictFile[]>('detect_conflicts', { repoPath });
  },

  /**
   * 获取文件每行的 Blame 信息
   *
   * 与 gitgraph 项目对齐的新增命令（Task 8.3）。
   * 执行 `git blame --line-porcelain -- <file_path>` 命令，
   * 返回文件每行的提交溯源信息列表（BlameLine 数组）。
   *
   * 每行信息包含：提交完整哈希和短哈希、作者信息、提交者信息、
   * 行号、行内容、是否是边界提交（boundary commit）。
   *
   * 使用场景：
   * - 用户在文件右键菜单中选择"View Blame"时，前端调用此方法
   *   获取行级别的提交信息，然后在 Blame 视图中显示。
   * - 点击某行可跳转到对应提交的详情视图。
   *
   * @param repoPath - 仓库路径
   * @param filePath - 要查询 blame 的文件路径（相对于仓库根目录）
   * @returns 文件每行的 blame 信息列表
   */
  async getBlame(repoPath: string, filePath: string): Promise<BlameLine[]> {
    return await invoke<BlameLine[]>('get_blame', { repoPath, filePath });
  },

  /**
   * 将内容写入工作树中的文件
   *
   * Task 8.2 新增命令：用于合并编辑器在用户解决冲突后将合并结果写回文件。
   * 直接写入工作目录中的文件，覆盖原有内容。
   *
   * @param repoPath - 仓库路径
   * @param filePath - 文件路径（相对于仓库根目录）
   * @param content - 要写入的文件内容
   */
  async writeFileContent(repoPath: string, filePath: string, content: string): Promise<void> {
    await invoke<void>('write_file_content', { repoPath, filePath, content });
  },

  // ==================== 阶段 10：仓库管理 + 状态持久化 + 头像 ====================

  /**
   * 获取指定用户的头像（阶段 10：Task 10.5）
   *
   * 调用后端 get_avatar 命令获取头像：
   * 1. 先检查本地缓存（~/.gittimeprism/avatars/）
   * 2. 缓存未命中时根据仓库 remote 源类型获取：
   *    - GitHub 源：调用 GitHub API（本阶段简化为 Gravatar 兜底）
   *    - GitLab 源：调用 GitLab API
   *    - Gravatar 源：用 email 的 MD5 哈希构造 URL
   * 3. 返回头像文件的本地路径
   *
   * 前端可以用 convertFileSrc(path) 将本地路径转为可加载的 URL：
   * ```typescript
   * import { convertFileSrc } from '@tauri-apps/api/core';
   * const avatarPath = await repoService.getAvatar(repoPath, email, author);
   * if (avatarPath) {
   *   imgElement.src = convertFileSrc(avatarPath);
   * }
   * ```
   *
   * @param repoPath - 仓库路径（用于检测 remote 源类型）
   * @param email - 用户邮箱（用于标识头像和构造 Gravatar URL）
   * @param author - 作者名（备用，目前未使用）
   * @returns 头像文件的本地路径，获取失败则为 null
   */
  async getAvatar(repoPath: string, email: string, author: string): Promise<string | null> {
    const result = await invoke<string | null>('get_avatar', { repoPath, email, author });
    return result;
  },

  /**
   * 清除所有头像缓存（阶段 10：Task 10.5）
   *
   * 删除 ~/.gittimeprism/avatars/ 目录下的所有头像文件和缓存索引。
   * 用户在设置中"清除头像缓存"时调用。
   *
   * @returns Promise，完成后所有头像缓存被清除
   */
  async clearAvatarCache(): Promise<void> {
    await invoke<void>('clear_avatar_cache');
  },

  /**
   * 发现指定路径下的所有 Git 仓库（阶段 10：Task 10.1）
   *
   * 递归搜索 workspacePath 下的所有 Git 仓库（识别含 .git 目录的文件夹）。
   *
   * @param workspacePath - 工作区根路径
   * @param maxDepth - 最大递归深度（0 = 仅检查根路径，1 = 检查一层子目录）
   * @returns 发现的仓库列表（含已注册与未注册的）
   */
  async discoverRepos(workspacePath: string, maxDepth: number): Promise<RepoEntry[]> {
    return await invoke<RepoEntry[]>('discover_repos', { workspacePath, maxDepth });
  },

  /**
   * 注册仓库（阶段 10：Task 10.1）
   *
   * 将仓库路径加入已注册列表，并记录打开时间。
   *
   * @param repoPath - 仓库路径
   */
  async registerRepo(repoPath: string): Promise<void> {
    await invoke<void>('register_repo', { repoPath });
  },

  /**
   * 取消注册仓库（阶段 10：Task 10.1）
   *
   * 将仓库从已注册列表中移除。
   *
   * @param repoPath - 仓库路径
   */
  async unregisterRepo(repoPath: string): Promise<void> {
    await invoke<void>('unregister_repo', { repoPath });
  },

  /**
   * 忽略仓库（阶段 10：Task 10.1）
   *
   * 将仓库加入忽略列表。
   *
   * @param repoPath - 仓库路径
   */
  async ignoreRepo(repoPath: string): Promise<void> {
    await invoke<void>('ignore_repo', { repoPath });
  },

  /**
   * 列出所有已注册的仓库（阶段 10：Task 10.1）
   *
   * @returns 已注册仓库的列表
   */
  async listRegisteredRepos(): Promise<RepoEntry[]> {
    return await invoke<RepoEntry[]>('list_registered_repos');
  },

  /**
   * 扫描仓库的子模块（阶段 10：Task 10.1）
   *
   * @param repoPath - 仓库路径
   * @returns 子模块路径列表（相对仓库根目录）
   */
  async scanSubmodules(repoPath: string): Promise<string[]> {
    return await invoke<string[]>('scan_submodules', { repoPath });
  },

  /**
   * 启动文件监听（阶段 10：Task 10.2）
   *
   * 开始监听指定仓库目录下的文件变化，触发 repo_changed 事件。
   *
   * @param repoPath - 仓库路径
   */
  async startWatcher(repoPath: string): Promise<void> {
    await invoke<void>('start_watcher', { repoPath });
  },

  /**
   * 停止文件监听（阶段 10：Task 10.2）
   */
  async stopWatcher(): Promise<void> {
    await invoke<void>('stop_watcher');
  },

  /**
   * 静音文件监听（阶段 10：Task 10.2）
   *
   * 在执行 Git 操作前调用，防止 GitTimePrism 自身的操作触发刷新。
   */
  async muteWatcher(): Promise<void> {
    await invoke<void>('mute_watcher');
  },

  /**
   * 取消静音文件监听（阶段 10：Task 10.2）
   *
   * 在 Git 操作完成后调用，恢复正常监听。
   * unmute 后 1.5 秒内的事件仍被忽略。
   */
  async unmuteWatcher(): Promise<void> {
    await invoke<void>('unmute_watcher');
  },

  // ==================== 阶段 9：子模块 + LFS + GPG 签名 + difftool + 文件编码 + askpass ====================

  /**
   * 获取仓库中所有子模块列表（阶段 9：Task 9.1）
   *
   * 解析 .gitmodules 文件获取子模块配置，结合 git submodule status 获取当前状态。
   *
   * @param repoPath - 仓库路径
   * @returns 子模块信息列表（无子模块时返回空数组）
   */
  async listSubmodules(repoPath: string): Promise<SubmoduleInfo[]> {
    return await invoke<SubmoduleInfo[]>('list_submodules', { repoPath });
  },

  /**
   * 添加子模块（阶段 9：Task 9.1）
   *
   * 执行 git submodule add <url> <path> [--branch <branch>] 命令。
   *
   * @param repoPath - 仓库路径
   * @param url - 子模块的远程仓库 URL
   * @param path - 子模块在主仓库中的相对路径
   * @param branch - 子模块跟踪的分支名（空字符串表示不指定分支）
   */
  async addSubmodule(repoPath: string, url: string, path: string, branch: string): Promise<void> {
    await invoke<void>('add_submodule', { repoPath, url, path, branch });
  },

  /**
   * 更新子模块（阶段 9：Task 9.1）
   *
   * 执行 git submodule update --init --recursive 命令，
   * 初始化并递归更新所有子模块到记录的提交。
   *
   * @param repoPath - 仓库路径
   */
  async updateSubmodules(repoPath: string): Promise<void> {
    await invoke<void>('update_submodules', { repoPath });
  },

  /**
   * 删除子模块（阶段 9：Task 9.1）
   *
   * 执行 git submodule deinit -f <path> + git rm -f <path> + 删除 .git/modules/<path> 目录。
   *
   * @param repoPath - 仓库路径
   * @param path - 要删除的子模块路径
   */
  async deleteSubmodule(repoPath: string, path: string): Promise<void> {
    await invoke<void>('delete_submodule', { repoPath, path });
  },

  /**
   * 初始化 LFS（阶段 9：Task 9.3）
   *
   * 执行 git lfs install 命令，在仓库中安装 LFS 钩子。
   *
   * @param repoPath - 仓库路径
   */
  async lfsInstall(repoPath: string): Promise<void> {
    await invoke<void>('lfs_install', { repoPath });
  },

  /**
   * 添加 LFS 跟踪规则（阶段 9：Task 9.3）
   *
   * 执行 git lfs track <pattern> 命令，将文件模式添加到 .gitattributes。
   *
   * @param repoPath - 仓库路径
   * @param pattern - 要跟踪的文件模式（如 "*.psd"）
   */
  async lfsTrack(repoPath: string, pattern: string): Promise<void> {
    await invoke<void>('lfs_track', { repoPath, pattern });
  },

  /**
   * 移除 LFS 跟踪规则（阶段 9：Task 9.3）
   *
   * 执行 git lfs untrack <pattern> 命令，从 .gitattributes 移除文件模式。
   *
   * @param repoPath - 仓库路径
   * @param pattern - 要移除跟踪的文件模式
   */
  async lfsUntrack(repoPath: string, pattern: string): Promise<void> {
    await invoke<void>('lfs_untrack', { repoPath, pattern });
  },

  /**
   * 获取 LFS 跟踪的文件类型列表（阶段 9：Task 9.3）
   *
   * 解析 .gitattributes 文件，返回所有 LFS 跟踪规则及其锁定状态。
   *
   * @param repoPath - 仓库路径
   * @returns LFS 跟踪规则列表
   */
  async lfsList(repoPath: string): Promise<LfsPattern[]> {
    return await invoke<LfsPattern[]>('lfs_list', { repoPath });
  },

  /**
   * 获取 LFS 文件锁列表（阶段 9：Task 9.3）
   *
   * 执行 git lfs locks --json 命令，返回所有文件锁。
   *
   * @param repoPath - 仓库路径
   * @returns 文件锁列表
   */
  async lfsLocks(repoPath: string): Promise<LfsLock[]> {
    return await invoke<LfsLock[]>('lfs_locks', { repoPath });
  },

  /**
   * 拉取 LFS 对象（阶段 9：Task 9.3）
   *
   * 执行 git lfs pull 命令，从 LFS 服务器下载当前提交所需的 LFS 对象。
   *
   * @param repoPath - 仓库路径
   */
  async lfsPull(repoPath: string): Promise<void> {
    await invoke<void>('lfs_pull', { repoPath });
  },

  /**
   * 推送 LFS 对象（阶段 9：Task 9.3）
   *
   * 执行 git lfs push --all origin 命令，将本地 LFS 对象推送到远程。
   *
   * @param repoPath - 仓库路径
   */
  async lfsPush(repoPath: string): Promise<void> {
    await invoke<void>('lfs_push', { repoPath });
  },

  /**
   * 获取标签详情（阶段 9：Task 9.5）
   *
   * 执行 git for-each-ref + git verify-tag --raw 获取标签完整详情，
   * 包括标签类型、标签者信息、GPG 签名状态。
   *
   * @param repoPath - 仓库路径
   * @param tagName - 标签名称
   * @returns 标签详情（含签名信息）
   */
  async getTagDetails(repoPath: string, tagName: string): Promise<TagDetails> {
    return await invoke<TagDetails>('get_tag_details', { repoPath, tagName });
  },

  /**
   * 打开目录差异对比工具（阶段 9：Task 9.6）
   *
   * 执行 git difftool --dir-diff <from> <to> 命令，
   * 在系统默认 difftool 中打开两个提交的目录差异对比。
   *
   * @param repoPath - 仓库路径
   * @param from - 起始提交哈希（空字符串表示工作区）
   * @param to - 目标提交哈希（空字符串表示工作区）
   */
  async openDirDiff(repoPath: string, from: string, to: string): Promise<void> {
    await invoke<void>('open_dir_diff', { repoPath, from, to });
  },

  /**
   * 获取支持的文件编码列表（阶段 9：Task 9.7）
   *
   * 返回前端可选择的编码名称列表，用于文件内容查看器的编码选择。
   *
   * @returns 支持的编码名称列表（如 ["utf8", "gbk", "big5", ...]）
   */
  async getSupportedEncodings(): Promise<string[]> {
    return await invoke<string[]>('get_supported_encodings');
  },

  /**
   * 设置凭证（阶段 9：Task 9.8）
   *
   * 将指定 host 的用户名/密码存入内存缓存（session 级别，不持久化）。
   *
   * @param host - 远程仓库主机名（如 "github.com"）
   * @param username - 用户名
   * @param password - 密码或个人访问令牌
   */
  async setCredential(host: string, username: string, password: string): Promise<void> {
    await invoke<void>('set_credential', { host, username, password });
  },

  /**
   * 获取凭证（阶段 9：Task 9.8）
   *
   * 从内存缓存中获取指定 host 的凭证。
   *
   * @param host - 远程仓库主机名
   * @returns 凭证信息（未找到时返回 null）
   */
  async getCredential(host: string): Promise<Credential | null> {
    return await invoke<Credential | null>('get_credential', { host });
  },

  /**
   * 清除指定 host 的凭证（阶段 9：Task 9.8）
   *
   * @param host - 远程仓库主机名
   */
  async clearCredential(host: string): Promise<void> {
    await invoke<void>('clear_credential', { host });
  },

  /**
   * 检查是否已缓存指定 host 的凭证（阶段 9：Task 9.8）
   *
   * @param host - 远程仓库主机名
   * @returns true = 已缓存凭证，false = 未缓存
   */
  async hasCredential(host: string): Promise<boolean> {
    return await invoke<boolean>('has_credential', { host });
  },

  /**
   * 列出所有已缓存凭证的 host 列表（阶段 9：Task 9.8）
   *
   * @returns 已缓存凭证的主机名列表
   */
  async listCredentialHosts(): Promise<string[]> {
    return await invoke<string[]>('list_credential_hosts');
  },
};

/**
 * 仓库注册信息（阶段 10：与 Rust 后端的 RepoEntry 结构体对应）
 *
 * 描述一个被发现的或已注册的 Git 仓库的基本信息。
 */
export interface RepoEntry {
  /** 仓库的绝对路径 */
  path: string;
  /** 仓库的显示名称（默认为路径末尾的文件夹名） */
  name: string;
  /** 是否已注册到 GitTimePrism */
  is_registered: boolean;
  /** 上次打开此仓库的时间（Unix 时间戳，秒；从未打开过则为 null） */
  last_opened: number | null;
  /** 此仓库是否包含子模块 */
  has_submodules: boolean;
}
