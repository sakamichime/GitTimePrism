/*
 * Git 变基（rebase）Tauri IPC 命令模块
 *
 * 此模块是前端与后端 git rebase 功能之间的桥梁。
 * 前端通过 invoke('rebase', { repoPath, obj, ignoreDate, sign, interactive }) 调用。
 *
 * 提供以下命令：
 * 1. rebase - 将当前分支变基到指定对象之上
 *
 * 注意：交互式变基（interactive=true）由前端直接在 PTY 终端中执行，
 * 不调用此命令。此命令的 interactive 参数仅用于 API 一致性。
 */

// 引入 Tauri 的命令宏
use tauri::command;

/**
 * 执行 git rebase 变基操作（Tauri IPC 命令）
 *
 * 前端调用示例：
 * ```typescript
 * import { invoke } from '@tauri-apps/api/core';
 *
 * // 普通变基
 * await invoke('rebase', {
 *   repoPath: '/path/to/repo',
 *   obj: 'main',
 *   ignoreDate: false,
 *   sign: false,
 *   interactive: false
 * });
 * ```
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - obj: 要变基到的目标对象（分支名、远程跟踪分支名、或提交哈希）
 * - ignore_date: 是否启用 --ignore-date（保持原始提交日期不变）
 * - sign: 是否启用 GPG 签名（-S 选项）
 * - interactive: 是否启用交互式变基（true 时由前端在 PTY 终端启动）
 *
 * 返回：
 * - Ok(())：变基成功
 * - Err(String)：执行失败，错误信息已转换为字符串
 */
#[command]
pub fn rebase(
    repo_path: String,
    obj: String,
    ignore_date: bool,
    sign: bool,
    interactive: bool,
) -> Result<(), String> {
    // 调用 git 层的 rebase 函数执行实际操作
    crate::git::rebase::rebase(&repo_path, &obj, ignore_date, sign, interactive)
        .map_err(|e| e.to_string())
}
