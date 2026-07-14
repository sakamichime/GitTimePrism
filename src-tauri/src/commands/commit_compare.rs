/*
 * 提交对比 Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的提交对比命令：
 * 1. get_commit_comparison - 比较两个提交之间的文件差异
 *
 * 前端调用示例：
 * ```javascript
 * const comparison = await invoke('get_commit_comparison', {
 *   repoPath: '/path/to/repo',
 *   fromHash: 'a1b2c3d4...',
 *   toHash: 'e5f6a1b2...'
 * });
 * console.log(`变更文件数: ${comparison.file_changes.length}`);
 * comparison.file_changes.forEach(f => {
 *   console.log(`${f.type} ${f.new_file_path} (+${f.additions} -${f.deletions})`);
 * });
 * ```
 */

use tauri::command;

/**
 * 获取两个提交之间的对比结果
 *
 * 复用 `get_diff_name_status_internal + get_diff_num_stat_internal`，
 * 生成两提交之间的文件变更列表。
 *
 * 当 to_hash 为 "*"（UNCOMMITTED 虚拟节点）时，
 * 表示与工作区对比，此时会获取 status_files
 * （deleted + untracked）合并到 file_changes 中。
 *
 * 前端调用方式：
 * ```javascript
 * const comparison = await invoke('get_commit_comparison', {
 *   repoPath: '/path/to/repo',
 *   fromHash: 'a1b2c3d4...',
 *   toHash: 'e5f6a1b2...'  // 或 '*' 表示与工作区对比
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - from_hash: 对比的起始 commit hash
 * - to_hash: 对比的目标 commit hash
 *            如果是 "*"（UNCOMMITTED），表示与工作区对比
 *
 * 返回值：
 * - Ok(CommitComparison) - 查询成功，包含文件变更列表
 * - Err(String) - 查询失败
 */
#[command]
pub fn get_commit_comparison(
    repo_path: String,
    from_hash: String,
    to_hash: String,
) -> Result<crate::git::commit_compare::CommitComparison, String> {
    // 调用 git::commit_compare::get_commit_comparison 执行实际的对比查询操作
    // 将 GitError 转换为 String 以满足 Tauri 命令的返回类型要求
    crate::git::commit_compare::get_commit_comparison(&repo_path, &from_hash, &to_hash)
        .map_err(|e| e.to_string())
}
