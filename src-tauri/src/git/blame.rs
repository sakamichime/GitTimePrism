/*
 * Git Blame 查询模块
 *
 * 此模块负责获取文件每行的提交溯源信息（git blame）。
 * 通过解析 `git blame --line-porcelain` 的输出，返回结构化的 BlameLine 列表。
 *
 * `git blame` 的作用：
 * 显示文件中每一行最后是被哪个提交修改的，包括提交者、日期、提交哈希等信息。
 * 常用于追踪代码变更的责任人（"这行代码是谁写的？"）。
 *
 * `--line-porcelain` 格式说明：
 * 对每一行都输出完整的提交信息（不省略连续相同 commit 的行）。
 * 每个条目由多行组成，格式如下：
 *   <40-char-hash> <orig-line> <final-line> [<group-size>]
 *   author <作者名字>
 *   author-mail <作者邮箱>
 *   author-time <Unix 时间戳>
 *   author-tz <时区>
 *   committer <提交者名字>
 *   committer-mail <提交者邮箱>
 *   committer-time <Unix 时间戳>
 *   committer-tz <时区>
 *   summary <提交消息第一行>
 *   filename <文件名>
 *   \t<行内容>
 *
 * 对于 boundary commit（文件历史最早可见的提交，即 blame 追踪的边界），
 * hash 前面会有 `^` 前缀：`^<hash> <orig-line> <final-line>`
 *
 * 此模块用于 Task 8.3 后端 Blame 功能。
 *
 * 依赖关系：
 * blame -> commands（使用 run_git 执行 git 命令）
 */

// 引入通用的 Git 命令执行器和错误类型
use super::commands::{run_git, GitError};

/**
 * 单行的 Blame 信息
 *
 * 表示文件中某一行的提交溯源信息。
 * 包含该行所属提交的哈希、作者、提交者、日期以及行内容。
 *
 * 此结构体通过 serde 序列化为 JSON 后传递给前端。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct BlameLine {
    /// 该行所属提交的完整哈希（40 位 SHA-1）
    pub commit_hash: String,
    /// 该行所属提交的短哈希（前 7 位，便于显示）
    pub short_hash: String,
    /// 作者名字（编写该行代码的人）
    pub author: String,
    /// 作者邮箱
    pub author_email: String,
    /// 作者日期（ISO 8601 UTC 格式，如 "2024-01-15T08:30:00Z"）
    /// 从 git blame 的 author-time（Unix 时间戳）转换而来
    pub author_date: String,
    /// 提交者名字（创建该提交的人，可能与作者不同，如 rebase 后）
    pub committer: String,
    /// 提交者邮箱
    pub committer_email: String,
    /// 提交者日期（ISO 8601 UTC 格式）
    /// 从 git blame 的 committer-time（Unix 时间戳）转换而来
    pub committer_date: String,
    /// 该行在文件中的最终行号（从 1 开始）
    pub line_number: u32,
    /// 该行的实际内容（不含换行符）
    pub line_content: String,
    /// 是否是边界提交（boundary commit）
    /// true 表示该行属于文件历史中最早可见的提交（blame 无法继续追溯更早的版本）
    /// false 表示普通提交
    pub is_boundary: bool,
}

/**
 * 将 Unix 时间戳转换为 ISO 8601 UTC 格式字符串
 *
 * 例如：1705312200 → "2024-01-15T08:30:00Z"
 *
 * 此函数使用 Howard Hinnant 的日期算法，无需外部依赖（如 chrono）。
 * 算法将 Unix 时间戳的天数部分转换为年月日，时间部分转换为时分秒。
 * 返回 UTC 时区的 ISO 8601 格式，前端可按需转换为本地时区显示。
 *
 * 参数：
 * - timestamp: Unix 时间戳（秒，从 1970-01-01 00:00:00 UTC 开始）
 *
 * 返回值：
 * - ISO 8601 UTC 格式字符串，如 "2024-01-15T08:30:00Z"
 *   如果时间戳为 0 或负数，返回 "1970-01-01T00:00:00Z"
 */
fn unix_to_iso8601(timestamp: i64) -> String {
    // 每天的秒数
    const SECS_PER_DAY: i64 = 86400;

    // 将时间戳拆分为天数和当天秒数
    // 使用 div_euclid/rem_euclid 正确处理负数时间戳
    let days = timestamp.div_euclid(SECS_PER_DAY);
    let secs_of_day = timestamp.rem_euclid(SECS_PER_DAY);

    // 计算时分秒
    let hour = secs_of_day / 3600;
    let min = (secs_of_day % 3600) / 60;
    let sec = secs_of_day % 60;

    // Howard Hinnant 的 civil_from_days 算法
    // 将 Unix 纪元天数（1970-01-01 = day 0）转换为年月日
    // 算法详解：https://howardhinnant.github.io/date_algorithms.html
    let z = days + 719468; // 调整到 0000-03-01 为起点的天数
    let era = if z >= 0 { z } else { z - 146096 } / 146097; // 400 年纪元
    let doe = z - era * 146096; // 纪元内的天数（0 ~ 146096）
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // 纪元内的年份
    let y = yoe + era * 400; // 实际年份
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // 年份内的天数（3月1日开始）
    let mp = (5 * doy + 2) / 153; // 月份索引（0=三月, 1=四月, ..., 11=二月）
    let d = doy - (153 * mp + 2) / 5 + 1; // 日（1~31）
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // 月（1~12）
    // 如果月份是 1 月或 2 月，实际年份需要 +1（因为算法以 3 月为起点）
    let y = if m <= 2 { y + 1 } else { y };

    // 格式化为 ISO 8601 UTC 字符串
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m, d, hour, min, sec
    )
}

/**
 * 获取文件的 Blame 信息
 *
 * 执行 `git blame --line-porcelain -- <file_path>` 命令，
 * 解析输出并返回 BlameLine 列表。
 *
 * `--line-porcelain` 选项让 git 对每一行都输出完整的提交信息，
 * 便于解析（不会因为连续行属于同一 commit 而省略信息）。
 *
 * 解析算法：
 * 1. 按行遍历 git blame 的输出
 * 2. 识别每行的类型（hash 行 / author 行 / committer 行 / 行内容）
 * 3. 维护"当前条目"状态，遇到行内容（以 \t 开头）时输出一个 BlameLine
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 要查询 blame 的文件路径（相对于仓库根目录）
 *
 * 返回值：
 * - Ok(Vec<BlameLine>): 文件每行的 blame 信息列表
 * - Err(GitError): 命令执行失败（文件不存在、不是文件等）
 *
 * 使用示例：
 * ```
 * let blame_lines = get_blame("/path/to/repo", "src/main.rs")?;
 * for line in blame_lines {
 *     println!("行 {}: {} - {}", line.line_number, line.short_hash, line.author);
 * }
 * ```
 */
pub fn get_blame(repo_path: &str, file_path: &str) -> Result<Vec<BlameLine>, GitError> {
    // 验证文件路径不为空
    if file_path.trim().is_empty() {
        return Err(GitError::InvalidPath("文件路径不能为空".to_string()));
    }

    // 执行 git blame --line-porcelain -- <file_path>
    // --line-porcelain: 对每行输出完整提交信息（便于解析）
    // --: 分隔符，确保 file_path 被视为路径而非选项（防止路径以 - 开头时被误判）
    let output = run_git(repo_path, &["blame", "--line-porcelain", "--", file_path])?;

    // 获取标准输出
    let stdout = output.stdout;

    // 解析输出
    Ok(parse_blame_output(&stdout))
}

/**
 * 解析 `git blame --line-porcelain` 的输出
 *
 * 将 git blame 的文本输出解析为结构化的 BlameLine 列表。
 *
 * 解析逻辑采用状态机模式：
 * - 维护"当前条目"的各个字段（hash、author、committer 等）
 * - 遇到 hash 行时更新 commit 信息
 * - 遇到 author/committer 等字段行时更新对应字段
 * - 遇到行内容行（以 \t 开头）时，组装一个完整的 BlameLine 并加入结果列表
 *
 * 参数：
 * - stdout: git blame --line-porcelain 的标准输出文本
 *
 * 返回值：
 * - Vec<BlameLine>: 解析后的 blame 行信息列表
 */
fn parse_blame_output(stdout: &str) -> Vec<BlameLine> {
    // 结果列表
    let mut result: Vec<BlameLine> = Vec::new();

    // 当前条目的各个字段（状态机的状态）
    let mut current_hash: String = String::new(); // 当前提交的完整哈希
    let mut current_is_boundary: bool = false; // 当前提交是否是边界提交
    let mut current_line_number: u32 = 0; // 当前行在文件中的最终行号
    let mut current_author: String = String::new(); // 当前提交的作者名字
    let mut current_author_email: String = String::new(); // 当前提交的作者邮箱
    let mut current_author_time: i64 = 0; // 当前提交的作者时间戳
    let mut current_committer: String = String::new(); // 当前提交的提交者名字
    let mut current_committer_email: String = String::new(); // 当前提交的提交者邮箱
    let mut current_committer_time: i64 = 0; // 当前提交的提交者时间戳

    // 逐行遍历输出
    for line in stdout.lines() {
        // 跳过空行
        if line.is_empty() {
            continue;
        }

        // 检查是否是行内容（以 \t 制表符开头）
        // git blame --line-porcelain 格式中，行内容以 \t 开头
        if line.starts_with('\t') {
            // 提取行内容（去掉前导 \t）
            let line_content = line.get(1..).unwrap_or("").to_string();

            // 组装一个完整的 BlameLine 并加入结果列表
            result.push(BlameLine {
                // 完整哈希
                commit_hash: current_hash.clone(),
                // 短哈希（前 7 位），便于前端显示
                short_hash: current_hash.get(..7).unwrap_or(&current_hash).to_string(),
                // 作者信息
                author: current_author.clone(),
                author_email: current_author_email.clone(),
                // 作者日期（Unix 时间戳转 ISO 8601 UTC）
                author_date: unix_to_iso8601(current_author_time),
                // 提交者信息
                committer: current_committer.clone(),
                committer_email: current_committer_email.clone(),
                // 提交者日期（Unix 时间戳转 ISO 8601 UTC）
                committer_date: unix_to_iso8601(current_committer_time),
                // 行号
                line_number: current_line_number,
                // 行内容
                line_content,
                // 是否是边界提交
                is_boundary: current_is_boundary,
            });
            // 继续处理下一行
            continue;
        }

        // 解析各种头部字段行
        // 每个字段行的格式为 "keyword value"，如 "author John Doe"

        if line.starts_with("author-mail ") {
            // 作者邮箱行：author-mail <email>
            let mail = line["author-mail ".len()..].to_string();
            // git blame 的 author-mail 格式为 <email>，去掉尖括号
            current_author_email = mail
                .trim_start_matches('<')
                .trim_end_matches('>')
                .to_string();
        } else if line.starts_with("author-time ") {
            // 作者时间戳行：author-time <unix-timestamp>
            let time_str = line["author-time ".len()..].trim();
            current_author_time = time_str.parse().unwrap_or(0);
        } else if line.starts_with("author-tz ") {
            // 作者时区行：author-tz +0800
            // 暂不处理时区，统一使用 UTC（前端可按需转换）
        } else if line.starts_with("author ") {
            // 作者名字行：author <name>
            // 注意：此判断必须在 author-mail/author-time 之后，否则会误匹配
            current_author = line["author ".len()..].to_string();
        } else if line.starts_with("committer-mail ") {
            // 提交者邮箱行：committer-mail <email>
            let mail = line["committer-mail ".len()..].to_string();
            current_committer_email = mail
                .trim_start_matches('<')
                .trim_end_matches('>')
                .to_string();
        } else if line.starts_with("committer-time ") {
            // 提交者时间戳行：committer-time <unix-timestamp>
            let time_str = line["committer-time ".len()..].trim();
            current_committer_time = time_str.parse().unwrap_or(0);
        } else if line.starts_with("committer-tz ") {
            // 提交者时区行：committer-tz +0800
            // 暂不处理时区
        } else if line.starts_with("committer ") {
            // 提交者名字行：committer <name>
            current_committer = line["committer ".len()..].to_string();
        } else if line.starts_with("summary ") {
            // 提交消息第一行：summary <message>
            // 暂不存储 summary（BlameLine 结构体中没有此字段）
            // 如需显示提交消息，前端可通过 commit_hash 调用 get_commit_details 获取
        } else if line.starts_with("filename ") {
            // 文件名行：filename <path>
            // 暂不存储 filename（每行的文件名与查询的 file_path 相同，除非有重命名）
        } else if line.starts_with("boundary") {
            // boundary 标记行（--line-porcelain 模式下通常不会有单独的 boundary 行，
            // 而是通过 hash 前的 ^ 标记，但这里做兼容处理）
            current_is_boundary = true;
        } else {
            // 这是 hash 行：[^]<hash> <orig-line> <final-line> [<group-size>]
            // 格式说明：
            // - ^ 前缀表示边界提交（boundary commit）
            // - hash 是 40 位 SHA-1 哈希
            // - orig-line 是原始行号（在原提交中的行号）
            // - final-line 是最终行号（在当前文件中的行号，从 1 开始）
            // - group-size 是可选的组大小（连续属于同一 commit 的行数）

            // 检查是否有 ^ 前缀（boundary commit）
            let (content, is_boundary) = if let Some(stripped) = line.strip_prefix('^') {
                (stripped, true)
            } else {
                (line, false)
            };

            // 按空格分割：[hash, orig-line, final-line, (group-size)]
            let parts: Vec<&str> = content.split_whitespace().collect();
            if parts.len() >= 3 {
                // 第一个 token 是 hash
                current_hash = parts[0].to_string();
                // 第二个 token 是 orig-line（原始行号，暂不使用）
                // 第三个 token 是 final-line（最终行号，用于显示）
                current_line_number = parts[2].parse().unwrap_or(0);
                // 更新 boundary 标记
                current_is_boundary = is_boundary;
            }
            // 如果 parts 长度不足 3，说明格式异常，跳过此行
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    /**
     * 测试 Unix 时间戳转 ISO 8601
     */
    #[test]
    fn test_unix_to_iso8601() {
        // 2024-01-15T08:30:00Z
        assert_eq!(unix_to_iso8601(1705312200), "2024-01-15T08:30:00Z");
        // Unix 纪元起点
        assert_eq!(unix_to_iso8601(0), "1970-01-01T00:00:00Z");
        // 2023-12-31T23:59:59Z
        assert_eq!(unix_to_iso8601(1704067199), "2023-12-31T23:59:59Z");
    }

    /**
     * 测试解析 blame 输出
     */
    #[test]
    fn test_parse_blame_output() {
        // 模拟 git blame --line-porcelain 的输出
        let stdout = "a1b2c3d4e5f6789012345678901234567890abcd 1 1\n\
author John Doe\n\
author-mail <john@example.com>\n\
author-time 1705312200\n\
author-tz +0000\n\
committer Jane Smith\n\
committer-mail <jane@example.com>\n\
committer-time 1705312200\n\
committer-tz +0000\n\
summary Initial commit\n\
filename test.txt\n\
\tHello World\n";

        let lines = parse_blame_output(stdout);

        // 应该解析出 1 行
        assert_eq!(lines.len(), 1);

        let line = &lines[0];
        assert_eq!(line.commit_hash, "a1b2c3d4e5f6789012345678901234567890abcd");
        assert_eq!(line.short_hash, "a1b2c3d");
        assert_eq!(line.author, "John Doe");
        assert_eq!(line.author_email, "john@example.com");
        assert_eq!(line.author_date, "2024-01-15T08:30:00Z");
        assert_eq!(line.committer, "Jane Smith");
        assert_eq!(line.committer_email, "jane@example.com");
        assert_eq!(line.line_number, 1);
        assert_eq!(line.line_content, "Hello World");
        assert!(!line.is_boundary);
    }

    /**
     * 测试解析 boundary commit（边界提交）
     */
    #[test]
    fn test_parse_blame_boundary() {
        // 模拟 boundary commit 的输出（hash 前有 ^）
        let stdout = "^a1b2c3d4e5f6789012345678901234567890abcd 1 1\n\
author First Author\n\
author-mail <first@example.com>\n\
author-time 0\n\
author-tz +0000\n\
committer First Committer\n\
committer-mail <first@example.com>\n\
committer-time 0\n\
committer-tz +0000\n\
summary Initial commit\n\
filename test.txt\n\
\tFirst line\n";

        let lines = parse_blame_output(stdout);

        assert_eq!(lines.len(), 1);
        assert!(lines[0].is_boundary);
        assert_eq!(lines[0].commit_hash, "a1b2c3d4e5f6789012345678901234567890abcd");
        assert_eq!(lines[0].author, "First Author");
    }
}
