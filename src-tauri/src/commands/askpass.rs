/*
 * Askpass 凭证管理 Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的凭证管理命令：
 * 1. set_credential - 设置（保存）指定 host 的用户名密码到内存缓存
 * 2. get_credential - 获取指定 host 的凭证
 * 3. clear_credential - 清除指定 host 的凭证（或清除所有凭证）
 * 4. has_credential - 检查是否已缓存指定 host 的凭证
 * 5. list_credential_hosts - 列出所有已缓存凭证的 host
 * 6. extract_host_from_url - 从 Git 远程 URL 中提取 host
 *
 * 前端调用示例：
 * ```javascript
 * // 保存 GitHub 凭证
 * await invoke('set_credential', {
 *   host: 'github.com',
 *   username: 'alice',
 *   password: 'ghp_xxxx...'
 * });
 *
 * // 检查是否有凭证
 * const has = await invoke('has_credential', { host: 'github.com' });
 *
 * // 从 URL 提取 host
 * const host = await invoke('extract_host_from_url', {
 *   url: 'https://github.com/user/repo.git'
 * });
 * ```
 *
 * 使用场景：
 * 1. 用户执行 push/pull/fetch 等需要认证的操作前，前端先检查是否有凭证
 * 2. 如果没有凭证，弹出对话框让用户输入用户名密码
 * 3. 调用 set_credential 保存凭证到内存
 * 4. 执行 git 命令时，后端注入 GIT_TERMINAL_PROMPT=0 环境变量
 */

use tauri::command;

/**
 * 设置（保存）凭证到内存缓存
 *
 * 将指定 host 的用户名密码保存到内存缓存中。
 * 凭证仅在当前应用会话中有效，应用关闭后自动清除。
 *
 * 参数：
 * - host: 远程仓库的主机名（如 "github.com"）
 * - username: 用户名或 OAuth token
 * - password: 密码或个人访问令牌
 *
 * 返回值：
 * - Ok(()) - 保存成功
 */
#[command]
pub fn set_credential(
    host: String,
    username: String,
    password: String,
) -> Result<(), String> {
    crate::askpass::set_credential(&host, &username, &password);
    Ok(())
}

/**
 * 获取指定 host 的凭证
 *
 * 从内存缓存中查找指定 host 的用户名密码。
 *
 * 参数：
 * - host: 远程仓库的主机名
 *
 * 返回值：
 * - Ok(Credential) - 找到凭证（包含 host/username/password）
 * - Ok(None) - 未找到该 host 的凭证（通过 Option::None 表示）
 * - Err(String) - 查询失败
 *
 * 注意：为了安全，前端应在必要时才调用此命令获取密码，
 * 显示后立即从内存中清除（避免密码长期存在于前端 JS 环境）。
 */
#[command]
pub fn get_credential(
    host: String,
) -> Result<Option<crate::askpass::Credential>, String> {
    Ok(crate::askpass::get_credential(&host))
}

/**
 * 清除凭证
 *
 * 从内存缓存中移除指定 host 的凭证。
 * 如果 host 为空字符串，则清除所有凭证。
 *
 * 参数：
 * - host: 远程仓库的主机名；为空字符串时清除所有凭证
 *
 * 返回值：
 * - Ok(bool) - true 表示成功清除凭证，false 表示未找到凭证
 */
#[command]
pub fn clear_credential(host: String) -> Result<bool, String> {
    Ok(crate::askpass::clear_credential(&host))
}

/**
 * 检查是否已缓存指定 host 的凭证
 *
 * 参数：
 * - host: 远程仓库的主机名
 *
 * 返回值：
 * - Ok(bool) - true 表示已缓存凭证，false 表示未缓存
 */
#[command]
pub fn has_credential(host: String) -> Result<bool, String> {
    Ok(crate::askpass::has_credential(&host))
}

/**
 * 列出所有已缓存凭证的 host
 *
 * 返回内存缓存中所有有凭证的 host 列表。
 * 注意：此命令不返回密码，只返回 host 列表。
 *
 * 返回值：
 * - Ok(Vec<String>) - 已缓存凭证的 host 列表
 */
#[command]
pub fn list_credential_hosts() -> Result<Vec<String>, String> {
    Ok(crate::askpass::list_credential_hosts())
}

/**
 * 从 Git 远程 URL 中提取 host
 *
 * 支持 HTTPS 和 SSH 两种 URL 格式：
 * - https://github.com/user/repo.git → github.com
 * - git@github.com:user/repo.git → github.com
 *
 * 参数：
 * - url: Git 远程仓库 URL
 *
 * 返回值：
 * - Ok(Option<String>) - 提取出的 host（None 表示无法解析）
 */
#[command]
pub fn extract_host_from_url(url: String) -> Result<Option<String>, String> {
    Ok(crate::askpass::extract_host_from_url(&url))
}
