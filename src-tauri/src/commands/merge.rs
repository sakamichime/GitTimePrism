/*
 * Git 合并（merge）Tauri IPC 命令模块
 *
 * 此模块是前端与后端 git merge 功能之间的桥梁。
 * 前端通过 invoke('merge', { repoPath, obj, squash, noFastForward, noCommit, sign }) 调用。
 *
 * 提供以下命令：
 * 1. merge - 将指定对象合并到当前分支
 */

// 引入 Tauri 的命令宏，用于标记可被前端调用的函数
use tauri::command;

/**
 * 执行 git merge 合并操作（Tauri IPC 命令）
 *
 * 前端调用示例：
 * ```typescript
 * import { invoke } from '@tauri-apps/api/core';
 *
 * // 普通合并
 * await invoke('merge', {
 *   repoPath: '/path/to/repo',
 *   obj: 'feature',
 *   squash: false,
 *   noFastForward: false,
 *   noCommit: false,
 *   sign: false
 * });
 *
 * // squash 合并并自动提交
 * await invoke('merge', {
 *   repoPath: '/path/to/repo',
 *   obj: 'feature',
 *   squash: true,
 *   noFastForward: false,
 *   noCommit: false,
 *   sign: false
 * });
 * ```
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - obj: 要合并的对象（分支名、远程跟踪分支名、或提交哈希）
 * - squash: 是否启用 --squash（压缩合并）
 * - no_fast_forward: 是否启用 --no-ff（禁止快进）
 * - no_commit: 是否启用 --no-commit（合并不自动提交）
 * - sign: 是否启用 GPG 签名（-S 选项）
 *
 * 返回：
 * - Ok(Option<String>)：合并成功
 *   - Some(hash): 合并产生了新提交，返回新提交的哈希
 *   - None: 合并未产生新提交（如 --no-commit 模式）
 * - Err(String)：执行失败，错误信息已转换为字符串
 */
#[command]
pub fn merge(
    repo_path: String,
    obj: String,
    squash: bool,
    no_fast_forward: bool,
    no_commit: bool,
    sign: bool,
) -> Result<Option<String>, String> {
    // 调用 git 层的 merge 函数执行实际操作
    // .map_err(|e| e.to_string()) 将 GitError 转换为 String
    crate::git::merge::merge(&repo_path, &obj, squash, no_fast_forward, no_commit, sign)
        .map_err(|e| e.to_string())
}
