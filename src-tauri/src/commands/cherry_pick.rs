/*
 * Git 拣选（cherry-pick）Tauri IPC 命令模块
 *
 * 此模块是前端与后端 git cherry-pick 功能之间的桥梁。
 * 前端通过 invoke('cherrypick', { repoPath, hash, noCommit, recordOrigin, sign, mainline }) 调用。
 *
 * 提供以下命令：
 * 1. cherrypick - 将指定提交的变更拣选到当前分支
 */

// 引入 Tauri 的命令宏
use tauri::command;

/**
 * 执行 git cherry-pick 拣选操作（Tauri IPC 命令）
 *
 * 前端调用示例：
 * ```typescript
 * import { invoke } from '@tauri-apps/api/core';
 *
 * // 普通拣选
 * await invoke('cherrypick', {
 *   repoPath: '/path/to/repo',
 *   hash: 'abc1234',
 *   noCommit: false,
 *   recordOrigin: false,
 *   sign: false,
 *   mainline: 0
 * });
 * ```
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - hash: 要拣选的提交哈希值
 * - no_commit: 是否启用 --no-commit（拣选但不创建提交）
 * - record_origin: 是否启用 -x（在提交消息中附加来源标记）
 * - sign: 是否启用 GPG 签名（-S 选项）
 * - mainline: 父提交索引（用于拣选合并提交，0 表示不指定）
 *
 * 返回：
 * - Ok(())：拣选成功
 * - Err(String)：执行失败，错误信息已转换为字符串
 */
#[command]
pub fn cherrypick(
    repo_path: String,
    hash: String,
    no_commit: bool,
    record_origin: bool,
    sign: bool,
    mainline: u32,
) -> Result<(), String> {
    // 调用 git 层的 cherrypick 函数执行实际操作
    crate::git::cherry_pick::cherrypick(
        &repo_path,
        &hash,
        no_commit,
        record_origin,
        sign,
        mainline,
    )
    .map_err(|e| e.to_string())
}
