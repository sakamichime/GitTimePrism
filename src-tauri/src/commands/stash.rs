/*
 * Stash Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的 Stash 命令：
 * 1. get_stashes - 获取仓库中的所有 stash 记录
 * 2. apply_stash - 应用指定 stash（保留 stash 记录）
 * 3. pop_stash - 弹出指定 stash（应用后删除）
 * 4. drop_stash - 删除指定 stash（不应用）
 * 5. push_stash - 将当前未提交变更保存为新的 stash
 * 6. branch_from_stash - 从 stash 创建新分支并切换过去
 *
 * 前端调用示例：
 * ```javascript
 * // 获取所有 stash 记录
 * const stashes = await invoke('get_stashes', { repoPath: '/path/to/repo' });
 *
 * // 应用 stash@{0}（带 --index 选项）
 * await invoke('apply_stash', {
 *   repoPath: '/path/to/repo',
 *   selector: 'stash@{0}',
 *   index: true
 * });
 *
 * // 将当前未提交变更保存为 stash（包含未跟踪文件，自定义消息）
 * await invoke('push_stash', {
 *   repoPath: '/path/to/repo',
 *   includeUntracked: true,
 *   message: 'WIP: 修复登录bug'
 * });
 * ```
 */

use tauri::command;

/**
 * 获取仓库中的所有 stash 记录
 *
 * 执行 `git reflog --format=... refs/stash --` 命令，
 * 返回所有 stash 记录的列表（按 stash@{0}, stash@{1}, ... 顺序）。
 *
 * 前端调用方式：
 * ```javascript
 * const stashes = await invoke('get_stashes', {
 *   repoPath: '/path/to/repo'
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(Vec<StashInfo>) - 查询成功，返回所有 stash 记录
 * - Err(String) - 查询失败
 */
#[command]
pub fn get_stashes(
    repo_path: String,
) -> Result<Vec<crate::git::stash::StashInfo>, String> {
    // 调用 git::stash::get_stashes 执行实际的 stash 查询操作
    // 将 GitError 转换为 String 以满足 Tauri 命令的返回类型要求
    crate::git::stash::get_stashes(&repo_path).map_err(|e| e.to_string())
}

/**
 * 应用指定的 stash（保留 stash 记录）
 *
 * 执行 `git stash apply [--index] {selector}` 命令。
 * 与 pop_stash 的区别：apply 不会从 stash 列表中删除该 stash。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('apply_stash', {
 *   repoPath: '/path/to/repo',
 *   selector: 'stash@{0}',
 *   index: false  // 是否使用 --index 选项恢复暂存区
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - selector: stash 选择器（如 "stash@{0}"）
 * - index: 是否使用 --index 选项（true = 尝试恢复暂存区）
 *
 * 返回值：
 * - Ok(()) - 应用成功
 * - Err(String) - 应用失败（如选择器不存在、有冲突等）
 */
#[command]
pub fn apply_stash(repo_path: String, selector: String, index: bool) -> Result<(), String> {
    // 调用 git::stash::apply_stash 执行实际的应用操作
    // 将 GitError 转换为 String 返回给前端
    crate::git::stash::apply_stash(&repo_path, &selector, index).map_err(|e| e.to_string())
}

/**
 * 弹出指定的 stash（应用后删除）
 *
 * 执行 `git stash pop [--index] {selector}` 命令。
 * pop = apply + drop，如果 apply 产生冲突，stash 不会被删除。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('pop_stash', {
 *   repoPath: '/path/to/repo',
 *   selector: 'stash@{0}',
 *   index: false
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - selector: stash 选择器（如 "stash@{0}"）
 * - index: 是否使用 --index 选项
 *
 * 返回值：
 * - Ok(()) - 弹出成功
 * - Err(String) - 弹出失败
 */
#[command]
pub fn pop_stash(repo_path: String, selector: String, index: bool) -> Result<(), String> {
    // 调用 git::stash::pop_stash 执行实际的弹出操作
    crate::git::stash::pop_stash(&repo_path, &selector, index).map_err(|e| e.to_string())
}

/**
 * 删除指定的 stash（不应用）
 *
 * 执行 `git stash drop {selector}` 命令。
 * 直接从 stash 列表中删除，不影响当前工作区。此操作不可逆。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('drop_stash', {
 *   repoPath: '/path/to/repo',
 *   selector: 'stash@{0}'
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - selector: stash 选择器（如 "stash@{0}"）
 *
 * 返回值：
 * - Ok(()) - 删除成功
 * - Err(String) - 删除失败（如选择器不存在）
 */
#[command]
pub fn drop_stash(repo_path: String, selector: String) -> Result<(), String> {
    // 调用 git::stash::drop_stash 执行实际的删除操作
    crate::git::stash::drop_stash(&repo_path, &selector).map_err(|e| e.to_string())
}

/**
 * 将当前未提交的变更保存为新的 stash
 *
 * 执行 `git stash push [--include-untracked] [--message {msg}]` 命令。
 * 该命令会保存工作区和暂存区的变更到 stash，然后重置工作区到 HEAD 状态。
 *
 * 前端调用方式：
 * ```javascript
 * // 不带消息的 stash
 * await invoke('push_stash', {
 *   repoPath: '/path/to/repo',
 *   includeUntracked: true,
 *   message: null
 * });
 *
 * // 带自定义消息的 stash
 * await invoke('push_stash', {
 *   repoPath: '/path/to/repo',
 *   includeUntracked: false,
 *   message: 'WIP: 修复登录bug'
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - include_untracked: 是否包含未跟踪文件（--include-untracked 选项）
 * - message: stash 描述消息（Option<String>，None 或空字符串时不加 --message 选项）
 *
 * 返回值：
 * - Ok(()) - 保存成功
 * - Err(String) - 保存失败（如没有可 stash 的变更）
 */
#[command]
pub fn push_stash(
    repo_path: String,
    include_untracked: bool,
    message: Option<String>,
) -> Result<(), String> {
    // 将 Option<String> 转换为 Option<&str>，传递给底层函数
    // as_deref() 方法可以将 Option<String> 转换为 Option<&str> 而不分配新内存
    let message_ref: Option<&str> = message.as_deref();
    // 调用 git::stash::push_stash 执行实际的保存操作
    crate::git::stash::push_stash(&repo_path, include_untracked, message_ref).map_err(|e| e.to_string())
}

/**
 * 从 stash 创建新分支并切换过去
 *
 * 执行 `git stash branch {branch_name} {selector}` 命令。
 * 该命令会基于 stash 的 base commit 创建新分支，切换过去，并应用 stash 变更。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('branch_from_stash', {
 *   repoPath: '/path/to/repo',
 *   branchName: 'feature/from-stash',
 *   selector: 'stash@{0}'
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - branch_name: 要创建的新分支名称（不能与已有分支重名）
 * - selector: stash 选择器（如 "stash@{0}"）
 *
 * 返回值：
 * - Ok(()) - 创建并切换成功
 * - Err(String) - 失败（如分支已存在、stash 不存在等）
 */
#[command]
pub fn branch_from_stash(
    repo_path: String,
    branch_name: String,
    selector: String,
) -> Result<(), String> {
    // 调用 git::stash::branch_from_stash 执行实际的创建分支操作
    crate::git::stash::branch_from_stash(&repo_path, &branch_name, &selector).map_err(|e| e.to_string())
}
