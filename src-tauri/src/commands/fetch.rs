/*
 * Git Fetch 操作 Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的 fetch（获取远程更新）命令：
 * 1. fetch_command - 从远程仓库获取更新（git fetch），支持 --all / 指定 remote、--prune、--prune-tags
 *
 * 前端调用示例：
 *   const result = await invoke("fetch_command", {
 *     repoPath: "/path/to/repo",
 *     remote: null,        // null 表示 --all
 *     prune: true,
 *     pruneTags: false
 *   });
 *
 * 依赖关系：
 * commands::fetch -> git::fetch（执行实际的 git fetch 命令）
 */

// 引入 Tauri 的命令宏，用于标记可被前端调用的函数
use tauri::command;

/// 从远程仓库获取更新（Tauri IPC 命令）
///
/// 此函数是前端可调用的 Tauri 命令，负责：
/// 1. 接收前端传入的仓库路径、远程仓库名（可选）、prune、pruneTags 选项
/// 2. 调用 git::fetch::fetch 执行实际的 git fetch 操作
/// 3. 将结果返回给前端（成功时返回输出信息，失败时返回错误字符串）
///
/// 前端调用方式：
///   const result = await invoke("fetch_command", {
///     repoPath: "/path/to/repo",
///     remote: null,           // null 表示 --all 拉取所有远程
///     prune: true,            // 启用 --prune
///     pruneTags: false        // 不启用 --prune-tags
///   });
///
/// 参数：
/// - `repo_path`：仓库根目录路径（前端传入的字符串）
/// - `remote`：远程仓库名；None 表示使用 --all 拉取所有远程
/// - `prune`：是否启用 --prune（清理已删除的远程跟踪分支引用）
/// - `prune_tags`：是否启用 --prune-tags（清理已删除的标签引用）
///
/// 返回值：
/// - Ok(String)：fetch 成功，返回 git fetch 的输出信息
/// - Err(String)：fetch 失败，返回错误描述字符串
#[command]
pub fn fetch_command(
    repo_path: String,
    remote: Option<String>,
    prune: bool,
    prune_tags: bool,
) -> Result<String, String> {
    // 将 Option<String> 转换为 Option<&str> 供底层函数使用
    let remote_ref: Option<&str> = remote.as_deref();

    // 调用 git::fetch::fetch 执行实际操作
    // 将 GitError 转换为 String 以满足 Tauri 命令的返回类型要求
    crate::git::fetch::fetch(&repo_path, remote_ref, prune, prune_tags)
        .map_err(|e| e.to_string())
}
