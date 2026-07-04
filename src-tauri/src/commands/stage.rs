/*
 * 暂存/提交 Tauri IPC 命令模块
 * 
 * 此模块提供前端可调用的暂存和提交操作命令：
 * 1. stage_file      - 暂存单个文件（git add <file>）
 * 2. unstage_file    - 取消暂存单个文件（git reset HEAD -- <file>）
 * 3. stage_all       - 暂存所有变更文件（git add -A）
 * 4. commit_changes  - 创建提交（git commit -m "message"）
 * 
 * 前端调用示例：
 * ```javascript
 * // 暂存单个文件
 * await invoke('stage_file', { repoPath: '/path', filePath: 'src/main.rs' });
 * 
 * // 暂存所有文件
 * await invoke('stage_all', { repoPath: '/path' });
 * 
 * // 取消暂存
 * await invoke('unstage_file', { repoPath: '/path', filePath: 'src/main.rs' });
 * 
 * // 创建提交
 * const hash = await invoke('commit_changes', { repoPath: '/path', message: 'fix: update UI' });
 * ```
 */

use tauri::command;

/**
 * 暂存单个文件
 * 
 * 将指定文件从工作区添加到暂存区。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 要暂存的文件路径（相对于仓库根目录）
 * 
 * 返回值：
 * - Ok(()) - 暂存成功
 * - Err(String) - 暂存失败
 */
#[command]
pub fn stage_file(repo_path: String, file_path: String) -> Result<(), String> {
    crate::git::stage::stage_file(&repo_path, &file_path).map_err(|e| e.to_string())
}

/**
 * 取消暂存单个文件
 * 
 * 将指定文件从暂存区移回工作区，保留变更内容。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 要取消暂存的文件路径（相对于仓库根目录）
 * 
 * 返回值：
 * - Ok(()) - 取消暂存成功
 * - Err(String) - 操作失败
 */
#[command]
pub fn unstage_file(repo_path: String, file_path: String) -> Result<(), String> {
    crate::git::stage::unstage_file(&repo_path, &file_path).map_err(|e| e.to_string())
}

/**
 * 暂存所有变更文件
 * 
 * 将工作区和暂存区的所有变更一次性添加到暂存区。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * 
 * 返回值：
 * - Ok(()) - 全部暂存成功
 * - Err(String) - 暂存失败
 */
#[command]
pub fn stage_all(repo_path: String) -> Result<(), String> {
    crate::git::stage::stage_all(&repo_path).map_err(|e| e.to_string())
}

/**
 * 创建提交
 * 
 * 将暂存区的所有变更提交到仓库，附带指定的提交消息。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - message: 提交消息字符串
 * 
 * 返回值：
 * - Ok(String) - 提交成功，返回新提交的完整哈希值
 * - Err(String) - 提交失败（暂存区为空、消息为空等）
 */
#[command]
pub fn commit_changes(repo_path: String, message: String) -> Result<String, String> {
    crate::git::stage::commit_changes(&repo_path, &message).map_err(|e| e.to_string())
}
