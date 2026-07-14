/*
 * Git 文件操作 Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的文件操作命令：
 * 1. reset_file_to_revision  - 将单个文件恢复到指定提交的版本（git checkout {hash} -- {file}）
 * 2. clean_untracked_files   - 清理未跟踪的文件（git clean -f[d]）
 *
 * 前端调用示例：
 * ```javascript
 * // 将 src/main.rs 恢复到 abc1234 提交时的版本
 * await invoke('reset_file_to_revision', {
 *   repoPath: '/path/to/repo',
 *   hash: 'abc1234',
 *   file: 'src/main.rs'
 * });
 *
 * // 清理未跟踪的文件和目录
 * await invoke('clean_untracked_files', {
 *   repoPath: '/path/to/repo',
 *   directories: true
 * });
 * ```
 *
 * 依赖关系：
 * commands::file_ops -> git::file_ops（执行实际的文件操作）
 */

// 引入 Tauri 的命令宏，用于标记可被前端调用的函数
use tauri::command;

/// 将单个文件恢复到指定提交的版本（Tauri IPC 命令）
///
/// 执行 `git checkout {hash} -- {file}`，将工作区和暂存区中的指定文件
/// 恢复到指定提交时的状态。
///
/// 前端调用方式：
/// ```javascript
/// await invoke('reset_file_to_revision', {
///   repoPath: '/path/to/repo',
///   hash: 'abc1234',
///   file: 'src/main.rs'
/// });
/// ```
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `hash`：目标提交的哈希值（也可以是分支名、标签名、HEAD 等）
/// - `file`：要恢复的文件路径（相对于仓库根目录）
///
/// 返回值：
/// - Ok(())：恢复成功
/// - Err(String)：恢复失败
#[command]
pub fn reset_file_to_revision(
    repo_path: String,
    hash: String,
    file: String,
) -> Result<(), String> {
    // 调用 git::file_ops::reset_file_to_revision 执行实际的文件恢复
    crate::git::file_ops::reset_file_to_revision(&repo_path, &hash, &file).map_err(|e| e.to_string())
}

/// 清理未跟踪的文件（Tauri IPC 命令）
///
/// 执行 `git clean -f[d]`，删除工作区中未被 Git 跟踪的文件。
/// ⚠️ 此操作不可逆，前端应做二次确认。
///
/// 前端调用方式：
/// ```javascript
/// await invoke('clean_untracked_files', {
///   repoPath: '/path/to/repo',
///   directories: true  // true=同时删除未跟踪的目录
/// });
/// ```
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `directories`：是否同时删除未跟踪的目录（true=添加 -d 选项）
///
/// 返回值：
/// - Ok(())：清理成功
/// - Err(String)：清理失败
#[command]
pub fn clean_untracked_files(
    repo_path: String,
    directories: bool,
) -> Result<(), String> {
    // 调用 git::file_ops::clean_untracked_files 执行实际的清理操作
    crate::git::file_ops::clean_untracked_files(&repo_path, directories).map_err(|e| e.to_string())
}
