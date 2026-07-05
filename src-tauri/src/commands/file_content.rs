/*
 * 文件内容获取 Tauri IPC 命令模块
 * 
 * 此模块提供前端可调用的文件内容获取命令：
 * 1. get_worktree_file_content - 获取工作树中文件的完整内容
 * 2. get_staged_file_content - 获取暂存区中文件的完整内容
 * 3. get_head_file_content - 获取 HEAD 提交中文件的完整内容
 * 
 * 前端调用示例：
 * ```javascript
 * // 获取工作树文件内容
 * const worktreeContent = await invoke('get_worktree_file_content', {
 *   repoPath: '/path',
 *   filePath: 'src/main.rs'
 * });
 * 
 * // 获取暂存区文件内容
 * const stagedContent = await invoke('get_staged_file_content', {
 *   repoPath: '/path',
 *   filePath: 'src/main.rs'
 * });
 * 
 * // 获取 HEAD 提交中的文件内容
 * const headContent = await invoke('get_head_file_content', {
 *   repoPath: '/path',
 *   filePath: 'src/main.rs'
 * });
 * ```
 */

use tauri::command;

/**
 * 获取工作树中文件的完整内容
 * 
 * 读取工作目录中的文件内容。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * 
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(String) - 读取失败
 */
#[command]
pub fn get_worktree_file_content(
    repo_path: String,
    file_path: String,
) -> Result<String, String> {
    crate::git::file_content::get_worktree_file_content(&repo_path, &file_path)
        .map_err(|e| e.to_string())
}

/**
 * 获取暂存区中文件的完整内容
 * 
 * 使用 `git show :file_path` 获取暂存区中的文件内容。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * 
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(String) - 读取失败
 */
#[command]
pub fn get_staged_file_content(
    repo_path: String,
    file_path: String,
) -> Result<String, String> {
    crate::git::file_content::get_staged_file_content(&repo_path, &file_path)
        .map_err(|e| e.to_string())
}

/**
 * 获取 HEAD 提交中文件的完整内容
 * 
 * 使用 `git show HEAD:file_path` 获取 HEAD 提交中的文件内容。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * 
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(String) - 读取失败
 */
#[command]
pub fn get_head_file_content(
    repo_path: String,
    file_path: String,
) -> Result<String, String> {
    crate::git::file_content::get_head_file_content(&repo_path, &file_path)
        .map_err(|e| e.to_string())
}
