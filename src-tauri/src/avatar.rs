/*
 * 头像管理模块（阶段 10：Task 10.4）
 *
 * 此模块负责从 GitHub / GitLab / Gravatar 三个源获取用户头像，
 * 并缓存到本地磁盘（~/.gittimeprism/avatars/）。
 *
 * 头像源优先级（取决于仓库的 remote URL）：
 * 1. GitHub：从 remote URL 提取 owner/repo，调用 GitHub API 获取提交作者头像
 * 2. GitLab：从 remote URL 检测 GitLab，调用 GitLab API 查询用户头像
 * 3. Gravatar（兜底）：用 email 的 MD5 哈希构造 Gravatar URL
 *
 * 缓存策略：
 * - 普通头像：14 天缓存刷新（14 天后下次请求时重新获取）
 * - Identicon 头像（Gravatar 默认生成的几何头像）：4 天刷新
 * - 缓存文件名：{email_md5}.{format}（如 abc123.png）
 *
 * 头像文件路径返回给前端：
 * - 前端可通过 convertFileSrc 或 asset 协议加载本地头像文件
 * - 如果头像不存在或获取失败，返回 None
 *
 * 依赖：
 * - reqwest：HTTP 客户端（获取头像图片和 API 响应）
 * - md-5：计算 email 的 MD5 哈希
 * - tokio：异步运行时（reqwest 异步 API 依赖）
 */

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use md5::{Md5, Digest};

/**
 * 头像缓存条目
 *
 * 描述一个已缓存头像的信息，保存在 ~/.gittimeprism/avatars/cache.json 中。
 */
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AvatarCacheEntry {
    /// 头像图片文件名（如 "abc123.png"，相对于 avatars 目录）
    pub image: String,
    /// 缓存时间戳（Unix 时间戳，毫秒）
    pub timestamp: i64,
    /// 是否是 identicon（Gravatar 自动生成的几何头像）
    /// identicon 缓存 4 天，普通头像缓存 14 天
    pub identicon: bool,
}

/**
 * 头像缓存（键为 email，值为缓存条目）
 */
type AvatarCache = std::collections::HashMap<String, AvatarCacheEntry>;

/**
 * 普通头像的缓存时间（14 天，单位：毫秒）
 *
 * 14 天 = 14 * 24 * 60 * 60 * 1000 = 1,209,600,000 毫秒
 */
const AVATAR_CACHE_DURATION_MS: i64 = 14 * 24 * 60 * 60 * 1000;

/**
 * Identicon 头像的缓存时间（4 天，单位：毫秒）
 *
 * 4 天 = 4 * 24 * 60 * 60 * 1000 = 345,600,000 毫秒
 */
const IDENTICON_CACHE_DURATION_MS: i64 = 4 * 24 * 60 * 60 * 1000;

/**
 * 获取 ~/.gittimeprism 配置目录的路径
 *
 * 返回值：配置目录的 PathBuf
 */
fn get_config_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".gittimeprism")
}

/**
 * 获取头像缓存目录的路径
 *
 * 路径为：~/.gittimeprism/avatars/
 *
 * 返回值：头像目录的 PathBuf
 */
fn get_avatars_dir() -> PathBuf {
    get_config_dir().join("avatars")
}

/**
 * 获取头像缓存索引文件的路径
 *
 * 路径为：~/.gittimeprism/avatars/cache.json
 *
 * 返回值：缓存索引文件的 PathBuf
 */
fn get_cache_index_path() -> PathBuf {
    get_avatars_dir().join("cache.json")
}

/**
 * 计算 email 的 MD5 哈希（小写十六进制字符串）
 *
 * Gravatar 使用 email 的 MD5 哈希作为头像标识。
 * 计算前需要将 email 转为小写并去除首尾空白。
 *
 * 参数：
 * - email: 邮箱地址
 *
 * 返回值：32 位小写十六进制 MD5 哈希字符串
 */
fn compute_email_md5(email: &str) -> String {
    // 转为小写并去除首尾空白
    let normalized = email.trim().to_lowercase();
    // 创建 MD5 哈希器
    let mut hasher = Md5::new();
    // 输入数据
    hasher.update(normalized.as_bytes());
    // 计算哈希
    let result = hasher.finalize();
    // 转为十六进制字符串
    hex::encode(result)
}

/**
 * 加载头像缓存索引
 *
 * 从 ~/.gittimeprism/avatars/cache.json 读取缓存索引。
 * 如果文件不存在或解析失败，返回空缓存。
 *
 * 返回值：AvatarCache 缓存哈希表
 */
fn load_cache_index() -> AvatarCache {
    let cache_path = get_cache_index_path();
    if !cache_path.exists() {
        return AvatarCache::new();
    }
    match fs::read_to_string(&cache_path) {
        Ok(content) => {
            match serde_json::from_str::<AvatarCache>(&content) {
                Ok(cache) => cache,
                Err(err) => {
                    eprintln!("[avatar] 缓存索引解析失败: {}，使用空缓存", err);
                    AvatarCache::new()
                }
            }
        }
        Err(_) => AvatarCache::new(),
    }
}

/**
 * 保存头像缓存索引到磁盘
 *
 * 将缓存索引写入 ~/.gittimeprism/avatars/cache.json。
 *
 * 参数：
 * - cache: 要保存的缓存
 *
 * 返回值：
 * - Ok(()) - 保存成功
 * - Err(String) - 保存失败
 */
fn save_cache_index(cache: &AvatarCache) -> Result<(), String> {
    let avatars_dir = get_avatars_dir();
    if !avatars_dir.exists() {
        fs::create_dir_all(&avatars_dir)
            .map_err(|e| format!("创建头像目录失败: {}", e))?;
    }
    let cache_path = get_cache_index_path();
    let json = serde_json::to_string_pretty(cache)
        .map_err(|e| format!("序列化缓存索引失败: {}", e))?;
    fs::write(&cache_path, json)
        .map_err(|e| format!("写入缓存索引失败: {}", e))?;
    Ok(())
}

/**
 * 检查头像缓存是否过期
 *
 * 根据 identicon 标志选择不同的过期时间：
 * - identicon：4 天
 * - 普通头像：14 天
 *
 * 参数：
 * - entry: 缓存条目
 *
 * 返回值：
 * - true - 缓存已过期，需要重新获取
 * - false - 缓存未过期，可直接使用
 */
fn is_cache_expired(entry: &AvatarCacheEntry) -> bool {
    let now = chrono::Utc::now().timestamp_millis();
    let duration = if entry.identicon {
        IDENTICON_CACHE_DURATION_MS
    } else {
        AVATAR_CACHE_DURATION_MS
    };
    entry.timestamp + duration < now
}

/**
 * 检测仓库的远程源类型
 *
 * 通过读取仓库的 remote URL 来判断使用哪个头像源：
 * - GitHub URL（https://github.com/... 或 git@github.com:...）→ GitHub 源
 * - GitLab URL（https://gitlab.com/... 或 git@gitlab.com:...）→ GitLab 源
 * - 其他 → Gravatar 兜底
 *
 * 参数：
 * - repo_path: 仓库路径
 *
 * 返回值：RemoteSource 枚举
 */
fn detect_remote_source(repo_path: &str) -> RemoteSource {
    // 调用 git remote get-url origin 获取 origin 的 URL
    let output = crate::git::commands::run_git(repo_path, &["remote", "get-url", "origin"]);
    match output {
        Ok(git_output) => {
            let url = git_output.stdout.trim();
            // 检测 GitHub URL
            // 支持两种格式：
            // 1. https://github.com/owner/repo.git
            // 2. git@github.com:owner/repo.git
            if url.contains("github.com") {
                // 尝试提取 owner 和 repo
                // 简化处理：仅返回 GitHub 类型，不提取 owner/repo（头像获取时不直接使用）
                return RemoteSource::GitHub;
            }
            // 检测 GitLab URL
            if url.contains("gitlab.com") {
                return RemoteSource::GitLab;
            }
            // 其他情况使用 Gravatar
            RemoteSource::Gravatar
        }
        Err(_) => {
            // 没有 origin remote，使用 Gravatar 兜底
            RemoteSource::Gravatar
        }
    }
}

/**
 * 远程源类型枚举
 */
enum RemoteSource {
    /// GitHub 源（从 GitHub API 获取提交作者头像）
    GitHub,
    /// GitLab 源（从 GitLab API 查询用户头像）
    GitLab,
    /// Gravatar 源（用 email 的 MD5 哈希构造 URL）
    Gravatar,
}

/**
 * 从 GitHub 获取头像
 *
 * 由于无法从 email 直接推导 GitHub 用户名，这里采用简化策略：
 * 直接构造 GitHub avatar URL。
 * 实际的 gitgraph 实现是通过 GitHub API 的 /repos/{owner}/{repo}/commits/{hash}
 * 获取提交作者信息，但这需要 commit hash，本阶段简化为直接使用 Gravatar 兜底。
 *
 * 参数：
 * - email: 邮箱地址
 * - author: 作者名（备用，目前未使用）
 *
 * 返回值：
 * - Ok(Some((image_data, format, is_identicon))) - 获取成功
 * - Ok(None) - 获取失败（如 404）
 * - Err(String) - 网络错误
 */
#[allow(dead_code)]
async fn fetch_from_github(email: &str, author: &str) -> Result<Option<(Vec<u8>, String, bool)>, String> {
    // 简化实现：GitHub 源需要 commit hash 才能查询作者信息
    // 本阶段直接降级为 Gravatar
    let _ = (email, author);
    fetch_from_gravatar(email).await
}

/**
 * 从 GitLab 获取头像
 *
 * 调用 GitLab API /api/v4/users?search={email} 查询用户头像 URL。
 *
 * 参数：
 * - email: 邮箱地址
 *
 * 返回值：
 * - Ok(Some((image_data, format, is_identicon))) - 获取成功
 * - Ok(None) - 获取失败
 * - Err(String) - 网络错误
 */
#[allow(dead_code)]
async fn fetch_from_gitlab(email: &str) -> Result<Option<(Vec<u8>, String, bool)>, String> {
    // 构造 GitLab API URL
    let url = format!("https://gitlab.com/api/v4/users?search={}", email);
    // 创建 HTTP 客户端
    let client = reqwest::Client::builder()
        .user_agent("GitTimePrism/0.1")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    // 发送 GET 请求
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("GitLab API 请求失败: {}", e))?;
    // 检查状态码
    if !response.status().is_success() {
        return Ok(None);
    }
    // 解析 JSON 响应
    let users: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("GitLab API 响应解析失败: {}", e))?;
    // 检查是否有匹配的用户
    if users.is_empty() {
        return Ok(None);
    }
    // 获取头像 URL
    let avatar_url = users[0]
        .get("avatar_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "GitLab 响应中缺少 avatar_url".to_string())?;
    // 下载头像图片
    download_image(avatar_url).await
}

/**
 * 从 Gravatar 获取头像
 *
 * 用 email 的 MD5 哈希构造 Gravatar URL：
 * 1. 先尝试 https://secure.gravatar.com/avatar/{md5}?s=162&d=404
 *    d=404 表示如果没有头像返回 404，避免使用 identicon
 * 2. 如果 404，再尝试 d=identicon 获取自动生成的几何头像
 *
 * 参数：
 * - email: 邮箱地址
 *
 * 返回值：
 * - Ok(Some((image_data, format, is_identicon))) - 获取成功
 * - Ok(None) - 获取失败
 * - Err(String) - 网络错误
 */
async fn fetch_from_gravatar(email: &str) -> Result<Option<(Vec<u8>, String, bool)>, String> {
    // 计算 email 的 MD5 哈希
    let hash = compute_email_md5(email);
    // 构造 Gravatar URL（先尝试非 identicon，d=404 表示无头像时返回 404）
    let url = format!("https://secure.gravatar.com/avatar/{}?s=162&d=404", hash);
    // 创建 HTTP 客户端
    let client = reqwest::Client::builder()
        .user_agent("GitTimePrism/0.1")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    // 发送 GET 请求
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Gravatar 请求失败: {}", e))?;
    // 检查状态码
    if response.status().as_u16() == 404 {
        // 没有 Gravatar 头像，尝试 identicon
        let identicon_url = format!(
            "https://secure.gravatar.com/avatar/{}?s=162&d=identicon",
            hash
        );
        let identicon_response = client
            .get(&identicon_url)
            .send()
            .await
            .map_err(|e| format!("Gravatar identicon 请求失败: {}", e))?;
        if !identicon_response.status().is_success() {
            return Ok(None);
        }
        // 获取图片数据和格式
        let content_type = identicon_response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("image/png")
            .to_string();
        let format = content_type.split('/').nth(1).unwrap_or("png").to_string();
        let image_data = identicon_response
            .bytes()
            .await
            .map_err(|e| format!("读取 identicon 图片数据失败: {}", e))?
            .to_vec();
        return Ok(Some((image_data, format, true)));
    }
    if !response.status().is_success() {
        return Ok(None);
    }
    // 获取图片数据和格式
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let format = content_type.split('/').nth(1).unwrap_or("png").to_string();
    let image_data = response
        .bytes()
        .await
        .map_err(|e| format!("读取 Gravatar 图片数据失败: {}", e))?
        .to_vec();
    Ok(Some((image_data, format, false)))
}

/**
 * 下载图片
 *
 * 从指定 URL 下载图片，返回图片数据、格式和 identicon 标志。
 *
 * 参数：
 * - url: 图片 URL
 *
 * 返回值：
 * - Ok(Some((image_data, format, is_identicon))) - 下载成功
 * - Ok(None) - 下载失败
 * - Err(String) - 网络错误
 */
async fn download_image(url: &str) -> Result<Option<(Vec<u8>, String, bool)>, String> {
    let client = reqwest::Client::builder()
        .user_agent("GitTimePrism/0.1")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载图片失败: {}", e))?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let format = content_type.split('/').nth(1).unwrap_or("png").to_string();
    let image_data = response
        .bytes()
        .await
        .map_err(|e| format!("读取图片数据失败: {}", e))?
        .to_vec();
    Ok(Some((image_data, format, false)))
}

/**
 * 获取头像（核心 API）
 *
 * 此函数是头像管理的核心入口，前端通过 invoke('get_avatar', ...) 调用。
 *
 * 工作流程：
 * 1. 检查本地缓存：
 *    - 如果缓存存在且未过期，直接返回缓存的文件路径
 *    - 如果缓存过期或不存在，触发异步获取
 * 2. 异步获取头像（根据仓库的 remote 源类型）：
 *    - GitHub 源：调用 GitHub API（本阶段简化为 Gravatar）
 *    - GitLab 源：调用 GitLab API
 *    - Gravatar 源：用 email MD5 构造 URL
 * 3. 下载头像图片并保存到本地缓存
 * 4. 返回头像文件的本地路径
 *
 * 注意：此函数是异步的，因为需要发起 HTTP 请求。
 * 如果缓存命中，会立即返回，不会发起网络请求。
 *
 * 参数：
 * - repo_path: 仓库路径（用于检测 remote 源类型）
 * - email: 用户邮箱
 * - author: 作者名（备用，目前未使用）
 *
 * 返回值：
 * - Ok(Some(file_path)) - 头像文件路径（绝对路径）
 * - Ok(None) - 头像不存在或获取失败
 * - Err(String) - 错误
 */
pub async fn get_avatar(repo_path: &str, email: &str, author: &str) -> Result<Option<String>, String> {
    // 加载缓存索引
    let mut cache = load_cache_index();

    // 计算 email 的 MD5（用作缓存键和文件名）
    let email_md5 = compute_email_md5(email);

    // 检查缓存
    let need_fetch = match cache.get(email) {
        Some(entry) => {
            // 检查缓存是否过期
            if is_cache_expired(entry) {
                // 过期，需要重新获取
                true
            } else {
                // 未过期，检查文件是否存在
                let avatar_path = get_avatars_dir().join(&entry.image);
                if avatar_path.exists() {
                    // 缓存有效，返回文件路径
                    return Ok(Some(avatar_path.to_string_lossy().to_string()));
                } else {
                    // 文件不存在（可能被手动删除），需要重新获取
                    true
                }
            }
        }
        None => true, // 无缓存，需要获取
    };

    if !need_fetch {
        // 此分支理论上不会执行（前面已 return），但作为防御性代码保留
        return Ok(None);
    }

    // 检测仓库的 remote 源类型
    let source = detect_remote_source(repo_path);

    // 根据源类型获取头像
    let fetch_result = match source {
        RemoteSource::GitHub => {
            // GitHub 源：本阶段简化为 Gravatar（GitHub API 需要 commit hash）
            fetch_from_gravatar(email).await
        }
        RemoteSource::GitLab => {
            // GitLab 源：调用 GitLab API，失败时降级到 Gravatar
            // 使用 match 替代 or_else（or_else 的闭包不是 async，无法使用 .await）
            match fetch_from_gitlab(email).await {
                Ok(result) => Ok(result),
                Err(_) => {
                    eprintln!("[avatar] GitLab 获取失败，降级到 Gravatar");
                    fetch_from_gravatar(email).await
                }
            }
        }
        RemoteSource::Gravatar => {
            // Gravatar 源
            fetch_from_gravatar(email).await
        }
    };

    // 处理获取结果
    match fetch_result {
        Ok(Some((image_data, format, is_identicon))) => {
            // 获取成功，保存图片到磁盘
            let avatars_dir = get_avatars_dir();
            if !avatars_dir.exists() {
                fs::create_dir_all(&avatars_dir)
                    .map_err(|e| format!("创建头像目录失败: {}", e))?;
            }
            // 构造文件名：{email_md5}.{format}
            let filename = format!("{}.{}", email_md5, format);
            let file_path = avatars_dir.join(&filename);
            // 写入图片数据
            let mut file = fs::File::create(&file_path)
                .map_err(|e| format!("创建头像文件失败: {}", e))?;
            file.write_all(&image_data)
                .map_err(|e| format!("写入头像文件失败: {}", e))?;
            // 更新缓存索引
            let entry = AvatarCacheEntry {
                image: filename,
                timestamp: chrono::Utc::now().timestamp_millis(),
                identicon: is_identicon,
            };
            cache.insert(email.to_string(), entry);
            // 保存缓存索引
            if let Err(e) = save_cache_index(&cache) {
                eprintln!("[avatar] 保存缓存索引失败: {}（不影响头像返回）", e);
            }
            // 返回文件路径
            Ok(Some(file_path.to_string_lossy().to_string()))
        }
        Ok(None) => {
            // 获取失败（如 404），返回 None
            Ok(None)
        }
        Err(e) => {
            // 网络错误
            eprintln!("[avatar] 获取头像失败: {}", e);
            Ok(None)
        }
    }
}

/**
 * 清除所有头像缓存
 *
 * 删除 ~/.gittimeprism/avatars/ 目录下的所有头像文件和缓存索引。
 * 用户在设置中"清除头像缓存"时调用。
 *
 * 返回值：
 * - Ok(()) - 清除成功
 * - Err(String) - 失败
 */
pub fn clear_avatar_cache() -> Result<(), String> {
    let avatars_dir = get_avatars_dir();
    if avatars_dir.exists() {
        fs::remove_dir_all(&avatars_dir)
            .map_err(|e| format!("删除头像目录失败: {}", e))?;
        // 重新创建空目录
        fs::create_dir_all(&avatars_dir)
            .map_err(|e| format!("重建头像目录失败: {}", e))?;
    }
    Ok(())
}

// 静默未使用变量警告（author 参数保留用于未来 GitHub 用户名推导）
#[allow(dead_code)]
fn _silence_unused_author_warning(_author: &str) {}
