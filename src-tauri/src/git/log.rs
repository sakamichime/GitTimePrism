/*
 * Git 提交历史查询模块
 *
 * 此模块负责获取 Git 仓库的提交历史记录。
 * 通过执行 `git log --pretty=format:...` 命令并解析其输出，
 * 构建结构化的提交记录列表。
 *
 * 与 gitgraph 项目对齐：
 * - 使用统一的 GIT_LOG_SEPARATOR 作为字段分隔符
 * - 支持 commitOrdering（--date-order / --author-date-order / --topo-order）
 * - 支持 --first-parent（只跟随第一个 parent）
 * - 支持 --branches / --tags / --reflog / --remotes / --glob=refs/remotes/{remote} 选项
 * - 支持 useMailmap（%aN/%aE 替换 %an/%ae）
 * - 支持 maxCommits + 1 探测 moreCommitsAvailable
 *
 * format 字符串说明（使用统一分隔符）：
 *   %H § %P § %aN|%an § %aE|%ae § %at|%ct § %s
 * 字段含义：
 *   %H  - 完整提交哈希（40 位十六进制）
 *   %P  - 所有父提交的哈希（空格分隔）
 *   %aN - 作者名字（受 mailmap 影响，仅当 useMailmap=true 时使用）
 *   %an - 作者名字（不受 mailmap 影响，仅当 useMailmap=false 时使用）
 *   %aE - 作者邮箱（受 mailmap 影响）
 *   %ae - 作者邮箱（不受 mailmap 影响）
 *   %at - 作者日期（Unix 时间戳）
 *   %ct - 提交日期（Unix 时间戳）
 *   %s  - 提交消息第一行
 */

use super::commands::{run_git, GitError, GIT_LOG_SEPARATOR};

/**
 * 提交排序方式枚举
 *
 * 对应 git log 的 --date-order / --author-date-order / --topo-order 选项。
 * 控制提交记录在输出中的排列顺序。
 *
 * 序列化/反序列化时使用小写字符串（与前端 git-types.ts 的 CommitOrdering 枚举值匹配）：
 * - Default -> "default"（前端可不传此值，表示使用默认排序）
 * - Date -> "date"（对应前端 CommitOrdering.Date = 'date'）
 * - AuthorDate -> "author-date"（对应前端 CommitOrdering.AuthorDate = 'author-date'）
 * - Topo -> "topo"（对应前端 CommitOrdering.Topological = 'topo'）
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum CommitOrdering {
    /// 默认排序（不添加任何 --xxx-order 选项）
    /// git 会根据具体情况选择排序方式
    #[serde(rename = "default")]
    Default,
    /// --date-order：按提交日期排序
    /// 显示所有提交的提交日期（%ct），按时间倒序排列
    /// 在有多个分支时，会按提交日期交错显示
    #[serde(rename = "date")]
    Date,
    /// --author-date-order：按作者日期排序
    /// 显示所有提交的作者日期（%at），按时间倒序排列
    /// 与 Date 的区别：Date 用 commit date，AuthorDate 用 author date
    #[serde(rename = "author-date")]
    AuthorDate,
    /// --topo-order：按拓扑顺序排序
    /// 不显示任何子提交先于父提交的情况
    /// 保证父提交一定在子提交之前（或之后，取决于方向）
    #[serde(rename = "topo")]
    Topo,
}

/**
 * 默认的作者日期类型
 *
 * 控制使用 %at（作者日期）还是 %ct（提交日期）。
 * - Author: 使用 %at（作者日期，即原作者创建提交的时间）
 * - Commit: 使用 %ct（提交日期，即当前仓库应用此提交的时间）
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum DateType {
    /// 使用作者日期（%at）
    Author,
    /// 使用提交日期（%ct）
    Commit,
}

/**
 * 单个提交记录的详细信息
 *
 * 描述一个 Git 提交的完整信息，包括哈希、父提交、作者、日期和消息。
 * 通过 serde 序列化为 JSON 后传递给前端。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct CommitInfo {
    /// 提交的完整哈希值（40 位十六进制字符串）
    /// 例如 "a1b2c3d4e5f6789012345678901234567890abcd"
    pub hash: String,

    /// 提交的短哈希值（通常是前 7 位十六进制）
    /// 例如 "a1b2c3d"
    pub short_hash: String,

    /// 提交作者的名字
    pub author: String,

    /// 提交作者的邮箱地址
    pub email: String,

    /// 提交的日期时间（ISO 8601 格式）
    /// 例如 "2024-01-15T10:30:00+08:00"
    pub date: String,

    /// 提交消息的第一行（标题）
    pub message: String,
}

/**
 * 原始提交记录（用于内部解析，包含 parents 字段）
 *
 * 与 CommitInfo 的区别：
 * - 包含 parents 字段（父提交哈希列表）
 * - date 是 Unix 时间戳（i64）而非 ISO 字符串
 * - 不包含 short_hash（需要单独计算）
 *
 * 此结构体主要用于 graph.rs 中的节点图组装。
 */
#[derive(Debug, Clone)]
pub struct RawCommit {
    /// 提交的完整哈希值
    pub hash: String,
    /// 父提交的哈希列表（空格分隔后解析）
    /// 普通提交有 1 个父提交，合并提交有 2 个或更多
    pub parents: Vec<String>,
    /// 作者名字
    pub author: String,
    /// 作者邮箱
    pub email: String,
    /// 提交日期（Unix 时间戳，单位：秒）
    pub date: i64,
    /// 提交消息第一行
    pub message: String,
}

/**
 * 提交历史列表数据
 *
 * 包含提交记录列表和总数统计。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct CommitList {
    /// 提交记录列表（按时间倒序排列，最新的在前）
    pub commits: Vec<CommitInfo>,
    /// 本次查询到的提交总数
    pub total_count: u32,
}

/**
 * get_log_enhanced 的查询参数
 *
 * 封装了所有可选的查询条件，便于函数传参和未来扩展。
 */
#[derive(Debug, Clone)]
pub struct LogQueryParams {
    /// 要查询的分支列表
    /// - None: 显示所有分支的提交（使用 --branches）
    /// - Some(vec): 只显示指定分支的提交
    pub branches: Option<Vec<String>>,

    /// 最大返回的提交数量
    /// 函数内部会 +1 来探测 moreCommitsAvailable
    pub max_commits: u32,

    /// 是否包含标签引用的提交（--tags）
    pub include_tags: bool,

    /// 是否包含远程分支的提交（--remotes 或 --glob）
    pub include_remotes: bool,

    /// 是否包含 reflog 中提到的提交（--reflog）
    pub include_reflogs: bool,

    /// 是否只跟随第一个 parent（--first-parent）
    pub only_first_parent: bool,

    /// 提交排序方式
    pub ordering: CommitOrdering,

    /// 已知的 remote 名称列表（用于 --glob 过滤）
    pub remotes: Vec<String>,

    /// 要隐藏的 remote 名称列表
    pub hide_remotes: Vec<String>,

    /// stash 的 base_hash 列表（用于确保 stash 引用的 commit 也被显示）
    pub stash_base_hashes: Vec<String>,

    /// 是否启用 mailmap（%aN/%aE 替换 %an/%ae）
    pub use_mailmap: bool,

    /// 日期类型（Author=作者日期 %at，Commit=提交日期 %ct）
    pub date_type: DateType,
}

/**
 * LogQueryParams 的默认实现
 *
 * 提供一组合理的默认值，便于调用方使用 ..Default::default() 语法。
 */
impl Default for LogQueryParams {
    fn default() -> Self {
        Self {
            branches: None,
            max_commits: 100,
            include_tags: false,
            include_remotes: false,
            include_reflogs: false,
            only_first_parent: false,
            ordering: CommitOrdering::Default,
            remotes: Vec::new(),
            hide_remotes: Vec::new(),
            stash_base_hashes: Vec::new(),
            use_mailmap: false,
            date_type: DateType::Author,
        }
    }
}

/**
 * 增强版提交历史查询的结果
 *
 * 包含原始提交列表和是否还有更多提交的标志。
 */
#[derive(Debug, Clone)]
pub struct EnhancedLogResult {
    /// 提交记录列表（已去除用于探测的 +1 记录）
    pub commits: Vec<RawCommit>,
    /// 是否还有更多提交可加载
    /// true = 实际查询到的提交数 == max_commits + 1，说明还有更多
    /// false = 实际查询到的提交数 <= max_commits，已全部加载
    pub more_commits_available: bool,
}

/**
 * 解析 git log 的单行输出为 CommitInfo 结构体
 *
 * 此函数保持向后兼容，使用旧的 |||SEP||| 分隔符。
 * 新代码应使用 parse_commit_line_unified。
 *
 * git log 的每行输出格式为（使用 |||SEP||| 作为字段分隔符）：
 * <完整哈希>|||SEP|||<短哈希>|||SEP|||<作者>|||SEP|||<邮箱>|||SEP|||<日期>|||SEP|||<消息>
 */
fn parse_commit_line(line: &str) -> Option<CommitInfo> {
    let parts: Vec<&str> = line.split("|||SEP|||").collect();

    if parts.len() != 6 {
        return None;
    }

    Some(CommitInfo {
        hash: parts[0].trim().to_string(),
        short_hash: parts[1].trim().to_string(),
        author: parts[2].trim().to_string(),
        email: parts[3].trim().to_string(),
        date: parts[4].trim().to_string(),
        message: parts[5].trim().to_string(),
    })
}

/**
 * 获取仓库的提交历史记录
 *
 * 此函数保持向后兼容，使用旧的 |||SEP||| 分隔符和简单的参数。
 * 新代码应使用 get_log_enhanced。
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - count: 要获取的提交数量（0 表示全部）
 *
 * 返回值：
 * - Ok(CommitList) - 查询成功
 * - Err(GitError) - 查询失败
 */
pub fn get_log(repo_path: &str, count: u32) -> Result<CommitList, GitError> {
    // 使用旧的 |||SEP||| 分隔符，保持向后兼容
    let format_str = "%H|||SEP|||%h|||SEP|||%an|||SEP|||%ae|||SEP|||%aI|||SEP|||%s";
    let full_format = format!("--pretty=format:{}", format_str);

    let full_args: Vec<String> = if count > 0 {
        vec![
            "log".to_string(),
            full_format,
            format!("-n{}", count),
        ]
    } else {
        vec!["log".to_string(), full_format]
    };

    let args_refs: Vec<&str> = full_args.iter().map(|s| s.as_str()).collect();
    let output = run_git(repo_path, &args_refs)?;

    let commits: Vec<CommitInfo> = output
        .stdout
        .lines()
        .filter_map(|line| parse_commit_line(line))
        .collect();

    let total_count = commits.len() as u32;

    Ok(CommitList {
        commits,
        total_count,
    })
}

/**
 * 获取单个文件的提交历史
 *
 * 此函数保持向后兼容，使用旧的 |||SEP||| 分隔符。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 */
pub fn get_file_history(repo_path: &str, file_path: &str) -> Result<Vec<CommitInfo>, GitError> {
    let format_str = "%H|||SEP|||%h|||SEP|||%an|||SEP|||%ae|||SEP|||%aI|||SEP|||%s";
    let full_format = format!("--pretty=format:{}", format_str);

    let full_args: Vec<String> = vec![
        "log".to_string(),
        "--follow".to_string(),
        full_format,
        "--".to_string(),
        file_path.to_string(),
    ];

    let args_refs: Vec<&str> = full_args.iter().map(|s| s.as_str()).collect();
    let output = run_git(repo_path, &args_refs)?;

    let commits: Vec<CommitInfo> = output
        .stdout
        .lines()
        .filter_map(|line| parse_commit_line(line))
        .collect();

    Ok(commits)
}

/**
 * 增强版提交历史查询
 *
 * 此函数对应 gitgraph 项目中 `DataSource.getLog()` 的核心逻辑，
 * 支持完整的查询参数：
 * - 分支过滤（指定分支或显示所有）
 * - 排序方式（date / author-date / topo）
 * - --first-parent（只跟随第一个 parent）
 * - --branches / --tags / --reflog / --remotes / --glob
 * - useMailmap（%aN/%aE 替换 %an/%ae）
 * - maxCommits + 1 探测 moreCommitsAvailable
 * - 包含 stash 的 base_hash，确保 stash 引用的 commit 也被显示
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - params: 查询参数（见 LogQueryParams 结构体）
 *
 * 返回值：
 * - Ok(EnhancedLogResult) - 查询成功
 * - Err(GitError) - 查询失败
 */
pub fn get_log_enhanced(
    repo_path: &str,
    params: &LogQueryParams,
) -> Result<EnhancedLogResult, GitError> {
    // 构建 format 字符串
    // 字段顺序：hash § parents § author § email § date § message
    // 根据 use_mailmap 选择 %aN/%aE 或 %an/%ae
    // 根据 date_type 选择 %at 或 %ct
    let author_placeholder = if params.use_mailmap { "%aN" } else { "%an" };
    let email_placeholder = if params.use_mailmap { "%aE" } else { "%ae" };
    let date_placeholder = match params.date_type {
        DateType::Author => "%at",
        DateType::Commit => "%ct",
    };

    let format_str = [
        "%H", "%P", author_placeholder, email_placeholder, date_placeholder, "%s",
    ]
    .join(GIT_LOG_SEPARATOR);

    // 构建命令参数列表
    // 使用 -c log.showSignature=false 避免 GPG 签名输出干扰解析
    let mut args: Vec<String> = Vec::new();

    // 添加 -c log.showSignature=false（避免签名验证输出干扰）
    args.push("-c".to_string());
    args.push("log.showSignature=false".to_string());

    // 添加 log 子命令
    args.push("log".to_string());

    // 添加 --max-count（实际是 max_commits + 1，用于探测是否还有更多提交）
    let max_count = params.max_commits.saturating_add(1);
    args.push(format!("--max-count={}", max_count));

    // 添加 --format
    args.push(format!("--format={}", format_str));

    // 添加排序选项
    match params.ordering {
        CommitOrdering::Default => {
            // 不添加任何 --xxx-order 选项
        }
        CommitOrdering::Date => {
            args.push("--date-order".to_string());
        }
        CommitOrdering::AuthorDate => {
            args.push("--author-date-order".to_string());
        }
        CommitOrdering::Topo => {
            args.push("--topo-order".to_string());
        }
    }

    // 添加 --first-parent
    if params.only_first_parent {
        args.push("--first-parent".to_string());
    }

    // 添加分支过滤
    if let Some(branches) = &params.branches {
        // 指定分支：直接添加分支名
        for branch in branches {
            args.push(branch.clone());
        }
    } else {
        // 显示所有分支
        args.push("--branches".to_string());

        // 包含标签
        if params.include_tags {
            args.push("--tags".to_string());
        }

        // 包含 reflog
        if params.include_reflogs {
            args.push("--reflog".to_string());
        }

        // 包含远程分支
        if params.include_remotes {
            if params.hide_remotes.is_empty() {
                // 没有隐藏的 remote，使用 --remotes 显示所有
                args.push("--remotes".to_string());
            } else {
                // 有隐藏的 remote，使用 --glob 分别添加要显示的 remote
                for remote in &params.remotes {
                    if !params.hide_remotes.contains(remote) {
                        args.push(format!("--glob=refs/remotes/{}", remote));
                    }
                }
            }
        }

        // 添加 stash 的 base_hash（确保 stash 引用的 commit 也被显示）
        // 去重处理：相同的 base_hash 只添加一次
        let mut seen_hashes = std::collections::HashSet::new();
        for base_hash in &params.stash_base_hashes {
            if seen_hashes.insert(base_hash.clone()) {
                args.push(base_hash.clone());
            }
        }

        // 添加 HEAD（确保当前分支的提交总是被包含）
        args.push("HEAD".to_string());
    }

    // 添加 -- 分隔符
    args.push("--".to_string());

    // 转换为 &str 引用
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    // 执行命令
    let output = run_git(repo_path, &args_refs)?;

    // 解析输出
    let commits = parse_enhanced_log_output(&output.stdout);

    // 探测是否还有更多提交
    // 如果实际返回的提交数 == max_commits + 1，说明还有更多
    let more_commits_available = commits.len() as u32 > params.max_commits;

    // 如果有更多，去除最后一个（用于探测的 +1 记录）
    let mut commits = commits;
    if more_commits_available {
        commits.pop();
    }

    Ok(EnhancedLogResult {
        commits,
        more_commits_available,
    })
}

/**
 * 解析增强版 git log 的输出
 *
 * 输出格式：每行一个提交，字段之间用 GIT_LOG_SEPARATOR 分隔
 * 字段顺序：hash § parents § author § email § date § message
 *
 * 参数：
 * - output: git log 命令的原始输出
 *
 * 返回值：
 * - Vec<RawCommit>: 解析后的提交列表
 */
fn parse_enhanced_log_output(output: &str) -> Vec<RawCommit> {
    let mut commits: Vec<RawCommit> = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // 使用 GIT_LOG_SEPARATOR 分割为 6 个字段
        let parts: Vec<&str> = line.split(GIT_LOG_SEPARATOR).collect();
        if parts.len() != 6 {
            // 字段数不正确，跳过此行
            continue;
        }

        let hash = parts[0].trim();
        let parents_str = parts[1].trim();
        let author = parts[2].trim();
        let email = parts[3].trim();
        let date_str = parts[4].trim();
        let message = parts[5].trim();

        // 解析 parents（空格分隔）
        let parents: Vec<String> = if parents_str.is_empty() {
            Vec::new()
        } else {
            parents_str
                .split_whitespace()
                .map(|s| s.to_string())
                .collect()
        };

        // 解析日期（Unix 时间戳）
        let date: i64 = date_str.parse().unwrap_or(0);

        commits.push(RawCommit {
            hash: hash.to_string(),
            parents,
            author: author.to_string(),
            email: email.to_string(),
            date,
            message: message.to_string(),
        });
    }

    commits
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_enhanced_log_output_basic() {
        let separator = GIT_LOG_SEPARATOR;
        let output = format!(
            "abc123{}def456{}张三{}zhangsan@example.com{}1700000000{}修复登录bug\n",
            separator, separator, separator, separator, separator
        );

        let commits = parse_enhanced_log_output(&output);

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].hash, "abc123");
        assert_eq!(commits[0].parents, vec!["def456"]);
        assert_eq!(commits[0].author, "张三");
        assert_eq!(commits[0].email, "zhangsan@example.com");
        assert_eq!(commits[0].date, 1700000000);
        assert_eq!(commits[0].message, "修复登录bug");
    }

    #[test]
    fn test_parse_enhanced_log_output_merge_commit() {
        // 测试 merge commit（多个 parents）
        let separator = GIT_LOG_SEPARATOR;
        let output = format!(
            "abc123{}def456 ghi789{}张三{}zhangsan@example.com{}1700000000{}合并分支\n",
            separator, separator, separator, separator, separator
        );

        let commits = parse_enhanced_log_output(&output);

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].parents, vec!["def456", "ghi789"]);
    }

    #[test]
    fn test_parse_enhanced_log_output_empty_parents() {
        // 测试初始提交（没有 parents）
        let separator = GIT_LOG_SEPARATOR;
        let output = format!(
            "abc123{}{}张三{}zhangsan@example.com{}1700000000{}初始提交\n",
            separator, separator, separator, separator, separator
        );

        let commits = parse_enhanced_log_output(&output);

        assert_eq!(commits.len(), 1);
        assert!(commits[0].parents.is_empty());
    }

    #[test]
    fn test_commit_ordering_default() {
        let params = LogQueryParams::default();
        assert_eq!(params.ordering, CommitOrdering::Default);
        assert_eq!(params.date_type, DateType::Author);
        assert!(!params.use_mailmap);
    }
}
