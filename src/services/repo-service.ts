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
   * 获取提交节点图
   * 返回带有 ASCII 图形线的提交历史，用于可视化展示分支和合并关系
   * 
   * @param repoPath - 仓库路径
   * @param count - 要获取的提交数量（0 表示全部，默认 50）
   * @returns 节点图数据（包含提交节点列表和总数）
   */
  async getCommitGraph(repoPath: string, count: number = 50): Promise<CommitGraph> {
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
   * @param repoPath - 仓库路径
   * @param mode - 撤销模式（"soft" | "mixed" | "hard"）
   */
  async resetCommit(repoPath: string, mode: string): Promise<void> {
    await invoke<void>('reset_commit', { repoPath, mode });
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
};
