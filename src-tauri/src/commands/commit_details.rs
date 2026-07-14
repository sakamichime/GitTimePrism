/*
 * 提交详情查询 Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的提交详情查询命令：
 * 1. get_commit_details - 获取单个提交的完整详情（含 GPG 签名和文件变更）
 *
 * 前端调用示例：
 * ```javascript
 * const details = await invoke('get_commit_details', {
 *   repoPath: '/path/to/repo',
 *   commitHash: 'a1b2c3d4...',
 *   hasParents: true,
 *   useMailmap: false
 * });
 * console.log(`作者: ${details.author} <${details.author_email}>`);
 * console.log(`文件变更数: ${details.file_changes.length}`);
 * ```
 */

use tauri::command;

/**
 * 获取单个提交的完整详情
 *
 * 执行 `git -c log.showSignature=false show --quiet --format=... {hash}` 命令，
 * 解析 12 字段输出（含 GPG 签名信息），
 * 并调用 diff 命令获取文件变更列表，返回完整的 CommitDetails。
 *
 * 前端调用方式：
 * ```javascript
 * const details = await invoke('get_commit_details', {
 *   repoPath: '/path/to/repo',
 *   commitHash: 'a1b2c3d4...',
 *   hasParents: true,  // 此 commit 是否有父提交
 *   useMailmap: false  // 是否启用 mailmap（可选，默认 false）
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - commit_hash: 要查询详情的 commit hash
 * - has_parents: 此 commit 是否有父提交
 *                true = 普通提交，from_commit = commit_hash + "^"
 *                false = 初始提交，from_commit = commit_hash（使用 diff-tree 查看初始提交）
 * - use_mailmap: 是否启用 mailmap（可选，默认 false）
 *
 * 返回值：
 * - Ok(CommitDetails) - 查询成功，包含提交详情和文件变更列表
 * - Err(String) - 查询失败
 */
#[command]
pub fn get_commit_details(
    repo_path: String,
    commit_hash: String,
    has_parents: bool,
    use_mailmap: Option<bool>,
) -> Result<crate::git::commit_details::CommitDetails, String> {
    // 调用 git::commit_details::get_commit_details 执行实际的详情查询操作
    // use_mailmap 默认为 false
    let use_mailmap = use_mailmap.unwrap_or(false);
    // 将 GitError 转换为 String 以满足 Tauri 命令的返回类型要求
    crate::git::commit_details::get_commit_details(&repo_path, &commit_hash, has_parents, use_mailmap)
        .map_err(|e| e.to_string())
}
