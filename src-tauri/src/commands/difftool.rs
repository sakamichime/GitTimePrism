/*
 * Difftool Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的 difftool 命令：
 * 1. open_dir_diff - 打开目录级差异对比（启动外部差异工具）
 *
 * 前端调用示例：
 * ```javascript
 * // 对比暂存区与工作区（默认行为）
 * await invoke('open_dir_diff', {
 *   repoPath: '/path/to/repo'
 * });
 *
 * // 对比两个提交
 * await invoke('open_dir_diff', {
 *   repoPath: '/path/to/repo',
 *   from: 'abc1234',
 *   to: 'def5678'
 * });
 * ```
 */

use tauri::command;

/**
 * 打开目录级差异对比
 *
 * 执行 `git difftool --dir-diff [{from}] [{to}]` 命令，
 * 启动用户配置的外部差异工具对比两个版本的目录差异。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - from: 可选，对比的起始提交哈希/引用；为 null 时默认为 HEAD
 * - to: 可选，对比的目标提交哈希/引用；为 null 时对比工作区
 *
 * 返回值：
 * - Ok(()) - difftool 启动成功
 * - Err(String) - 启动失败
 */
#[command]
pub fn open_dir_diff(
    repo_path: String,
    from: Option<String>,
    to: Option<String>,
) -> Result<(), String> {
    // 将 Option<String> 转换为 Option<&str> 传给底层函数
    let from_ref = from.as_deref();
    let to_ref = to.as_deref();
    crate::git::difftool::open_dir_diff(&repo_path, from_ref, to_ref).map_err(|e| e.to_string())
}
