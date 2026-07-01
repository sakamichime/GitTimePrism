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
};
