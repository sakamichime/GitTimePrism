/*
 * 提交节点图 Tauri IPC 命令模块
 * 
 * 此模块提供前端可调用的提交节点图查询命令：
 * 1. get_commit_graph - 获取带 ASCII 图形线的提交历史
 * 
 * 前端调用示例：
 * ```javascript
 * const graph = await invoke('get_commit_graph', {
 *   repoPath: '/path/to/repo',
 *   count: 50
 * });
 * 
 * graph.commits.forEach(c => {
 *   console.log(`${c.graph_line} ${c.short_hash} ${c.message}`);
 * });
 * ```
 */

use tauri::command;

/**
 * 获取仓库的提交节点图
 * 
 * 执行 `git log --graph --pretty=format:...` 命令，
 * 返回带有 ASCII 图形线的提交历史，用于可视化展示分支和合并关系。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - count: 要获取的提交数量（0 表示全部）
 * 
 * 返回值：
 * - Ok(CommitGraph) - 查询成功，包含节点列表和总数
 * - Err(String) - 查询失败
 */
#[command]
pub fn get_commit_graph(
    repo_path: String,
    count: u32,
) -> Result<crate::git::graph::CommitGraph, String> {
    crate::git::graph::get_commit_graph(&repo_path, count).map_err(|e| e.to_string())
}
