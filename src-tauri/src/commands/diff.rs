/*
 * 文件差异对比 Tauri IPC 命令模块
 * 
 * 此模块提供前端可调用的文件差异对比命令：
 * 1. get_workdir_diff  - 获取工作区与暂存区之间的差异
 * 2. get_staged_diff   - 获取暂存区与 HEAD 之间的差异
 * 3. get_commit_diff   - 获取指定提交的差异
 * 
 * 前端调用示例：
 * ```javascript
 * // 查看工作区中某个文件的 diff
 * const diff = await invoke('get_workdir_diff', {
 *   repoPath: '/path',
 *   filePath: 'src/main.rs'
 * });
 * 
 * // 查看暂存区的所有 diff
 * const staged = await invoke('get_staged_diff', { repoPath: '/path' });
 * 
 * // 查看某个提交的 diff
 * const commitDiff = await invoke('get_commit_diff', {
 *   repoPath: '/path',
 *   commitHash: 'abc1234'
 * });
 * ```
 */

use tauri::command;

/**
 * 获取工作区与暂存区之间的差异
 * 
 * 返回工作区中尚未暂存的变更。
 * 如果指定了 file_path，只返回该文件的 diff；否则返回所有文件的 diff。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 可选，指定单个文件路径；不传则获取所有文件的 diff
 * 
 * 返回值：
 * - Ok(DiffResult) - 查询成功
 * - Err(String) - 查询失败
 */
#[command]
pub fn get_workdir_diff(
    repo_path: String,
    file_path: Option<String>,
) -> Result<crate::git::diff::DiffResult, String> {
    crate::git::diff::get_workdir_diff(&repo_path, file_path.as_deref()).map_err(|e| e.to_string())
}

/**
 * 获取暂存区与 HEAD 之间的差异
 * 
 * 返回已暂存但尚未提交的变更。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * 
 * 返回值：
 * - Ok(DiffResult) - 查询成功
 * - Err(String) - 查询失败
 */
#[command]
pub fn get_staged_diff(
    repo_path: String,
) -> Result<crate::git::diff::DiffResult, String> {
    crate::git::diff::get_staged_diff(&repo_path).map_err(|e| e.to_string())
}

/**
 * 获取指定提交的差异
 * 
 * 返回该提交引入的所有文件变更。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - commit_hash: 提交的哈希值
 * 
 * 返回值：
 * - Ok(DiffResult) - 查询成功
 * - Err(String) - 查询失败
 */
#[command]
pub fn get_commit_diff(
    repo_path: String,
    commit_hash: String,
) -> Result<crate::git::diff::DiffResult, String> {
    crate::git::diff::get_commit_diff(&repo_path, &commit_hash).map_err(|e| e.to_string())
}
