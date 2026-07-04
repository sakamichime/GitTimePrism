/*
 * Git 文件差异对比模块
 * 
 * 此模块负责获取和解析 Git 的文件差异（diff）信息：
 * 1. 工作区 diff - 比较工作区与暂存区的差异（git diff）
 * 2. 暂存区 diff - 比较暂存区与 HEAD 的差异（git diff --cached）
 * 3. 提交 diff - 查看某个提交引入的变更（git show）
 * 
 * diff 输出使用统一格式（unified diff），包含：
 * - 文件头信息（旧文件/新文件路径）
 * - hunk 头信息（@@ -old_start,old_count +new_start,new_count @@）
 * - 变更行（+ 新增行，- 删除行，空格 上下文行）
 */

use super::commands::{run_git, GitError};

/**
 * 单个 diff hunk（变更块）的信息
 * 
 * 一个 hunk 表示文件中一段连续的变更区域，
 * 包含变更前后的行号范围和具体的变更内容。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct DiffHunk {
    /// 旧文件中的起始行号和行数（@@ -old_start,old_count ...）
    pub old_start: u32,
    pub old_count: u32,
    /// 新文件中的起始行号和行数（@@ ... +new_start,new_count @@）
    pub new_start: u32,
    pub new_count: u32,
    /// hunk 的所有行内容（包含前缀：+ 新增，- 删除，空格 上下文）
    pub lines: Vec<String>,
}

/**
 * 单个文件的 diff 信息
 * 
 * 包含文件的变更统计和详细的 hunk 列表。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct FileDiff {
    /// 文件路径（相对于仓库根目录）
    pub path: String,
    /// 旧文件路径（仅重命名文件有值）
    pub old_path: Option<String>,
    /// 新增行数
    pub additions: u32,
    /// 删除行数
    pub deletions: u32,
    /// 是否是新增文件
    pub is_new: bool,
    /// 是否是删除文件
    pub is_deleted: bool,
    /// 是否是重命名文件
    pub is_renamed: bool,
    /// diff hunks 列表
    pub hunks: Vec<DiffHunk>,
    /// 原始 diff 文本（用于直接显示）
    pub raw_diff: String,
}

/**
 * 整个 diff 的结果
 * 
 * 包含多个文件的 diff 信息。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct DiffResult {
    /// 涉及的文件列表
    pub files: Vec<FileDiff>,
    /// 总新增行数
    pub total_additions: u32,
    /// 总删除行数
    pub total_deletions: u32,
}

/**
 * 获取工作区与暂存区之间的差异
 * 
 * 执行 `git diff` 命令，返回工作区中尚未暂存的变更。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 可选，指定单个文件路径；None 表示获取所有文件的 diff
 * 
 * 返回值：
 * - Ok(DiffResult) - 查询成功
 * - Err(GitError) - 查询失败
 */
pub fn get_workdir_diff(repo_path: &str, file_path: Option<&str>) -> Result<DiffResult, GitError> {
    let mut args = vec!["diff", "--no-color"];
    
    if let Some(path) = file_path {
        args.push("--");
        args.push(path);
    }
    
    let output = run_git(repo_path, &args)?;
    parse_diff_output(&output.stdout)
}

/**
 * 获取暂存区与 HEAD 之间的差异
 * 
 * 执行 `git diff --cached` 命令，返回已暂存但尚未提交的变更。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * 
 * 返回值：
 * - Ok(DiffResult) - 查询成功
 * - Err(GitError) - 查询失败
 */
pub fn get_staged_diff(repo_path: &str) -> Result<DiffResult, GitError> {
    let output = run_git(repo_path, &["diff", "--cached", "--no-color"])?;
    parse_diff_output(&output.stdout)
}

/**
 * 获取指定提交的差异
 * 
 * 执行 `git show <commit_hash>` 命令，返回该提交引入的所有变更。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - commit_hash: 提交的哈希值
 * 
 * 返回值：
 * - Ok(DiffResult) - 查询成功
 * - Err(GitError) - 查询失败
 */
pub fn get_commit_diff(repo_path: &str, commit_hash: &str) -> Result<DiffResult, GitError> {
    let output = run_git(repo_path, &["show", "--no-color", commit_hash])?;
    parse_diff_output(&output.stdout)
}

/**
 * 解析 git diff/show 的输出为结构化的 DiffResult
 * 
 * 解析 unified diff 格式：
 * ```
 * diff --git a/file.txt b/file.txt
 * index abc1234..def5678 100644
 * --- a/file.txt
 * +++ b/file.txt
 * @@ -1,3 +1,4 @@
 *  context line
 * +added line
 *  another context
 * -removed line
 * ```
 * 
 * 参数：
 * - diff_text: git diff 命令的原始输出
 * 
 * 返回值：
 * - Ok(DiffResult) - 解析成功
 * - Err(GitError) - 解析失败
 */
fn parse_diff_output(diff_text: &str) -> Result<DiffResult, GitError> {
    if diff_text.trim().is_empty() {
        return Ok(DiffResult {
            files: Vec::new(),
            total_additions: 0,
            total_deletions: 0,
        });
    }

    let mut files: Vec<FileDiff> = Vec::new();
    let mut current_file: Option<String> = None;
    let mut current_old_path: Option<String> = None;
    let mut current_hunks: Vec<DiffHunk> = Vec::new();
    let mut current_additions: u32 = 0;
    let mut current_deletions: u32 = 0;
    let mut is_new = false;
    let mut is_deleted = false;
    let mut is_renamed = false;
    let mut raw_diff_lines: Vec<String> = Vec::new();

    for line in diff_text.lines() {
        raw_diff_lines.push(line.to_string());

        // 检测新文件开始：diff --git a/old b/new
        if line.starts_with("diff --git ") {
            // 保存前一个文件
            if let Some(path) = current_file.take() {
                files.push(FileDiff {
                    path,
                    old_path: current_old_path.take(),
                    additions: current_additions,
                    deletions: current_deletions,
                    is_new,
                    is_deleted,
                    is_renamed,
                    hunks: current_hunks.clone(),
                    raw_diff: String::new(), // 稍后填充
                });
                current_hunks.clear();
                current_additions = 0;
                current_deletions = 0;
                is_new = false;
                is_deleted = false;
                is_renamed = false;
            }

            // 解析新旧文件路径
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                let old_path = parts[1].strip_prefix("a/").unwrap_or(parts[1]).to_string();
                let new_path = parts[2].strip_prefix("b/").unwrap_or(parts[2]).to_string();
                
                if old_path == "/dev/null" {
                    is_new = true;
                    current_file = Some(new_path);
                } else if new_path == "/dev/null" {
                    is_deleted = true;
                    current_file = Some(old_path);
                } else if old_path != new_path {
                    is_renamed = true;
                    current_old_path = Some(old_path);
                    current_file = Some(new_path);
                } else {
                    current_file = Some(new_path);
                }
            }
            continue;
        }

        // 检测 hunk 头：@@ -old_start,old_count +new_start,new_count @@
        if line.starts_with("@@") {
            if let Some(hunk) = parse_hunk_header(line) {
                current_hunks.push(hunk);
            }
            continue;
        }

        // 统计新增/删除行
        if let Some(ref _path) = current_file {
            if line.starts_with('+') && !line.starts_with("+++") {
                current_additions += 1;
            } else if line.starts_with('-') && !line.starts_with("---") {
                current_deletions += 1;
            }

            // 将行添加到当前 hunk
            if let Some(last_hunk) = current_hunks.last_mut() {
                last_hunk.lines.push(line.to_string());
            }
        }
    }

    // 保存最后一个文件
    if let Some(path) = current_file {
        files.push(FileDiff {
            path,
            old_path: current_old_path,
            additions: current_additions,
            deletions: current_deletions,
            is_new,
            is_deleted,
            is_renamed,
            hunks: current_hunks,
            raw_diff: String::new(),
        });
    }

    // 计算总数
    let total_additions: u32 = files.iter().map(|f| f.additions).sum();
    let total_deletions: u32 = files.iter().map(|f| f.deletions).sum();

    Ok(DiffResult {
        files,
        total_additions,
        total_deletions,
    })
}

/**
 * 解析 hunk 头行
 * 
 * 格式：@@ -old_start,old_count +new_start,new_count @@ [optional description]
 * 
 * 参数：
 * - line: hunk 头行文本
 * 
 * 返回值：
 * - Some(DiffHunk) - 解析成功
 * - None - 格式不正确
 */
fn parse_hunk_header(line: &str) -> Option<DiffHunk> {
    // 查找 @@ ... @@ 之间的内容
    let start = line.find("@@")?;
    let rest = &line[start + 2..];
    let end = rest.find("@@")?;
    let range_str = rest[..end].trim();

    // 分割为旧范围和新范围
    let parts: Vec<&str> = range_str.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }

    let old_range = parts[0].strip_prefix('-')?;
    let new_range = parts[1].strip_prefix('+')?;

    let (old_start, old_count) = parse_range(old_range)?;
    let (new_start, new_count) = parse_range(new_range)?;

    Some(DiffHunk {
        old_start,
        old_count,
        new_start,
        new_count,
        lines: Vec::new(),
    })
}

/**
 * 解析范围字符串
 * 
 * 格式：start,count 或 start（count 默认为 1）
 * 
 * 参数：
 * - range: 范围字符串
 * 
 * 返回值：
 * - Some((start, count)) - 解析成功
 * - None - 格式不正确
 */
fn parse_range(range: &str) -> Option<(u32, u32)> {
    if let Some(comma_pos) = range.find(',') {
        let start: u32 = range[..comma_pos].parse().ok()?;
        let count: u32 = range[comma_pos + 1..].parse().ok()?;
        Some((start, count))
    } else {
        let start: u32 = range.parse().ok()?;
        Some((start, 1))
    }
}
