/*
 * 分支切换 Tauri IPC 命令模块
 * 
 * 此模块是前端与 Git 分支切换操作之间的桥梁。
 * 每个函数使用 #[tauri::command] 宏标记，前端通过 invoke() 调用。
 * 
 * 提供以下 2 个命令：
 * 1. checkout_branch    - 切换到指定分支
 * 2. create_and_checkout - 创建新分支并切换
 */

use tauri::command;

/**
 * 切换到指定分支
 * 
 * 执行 `git checkout <branch>` 命令，将工作区切换到指定的分支。
 * 
 * 前端调用方式：
 * ```javascript
 * await invoke('checkout_branch', { repoPath: 'C:\\Projects\\my-repo', branchName: 'main' });
 * ```
 * 
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * - branch_name: 要切换到的分支名称
 * 
 * 返回值：
 * - Ok(()) - 切换成功
 * - Err(String) - 切换失败
 */
#[command]
pub fn checkout_branch(repo_path: String, branch_name: String) -> Result<(), String> {
    crate::git::checkout::checkout_branch(&repo_path, &branch_name).map_err(|e| e.to_string())
}

/**
 * 创建新分支并切换过去
 *
 * 执行 `git checkout -b <branch>` 命令，基于当前 HEAD 创建新分支并立即切换。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('create_and_checkout', { repoPath: 'C:\\Projects\\my-repo', branchName: 'feature-x' });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * - branch_name: 新分支的名称
 *
 * 返回值：
 * - Ok(()) - 创建并切换成功
 * - Err(String) - 操作失败
 */
#[command]
pub fn create_and_checkout(repo_path: String, branch_name: String) -> Result<(), String> {
    crate::git::checkout::create_and_checkout(&repo_path, &branch_name).map_err(|e| e.to_string())
}

/**
 * 重命名分支（Tauri IPC 命令）
 *
 * 执行 `git branch -m <old> <new>` 命令，将分支从 oldName 重命名为 newName。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('rename_branch', {
 *   repoPath: 'C:\\Projects\\my-repo',
 *   oldName: 'old-feature',
 *   newName: 'new-feature'
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * - old_name: 旧的分支名称
 * - new_name: 新的分支名称
 *
 * 返回值：
 * - Ok(()) - 重命名成功
 * - Err(String) - 重命名失败
 */
#[command]
pub fn rename_branch(
    repo_path: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    crate::git::branch::rename_branch(&repo_path, &old_name, &new_name).map_err(|e| e.to_string())
}

/**
 * 删除本地分支（Tauri IPC 命令）
 *
 * 执行 `git branch -d <name>`（安全删除）或 `git branch -D <name>`（强制删除）。
 *
 * 前端调用方式：
 * ```javascript
 * // 安全删除（仅当分支已合并）
 * await invoke('delete_branch', {
 *   repoPath: 'C:\\Projects\\my-repo',
 *   name: 'feature',
 *   force: false
 * });
 * // 强制删除（即使分支未合并）
 * await invoke('delete_branch', {
 *   repoPath: 'C:\\Projects\\my-repo',
 *   name: 'feature',
 *   force: true
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * - name: 要删除的分支名称
 * - force: 是否强制删除（true 使用 -D，false 使用 -d）
 *
 * 返回值：
 * - Ok(()) - 删除成功
 * - Err(String) - 删除失败
 */
#[command]
pub fn delete_branch(repo_path: String, name: String, force: bool) -> Result<(), String> {
    crate::git::branch::delete_branch(&repo_path, &name, force).map_err(|e| e.to_string())
}

/**
 * 删除远程分支（Tauri IPC 命令）
 *
 * 先尝试执行 `git push <remote> --delete <branch>` 删除远程分支。
 * 如果远程分支不存在，则兜底执行 `git branch -d -r <remote>/<branch>` 删除本地远程跟踪引用。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('delete_remote_branch', {
 *   repoPath: 'C:\\Projects\\my-repo',
 *   remote: 'origin',
 *   branch: 'feature'
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * - remote: 远程仓库名（如 "origin"）
 * - branch: 要删除的远程分支名（不含 remote 前缀）
 *
 * 返回值：
 * - Ok(()) - 删除成功
 * - Err(String) - 删除失败
 */
#[command]
pub fn delete_remote_branch(
    repo_path: String,
    remote: String,
    branch: String,
) -> Result<(), String> {
    crate::git::branch::delete_remote_branch(&repo_path, &remote, &branch)
        .map_err(|e| e.to_string())
}

/**
 * 检出到指定提交（Tauri IPC 命令）
 *
 * 执行 `git checkout <hash>` 命令，进入 detached HEAD 状态。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('checkout_commit', {
 *   repoPath: 'C:\\Projects\\my-repo',
 *   hash: 'abc1234'
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * - hash: 要检出的提交哈希值
 *
 * 返回值：
 * - Ok(()) - 检出成功
 * - Err(String) - 检出失败
 */
#[command]
pub fn checkout_commit(repo_path: String, hash: String) -> Result<(), String> {
    crate::git::branch::checkout_commit(&repo_path, &hash).map_err(|e| e.to_string())
}

/**
 * 创建新分支（Tauri IPC 命令）
 *
 * 支持以下创建方式：
 * - checkout=true, force=false: 创建并切换（git checkout -b）
 * - checkout=false: 仅创建不切换（git branch）
 * - force=true: 强制创建（git branch -f）
 *
 * 前端调用方式：
 * ```javascript
 * // 创建并切换
 * await invoke('create_branch', {
 *   repoPath: 'C:\\Projects\\my-repo',
 *   name: 'feature',
 *   hash: 'abc1234',
 *   checkout: true,
 *   force: false
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * - name: 新分支的名称
 * - hash: 新分支要指向的提交哈希（空字符串表示使用当前 HEAD）
 * - checkout: 创建后是否立即切换到新分支
 * - force: 是否强制创建（覆盖同名分支）
 *
 * 返回值：
 * - Ok(()) - 创建成功
 * - Err(String) - 创建失败
 */
#[command]
pub fn create_branch(
    repo_path: String,
    name: String,
    hash: String,
    checkout: bool,
    force: bool,
) -> Result<(), String> {
    crate::git::branch::create_branch(&repo_path, &name, &hash, checkout, force)
        .map_err(|e| e.to_string())
}
