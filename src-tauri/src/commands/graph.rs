/*
 * 提交节点图 Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的提交节点图查询命令：
 * 1. get_commit_graph - 获取带 ASCII 图形线的提交历史（旧版，保持向后兼容）
 * 2. get_annotated_commit_graph - 获取带 ref 注解的提交节点图（新版，与 gitgraph 项目对齐）
 *
 * 前端调用示例（旧版）：
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
 *
 * 前端调用示例（新版）：
 * ```javascript
 * const graph = await invoke('get_annotated_commit_graph', {
 *   repoPath: '/path/to/repo',
 *   params: {
 *     maxCommits: 100,
 *     showTags: true,
 *     showRemoteBranches: false,
 *     includeReflogs: false,
 *     onlyFirstParent: false,
 *     ordering: 'date',
 *     remotes: [],
 *     hideRemotes: [],
 *     useMailmap: false,
 *     showUncommittedChanges: true
 *   }
 * });
 *
 * graph.commits.forEach(c => {
 *   console.log(`${c.hash} ${c.message} heads=${c.heads}`);
 * });
 * ```
 */

use tauri::command;

/**
 * 获取仓库的提交节点图（旧版，保持向后兼容）
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
 *
 * Task 13.8：底层实现已标记为 deprecated。
 * 此 Tauri 命令保留是为了不破坏旧版前端代码（前端可能仍在调用 invoke('get_commit_graph')）。
 * 新代码应使用 get_annotated_commit_graph 命令。
 * 使用 #[allow(deprecated)] 抑制此处的弃用警告。
 */
#[command]
#[allow(deprecated)]
pub fn get_commit_graph(
    repo_path: String,
    count: u32,
) -> Result<crate::git::graph::CommitGraph, String> {
    crate::git::graph::get_commit_graph(&repo_path, count).map_err(|e| e.to_string())
}

/**
 * 获取带 ref 注解的提交节点图（新版，与 gitgraph 项目对齐）
 *
 * 此命令对应 gitgraph 项目中 `DataSource.getCommits()` 的核心逻辑。
 * 通过并行调用 get_log_enhanced + get_refs + get_stashes 三路数据，
 * 组装出带 heads/tags/remotes/stash 注解的 AnnotatedCommit 列表。
 *
 * 前端调用方式：
 * ```javascript
 * const graph = await invoke('get_annotated_commit_graph', {
 *   repoPath: '/path/to/repo',
 *   params: {
 *     maxCommits: 100,           // 最大返回的提交数量
 *     showTags: true,            // 是否在 commit 上注解 tags
 *     showRemoteBranches: false, // 是否包含远程分支
 *     includeReflogs: false,     // 是否包含 reflog 中提到的提交
 *     onlyFirstParent: false,    // 是否只跟随第一个 parent
 *     ordering: 'date',          // 排序方式：'default'/'date'/'author-date'/'topo'
 *     remotes: [],               // 已知的 remote 名称列表
 *     hideRemotes: [],           // 要隐藏的 remote 名称列表
 *     useMailmap: false,         // 是否启用 mailmap
 *     showUncommittedChanges: true // 是否注入 UNCOMMITTED 虚拟节点
 *   }
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - params: 查询参数（见 GraphQueryParams 结构体），使用 camelCase 命名
 *
 * 返回值：
 * - Ok(AnnotatedCommitGraph) - 查询成功，包含带注解的提交列表、HEAD 和 moreCommitsAvailable 标志
 * - Err(String) - 查询失败
 */
#[command]
pub fn get_annotated_commit_graph(
    repo_path: String,
    params: crate::git::graph::GraphQueryParams,
) -> Result<crate::git::graph::AnnotatedCommitGraph, String> {
    // 调用 git::graph::get_annotated_commit_graph 执行实际的节点图查询操作
    // 将 GitError 转换为 String 以满足 Tauri 命令的返回类型要求
    crate::git::graph::get_annotated_commit_graph(&repo_path, &params).map_err(|e| e.to_string())
}
