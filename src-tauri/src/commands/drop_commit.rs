/*
 * Git 丢弃提交（drop commit）Tauri IPC 命令模块
 *
 * 此模块是前端与后端 drop_commit 功能之间的桥梁。
 * 前端通过 invoke('drop_commit', { repoPath, hash, sign }) 调用。
 *
 * 提供以下命令：
 * 1. drop_commit - 丢弃指定的提交（通过 git rebase --onto 实现）
 *
 * ⚠️ 危险操作 ⚠️ 此操作会改写 Git 历史。
 */

// 引入 Tauri 的命令宏
use tauri::command;

/**
 * 执行丢弃提交操作（Tauri IPC 命令）
 *
 * 前端调用示例：
 * ```typescript
 * import { invoke } from '@tauri-apps/api/core';
 *
 * // 丢弃提交
 * await invoke('drop_commit', {
 *   repoPath: '/path/to/repo',
 *   hash: 'abc1234',
 *   sign: false
 * });
 * ```
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - hash: 要丢弃的提交哈希值
 * - sign: 是否启用 GPG 签名（-S 选项）
 *
 * 返回：
 * - Ok(())：丢弃成功
 * - Err(String)：执行失败，错误信息已转换为字符串
 *
 * 注意：
 * - 此操作会改写历史，如果提交已推送到远程，可能导致其他协作者的问题
 * - 后端会进行拓扑可行性检查，不能丢弃 HEAD 的祖先提交
 */
#[command]
pub fn drop_commit(repo_path: String, hash: String, sign: bool) -> Result<(), String> {
    // 调用 git 层的 drop_commit 函数执行实际操作
    crate::git::drop_commit::drop_commit(&repo_path, &hash, sign).map_err(|e| e.to_string())
}
