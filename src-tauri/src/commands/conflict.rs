/*
 * 合并冲突检测 Tauri IPC 命令模块
 *
 * 此模块是前端与后端冲突检测功能之间的桥梁。
 * 前端通过 invoke('detect_conflicts', { repoPath }) 调用。
 *
 * 提供以下命令：
 * 1. detect_conflicts - 检测仓库中存在合并冲突的文件列表
 *
 * 使用场景：
 * - merge/pull/rebase 操作后，如果命令返回错误（可能存在冲突），
 *   前端调用此命令获取冲突文件列表，然后打开合并编辑器解决冲突。
 * - 前端也可以在任意时刻调用此命令检查仓库是否处于冲突状态。
 *
 * 前端调用示例：
 * ```typescript
 * import { invoke } from '@tauri-apps/api/core';
 *
 * try {
 *   await invoke('merge', { repoPath, obj: 'feature', ... });
 * } catch (err) {
 *   // merge 失败，可能是冲突，检测冲突文件
 *   const conflicts = await invoke('detect_conflicts', { repoPath });
 *   if (conflicts.length > 0) {
 *     // 打开合并编辑器解决冲突
 *     mergeEditor.open(repoPath, conflicts);
 *   }
 * }
 * ```
 */

// 引入 Tauri 的命令宏，用于标记可被前端调用的函数
use tauri::command;

/**
 * 检测仓库中存在合并冲突的文件（Tauri IPC 命令）
 *
 * 执行 `git ls-files -u -z` 命令，返回所有 unmerged 文件的列表，
 * 每个文件包含 path、ours_hash、theirs_hash、base_hash 信息。
 *
 * 前端调用方式：
 * ```typescript
 * const conflicts = await invoke('detect_conflicts', {
 *   repoPath: '/path/to/repo'
 * });
 * console.log(`发现 ${conflicts.length} 个冲突文件`);
 * for (const conflict of conflicts) {
 *   console.log(`冲突文件: ${conflict.path}`);
 * }
 * ```
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 *
 * 返回：
 * - Ok(Vec<ConflictFile>)：冲突文件列表（无冲突时返回空数组）
 * - Err(String)：命令执行失败，错误信息已转换为字符串
 */
#[command]
pub fn detect_conflicts(repo_path: String) -> Result<Vec<crate::git::status::ConflictFile>, String> {
    // 调用 git 层的 detect_conflicts 函数执行实际操作
    // .map_err(|e| e.to_string()) 将 GitError 转换为 String
    crate::git::status::detect_conflicts(&repo_path).map_err(|e| e.to_string())
}
