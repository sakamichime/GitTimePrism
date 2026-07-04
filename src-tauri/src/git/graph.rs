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
            if let Some(commit) = parse_commit_data(graph_part, data_part) {
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
 * 图形线由 *, |, \, /, - 等字符组成，位于提交数据之前。
 * 
 * 参数：
 * - prefix: |||SEP||| 之前的文本
 * 
 * 返回值：
 * - String - 提取的图形线
 */
fn extract_graph_line(prefix: &str) -> String {
    // 图形线通常以 * 开头，后面跟着 |, \, /, 空格等
    // 我们保留从开头到最后一个图形字符的部分
    let chars: Vec<char> = prefix.chars().collect();
    let mut end = 0;
    
    for (i, &c) in chars.iter().enumerate() {
        if c == '*' || c == '|' || c == '\\' || c == '/' || c == '-' || c == ' ' {
            end = i + 1;
        } else {
            break;
        }
    }
    
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
