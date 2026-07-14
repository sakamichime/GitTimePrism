/*
 * Git LFS（Large File Storage）管理模块
 *
 * 此模块负责 Git LFS 的查询与管理工作，包括：
 * 1. 初始化 LFS（git lfs install）
 * 2. 添加/移除跟踪规则（git lfs track / untrack）
 * 3. 查询跟踪的文件类型（解析 .gitattributes）
 * 4. 查询文件锁（git lfs locks --json）
 * 5. 拉取/推送 LFS 对象（git lfs pull / push）
 *
 * Git LFS 是 Git 的扩展，用于管理大文件（如图片、视频、二进制文件）。
 * 它将大文件的实际内容存储在单独的 LFS 服务器上，而在 Git 仓库中只保存指针文件，
 * 从而避免仓库体积膨胀。
 */

use super::commands::{run_git, GitError};
use std::fs;
use std::path::Path;

/**
 * LFS 跟踪规则
 *
 * 表示 .gitattributes 中的一条 LFS 跟踪规则。
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LfsPattern {
    /// 跟踪规则的文件模式（如 "*.psd"、"*.zip"）
    pub pattern: String,
    /// 此模式对应的文件是否已被锁定（通过 git lfs locks 查询）
    pub is_locked: bool,
}

/**
 * LFS 文件锁信息
 *
 * 表示一个被 LFS 锁定的文件。
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LfsLock {
    /// 被锁定的文件路径（相对于仓库根目录）
    pub path: String,
    /// 锁的唯一 ID
    pub id: String,
    /// 锁定此文件的用户名
    pub owner: String,
    /// 锁定时间（ISO 8601 格式字符串，如 "2024-01-15T08:30:00Z"）
    pub locked_at: String,
}

/**
 * 初始化 LFS
 *
 * 执行 `git lfs install` 命令。
 * 此命令会在仓库中安装 LFS 钩子，配置必要的过滤器，
 * 使仓库能够正确处理 LFS 跟踪的文件。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(()) - 安装成功
 * - Err(GitError) - 安装失败（可能 LFS 未安装）
 */
pub fn lfs_install(repo_path: &str) -> Result<(), GitError> {
    let _output = run_git(repo_path, &["lfs", "install"])?;
    Ok(())
}

/**
 * 添加 LFS 跟踪规则
 *
 * 执行 `git lfs track {pattern}` 命令。
 * 此命令会将指定的文件模式添加到 .gitattributes 文件中，
 * 使 LFS 跟踪匹配此模式的所有文件。
 *
 * 常见模式示例：
 * - "*.psd"：跟踪所有 Photoshop 文件
 * - "*.zip"：跟踪所有 zip 压缩文件
 * - "assets/" 通配符：跟踪 assets 目录下的所有文件
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - pattern: 要跟踪的文件模式（如 "*.psd"）
 *
 * 返回值：
 * - Ok(()) - 添加成功
 * - Err(GitError) - 添加失败
 */
pub fn lfs_track(repo_path: &str, pattern: &str) -> Result<(), GitError> {
    let _output = run_git(repo_path, &["lfs", "track", pattern])?;
    Ok(())
}

/**
 * 移除 LFS 跟踪规则
 *
 * 执行 `git lfs untrack {pattern}` 命令。
 * 此命令会从 .gitattributes 文件中移除指定的文件模式，
 * 使 LFS 不再跟踪匹配此模式的文件。
 *
 * 注意：已存储在 LFS 中的文件不会被转换回普通 Git 对象。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - pattern: 要移除跟踪的文件模式（如 "*.psd"）
 *
 * 返回值：
 * - Ok(()) - 移除成功
 * - Err(GitError) - 移除失败
 */
pub fn lfs_untrack(repo_path: &str, pattern: &str) -> Result<(), GitError> {
    let _output = run_git(repo_path, &["lfs", "untrack", pattern])?;
    Ok(())
}

/**
 * 获取 LFS 跟踪的文件类型列表
 *
 * 解析 `.gitattributes` 文件，提取所有 LFS 跟踪规则。
 * .gitattributes 中 LFS 跟踪规则的格式为：
 *   {pattern} filter=lfs diff=lfs merge=lfs -text
 *
 * 同时查询当前锁定的文件列表，标记哪些模式的文件已被锁定。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(Vec<LfsPattern>) - 查询成功，返回跟踪规则列表
 * - Err(GitError) - 查询失败
 */
pub fn lfs_list(repo_path: &str) -> Result<Vec<LfsPattern>, GitError> {
    // 解析 .gitattributes 文件，提取 LFS 跟踪规则
    let patterns = parse_gitattributes_for_lfs(repo_path)?;

    // 查询当前锁定的文件列表（失败时不影响 pattern 列表的返回）
    let locked_paths = lfs_locks(repo_path)
        .unwrap_or_default()
        .into_iter()
        .map(|lock| lock.path)
        .collect::<Vec<_>>();

    // 标记每个 pattern 是否有被锁定的文件
    let result = patterns
        .into_iter()
        .map(|pattern| {
            // 简单判断：如果任何锁定文件的路径匹配此 pattern 的扩展名，则标记为已锁定
            // 这是个简化判断，完整的 glob 匹配需要额外依赖
            let is_locked = locked_paths.iter().any(|path| {
                // 提取 pattern 的扩展名（如 "*.psd" → ".psd"）
                if let Some(ext) = pattern.strip_prefix('*') {
                    path.ends_with(ext)
                } else {
                    path == &pattern
                }
            });
            LfsPattern { pattern, is_locked }
        })
        .collect();

    Ok(result)
}

/**
 * 获取 LFS 文件锁列表
 *
 * 执行 `git lfs locks --json` 命令，返回所有文件锁的列表。
 * JSON 输出格式：
 * ```json
 * [
 *   {"id": "lock-1", "path": "assets/big.psd", "owner": {"name": "alice"}, "locked_at": "2024-01-15T08:30:00Z"}
 * ]
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(Vec<LfsLock>) - 查询成功，返回文件锁列表
 * - Err(GitError) - 查询失败
 */
pub fn lfs_locks(repo_path: &str) -> Result<Vec<LfsLock>, GitError> {
    let output = run_git(repo_path, &["lfs", "locks", "--json"])?;

    // 如果输出为空，返回空列表
    if output.stdout.trim().is_empty() {
        return Ok(Vec::new());
    }

    // 解析 JSON 输出
    // git lfs locks --json 的输出是一个数组，每个元素包含 id/path/owner/locked_at
    parse_lfs_locks_json(&output.stdout)
}

/**
 * 拉取 LFS 对象
 *
 * 执行 `git lfs pull` 命令。
 * 此命令会从 LFS 服务器下载当前检出的提交所需的 LFS 对象，
 * 替换工作区中的指针文件为实际文件内容。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(()) - 拉取成功
 * - Err(GitError) - 拉取失败
 */
pub fn lfs_pull(repo_path: &str) -> Result<(), GitError> {
    let _output = run_git(repo_path, &["lfs", "pull"])?;
    Ok(())
}

/**
 * 推送 LFS 对象
 *
 * 执行 `git lfs push --all origin` 命令。
 * 此命令会将本地所有 LFS 对象推送到远程 LFS 服务器（origin）。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(()) - 推送成功
 * - Err(GitError) - 推送失败
 */
pub fn lfs_push(repo_path: &str) -> Result<(), GitError> {
    let _output = run_git(repo_path, &["lfs", "push", "--all", "origin"])?;
    Ok(())
}

/**
 * 解析 `.gitattributes` 文件，提取 LFS 跟踪规则
 *
 * .gitattributes 中 LFS 跟踪规则的格式为：
 *   {pattern} filter=lfs diff=lfs merge=lfs -text
 *
 * 我们只需要提取 pattern 部分（即每行的第一个字段），
 * 并验证该行是否包含 "filter=lfs"（确认是 LFS 规则）。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(Vec<String>) - 解析成功，返回 pattern 列表（无 .gitattributes 文件时返回空 Vec）
 * - Err(GitError) - 读取文件失败
 */
fn parse_gitattributes_for_lfs(repo_path: &str) -> Result<Vec<String>, GitError> {
    let gitattributes_path = Path::new(repo_path).join(".gitattributes");

    // 如果 .gitattributes 文件不存在，返回空列表
    if !gitattributes_path.exists() {
        return Ok(Vec::new());
    }

    // 读取 .gitattributes 文件内容
    let content = fs::read_to_string(&gitattributes_path).map_err(|e| {
        GitError::Io(format!(
            "读取 .gitattributes 文件失败 {}: {}",
            gitattributes_path.display(),
            e
        ))
    })?;

    let mut patterns = Vec::new();

    // 逐行解析
    for line in content.lines() {
        let trimmed = line.trim();

        // 跳过空行和注释行
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // 检查是否是 LFS 跟踪规则（包含 "filter=lfs"）
        if !trimmed.contains("filter=lfs") {
            continue;
        }

        // 提取 pattern（第一个空白分隔的字段）
        // 行格式：{pattern} filter=lfs diff=lfs merge=lfs -text
        if let Some(first_space) = trimmed.find(char::is_whitespace) {
            let pattern = trimmed[..first_space].trim().to_string();
            if !pattern.is_empty() {
                patterns.push(pattern);
            }
        }
    }

    Ok(patterns)
}

/**
 * 解析 `git lfs locks --json` 命令的 JSON 输出
 *
 * JSON 输出格式：
 * ```json
 * [
 *   {
 *     "id": "lock-1",
 *     "path": "assets/big.psd",
 *     "owner": {"name": "alice"},
 *     "locked_at": "2024-01-15T08:30:00Z"
 *   }
 * ]
 * ```
 *
 * 参数：
 * - json_str: git lfs locks --json 命令的输出
 *
 * 返回值：
 * - Ok(Vec<LfsLock>) - 解析成功
 * - Err(GitError) - 解析失败
 */
fn parse_lfs_locks_json(json_str: &str) -> Result<Vec<LfsLock>, GitError> {
    // 使用 serde_json 解析 JSON
    // 定义一个辅助结构体来匹配 JSON 的字段（owner 是嵌套对象）
    #[derive(serde::Deserialize)]
    struct RawLock {
        id: String,
        path: String,
        owner: Option<RawOwner>,
        locked_at: Option<String>,
    }

    #[derive(serde::Deserialize)]
    struct RawOwner {
        name: Option<String>,
    }

    let raw_locks: Vec<RawLock> = serde_json::from_str(json_str).map_err(|e| {
        GitError::CommandFailed {
            exit_code: 0,
            message: format!("解析 LFS locks JSON 失败: {}", e),
        }
    })?;

    // 转换为 LfsLock 结构体
    let locks = raw_locks
        .into_iter()
        .map(|raw| LfsLock {
            path: raw.path,
            id: raw.id,
            owner: raw.owner.and_then(|o| o.name).unwrap_or_default(),
            locked_at: raw.locked_at.unwrap_or_default(),
        })
        .collect();

    Ok(locks)
}
