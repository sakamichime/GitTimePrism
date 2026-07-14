/*
 * Git Blame 查询 Tauri IPC 命令模块
 *
 * 此模块是前端与后端 Blame 查询功能之间的桥梁。
 * 前端通过 invoke('get_blame', { repoPath, filePath }) 调用。
 *
 * 提供以下命令：
 * 1. get_blame - 获取文件每行的提交溯源信息
 *
 * 使用场景：
 * - 用户在文件右键菜单中选择"View Blame"时，前端调用此命令
 *   获取文件每行的提交信息（commit hash/author/email/date/line content），
 *   然后在 Blame 视图中显示行级别的提交溯源信息。
 * - 点击某行可跳转到对应提交的详情视图。
 *
 * 前端调用示例：
 * ```typescript
 * import { invoke } from '@tauri-apps/api/core';
 *
 * const blameLines = await invoke('get_blame', {
 *   repoPath: '/path/to/repo',
 *   filePath: 'src/main.rs'
 * });
 * for (const line of blameLines) {
 *   console.log(`行 ${line.line_number}: ${line.short_hash} - ${line.author}`);
 * }
 * ```
 */

// 引入 Tauri 的命令宏，用于标记可被前端调用的函数
use tauri::command;

/**
 * 获取文件每行的 Blame 信息（Tauri IPC 命令）
 *
 * 执行 `git blame --line-porcelain -- <file_path>` 命令，
 * 返回文件每行的提交溯源信息列表（BlameLine 数组）。
 *
 * 每行信息包含：
 * - 提交完整哈希和短哈希
 * - 作者名字、邮箱、日期
 * - 提交者名字、邮箱、日期
 * - 行号和行内容
 * - 是否是边界提交（boundary commit，文件历史最早可见的提交）
 *
 * 前端调用方式：
 * ```typescript
 * const blameLines = await invoke('get_blame', {
 *   repoPath: '/path/to/repo',
 *   filePath: 'src/main.rs'
 * });
 * ```
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - file_path: 要查询 blame 的文件路径（相对于仓库根目录）
 *
 * 返回：
 * - Ok(Vec<BlameLine>)：文件每行的 blame 信息列表
 * - Err(String)：命令执行失败（文件不存在、路径为空等），错误信息已转换为字符串
 */
#[command]
pub fn get_blame(
    repo_path: String,
    file_path: String,
) -> Result<Vec<crate::git::blame::BlameLine>, String> {
    // 调用 git 层的 get_blame 函数执行实际操作
    // .map_err(|e| e.to_string()) 将 GitError 转换为 String
    crate::git::blame::get_blame(&repo_path, &file_path).map_err(|e| e.to_string())
}
