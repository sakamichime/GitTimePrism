/*
 * 引用查询 Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的引用（refs）查询命令：
 * 1. get_refs - 获取仓库中的所有引用（heads/tags/remotes/HEAD）
 *
 * 前端调用示例：
 * ```javascript
 * const refs = await invoke('get_refs', {
 *   repoPath: '/path/to/repo',
 *   hideRemotes: ['upstream']
 * });
 * console.log(`本地分支数: ${refs.heads.length}`);
 * console.log(`HEAD: ${refs.head}`);
 * ```
 */

use tauri::command;

/**
 * 获取仓库中的所有引用
 *
 * 执行 `git show-ref -d --head` 命令，返回结构化的 RefMap。
 * 包含本地分支、标签（含 annotated）、远程分支和 HEAD 引用。
 *
 * 前端调用方式：
 * ```javascript
 * const refs = await invoke('get_refs', {
 *   repoPath: '/path/to/repo',
 *   hideRemotes: ['upstream']  // 可选，要隐藏的 remote 名称列表
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - hide_remotes: 要隐藏的 remote 名称列表（可选，默认为空数组）
 *
 * 返回值：
 * - Ok(RefMap) - 查询成功，包含所有引用信息
 * - Err(String) - 查询失败
 */
#[command]
pub fn get_refs(
    repo_path: String,
    hide_remotes: Option<Vec<String>>,
) -> Result<crate::git::refs::RefMap, String> {
    // 将 Vec<String> 转换为 Vec<&str> 供底层函数使用
    let hide_remotes_vec = hide_remotes.unwrap_or_default();
    let hide_remotes_refs: Vec<&str> = hide_remotes_vec.iter().map(|s| s.as_str()).collect();

    // 调用 git::refs::get_refs 执行实际的引用查询操作
    // 将 GitError 转换为 String 以满足 Tauri 命令的返回类型要求
    crate::git::refs::get_refs(&repo_path, &hide_remotes_refs).map_err(|e| e.to_string())
}
