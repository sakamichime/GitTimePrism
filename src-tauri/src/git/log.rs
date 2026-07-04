/*
 * Git 提交历史查询模块
 * 
 * 此模块负责获取 Git 仓库的提交历史记录。
 * 通过执行 `git log --pretty=format:...` 命令并解析其输出，
 * 构建结构化的提交记录列表。
 * 
 * 使用自定义的 format 字符串来精确控制输出格式，
 * 每个字段使用特殊分隔符 `|||SEP|||` 分隔，便于程序化解析。
 * 
 * format 字符串说明：
 * %H  - 完整提交哈希（40 位十六进制）
 * %h  - 短提交哈希（7 位十六进制）
 * %an - 作者名字
 * %ae - 作者邮箱
 * %aI - 作者日期（ISO 8601 格式，如 2024-01-15T10:30:00+08:00）
 * %s  - 提交消息的第一行（标题）
 * 
 * 输出格式示例（每行一个提交）：
 * a1b2c3d4e5f6...|||SEP|||a1b2c3d|||SEP|||张三|||SEP|||zhangsan@email.com|||SEP|||2024-01-15T10:30:00+08:00|||SEP|||修复登录bug
 */

use super::commands::{run_git, GitError};

/**
 * 单个提交记录的详细信息
 * 
 * 描述一个 Git 提交的完整信息，包括哈希、作者、日期和消息。
 * 通过 serde 序列化为 JSON 后传递给前端。
 * 
 * 前端使用示例：
 * ```javascript
 * const log = await invoke('get_commit_log', { repoPath: '/path', count: 20 });
 * log.commits.forEach(c => {
 *   console.log(`${c.short_hash} ${c.author}: ${c.message}`);
 * });
 * ```
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct CommitInfo {
    /// 提交的完整哈希值（40 位十六进制字符串）
    /// 例如 "a1b2c3d4e5f6789012345678901234567890abcd"
    /// 用于唯一标识一个提交
    pub hash: String,

    /// 提交的短哈希值（通常是前 7 位十六进制）
    /// 例如 "a1b2c3d"
    /// 用于在 UI 中简洁地显示提交标识
    pub short_hash: String,

    /// 提交作者的名字
    /// 例如 "张三" 或 "John Doe"
    pub author: String,

    /// 提交作者的邮箱地址
    /// 例如 "zhangsan@example.com"
    pub email: String,

    /// 提交的日期时间（ISO 8601 格式）
    /// 例如 "2024-01-15T10:30:00+08:00"
    /// 前端可以使用 Date 对象解析此格式
    pub date: String,

    /// 提交消息的第一行（标题）
    /// 例如 "修复登录页面的验证码bug"
    /// 不包含换行符，只取提交消息的第一行
    pub message: String,
}

/**
 * 提交历史列表数据
 * 
 * 包含提交记录列表和总数统计。
 * 通过 serde 序列化为 JSON 后传递给前端。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct CommitList {
    /// 提交记录列表（按时间倒序排列，最新的在前）
    /// 每个元素包含一个提交的详细信息
    pub commits: Vec<CommitInfo>,

    /// 本次查询到的提交总数
    /// 等于 commits.len()
    pub total_count: u32,
}

/**
 * 解析 git log 的单行输出为 CommitInfo 结构体
 * 
 * git log 的每行输出格式为（使用 |||SEP||| 作为字段分隔符）：
 * <完整哈希>|||SEP|||<短哈希>|||SEP|||<作者>|||SEP|||<邮箱>|||SEP|||<日期>|||SEP|||<消息>
 * 
 * 例如：
 * a1b2c3d4...|||SEP|||a1b2c3d|||SEP|||张三|||SEP|||zhangsan@email.com|||SEP|||2024-01-15T10:30:00+08:00|||SEP|||修复登录bug
 * 
 * 参数：
 * - line: git log 输出的一行文本
 * 
 * 返回值：
 * - Some(CommitInfo) - 成功解析
 * - None - 行格式不正确（理论上不应出现）
 */
fn parse_commit_line(line: &str) -> Option<CommitInfo> {
    // 使用 |||SEP||| 作为分隔符分割行（与 graph.rs 保持一致）
    // 这个分隔符极不可能出现在提交消息或作者名中，比单字符 | 更安全
    // 分割为 6 个字段：hash, short_hash, author, email, date, message
    let parts: Vec<&str> = line.split("|||SEP|||").collect();

    // 验证字段数量是否正确（必须恰好 6 个字段）
    if parts.len() != 6 {
        return None;
    }

    // 提取并清洗每个字段的值
    // trim() 去除首尾空白字符（换行符、空格等）
    Some(CommitInfo {
        hash: parts[0].trim().to_string(),       // 完整哈希
        short_hash: parts[1].trim().to_string(),   // 短哈希
        author: parts[2].trim().to_string(),       // 作者名
        email: parts[3].trim().to_string(),        // 作者邮箱
        date: parts[4].trim().to_string(),         // 日期时间
        message: parts[5].trim().to_string(),      // 提交消息
    })
}

/**
 * 获取仓库的提交历史记录
 * 
 * 执行 `git log --pretty=format:... -n <count>` 命令，
 * 获取指定数量的最近提交记录。
 * 
 * 执行步骤：
 * 1. 构建 format 字符串，定义输出格式
 * 2. 执行 git log 命令，限制返回数量
 * 3. 逐行解析输出为 CommitInfo 结构体
 * 4. 组装为 CommitList 结构体返回
 * 
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - count: 要获取的提交数量
 *          例如 10 表示获取最近 10 条提交记录
 *          如果 count 为 0，则返回所有提交记录
 * 
 * 返回值：
 * - Ok(CommitList) - 查询成功，包含提交列表和总数
 * - Err(GitError) - 查询失败（不是 Git 仓库、命令执行错误等）
 * 
 * 注意：
 * - 提交记录按时间倒序排列（最新的提交在列表最前面）
 * - 如果仓库没有提交记录，返回空列表
 * - 提交消息只包含第一行（不包含正文部分）
 */
pub fn get_log(repo_path: &str, count: u32) -> Result<CommitList, GitError> {
    // 定义 git log 的输出格式
    // 使用 |||SEP||| 作为字段分隔符（与 graph.rs 保持一致，极不可能出现在提交内容中）
    // 格式字段说明：
    //   %H  = 完整提交哈希（40位）
    //   %h  = 短提交哈希（通常7位）
    //   %an = 作者名字
    //   %ae = 作者邮箱
    //   %aI = 作者日期（ISO 8601 格式，包含时区信息）
    //   %s  = 提交消息标题（第一行）
    let format_str = "%H|||SEP|||%h|||SEP|||%an|||SEP|||%ae|||SEP|||%aI|||SEP|||%s";

    // 构建完整的 --pretty=format 参数
    // --pretty=format:<格式字符串> 告诉 git 按照指定格式输出每条提交记录
    let full_format = format!("--pretty=format:{}", format_str);

    // 构建命令参数列表（使用 Vec<String> 而非 Vec<&str>）
    // 因为 format 参数和 count 参数都需要动态生成字符串
    let full_args: Vec<String> = if count > 0 {
        // 有数量限制：添加 -n< count > 参数来限制返回的提交数量
        // -n20 表示只返回最近 20 条提交记录
        vec![
            "log".to_string(),       // 子命令：查看提交历史
            full_format,             // 自定义输出格式
            format!("-n{}", count),  // 限制返回的提交数量
        ]
    } else {
        // 无数量限制：返回所有提交记录
        vec![
            "log".to_string(),       // 子命令：查看提交历史
            full_format,             // 自定义输出格式
        ]
    };

    // 将 Vec<String> 转换为 Vec<&str> 以传递给 run_git 函数
    // 因为 run_git 的参数类型是 &[&str]，所以需要转换
    // iter().map(|s| s.as_str()) 安全地将 String 的引用转换为 &str
    let args_refs: Vec<&str> = full_args.iter().map(|s| s.as_str()).collect();

    // 执行 git log 命令并获取输出
    let output = run_git(repo_path, &args_refs)?;

    // 解析输出为 CommitInfo 列表
    let commits: Vec<CommitInfo> = output
        .stdout
        .lines()                  // 按行分割输出（每行一个提交）
        .filter_map(|line| parse_commit_line(line))  // 解析每行，过滤无效行
        .collect();                // 收集为 Vec

    // 计算实际获取的提交数量
    let total_count = commits.len() as u32;

    // 组装并返回提交历史列表
    Ok(CommitList {
        commits,
        total_count,
    })
}

/**
 * 获取单个文件的提交历史
 * 
 * 执行 `git log --follow --pretty=format:<format> -- <file_path>` 命令，
 * 获取指定文件的所有提交记录。
 * 
 * --follow 选项的作用：
 *   当文件被重命名时（例如 `git mv old_name new_name`），
 *   --follow 会追踪文件的重命名历史，把旧文件名下的提交也一并返回。
 *   如果不加 --follow，则只能看到重命名之后的提交记录。
 * 
 * 命令格式说明：
 *   git log --follow --pretty=format:<格式> -- <文件路径>
 *   其中 `--` 用于分隔 git 选项和文件路径，避免路径被误解析为选项参数。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录），例如 "src/main.rs"
 * 
 * 返回值：
 * - Ok(Vec<CommitInfo>) - 该文件的所有提交记录（按时间倒序排列）
 * - Err(GitError) - 查询失败（路径无效、不是 Git 仓库等）
 * 
 * 使用示例：
 *   let history = get_file_history("/path/to/repo", "src/main.rs")?;
 *   // history 是一个 Vec<CommitInfo>，包含该文件的所有提交
 */
pub fn get_file_history(repo_path: &str, file_path: &str) -> Result<Vec<CommitInfo>, GitError> {
    // 定义 git log 的输出格式（与 get_log 函数完全相同）
    // 使用 |||SEP||| 作为字段分隔符（与 graph.rs 保持一致），各字段含义：
    //   %H  = 完整提交哈希（40位）
    //   %h  = 短提交哈希（通常7位）
    //   %an = 作者名字
    //   %ae = 作者邮箱
    //   %aI = 作者日期（ISO 8601 格式，包含时区信息）
    //   %s  = 提交消息标题（第一行）
    let format_str = "%H|||SEP|||%h|||SEP|||%an|||SEP|||%ae|||SEP|||%aI|||SEP|||%s";

    // 构建完整的 --pretty=format 参数
    let full_format = format!("--pretty=format:{}", format_str);

    // 构建命令参数列表（使用 Vec<String> 而非 Vec<&str>，与 get_log 保持一致）
    // 包含以下关键部分：
    //   1. "log"       - git 子命令，查看提交历史
    //   2. "--follow"  - 跟踪文件重命名，确保能看到文件改名前的提交
    //   3. full_format - 自定义输出格式
    //   4. "--"        - 分隔符，告诉 git 后面的内容是文件路径而非选项
    //   5. file_path   - 要查询历史的文件路径
    let full_args: Vec<String> = vec![
        "log".to_string(),      // git log 子命令
        "--follow".to_string(), // 跟踪文件重命名历史
        full_format,            // 自定义输出格式
        "--".to_string(),       // 分隔符：分隔选项和文件路径
        file_path.to_string(),  // 目标文件路径（相对于仓库根目录）
    ];

    // 将 Vec<String> 转换为 Vec<&str> 以传递给 run_git 函数
    // 因为 run_git 的参数类型是 &[&str]，所以需要转换
    let args_refs: Vec<&str> = full_args.iter().map(|s| s.as_str()).collect();

    // 执行 git log 命令并获取输出
    // run_git 会在指定的仓库路径下执行 git 命令
    let output = run_git(repo_path, &args_refs)?;

    // 解析输出为 CommitInfo 列表
    // 每一行输出对应一个提交记录，使用 parse_commit_line 函数解析
    // filter_map 会自动过滤掉无法解析的行（理论上不应出现无效行）
    let commits: Vec<CommitInfo> = output
        .stdout
        .lines()                              // 按行分割输出（每行一个提交）
        .filter_map(|line| parse_commit_line(line))  // 解析每行，过滤无效行
        .collect();                           // 收集为 Vec<CommitInfo>

    // 返回该文件的所有提交记录列表
    Ok(commits)
}
