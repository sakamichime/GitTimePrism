/*
 * Git 分支管理模块
 * 
 * 此模块负责获取 Git 仓库中的分支信息，包括本地分支和远程分支。
 * 通过解析 `git branch -vv` 和 `git branch -r` 命令的输出，
 * 构建结构化的分支列表数据。
 * 
 * 分支信息包括：
 * - 分支名称
 * - 是否是当前分支
 * - 是否是远程分支
 * - 上游追踪分支
 * - 领先/落后上游的提交数
 * - 最新提交的哈希和消息
 * 
 * git branch -vv 输出格式说明：
 *   * main      a1b2c3d [origin/main] Commit message
 *     feature   e4f5g6h [origin/feature: ahead 2] Another message
 *     local-only i7j8k9l No upstream message
 * 
 * git branch -r 输出格式说明：
 *   origin/main
 *   origin/feature
 *   upstream/develop
 */

use super::commands::{run_git, GitError};

/**
 * 单个分支的详细信息
 * 
 * 描述一个 Git 分支的完整状态，包括名称、追踪关系、提交信息等。
 * 通过 serde 序列化为 JSON 后传递给前端。
 * 
 * 前端使用示例：
 * ```javascript
 * const branches = await invoke('get_branches', { repoPath: '/path/to/repo' });
 * branches.local.forEach(b => {
 *   console.log(`${b.name} ${b.is_current ? '(当前)' : ''} ${b.ahead}/${b.behind}`);
 * });
 * ```
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct BranchInfo {
    /// 分支名称（不含远程前缀）
    /// 本地分支: "main", "feature/login"
    /// 远程分支: "origin/main", "upstream/develop"（含远程前缀）
    pub name: String,

    /// 是否是当前活跃分支（即 HEAD 所在的分支）
    /// 同一时刻只有一个分支可以是 true
    pub is_current: bool,

    /// 是否是远程追踪分支
    /// true = 远程分支（如 origin/main）
    /// false = 本地分支
    pub is_remote: bool,

    /// 上游（追踪）分支的名称
    /// 对于本地分支：如果设置了上游追踪，则为上游分支名
    ///   例如 Some("origin/main") 或 Some("upstream/develop")
    /// 对于远程分支：始终为 None
    /// 如果本地分支没有设置上游追踪，则为 None
    pub upstream: Option<String>,

    /// 领先上游分支的提交数
    /// 表示本地分支有 ahead 个提交尚未推送到上游分支
    /// 仅当 upstream 不为 None 时有意义
    pub ahead: u32,

    /// 落后上游分支的提交数
    /// 表示上游分支有 behind 个提交尚未合并到本地分支
    /// 仅当 upstream 不为 None 时有意义
    pub behind: u32,

    /// 此分支最新提交的完整哈希值（7 位短哈希）
    /// 例如 "a1b2c3d"
    pub latest_commit: String,

    /// 此分支最新提交的消息（第一行）
    /// 例如 "Fix login page bug" 或 "Initial commit"
    pub latest_commit_msg: String,
}

/**
 * 仓库的分支列表数据
 * 
 * 将分支分为本地分支和远程分支两个列表。
 * 通过 serde 序列化为 JSON 后传递给前端。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct BranchList {
    /// 本地分支列表
    /// 包含所有在本地存在的分支
    pub local: Vec<BranchInfo>,

    /// 远程分支列表
    /// 包含所有远程追踪分支（如 origin/main）
    pub remote: Vec<BranchInfo>,
}

/**
 * 解析 `git branch -vv` 的输出，获取本地分支信息
 * 
 * git branch -vv 输出格式：
 *   * main      a1b2c3d [origin/main] Initial commit
 *     feature   e4f5g6h [origin/feature: ahead 2, behind 1] New feature
 *     local-br  i7j8k9l Some commit message
 * 
 * 解析规则：
 * - 行首 '*' 表示当前分支
 * - 紧跟分支名，然后是提交哈希（7位）
 * - 方括号 [...] 中是上游信息和 ahead/behind 统计
 * - 最后是提交消息
 * 
 * 参数：
 * - output: git branch -vv 命令的标准输出
 * 
 * 返回值：
 * - 本地分支信息列表
 */
fn parse_local_branches(output: &str) -> Vec<BranchInfo> {
    let mut branches = Vec::new();

    // 逐行解析输出
    for line in output.lines() {
        // 去除行首空白
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // 判断是否是当前分支（行首有 '*' 标记）
        let is_current = line.starts_with('*');
        // 去掉行首的 '*' 或 ' ' 以及空白，获取纯内容
        let content = if is_current {
            line.strip_prefix('*').unwrap_or(line).trim()
        } else {
            line
        };

        // 分割内容为空白分隔的标记
        // 格式: <branch_name> <commit_hash> [<upstream_info>] <commit_message>
        let parts: Vec<&str> = content.splitn(4, |c: char| c.is_whitespace()).collect();
        if parts.len() < 2 {
            continue; // 格式不正确，跳过
        }

        let branch_name = parts[0].trim();   // 分支名称
        let commit_hash = parts[1].trim();   // 提交哈希（7位）

        // 解析上游信息和提交消息
        // 剩余部分可能包含 [upstream: ahead N, behind M] 和提交消息
        let rest = if parts.len() > 2 {
            parts[2..].join(" ")
        } else {
            String::new()
        };

        // 解析上游追踪信息
        // 格式: [origin/main] 或 [origin/main: ahead 3, behind 1]
        let (upstream, ahead, behind) = parse_upstream_info(&rest);

        // 提取提交消息（去除上游信息部分）
        let commit_msg = rest
            .split(']')
            .last()
            .unwrap_or("")
            .trim()
            .to_string();

        branches.push(BranchInfo {
            name: branch_name.to_string(),
            is_current,
            is_remote: false, // 这些都是本地分支
            upstream,
            ahead,
            behind,
            latest_commit: commit_hash.to_string(),
            latest_commit_msg: commit_msg,
        });
    }

    branches
}

/**
 * 解析分支行中的上游追踪信息
 * 
 * 从 "[origin/main: ahead 3, behind 1]" 这样的字符串中提取：
 * - 上游分支名: "origin/main"
 * - ahead 值: 3
 * - behind 值: 1
 * 
 * 参数：
 * - text: 包含 [...] 部分的文本
 * 
 * 返回值：
 * - (Option<String>, u32, u32) - (上游分支名, ahead数量, behind数量)
 */
fn parse_upstream_info(text: &str) -> (Option<String>, u32, u32) {
    // 查找方括号 [...] 的内容
    let bracket_start = match text.find('[') {
        Some(pos) => pos,
        None => return (None, 0, 0), // 没有上游信息
    };

    let bracket_end = match text.find(']') {
        Some(pos) => pos,
        None => return (None, 0, 0), // 格式不正确
    };

    // 提取方括号内的内容
    // 例如 "origin/main: ahead 3, behind 1" 或 "origin/main"
    let bracket_content = &text[bracket_start + 1..bracket_end];
    let bracket_content = bracket_content.trim();

    // 检查是否是 "gone" 状态（上游分支已被删除）
    if bracket_content == "gone" {
        return (None, 0, 0);
    }

    // 分割为分支名和状态信息
    // 格式: "origin/main" 或 "origin/main: ahead 3, behind 1"
    let parts: Vec<&str> = bracket_content.splitn(2, ':').collect();
    let upstream = parts[0].trim().to_string();

    // 解析 ahead 和 behind 值
    let mut ahead: u32 = 0;
    let mut behind: u32 = 0;

    if parts.len() > 1 {
        // 状态信息部分，例如 " ahead 3, behind 1"
        let status_text = parts[1].trim();

        // 解析 ahead 值
        // 查找 "ahead" 关键词后面的数字
        if let Some(ahead_pos) = status_text.find("ahead") {
            let after_ahead = &status_text[ahead_pos + 5..];
            // 提取紧跟在 "ahead " 后面的数字
            let num_str: String = after_ahead
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(n) = num_str.parse::<u32>() {
                ahead = n;
            }
        }

        // 解析 behind 值
        // 查找 "behind" 关键词后面的数字
        if let Some(behind_pos) = status_text.find("behind") {
            let after_behind = &status_text[behind_pos + 6..];
            let num_str: String = after_behind
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(n) = num_str.parse::<u32>() {
                behind = n;
            }
        }
    }

    (Some(upstream), ahead, behind)
}

/**
 * 解析 `git branch -r` 的输出，获取远程分支信息
 * 
 * git branch -r 输出格式：
 *   origin/main
 *   origin/feature
 *   upstream/develop
 *   origin/HEAD -> origin/main
 * 
 * 参数：
 * - output: git branch -r 命令的标准输出
 * 
 * 返回值：
 * - 远程分支信息列表
 */
fn parse_remote_branches(output: &str) -> Vec<BranchInfo> {
    let mut branches = Vec::new();

    for line in output.lines() {
        // 去除行首空白
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // 跳过 HEAD 符号引用行（如 "origin/HEAD -> origin/main"）
        // 这种行不是实际的分支，而是远程的默认分支指针
        if line.contains("->") {
            continue;
        }

        // 远程分支的名称就是整行内容
        // 格式为 "远程名/分支名"，如 "origin/main"
        let branch_name = line.trim().to_string();

        // 跳过已过期的远程分支（以 "  " 开头或包含 "stale" 标记）
        // 这些分支在远程已被删除，但本地缓存仍然存在
        if branch_name.contains("(stale)") {
            continue;
        }

        branches.push(BranchInfo {
            name: branch_name,
            is_current: false,  // 远程分支不存在"当前"的概念
            is_remote: true,
            upstream: None,     // 远程分支本身不追踪其他分支
            ahead: 0,
            behind: 0,
            // 远程分支列表中不包含提交信息（需要额外命令获取）
            // 这里留空，如果需要可以后续通过 git log 获取
            latest_commit: String::new(),
            latest_commit_msg: String::new(),
        });
    }

    branches
}

/**
 * 获取仓库的所有分支列表（本地 + 远程）
 * 
 * 执行步骤：
 * 1. 执行 `git branch -vv` 获取本地分支详细信息
 * 2. 执行 `git branch -r` 获取远程分支列表
 * 3. 分别解析两个命令的输出
 * 4. 组装为 BranchList 结构体返回
 * 
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * 
 * 返回值：
 * - Ok(BranchList) - 查询成功，包含本地和远程分支列表
 * - Err(GitError) - 查询失败
 */
pub fn get_branches(repo_path: &str) -> Result<BranchList, GitError> {
    // 第一步：获取本地分支的详细信息
    // git branch -vv 参数说明：
    // -v: verbose，显示每个分支的最新提交哈希和消息
    // -vv: very verbose，额外显示上游追踪信息（ahead/behind 统计）
    let local_output = run_git(repo_path, &["branch", "-vv"])?;
    let local_branches = parse_local_branches(&local_output.stdout);

    // 第二步：获取远程分支列表
    // git branch -r 参数说明：
    // -r: 只显示远程追踪分支
    let remote_output = run_git(repo_path, &["branch", "-r"])?;
    let remote_branches = parse_remote_branches(&remote_output.stdout);

    // 组装并返回完整的分支列表
    Ok(BranchList {
        local: local_branches,
        remote: remote_branches,
    })
}
