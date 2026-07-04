/*
 * Git 提交节点图模块
 * 
 * 此模块负责获取和解析 Git 的提交历史节点图数据。
 * 通过执行 `git log --graph --pretty=format:...` 命令，
 * 构建结构化的提交节点列表，包含图形线、提交哈希、父提交和消息。
 * 
 * 节点图用于可视化展示分支、合并等 Git 操作的历史关系。
 * 
 * git log --graph 输出示例：
 * ```
 * * commit_hash parent_hashes Commit message
 * |\  
 * | * commit_hash2 parent_hashes Another commit
 * |/  
 * * commit_hash3 parent_hashes Merge commit
 * ```
 */

use super::commands::{run_git, GitError};

/**
 * 单个提交节点的详细信息
 * 
 * 包含节点图的 ASCII 线条、提交哈希、父提交列表和提交消息。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct GraphCommit {
    /// 节点图的 ASCII 线条（如 "* ", "| ", "|\\", "|/" 等）
    /// 这些字符构成了可视化的分支/合并结构
    pub graph_line: String,
    
    /// 提交的完整哈希值（40 位十六进制）
    pub hash: String,
    
    /// 提交的短哈希值（通常 7 位）
    pub short_hash: String,
    
    /// 父提交的哈希列表
    /// 普通提交有 1 个父提交，合并提交有 2 个或更多
    pub parents: Vec<String>,
    
    /// 作者名字
    pub author: String,
    
    /// 提交日期（ISO 8601 格式）
    pub date: String,
    
    /// 提交消息（第一行）
    pub message: String,
}

/**
 * 完整的提交节点图数据
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct CommitGraph {
    /// 所有提交节点列表（按时间倒序，最新的在前）
    pub commits: Vec<GraphCommit>,
    
    /// 提交总数
    pub total_count: u32,
}

/**
 * 获取仓库的提交节点图
 * 
 * 执行 `git log --graph --pretty=format:...` 命令，
 * 获取带有 ASCII 图形线的提交历史记录。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - count: 要获取的提交数量（0 表示全部）
 * 
 * 返回值：
 * - Ok(CommitGraph) - 查询成功
 * - Err(GitError) - 查询失败
 */
pub fn get_commit_graph(repo_path: &str, count: u32) -> Result<CommitGraph, GitError> {
    // 构建 format 字符串
    // 使用 |||SEP||| 作为字段分隔符（极不可能出现在提交消息中）
    let format_str = "%H|||SEP|||%h|||SEP|||%P|||SEP|||%an|||SEP|||%aI|||SEP|||%s";
    let full_format = format!("--pretty=format:{}", format_str);
    
    // 构建参数列表
    let mut args: Vec<String> = vec![
        "log".to_string(),
        "--graph".to_string(),
        full_format,
    ];
    
    if count > 0 {
        args.push(format!("-n{}", count));
    }
    
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_git(repo_path, &args_refs)?;
    
    // 解析输出
    let commits = parse_graph_output(&output.stdout);
    let total_count = commits.len() as u32;
    
    Ok(CommitGraph {
        commits,
        total_count,
    })
}

/**
 * 解析 git log --graph 的输出
 * 
 * 每行格式（带 |||SEP||| 分隔符）：
 * * commit_hash|||SEP|||short_hash|||SEP|||parent1 parent2|||SEP|||author|||SEP|||date|||SEP|||message
 * 
 * 或者纯图形线（无提交信息）：
 * |\
 * |/
 * | 
 * 
 * 参数：
 * - output: git log --graph 的原始输出
 * 
 * 返回值：
 * - Vec<GraphCommit> - 解析后的提交节点列表
 */
fn parse_graph_output(output: &str) -> Vec<GraphCommit> {
    let mut commits: Vec<GraphCommit> = Vec::new();
    
    for line in output.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }
        
        // 检查是否包含提交信息（有 |||SEP||| 分隔符）
        if trimmed.contains("|||SEP|||") {
            // 提取图形线部分（在第一个 |||SEP||| 之前的内容）
            let sep_pos = match trimmed.find("|||SEP|||") {
                Some(pos) => pos,
                None => continue,
            };
            
            // 图形线是 commit 标记之前的部分
            // 找到最后一个 * / \ | 等字符的位置
            let graph_part = extract_graph_line(&trimmed[..sep_pos]);
            
            // 解析剩余字段
            let data_part = &trimmed[sep_pos..];
            if let Some(commit) = parse_commit_data(&graph_part, data_part) {
                commits.push(commit);
            }
        }
        // 纯图形线（如 |\, |/, | ）不需要单独存储，
        // 它们会在前端渲染时与提交节点一起显示
    }
    
    commits
}

/**
 * 从 git log 输出行中提取图形线部分
 * 
 * git log --graph 的每一行输出由两部分组成：
 * 1. 左边的 ASCII 图形线（由 *, |, \\, /, -, 空格组成）
 * 2. 右边的提交数据（commit hash、消息等）
 * 
 * 这两部分之间没有固定分隔符，但图形线始终从行首开始，
 * 且图形字符是连续排列的，遇到第一个非图形字符就意味着图形线结束。
 * 
 * 提取规则：从字符串开头逐字节检查，
 * - 如果是图形字符（*, |, \\, /, -, 空格），就把它包含进来，继续看下一个
 * - 如果遇到第一个非图形字符（比如 commit hash 的字母/数字），立刻停止
 * - 最终返回从开头到停止位置之间的所有图形字符
 * 
 * 为什么遇到非图形字符要立即停止（break）？
 * 因为 git graph 的图形线一定是从行首开始的连续字符块，
 * 后面的 commit hash 等数据不属于图形，不能混进来。
 * 虽然理论上图形字符可能出现在非图形字符之后，
 * 但在 git log --graph 的实际输出中不会发生这种情况，
 * 所以 break 是安全且正确的做法。
 * 
 * 为什么用字节遍历而不是字符遍历？
 * 因为所有图形字符都是 ASCII（单字节），用字节索引遍历有两个好处：
 * 1. 更高效：不需要把字符串转成 Vec<char>，直接操作原始字节
 * 2. 更安全：Rust 的 &str 切片用的是字节索引，
 *    用字节索引遍历可以保证切片位置一定在 UTF-8 边界上，
 *    避免切在多字节字符中间导致 panic
 * 
 * 参数：
 * - prefix: |||SEP||| 之前的全部文本（包含图形线 + 空格 + commit hash 等）
 * 
 * 返回值：
 * - String - 只包含从行首开始的连续图形字符
 * 
 * 示例说明：
 * - 输入 "* abc123def"    → 输出 "* "
 *   （* 和空格是图形字符，遇到 'a' 立即停止）
 * - 输入 "| * abc123"     → 输出 "| * "
 *   （|、空格、*、空格都是图形字符，遇到 'a' 停止）
 * - 输入 "|\\ "           → 输出 "|\\ "
 *   （全是图形字符，没有非图形字符来打断，全部保留）
 * - 输入 "|/  "           → 输出 "|/  "
 *   （同上，全部是图形字符）
 */
fn extract_graph_line(prefix: &str) -> String {
    // 把字符串转成字节数组，直接按字节遍历
    // 因为所有图形字符（*, |, \\, /, -, 空格）都是 ASCII 单字节字符，
    // 所以按字节检查和按字符检查结果完全一样
    let bytes = prefix.as_bytes();
    
    // end 记录"图形线结束的字节位置"（切片时不包含该位置）
    // 初始值为 0，表示还没发现任何图形字符
    let mut end = 0;
    
    // 从第一个字节开始，逐个检查是图形字符还是提交数据字符
    for (i, &b) in bytes.iter().enumerate() {
        // 判断当前字节是否属于 git graph 的图形字符
        // 所有图形字符都是 ASCII，可以直接用字节值比较
        // * (0x2A) 表示一个提交节点
        // | (0x7C) 表示纵向的分支线
        // \\ (0x5C) 和 / (0x2F) 表示分支的合并/分叉线
        // - (0x2D) 有时出现在图形中
        // 空格 (0x20) 用于对齐不同分支的列位置
        if b == b'*' || b == b'|' || b == b'\\' || b == b'/' || b == b'-' || b == b' ' {
            // 是图形字符，把结束位置扩展到包含当前字节
            // i + 1 是因为结束位置要"包含"当前字节（切片时右边界不包含）
            end = i + 1;
        } else {
            // 遇到了非图形字符（比如 commit hash 的第一个字母/数字）
            // 说明图形线已经结束了，后面的内容都不属于图形
            // 立即停止检查，break 跳出整个循环
            break;
        }
    }
    
    // 用字节切片取出从开头到 end 位置的子字符串，就是纯图形线部分
    // 因为 end 一定是 ASCII 字符的边界（所有图形字符都是单字节 ASCII），
    // 所以这里切片是安全的，不会切在 UTF-8 多字节字符中间
    // 例如：prefix = "* abc123"，end = 2，结果 = "* "
    prefix[..end].to_string()
}

/**
 * 解析提交数据字段
 * 
 * 格式：|||SEP|||hash|||SEP|||short_hash|||SEP|||parents|||SEP|||author|||SEP|||date|||SEP|||message
 * 
 * 参数：
 * - graph_line: 图形线字符串
 * - data: 包含 |||SEP||| 分隔符的数据部分
 * 
 * 返回值：
 * - Some(GraphCommit) - 解析成功
 * - None - 格式不正确
 */
fn parse_commit_data(graph_line: &str, data: &str) -> Option<GraphCommit> {
    // 去掉开头的 |||SEP|||
    let data = data.strip_prefix("|||SEP|||")?;
    
    // 分割字段
    let parts: Vec<&str> = data.split("|||SEP|||").collect();
    if parts.len() < 6 {
        return None;
    }
    
    let hash = parts[0].trim().to_string();
    let short_hash = parts[1].trim().to_string();
    let parents_str = parts[2].trim();
    let author = parts[3].trim().to_string();
    let date = parts[4].trim().to_string();
    let message = parts[5].trim().to_string();
    
    // 解析父提交列表（空格分隔）
    let parents: Vec<String> = if parents_str.is_empty() {
        Vec::new()
    } else {
        parents_str.split_whitespace().map(|s| s.to_string()).collect()
    };
    
    Some(GraphCommit {
        graph_line: graph_line.to_string(),
        hash,
        short_hash,
        parents,
        author,
        date,
        message,
    })
}
