/*
 * 远程操作命令模块
 *
 * 此模块提供与远程仓库交互的 Tauri IPC 命令，包括：
 * - pull_changes: 从远程仓库拉取更新（git pull）
 * - push_changes: 推送本地提交到远程仓库（git push）
 *
 * 前端通过 `invoke('pull_changes', { repo_path, remote, branch })` 调用。
 * 这些命令是 Tauri 的 #[command] 函数，负责将前端参数传递给 git 模块中的具体实现。
 *
 * 依赖关系：
 * remote -> git::pull（拉取远程更新）
 * remote -> git::push（推送本地提交）
 */

// 引入 Tauri 的命令宏，用于标记可被前端调用的函数
use tauri::command;

/// 从远程仓库拉取更新（Tauri IPC 命令）
///
/// 此函数是前端可调用的 Tauri 命令，负责：
/// 1. 接收前端传入的仓库路径、远程仓库名、分支名参数
/// 2. 调用 git::pull::pull 执行实际的 git pull 操作
/// 3. 将结果返回给前端（成功时返回输出信息，失败时返回错误字符串）
///
/// 参数：
/// - repo_path: 仓库根目录路径（前端传入的字符串）
/// - remote: 远程仓库名（通常为 "origin"）
/// - branch: 要拉取的分支名
///
/// 返回值：
/// - Ok(String) - 拉取成功，返回 git pull 的输出信息
/// - Err(String) - 拉取失败，返回错误描述字符串
#[command]
pub fn pull_changes(
    repo_path: String,
    remote: String,
    branch: String,
) -> Result<String, String> {
    // 调用 git::pull 模块中的 pull 函数执行实际操作
    // 将 &String 自动转换为 &str 传递给底层函数
    // 如果返回 Err，使用 .map_err(|e| e.to_string()) 将 GitError 转换为字符串
    crate::git::pull::pull(&repo_path, &remote, &branch).map_err(|e| e.to_string())
}

/// 推送本地提交到远程仓库（Tauri IPC 命令）
///
/// 此函数是前端可调用的 Tauri 命令，负责：
/// 1. 接收前端传入的仓库路径、远程仓库名、分支名参数
/// 2. 调用 git::push::push 执行实际的 git push 操作
/// 3. 将结果返回给前端（成功时返回输出信息，失败时返回错误字符串）
///
/// 参数：
/// - repo_path: 仓库根目录路径（前端传入的字符串）
/// - remote: 远程仓库名（通常为 "origin"）
/// - branch: 要推送的分支名
///
/// 返回值：
/// - Ok(String) - 推送成功，返回 git push 的输出信息
/// - Err(String) - 推送失败，返回错误描述字符串
#[command]
pub fn push_changes(
    repo_path: String,
    remote: String,
    branch: String,
) -> Result<String, String> {
    // 调用 git::push 模块中的 push 函数执行实际操作
    // 将 &String 自动转换为 &str 传递给底层函数
    // 如果返回 Err，使用 .map_err(|e| e.to_string()) 将 GitError 转换为字符串
    crate::git::push::push(&repo_path, &remote, &branch).map_err(|e| e.to_string())
}
