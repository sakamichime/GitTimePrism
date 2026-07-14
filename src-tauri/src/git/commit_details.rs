/*
 * Git 提交详情查询模块
 *
 * 此模块负责获取单个 Git 提交的完整详情，包括：
 * - 基础信息（hash、parents、作者、提交者、日期）
 * - GPG 签名信息（签名状态、签名者、密钥 ID）
 * - 提交消息正文（body）
 * - 文件变更列表（type + 新旧路径 + 行数统计）
 *
 * 与 gitgraph 项目对齐：
 * - 严格遵循 `dataSource.ts` 中 `getCommitDetails()` 的实现逻辑
 * - 使用统一的 GIT_LOG_SEPARATOR 分隔符
 * - 12 字段解析（含 GPG `%G? %GS %GK`）
 * - 调用 `get_diff_name_status + get_diff_num_stat` 生成 fileChanges
 *
 * format 字符串说明（使用统一分隔符）：
 *   %H § %P § %an § %ae § %at § %cn § %ce § %ct § %G? § %GS § %GK § %B
 * 字段含义：
 *   %H  - 完整提交哈希
 *   %P  - 所有父提交的哈希（空格分隔）
 *   %an - 作者名字（不受 mailmap 影响）
 *   %ae - 作者邮箱
 *   %at - 作者日期（Unix 时间戳）
 *   %cn - 提交者名字
 *   %ce - 提交者邮箱
 *   %ct - 提交日期（Unix 时间戳）
 *   %G? - GPG 签名状态（G/U/X/Y/R/E/B/N/空）
 *   %GS - GPG 签名者
 *   %GK - GPG 密钥 ID
 *   %B  - 提交消息正文（含标题和正文）
 *
 * 注意：当 useMailmap=true 时，%an/%ae/%cn/%ce 应替换为 %aN/%aE/%cN/%cE
 */

use super::commands::{run_git, GitError, GIT_LOG_SEPARATOR};
use super::diff::FileChange;

/**
 * GPG 签名状态枚举
 *
 * 对应 gitgraph 项目 types.ts 中的 `GitSignatureStatus` 枚举。
 * 表示 Git 提交的 GPG 签名验证结果。
 *
 * 状态码含义（来自 `git log --format=%G?` 文档）：
 * - G: 签名良好且有效
 * - U: 签名良好但有效性未知
 * - X: 签名良好但已过期
 * - Y: 签名良好但密钥已过期
 * - R: 签名良好但密钥已被吊销
 * - E: 无法检查签名（例如缺少公钥）
 * - B: 签名错误
 * - N: 没有签名
 *
 * 序列化/反序列化时使用单字符字符串（与前端 git-types.ts 的 GitSignatureStatus 枚举值匹配）：
 * - GoodAndValid -> "G"
 * - GoodWithUnknownValidity -> "U"
 * - GoodButExpired -> "X"
 * - GoodButMadeByExpiredKey -> "Y"
 * - GoodButMadeByRevokedKey -> "R"
 * - CannotBeChecked -> "E"
 * - Bad -> "B"
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, PartialEq, Eq)]
pub enum SignatureStatus {
    /// G - 签名良好且有效
    #[serde(rename = "G")]
    GoodAndValid,
    /// U - 签名良好但有效性未知
    #[serde(rename = "U")]
    GoodWithUnknownValidity,
    /// X - 签名良好但已过期
    #[serde(rename = "X")]
    GoodButExpired,
    /// Y - 签名良好但密钥已过期
    #[serde(rename = "Y")]
    GoodButMadeByExpiredKey,
    /// R - 签名良好但密钥已被吊销
    #[serde(rename = "R")]
    GoodButMadeByRevokedKey,
    /// E - 无法检查签名（例如缺少公钥）
    #[serde(rename = "E")]
    CannotBeChecked,
    /// B - 签名错误
    #[serde(rename = "B")]
    Bad,
}

/**
 * GPG 签名信息
 *
 * 对应 gitgraph 项目 types.ts 中的 `GitSignature` 接口。
 * 包含签名状态、签名者和密钥 ID。
 *
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitSignature {
    /// GPG 密钥 ID（来自 %GK）
    pub key: String,
    /// 签名者信息（来自 %GS，通常是 "Name <email>"）
    pub signer: String,
    /// 签名状态
    pub status: SignatureStatus,
}

/**
 * 单个 Git 提交的完整详情
 *
 * 对应 gitgraph 项目 types.ts 中的 `GitCommitDetails` 接口。
 * 包含提交的基础信息、签名信息和文件变更列表。
 *
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）：
 * - author_email -> authorEmail
 * - author_date -> authorDate
 * - committer_email -> committerEmail
 * - committer_date -> committerDate
 * - file_changes -> fileChanges
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    /// 提交的完整哈希值（40 位十六进制）
    pub hash: String,

    /// 父提交的哈希列表
    /// 普通提交有 1 个父提交，合并提交有 2 个或更多
    pub parents: Vec<String>,

    /// 作者名字
    pub author: String,

    /// 作者邮箱
    pub author_email: String,

    /// 作者日期（Unix 时间戳，单位：秒）
    pub author_date: i64,

    /// 提交者名字
    pub committer: String,

    /// 提交者邮箱
    pub committer_email: String,

    /// 提交日期（Unix 时间戳，单位：秒）
    pub committer_date: i64,

    /// GPG 签名信息
    /// None = 此提交没有签名，或签名状态不在已知列表中
    /// Some(signature) = 此提交有签名，包含签名详情
    pub signature: Option<CommitSignature>,

    /// 提交消息正文（含标题和正文，已去除尾部的空行）
    pub body: String,

    /// 文件变更列表
    /// 每个文件变更包含类型、新旧路径和行数统计
    pub file_changes: Vec<FileChange>,
}

/**
 * 获取单个提交的完整详情
 *
 * 此函数对应 gitgraph 项目中 `DataSource.getCommitDetails()` 的核心逻辑。
 *
 * 算法步骤：
 * 1. 根据 has_parents 决定 from_commit（有父提交时为 commit_hash + "^"，否则为空）
 * 2. 调用 get_commit_details_base 获取提交基础信息（12 字段）
 * 3. 调用 get_diff_name_status_internal 获取文件变更类型和路径
 * 4. 调用 get_diff_num_stat_internal 获取文件变更行数统计
 * 5. 调用 generate_file_changes 合并两路结果，生成完整的 file_changes 列表
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - commit_hash: 要查询详情的 commit hash
 * - has_parents: 此 commit 是否有父提交
 *                true = 普通提交，from_commit = commit_hash + "^"
 *                false = 初始提交，from_commit = commit_hash（使用 diff-tree 查看初始提交）
 * - use_mailmap: 是否启用 mailmap（%aN/%aE/%cN/%cE 替换 %an/%ae/%cn/%ce）
 *
 * 返回值：
 * - Ok(CommitDetails) - 查询成功
 * - Err(GitError) - 查询失败
 */
pub fn get_commit_details(
    repo_path: &str,
    commit_hash: &str,
    has_parents: bool,
    use_mailmap: bool,
) -> Result<CommitDetails, GitError> {
    // 步骤 1：根据 has_parents 决定 from_commit
    // 对应 gitgraph: const fromCommit = hasParents ? commitHash + '^' : '';
    let from_commit = if has_parents {
        format!("{}^", commit_hash)
    } else {
        // 初始提交：使用 diff-tree 查看 commit 自身引入的变更
        // 我们的 diff.rs 在 from_hash == to_hash 时使用 diff-tree
        commit_hash.to_string()
    };

    // 步骤 2：获取提交基础信息
    let mut details = get_commit_details_base(repo_path, commit_hash, use_mailmap)?;

    // 步骤 3：获取文件变更类型和路径
    let name_status_records = super::diff::get_diff_name_status_internal(
        repo_path,
        &from_commit,
        commit_hash,
    )?;

    // 步骤 4：获取文件变更行数统计
    let num_stat_records = super::diff::get_diff_num_stat_internal(
        repo_path,
        &from_commit,
        commit_hash,
    )?;

    // 步骤 5：合并两路结果，生成 file_changes
    details.file_changes = super::diff::generate_file_changes(
        name_status_records,
        num_stat_records,
        None,
    );

    Ok(details)
}

/**
 * 获取提交的基础信息（不含文件变更）
 *
 * 此函数对应 gitgraph 项目中 `DataSource.getCommitDetailsBase()` 的实现。
 *
 * 执行 `git -c log.showSignature=false show --quiet --format=... {hash}` 命令，
 * 解析 12 字段输出，返回 CommitDetails（file_changes 为空）。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - commit_hash: 要查询的 commit hash
 * - use_mailmap: 是否启用 mailmap
 *
 * 返回值：
 * - Ok(CommitDetails) - 查询成功（file_changes 字段为空 Vec）
 * - Err(GitError) - 查询失败
 */
fn get_commit_details_base(
    repo_path: &str,
    commit_hash: &str,
    use_mailmap: bool,
) -> Result<CommitDetails, GitError> {
    // 构建 format 字符串
    // 12 个字段，使用 GIT_LOG_SEPARATOR 分隔：
    //   %H  = 完整提交哈希
    //   %P  = 所有父提交的哈希（空格分隔）
    //   作者信息：根据 use_mailmap 选择 %aN/%aE 或 %an/%ae
    //   %at = 作者日期（Unix 时间戳）
    //   提交者信息：根据 use_mailmap 选择 %cN/%cE 或 %cn/%ce
    //   %ct = 提交日期（Unix 时间戳）
    //   %G? = GPG 签名状态
    //   %GS = GPG 签名者
    //   %GK = GPG 密钥 ID
    //   %B  = 提交消息正文（含标题和正文）
    let author_name = if use_mailmap { "%aN" } else { "%an" };
    let author_email = if use_mailmap { "%aE" } else { "%ae" };
    let committer_name = if use_mailmap { "%cN" } else { "%cn" };
    let committer_email = if use_mailmap { "%cE" } else { "%ce" };

    let format_str = [
        "%H", "%P",
        author_name, author_email, "%at",
        committer_name, committer_email, "%ct",
        "%G?", "%GS", "%GK",
        "%B",
    ].join(GIT_LOG_SEPARATOR);

    // 构建命令参数
    // -c log.showSignature=false: 避免 GPG 签名验证输出干扰 %G? 解析
    // show --quiet: 只显示提交元数据，不显示 diff
    // --format: 指定输出格式
    let args: Vec<String> = vec![
        "-c".to_string(),
        "log.showSignature=false".to_string(),
        "show".to_string(),
        "--quiet".to_string(),
        format!("--format={}", format_str),
        commit_hash.to_string(),
    ];

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_git(repo_path, &args_refs)?;

    // 解析输出
    parse_commit_details_output(&output.stdout)
        .ok_or_else(|| GitError::CommandFailed {
            exit_code: 0,
            message: format!("无法解析提交详情输出: {}", commit_hash),
        })
}

/**
 * 解析 `git show --quiet --format=...` 的输出
 *
 * 输出格式：单行（%B 可能包含多行，但 GIT_LOG_SEPARATOR 不会出现在 %B 中）
 * 字段顺序：hash § parents § author § author_email § author_date
 *          § committer § committer_email § committer_date
 *          § signature_status § signer § key § body
 *
 * 解析规则：
 * 1. 用 GIT_LOG_SEPARATOR 分割为 12 个字段
 * 2. 解析 parents（空格分隔）
 * 3. 解析日期（Unix 时间戳）
 * 4. 解析签名状态（仅当 status 在 G/U/X/Y/R/E/B 中时才有签名）
 * 5. 解析 body（去除尾部空行）
 *
 * 参数：
 * - output: git show 命令的原始输出
 *
 * 返回值：
 * - Some(CommitDetails) - 解析成功（file_changes 字段为空 Vec）
 * - None - 格式不正确
 */
fn parse_commit_details_output(output: &str) -> Option<CommitDetails> {
    // 去除首尾空白
    let output = output.trim();

    // 使用 GIT_LOG_SEPARATOR 分割为 12 个字段
    // 注意：splitn(12, ...) 确保第 12 个字段（body）不被进一步分割
    let parts: Vec<&str> = output.splitn(12, GIT_LOG_SEPARATOR).collect();
    if parts.len() != 12 {
        return None;
    }

    let hash = parts[0].trim().to_string();
    let parents_str = parts[1].trim();
    let author = parts[2].trim().to_string();
    let author_email = parts[3].trim().to_string();
    let author_date: i64 = parts[4].trim().parse().unwrap_or(0);
    let committer = parts[5].trim().to_string();
    let committer_email = parts[6].trim().to_string();
    let committer_date: i64 = parts[7].trim().parse().unwrap_or(0);
    let signature_status_str = parts[8].trim();
    let signer = parts[9].trim().to_string();
    let key = parts[10].trim().to_string();
    let body_raw = parts[11];

    // 解析 parents（空格分隔）
    let parents: Vec<String> = if parents_str.is_empty() {
        Vec::new()
    } else {
        parents_str
            .split_whitespace()
            .map(|s| s.to_string())
            .collect()
    };

    // 解析签名状态
    // 对应 gitgraph: signature: ['G', 'U', 'X', 'Y', 'R', 'E', 'B'].includes(commitInfo[8]) ? {...} : null
    let signature = parse_signature_status(signature_status_str).map(|status| {
        CommitSignature {
            key,
            signer,
            status,
        }
    });

    // 解析 body（去除尾部空行）
    // 对应 gitgraph: body: removeTrailingBlankLines(commitInfo.slice(11).join(GIT_LOG_SEPARATOR).split(EOL_REGEX)).join('\n')
    let body = remove_trailing_blank_lines(body_raw);

    Some(CommitDetails {
        hash,
        parents,
        author,
        author_email,
        author_date,
        committer,
        committer_email,
        committer_date,
        signature,
        body,
        file_changes: Vec::new(),
    })
}

/**
 * 解析 GPG 签名状态字符串为 SignatureStatus 枚举
 *
 * 对应 gitgraph: ['G', 'U', 'X', 'Y', 'R', 'E', 'B'].includes(commitInfo[8])
 *
 * 参数：
 * - s: 签名状态字符串（单个字符，如 "G"、"U" 等）
 *
 * 返回值：
 * - Some(SignatureStatus) - 识别的签名状态
 * - None - 不在已知列表中（包括空字符串和 "N"）
 */
fn parse_signature_status(s: &str) -> Option<SignatureStatus> {
    // 取第一个字符作为状态码
    let status_char = s.chars().next()?;
    match status_char {
        'G' => Some(SignatureStatus::GoodAndValid),
        'U' => Some(SignatureStatus::GoodWithUnknownValidity),
        'X' => Some(SignatureStatus::GoodButExpired),
        'Y' => Some(SignatureStatus::GoodButMadeByExpiredKey),
        'R' => Some(SignatureStatus::GoodButMadeByRevokedKey),
        'E' => Some(SignatureStatus::CannotBeChecked),
        'B' => Some(SignatureStatus::Bad),
        // 其他字符（包括 'N' 和空）都不视为有效签名
        _ => None,
    }
}

/**
 * 去除字符串尾部的空行
 *
 * 对应 gitgraph 项目中的 `removeTrailingBlankLines()` 函数。
 * 将字符串按行分割，从后往前移除空行，然后用换行符重新连接。
 *
 * 参数：
 * - s: 原始字符串
 *
 * 返回值：
 * - String: 去除尾部空行后的字符串
 */
fn remove_trailing_blank_lines(s: &str) -> String {
    // 按行分割（支持 \r\n、\r、\n 三种换行符）
    let mut lines: Vec<&str> = s.split('\n').collect();

    // 从后往前移除空行（trim 后为空的行）
    while let Some(last) = lines.last() {
        if last.trim().is_empty() {
            lines.pop();
        } else {
            break;
        }
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_signature_status() {
        assert_eq!(
            parse_signature_status("G"),
            Some(SignatureStatus::GoodAndValid)
        );
        assert_eq!(
            parse_signature_status("U"),
            Some(SignatureStatus::GoodWithUnknownValidity)
        );
        assert_eq!(
            parse_signature_status("B"),
            Some(SignatureStatus::Bad)
        );
        // 未知状态码应返回 None
        assert_eq!(parse_signature_status("N"), None);
        assert_eq!(parse_signature_status(""), None);
        assert_eq!(parse_signature_status("Z"), None);
    }

    #[test]
    fn test_parse_commit_details_output_basic() {
        let separator = GIT_LOG_SEPARATOR;
        // 模拟 git show --quiet --format=... 的输出
        let output = format!(
            "abc123{}def456{}张三{}zhangsan@example.com{}1700000000{}李四{}lisi@example.com{}1700000001{}G{}Name <email>{}KEY123{}修复bug\n\n详细说明\n",
            separator, separator, separator, separator, separator, separator, separator, separator, separator, separator, separator
        );

        let details = parse_commit_details_output(&output).expect("应该解析成功");

        assert_eq!(details.hash, "abc123");
        assert_eq!(details.parents, vec!["def456"]);
        assert_eq!(details.author, "张三");
        assert_eq!(details.author_email, "zhangsan@example.com");
        assert_eq!(details.author_date, 1700000000);
        assert_eq!(details.committer, "李四");
        assert_eq!(details.committer_email, "lisi@example.com");
        assert_eq!(details.committer_date, 1700000001);

        // 验证签名信息
        let sig = details.signature.expect("应该有签名");
        assert_eq!(sig.status, SignatureStatus::GoodAndValid);
        assert_eq!(sig.signer, "Name <email>");
        assert_eq!(sig.key, "KEY123");

        // 验证 body（去除尾部空行）
        assert_eq!(details.body, "修复bug\n\n详细说明");
    }

    #[test]
    fn test_parse_commit_details_output_no_signature() {
        let separator = GIT_LOG_SEPARATOR;
        // 没有签名的提交（%G? 为空）
        let output = format!(
            "abc123{}def456{}张三{}zhangsan@example.com{}1700000000{}李四{}lisi@example.com{}1700000001{}{}{}{}修复bug\n",
            separator, separator, separator, separator, separator, separator, separator, separator, separator, separator, separator
        );

        let details = parse_commit_details_output(&output).expect("应该解析成功");

        assert!(details.signature.is_none(), "没有签名时 signature 应为 None");
    }

    #[test]
    fn test_parse_commit_details_output_empty_parents() {
        let separator = GIT_LOG_SEPARATOR;
        // 初始提交（没有 parents）
        let output = format!(
            "abc123{}{}张三{}zhangsan@example.com{}1700000000{}李四{}lisi@example.com{}1700000001{}{}{}{}初始提交\n",
            separator, separator, separator, separator, separator, separator, separator, separator, separator, separator, separator
        );

        let details = parse_commit_details_output(&output).expect("应该解析成功");

        assert!(details.parents.is_empty(), "初始提交应该没有 parents");
    }

    #[test]
    fn test_remove_trailing_blank_lines() {
        // 去除尾部空行
        assert_eq!(remove_trailing_blank_lines("hello\n\n\n"), "hello");
        assert_eq!(remove_trailing_blank_lines("hello\nworld\n\n"), "hello\nworld");
        // 没有尾部空行时保持不变
        assert_eq!(remove_trailing_blank_lines("hello\nworld"), "hello\nworld");
        // 空字符串
        assert_eq!(remove_trailing_blank_lines(""), "");
        assert_eq!(remove_trailing_blank_lines("\n\n\n"), "");
    }
}
