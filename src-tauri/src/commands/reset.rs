/*
 * Git 撤销提交（reset）Tauri 命令模块
 *
 * 此模块是前端与后端 git reset 功能之间的桥梁：
 * - 前端通过 invoke('reset_commit', { repo_path, mode, commit }) 调用
 * - 此命令将参数转发给 git::reset::reset_commit_to 执行实际操作
 * - 错误会被转换为 String 返回给前端
 *
 * 支持的 mode 值：
 * - "soft"：  撤销 commit，保留更改在暂存区
 * - "mixed"： 撤销 commit 和暂存，保留更改在工作区
 * - "hard"：  完全撤销，丢弃所有更改（危险！）
 *
 * commit 参数（可选）：
 * - 不传或 null：重置到 HEAD~1（撤销最近一次提交，与旧版本行为一致）
 * - 传入提交哈希、分支名或 HEAD~N：重置到指定的 commit
 */

// 引入 Tauri 的 command 宏，用于标记可被前端调用的函数
use tauri::command;

/**
 * Tauri IPC 命令：撤销提交
 *
 * 前端调用示例：
 * ```typescript
 * import { invoke } from '@tauri-apps/api/core';
 *
 * // 撤销最近一次提交（不传 commit 参数，使用默认的 HEAD~1）
 * await invoke('reset_commit', { repoPath: '/path/to/repo', mode: 'soft' });
 *
 * // 重置到指定提交
 * await invoke('reset_commit', {
 *   repoPath: '/path/to/repo',
 *   mode: 'mixed',
 *   commit: 'abc1234'
 * });
 *
 * // 危险！完全重置到指定提交
 * await invoke('reset_commit', {
 *   repoPath: '/path/to/repo',
 *   mode: 'hard',
 *   commit: 'abc1234'
 * });
 * ```
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径（由前端传入）
 * - mode:      重置模式，必须是 "soft"、"mixed"、"hard" 之一
 * - commit:    要重置到的目标 commit（可选）
 *              - None/null：重置到 HEAD~1（撤销最近一次提交）
 *              - Some(hash)：重置到指定 commit
 *
 * 返回：
 * - Ok(())：命令执行成功
 * - Err(String)：执行失败，错误信息已转换为字符串供前端显示
 */
#[command]
pub fn reset_commit(
    repo_path: String,
    mode: String,
    commit: Option<String>,
) -> Result<(), String> {
    // 调用 git 层的 reset_commit_to 函数执行实际操作
    // commit.as_deref() 将 Option<String> 转换为 Option<&str>
    // .map_err(|e| e.to_string()) 将 GitError 转换为 String
    crate::git::reset::reset_commit_to(&repo_path, &mode, commit.as_deref())
        .map_err(|e| e.to_string())
}
