/*
 * 头像管理 Tauri IPC 命令模块（阶段 10：Task 10.4）
 *
 * 此模块是前端与 avatar 模块之间的桥梁。
 * 每个函数使用 #[tauri::command] 宏标记，前端通过 invoke() 调用。
 *
 * 提供以下 2 个命令：
 * 1. get_avatar        - 获取指定用户的头像（带缓存）
 * 2. clear_avatar_cache - 清除所有头像缓存
 *
 * 前端调用示例：
 * ```javascript
 * import { invoke } from '@tauri-apps/api/core';
 * import { convertFileSrc } from '@tauri-apps/api/core';
 *
 * // 获取头像（异步）
 * const avatarPath = await invoke('get_avatar', {
 *   repoPath: 'C:\\Projects\\my-repo',
 *   email: 'alice@example.com',
 *   author: 'Alice'
 * });
 * if (avatarPath) {
 *   // 将本地文件路径转为可加载的 URL
 *   const avatarUrl = convertFileSrc(avatarPath);
 *   imgElement.src = avatarUrl;
 * }
 *
 * // 清除所有头像缓存
 * await invoke('clear_avatar_cache');
 * ```
 *
 * 头像加载策略：
 * - 缓存命中（14 天内 / identicon 4 天内）：立即返回文件路径，无网络请求
 * - 缓存未命中：发起 HTTP 请求获取头像，下载后保存到本地，返回文件路径
 * - 获取失败：返回 null，前端显示默认头像
 */

use tauri::command;

/**
 * 获取指定用户的头像
 *
 * 根据邮箱和仓库路径获取头像：
 * 1. 先检查本地缓存（~/.gittimeprism/avatars/）
 * 2. 缓存未命中时根据仓库的 remote 源类型获取：
 *    - GitHub 源：调用 GitHub API（本阶段简化为 Gravatar 兜底）
 *    - GitLab 源：调用 GitLab API 查询用户头像
 *    - Gravatar 源：用 email 的 MD5 哈希构造 URL
 * 3. 下载头像图片并缓存到本地
 * 4. 返回头像文件的本地路径
 *
 * 此命令是异步的（async），因为需要发起 HTTP 请求。
 * 如果缓存命中，会立即返回，不会发起网络请求。
 *
 * 前端调用方式：
 * ```javascript
 * const avatarPath = await invoke('get_avatar', {
 *   repoPath: 'C:\\Projects\\my-repo',
 *   email: 'alice@example.com',
 *   author: 'Alice'
 * });
 * ```
 *
 * 参数：
 * - repoPath: 仓库路径（用于检测 remote 源类型）
 * - email: 用户邮箱（用于标识头像和构造 Gravatar URL）
 * - author: 作者名（备用，目前未使用）
 *
 * 返回值：
 * - Ok(Some(file_path)) - 头像文件的本地路径（绝对路径）
 * - Ok(None) - 头像不存在或获取失败
 * - Err(String) - 错误
 */
#[command]
pub async fn get_avatar(
    repo_path: String,
    email: String,
    author: String,
) -> Result<Option<String>, String> {
    // 调用 avatar::get_avatar 执行实际的获取
    crate::avatar::get_avatar(&repo_path, &email, &author).await
}

/**
 * 清除所有头像缓存
 *
 * 删除 ~/.gittimeprism/avatars/ 目录下的所有头像文件和缓存索引。
 * 用户在设置中"清除头像缓存"时调用。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('clear_avatar_cache');
 * ```
 *
 * 返回值：
 * - Ok(()) - 清除成功
 * - Err(String) - 失败
 */
#[command]
pub fn clear_avatar_cache() -> Result<(), String> {
    // 调用 avatar::clear_avatar_cache 执行实际的清除
    crate::avatar::clear_avatar_cache()
}
