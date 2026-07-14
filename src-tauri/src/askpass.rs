/*
 * Askpass 凭证管理模块
 *
 * 此模块负责管理 Git 操作的认证凭证（用户名/密码），用于访问需要认证的远程仓库。
 *
 * 设计说明（简化版）：
 * 由于实现完整的 GIT_ASKPASS helper 需要单独编译一个可执行文件，
 * 此模块采用简化方案：
 * 1. 在内存中维护一个按 host 索引的凭证缓存（session 级别，不持久化密码）
 * 2. 前端通过对话框预先收集用户名密码，调用 set_credentials 命令存入缓存
 * 3. 当执行需要认证的 git 命令时，通过环境变量注入凭证：
 *    - GIT_TERMINAL_PROMPT=0：禁止 git 的交互式终端提示（避免阻塞）
 *    - 如果缓存中有对应 host 的凭证，通过 git credential approve 命令注入
 *
 * 安全说明：
 * - 密码仅缓存在内存中，不写入磁盘
 * - 应用关闭后凭证自动清除
 * - 提供 clear_credentials 命令让用户主动清除凭证
 *
 * 参考实现：gitgraph 项目的 askpass/ 目录（完整的 askpass helper 实现）
 */

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/**
 * 单条凭证信息
 *
 * 包含访问特定 host 所需的用户名和密码。
 */
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credential {
    /// 远程仓库的主机名（如 "github.com"、"gitlab.com"）
    pub host: String,
    /// 用户名（HTTPS 认证用户名，或 OAuth token）
    pub username: String,
    /// 密码或个人访问令牌（Personal Access Token）
    /// 注意：此字段仅在内存中，不会持久化到磁盘
    pub password: String,
}

/**
 * 全局凭证缓存的类型
 *
 * 使用 HashMap<host, Credential> 按 host 索引凭证，
 * 外层包裹 Mutex 实现线程安全访问。
 */
type CredentialStore = HashMap<String, Credential>;

/**
 * 获取全局凭证缓存的静态实例
 *
 * 使用 OnceLock 实现"一次初始化"的全局变量，
 * 首次调用时创建空的 HashMap，后续调用返回同一个实例。
 * OnceLock 是 Rust 1.70+ 稳定的同步原语，线程安全。
 *
 * 返回值：
 * - &'static Mutex<CredentialStore>: 全局凭证缓存的引用
 */
fn credential_store() -> &'static Mutex<CredentialStore> {
    // OnceLock 保证此静态变量只初始化一次
    static STORE: OnceLock<Mutex<CredentialStore>> = OnceLock::new();
    // get_or_init 首次调用时执行闭包创建 Mutex，后续调用直接返回已有实例
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

/**
 * 设置（保存）凭证到内存缓存
 *
 * 将指定 host 的用户名密码保存到内存缓存中。
 * 如果该 host 已有凭证，会被覆盖。
 *
 * 参数：
 * - host: 远程仓库的主机名（如 "github.com"）
 * - username: 用户名或 OAuth token
 * - password: 密码或个人访问令牌
 */
pub fn set_credential(host: &str, username: &str, password: &str) {
    // 锁定凭证缓存（ Mutex::lock 会阻塞直到获取锁）
    let mut store = credential_store()
        .lock()
        .expect("凭证缓存 Mutex 被毒化（panic 后未恢复）");

    // 构造 Credential 并插入到 HashMap 中
    // 如果 host 已存在，旧值会被新值覆盖
    store.insert(
        host.to_string(),
        Credential {
            host: host.to_string(),
            username: username.to_string(),
            password: password.to_string(),
        },
    );
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
 * - Some(Credential): 找到凭证（克隆一份返回，避免外部修改影响缓存）
 * - None: 未找到该 host 的凭证
 */
pub fn get_credential(host: &str) -> Option<Credential> {
    // 锁定凭证缓存
    let store = credential_store()
        .lock()
        .expect("凭证缓存 Mutex 被毒化（panic 后未恢复）");

    // 查找并克隆凭证（Credential 实现了 Clone）
    store.get(host).cloned()
}

/**
 * 清除指定 host 的凭证
 *
 * 从内存缓存中移除指定 host 的用户名密码。
 *
 * 参数：
 * - host: 远程仓库的主机名；为空字符串时清除所有凭证
 *
 * 返回值：
 * - true: 成功清除凭证
 * - false: 未找到该 host 的凭证（无操作）
 */
pub fn clear_credential(host: &str) -> bool {
    // 锁定凭证缓存
    let mut store = credential_store()
        .lock()
        .expect("凭证缓存 Mutex 被毒化（panic 后未恢复）");

    if host.is_empty() {
        // host 为空字符串时清除所有凭证
        let had_any = !store.is_empty();
        store.clear();
        had_any
    } else {
        // 移除指定 host 的凭证
        store.remove(host).is_some()
    }
}

/**
 * 检查是否已缓存指定 host 的凭证
 *
 * 参数：
 * - host: 远程仓库的主机名
 *
 * 返回值：
 * - true: 已缓存该 host 的凭证
 * - false: 未缓存该 host 的凭证
 */
pub fn has_credential(host: &str) -> bool {
    let store = credential_store()
        .lock()
        .expect("凭证缓存 Mutex 被毒化（panic 后未恢复）");
    store.contains_key(host)
}

/**
 * 获取所有已缓存凭证的 host 列表
 *
 * 返回内存缓存中所有有凭证的 host 列表。
 * 注意：此方法不返回密码，只返回 host 列表，用于前端显示已存储凭证的主机。
 *
 * 返回值：
 * - Vec<String>: 已缓存凭证的 host 列表
 */
pub fn list_credential_hosts() -> Vec<String> {
    let store = credential_store()
        .lock()
        .expect("凭证缓存 Mutex 被毒化（panic 后未恢复）");
    store.keys().cloned().collect()
}

/**
 * 获取 askpass 相关的环境变量
 *
 * 返回执行 git 命令时需要注入的环境变量列表，
 * 用于禁用交互式提示并配置凭证获取方式。
 *
 * 返回的环境变量：
 * - ("GIT_TERMINAL_PROMPT", "0")：禁用 git 的交互式终端提示
 *   当 git 需要密码时，不会阻塞等待用户输入，而是直接失败
 *   这样可以在 GUI 应用中避免 git 进程卡死
 *
 * 返回值：
 * - Vec<(&'static str, &'static str)>: 环境变量列表
 */
pub fn get_askpass_env() -> Vec<(&'static str, &'static str)> {
    vec![("GIT_TERMINAL_PROMPT", "0")]
}

/**
 * 从 URL 中提取 host
 *
 * 解析 Git 远程仓库 URL，提取其中的主机名部分。
 * 支持两种 URL 格式：
 * - HTTPS 格式：https://github.com/user/repo.git → github.com
 * - SSH 格式：git@github.com:user/repo.git → github.com
 *
 * 参数：
 * - url: Git 远程仓库 URL
 *
 * 返回值：
 * - Some(String): 提取出的 host
 * - None: 无法解析出 host
 */
pub fn extract_host_from_url(url: &str) -> Option<String> {
    // SSH 格式：git@github.com:user/repo.git
    // 特征：包含 "@" 和 ":"，且 ":" 在 "@" 之后
    if let Some(at_pos) = url.find('@') {
        if let Some(colon_pos) = url[at_pos..].find(':') {
            // 提取 "@" 和 ":" 之间的部分作为 host
            let host = &url[at_pos + 1..at_pos + colon_pos];
            if !host.is_empty() {
                return Some(host.to_string());
            }
        }
    }

    // HTTPS 格式：https://github.com/user/repo.git 或 https://user:pass@github.com/...
    // 特征：以 "http://" 或 "https://" 开头
    let http_prefixes = ["https://", "http://"];
    for prefix in &http_prefixes {
        if let Some(rest) = url.strip_prefix(prefix) {
            // rest 可能是 "user:pass@github.com/..." 或 "github.com/..."
            // 先去除可能的 user:pass@ 前缀
            let after_auth = if let Some(at_pos) = rest.find('@') {
                &rest[at_pos + 1..]
            } else {
                rest
            };

            // 取第一个 "/" 或 ":" 之前的部分作为 host
            let end = after_auth
                .find('/')
                .or_else(|| after_auth.find(':'))
                .unwrap_or(after_auth.len());
            let host = &after_auth[..end];
            if !host.is_empty() {
                return Some(host.to_string());
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_host_from_url_https() {
        assert_eq!(
            extract_host_from_url("https://github.com/user/repo.git"),
            Some("github.com".to_string())
        );
        assert_eq!(
            extract_host_from_url("https://user:pass@github.com/user/repo.git"),
            Some("github.com".to_string())
        );
    }

    #[test]
    fn test_extract_host_from_url_ssh() {
        assert_eq!(
            extract_host_from_url("git@github.com:user/repo.git"),
            Some("github.com".to_string())
        );
    }

    #[test]
    fn test_extract_host_from_url_invalid() {
        assert_eq!(extract_host_from_url("not-a-url"), None);
    }
}
