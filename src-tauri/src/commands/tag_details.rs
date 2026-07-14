/*
 * 标签详情查询 Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的标签详情查询命令：
 * 1. get_tag_details - 获取单个标签的完整详情（含 GPG 签名信息）
 *
 * 前端调用示例：
 * ```javascript
 * // 获取标签详情
 * const details = await invoke('get_tag_details', {
 *   repoPath: '/path/to/repo',
 *   tag: 'v1.0.0'
 * });
 *
 * // 检查标签是否有 GPG 签名
 * if (details.signature) {
 *   console.log('签名状态:', details.signature.status);
 *   console.log('签名者:', details.signature.signer);
 * }
 * ```
 */

use tauri::command;

/**
 * 获取单个标签的完整详情
 *
 * 执行 `git for-each-ref refs/tags/{tag}` + `git verify-tag --raw {tag}`，
 * 返回标签的基础信息和 GPG 签名信息。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - tag: 标签名称（如 "v1.0.0"）
 *
 * 返回值：
 * - Ok(TagDetails) - 查询成功，返回标签详情
 * - Err(String) - 查询失败
 */
#[command]
pub fn get_tag_details(
    repo_path: String,
    tag: String,
) -> Result<crate::git::tag_details::TagDetails, String> {
    // 调用 git::tag_details::get_tag_details 执行实际的标签详情查询
    // 将 GitError 转换为 String 以满足 Tauri 命令的返回类型要求
    crate::git::tag_details::get_tag_details(&repo_path, &tag).map_err(|e| e.to_string())
}
