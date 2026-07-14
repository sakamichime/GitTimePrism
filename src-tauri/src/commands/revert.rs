/*
 * Git 还原（revert）Tauri IPC 命令模块
 *
 * 此模块是前端与后端 git revert 功能之间的桥梁。
 * 前端通过 invoke('revert', { repoPath, hash, sign, mainline }) 调用。
 *
 * 提供以下命令：
 * 1. revert - 创建反向提交来撤销指定提交的变更
 */

// 引入 Tauri 的命令宏
use tauri::command;

/**
 * 执行 git revert 还原操作（Tauri IPC 命令）
 *
 * 前端调用示例：
 * ```typescript
 * import { invoke } from '@tauri-apps/api/core';
 *
 * // 普通还原
 * await invoke('revert', {
 *   repoPath: '/path/to/repo',
 *   hash: 'abc1234',
 *   sign: false,
 *   mainline: 0
 * });
 * ```
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - hash: 要还原的提交哈希值
 * - sign: 是否启用 GPG 签名（-S 选项）
 * - mainline: 父提交索引（用于还原合并提交，0 表示不指定）
 *
 * 返回：
 * - Ok(())：还原成功
 * - Err(String)：执行失败，错误信息已转换为字符串
 */
#[command]
pub fn revert(
    repo_path: String,
    hash: String,
    sign: bool,
    mainline: u32,
) -> Result<(), String> {
    // 调用 git 层的 revert 函数执行实际操作
    crate::git::revert::revert(&repo_path, &hash, sign, mainline).map_err(|e| e.to_string())
}
