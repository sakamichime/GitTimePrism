/*
 * Git 文件差异对比模块
 *
 * 此模块负责获取和解析 Git 的文件差异（diff）信息：
 * 1. 工作区 diff - 比较工作区与暂存区的差异（git diff）
 * 2. 暂存区 diff - 比较暂存区与 HEAD 的差异（git diff --cached）
 * 3. 提交 diff - 查看某个提交引入的变更（git show）
 *
 * 与 gitgraph 项目对齐（新增功能）：
 * 4. get_diff_name_status - 使用 `git diff-tree --name-status -r --root --find-renames --diff-filter=AMDR -z`
 *    获取文件变更类型（A/M/D/R）和新旧路径
 * 5. get_diff_num_stat - 使用 `git diff --numstat -z` 获取文件变更的行数统计（additions/deletions）
 * 6. generate_file_changes - 合并 name_status 和 num_stat 两路结果，生成完整的 FileChange 列表
 *
 * 双命令组合的设计原因：
 * - --name-status 提供文件类型（A/M/D/R）和路径，但不提供行数统计
 * - --numstat 提供行数统计（additions/deletions），但 rename 信息不直观
 * - 合并两路结果可以获得完整信息：type + oldPath + newPath + additions + deletions
 *
 * diff 输出使用统一格式（unified diff），包含：
 * - 文件头信息（旧文件/新文件路径）
 * - hunk 头信息（@@ -old_start,old_count +new_start,new_count @@）
 * - 变更行（+ 新增行，- 删除行，空格 上下文行）
 */

use super::commands::{run_git, run_git_raw, GitError};

/**
 * 单个 diff hunk（变更块）的信息
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct DiffHunk {
    /// 旧文件中的起始行号和行数
    pub old_start: u32,
    pub old_count: u32,
    /// 新文件中的起始行号和行数
    pub new_start: u32,
    pub new_count: u32,
    /// hunk 的所有行内容（包含前缀：+ 新增，- 删除，空格 上下文）
    pub lines: Vec<String>,
}

/**
 * 单个文件的 diff 信息
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
    /// 原始 diff 文本
    pub raw_diff: String,
}

/**
 * 整个 diff 的结果
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
 * Git 文件变更类型枚举
 *
 * 对应 git diff --name-status 输出中的状态码。
 * - A = Added（新增）
 * - M = Modified（修改）
 * - D = Deleted（删除）
 * - R = Renamed（重命名）
 *
 * 注意：此枚举与 status.rs 中的 FileStatus 不同，
 * 这里只关注 diff 中的变更类型，不包含 Untracked/Unmerged 等状态。
 *
 * 序列化/反序列化时使用单字符字符串（与前端 git-types.ts 的 GitFileStatus 枚举值匹配）：
 * - Added -> "A"
 * - Modified -> "M"
 * - Deleted -> "D"
 * - Renamed -> "R"
 * - Untracked -> "U"
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, PartialEq, Eq)]
pub enum GitFileStatus {
    /// 新增文件（状态码 "A"）
    #[serde(rename = "A")]
    Added,
    /// 修改文件（状态码 "M"）
    #[serde(rename = "M")]
    Modified,
    /// 删除文件（状态码 "D"）
    #[serde(rename = "D")]
    Deleted,
    /// 重命名文件（状态码 "R"）
    #[serde(rename = "R")]
    Renamed,
    /// 未跟踪文件（状态码 "U"，仅用于 commit_details/commit_compare 中的 untracked 文件）
    #[serde(rename = "U")]
    Untracked,
}

/**
 * 单个文件的变更信息（结构化）
 *
 * 此结构体对应 gitgraph 项目中的 GitFileChange 接口，
 * 包含文件变更的完整信息：类型、新旧路径、行数统计。
 *
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）：
 * - old_file_path -> oldFilePath
 * - new_file_path -> newFilePath
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// 旧文件路径（对于新增文件，与 new_file_path 相同）
    /// 对于重命名文件，这是重命名前的路径
    pub old_file_path: String,
    /// 新文件路径（对于删除文件，与 old_file_path 相同）
    /// 对于重命名文件，这是重命名后的路径
    pub new_file_path: String,
    /// 文件变更类型
    pub r#type: GitFileStatus,
    /// 新增行数（None 表示无法获取，例如二进制文件）
    pub additions: Option<u32>,
    /// 删除行数（None 表示无法获取，例如二进制文件）
    pub deletions: Option<u32>,
}

/**
 * 内部结构：--name-status 解析结果
 *
 * 此结构体仅限 git 模块内部使用（pub(super)），
 * 因为 get_diff_name_status_internal 和 generate_file_changes 是 pub(super) 函数，
 * 需要将此类型暴露给同模块的其他文件（如 commit_details.rs、commit_compare.rs）。
 */
#[derive(Debug, Clone)]
pub(super) struct DiffNameStatusRecord {
    /// 文件变更类型
    pub(super) file_type: GitFileStatus,
    /// 旧文件路径
    pub(super) old_file_path: String,
    /// 新文件路径
    pub(super) new_file_path: String,
}

/**
 * 内部结构：--numstat 解析结果
 *
 * 此结构体仅限 git 模块内部使用（pub(super)），
 * 因为 get_diff_num_stat_internal 和 generate_file_changes 是 pub(super) 函数，
 * 需要将此类型暴露给同模块的其他文件（如 commit_details.rs、commit_compare.rs）。
 */
#[derive(Debug, Clone)]
pub(super) struct DiffNumStatRecord {
    /// 文件路径（用于与 name_status 匹配）
    pub(super) file_path: String,
    /// 新增行数
    pub(super) additions: Option<u32>,
    /// 删除行数
    pub(super) deletions: Option<u32>,
}

/**
 * 获取工作区与暂存区之间的差异（保持向后兼容）
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
 * 获取暂存区与 HEAD 之间的差异（保持向后兼容）
 */
pub fn get_staged_diff(repo_path: &str) -> Result<DiffResult, GitError> {
    let output = run_git(repo_path, &["diff", "--cached", "--no-color"])?;
    parse_diff_output(&output.stdout)
}

/**
 * 获取指定提交的差异（保持向后兼容）
 */
pub fn get_commit_diff(repo_path: &str, commit_hash: &str) -> Result<DiffResult, GitError> {
    let output = run_git(repo_path, &["show", "--no-color", commit_hash])?;
    parse_diff_output(&output.stdout)
}

/**
 * 获取文件变更的类型信息（--name-status）
 *
 * 执行 `git diff-tree --name-status -r --root --find-renames --diff-filter=AMDR -z {hash}`
 * 或 `git diff --name-status --find-renames --diff-filter=AMDR -z {from} {to}`
 *
 * --name-status 输出格式（-z NUL 分隔）：
 * - A/M/D 类型：A\0path\0（占用 2 个槽位）
 * - R 类型：R\0old_path\0new_path\0（占用 3 个槽位）
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - from_hash: diff 的起始 commit hash
 * - to_hash: diff 的目标 commit hash
 *   - 如果 from_hash == to_hash，使用 git diff-tree（查看单个 commit 引入的变更）
 *   - 如果 to_hash 为空字符串，使用 git diff（比较 from_hash 与工作区）
 *   - 否则使用 git diff（比较两个 commit 之间的差异）
 *
 * 返回值：
 * - Ok(Vec<FileChange>) - 文件变更列表（不含行数统计）
 * - Err(GitError) - 查询失败
 */
pub fn get_diff_name_status(
    repo_path: &str,
    from_hash: &str,
    to_hash: &str,
) -> Result<Vec<FileChange>, GitError> {
    // 调用内部函数并转换结果
    let records = get_diff_name_status_internal(repo_path, from_hash, to_hash)?;
    Ok(generate_file_changes(records, Vec::new(), None))
}

/**
 * get_diff_name_status 的内部实现，返回 DiffNameStatusRecord 列表
 *
 * 此函数返回内部结构体，便于后续与 num_stat 合并。
 */
pub(super) fn get_diff_name_status_internal(
    repo_path: &str,
    from_hash: &str,
    to_hash: &str,
) -> Result<Vec<DiffNameStatusRecord>, GitError> {
    // 构建命令参数
    let args: Vec<String>;
    let is_same_hash = from_hash == to_hash;

    if is_same_hash {
        // 单个 commit 的变更：使用 git diff-tree
        // --name-status: 显示文件变更类型和路径
        // -r: 递归处理子目录
        // --root: 初始提交也能正确显示
        // --find-renames: 启用重命名检测
        // --diff-filter=AMDR: 只显示 Added/Modified/Deleted/Renamed
        // -z: NUL 分隔
        args = vec![
            "diff-tree".to_string(),
            "--name-status".to_string(),
            "-r".to_string(),
            "--root".to_string(),
            "--find-renames".to_string(),
            "--diff-filter=AMDR".to_string(),
            "-z".to_string(),
            from_hash.to_string(),
        ];
    } else {
        // 两个 commit 之间的变更：使用 git diff
        args = {
            let mut v = vec![
                "diff".to_string(),
                "--name-status".to_string(),
                "--find-renames".to_string(),
                "--diff-filter=AMDR".to_string(),
                "-z".to_string(),
                from_hash.to_string(),
            ];
            if !to_hash.is_empty() {
                v.push(to_hash.to_string());
            }
            v
        };
    }

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let bytes = run_git_raw(repo_path, &args_refs)?;

    // 解析 -z 格式输出
    let mut fields: Vec<&[u8]> = bytes.split(|&b| b == 0).collect();

    // 对于 diff-tree，第一个字段是 commit hash 本身，需要跳过
    if is_same_hash && !fields.is_empty() {
        fields.remove(0);
    }

    // 移除末尾的空字段
    if fields.last().map_or(false, |f| f.is_empty()) {
        fields.pop();
    }

    // 解析 name-status 输出
    let mut records = Vec::new();
    let mut i = 0;
    while i < fields.len() {
        let type_field = String::from_utf8_lossy(fields[i]);

        // type_field 的第一个字符是状态码
        let type_char = type_field.chars().next().unwrap_or(' ');

        match type_char {
            'A' => {
                // 新增文件：A\0path\0（2 个槽位）
                if i + 1 < fields.len() {
                    let path = String::from_utf8_lossy(fields[i + 1]).to_string();
                    records.push(DiffNameStatusRecord {
                        file_type: GitFileStatus::Added,
                        old_file_path: path.clone(),
                        new_file_path: path,
                    });
                    i += 2;
                    continue;
                }
            }
            'M' => {
                // 修改文件：M\0path\0（2 个槽位）
                if i + 1 < fields.len() {
                    let path = String::from_utf8_lossy(fields[i + 1]).to_string();
                    records.push(DiffNameStatusRecord {
                        file_type: GitFileStatus::Modified,
                        old_file_path: path.clone(),
                        new_file_path: path,
                    });
                    i += 2;
                    continue;
                }
            }
            'D' => {
                // 删除文件：D\0path\0（2 个槽位）
                if i + 1 < fields.len() {
                    let path = String::from_utf8_lossy(fields[i + 1]).to_string();
                    records.push(DiffNameStatusRecord {
                        file_type: GitFileStatus::Deleted,
                        old_file_path: path.clone(),
                        new_file_path: path,
                    });
                    i += 2;
                    continue;
                }
            }
            'R' => {
                // 重命名文件：R\0old_path\0new_path\0（3 个槽位）
                if i + 2 < fields.len() {
                    let old_path = String::from_utf8_lossy(fields[i + 1]).to_string();
                    let new_path = String::from_utf8_lossy(fields[i + 2]).to_string();
                    records.push(DiffNameStatusRecord {
                        file_type: GitFileStatus::Renamed,
                        old_file_path: old_path,
                        new_file_path: new_path,
                    });
                    i += 3;
                    continue;
                }
            }
            _ => {
                // 未知类型，跳过
            }
        }

        i += 1;
    }

    Ok(records)
}

/**
 * 获取文件变更的行数统计（--numstat）
 *
 * 执行 `git diff --numstat --find-renames --diff-filter=AMDR -z {from} {to}`
 * 或 `git diff-tree --numstat -r --root --find-renames --diff-filter=AMDR -z {hash}`
 *
 * --numstat 输出格式（-z NUL 分隔）：
 * - A/M/D 类型：additions\tdeletions\tpath\0（占用 1 个槽位）
 * - R 类型：additions\tdeletions\t\0old_path\0new_path\0（占用 3 个槽位）
 *   注意：R 类型时，第三个字段（路径）为空，需要从后续字段读取
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - from_hash: diff 的起始 commit hash
 * - to_hash: diff 的目标 commit hash
 *
 * 返回值：
 * - Ok(Vec<DiffNumStatRecord>) - 行数统计列表
 * - Err(GitError) - 查询失败
 */
pub(super) fn get_diff_num_stat_internal(
    repo_path: &str,
    from_hash: &str,
    to_hash: &str,
) -> Result<Vec<DiffNumStatRecord>, GitError> {
    // 构建命令参数
    let args: Vec<String>;
    let is_same_hash = from_hash == to_hash;

    if is_same_hash {
        // 单个 commit 的统计：使用 git diff-tree
        args = vec![
            "diff-tree".to_string(),
            "--numstat".to_string(),
            "-r".to_string(),
            "--root".to_string(),
            "--find-renames".to_string(),
            "--diff-filter=AMDR".to_string(),
            "-z".to_string(),
            from_hash.to_string(),
        ];
    } else {
        // 两个 commit 之间的统计：使用 git diff
        args = {
            let mut v = vec![
                "diff".to_string(),
                "--numstat".to_string(),
                "--find-renames".to_string(),
                "--diff-filter=AMDR".to_string(),
                "-z".to_string(),
                from_hash.to_string(),
            ];
            if !to_hash.is_empty() {
                v.push(to_hash.to_string());
            }
            v
        };
    }

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let bytes = run_git_raw(repo_path, &args_refs)?;

    // 解析 -z 格式输出
    let mut fields: Vec<&[u8]> = bytes.split(|&b| b == 0).collect();

    // 对于 diff-tree，第一个字段是 commit hash 本身，需要跳过
    if is_same_hash && !fields.is_empty() {
        fields.remove(0);
    }

    // 移除末尾的空字段
    if fields.last().map_or(false, |f| f.is_empty()) {
        fields.pop();
    }

    // 解析 numstat 输出
    let mut records = Vec::new();
    let mut i = 0;
    while i < fields.len() {
        let field = String::from_utf8_lossy(fields[i]);

        // numstat 格式：additions\tdeletions\tpath
        // 对于二进制文件，additions/deletions 可能是 "-"
        let parts: Vec<&str> = field.split('\t').collect();
        if parts.len() != 3 {
            i += 1;
            continue;
        }

        let additions = parse_numstat_count(parts[0]);
        let deletions = parse_numstat_count(parts[1]);
        let path_field = parts[2];

        if path_field.is_empty() {
            // 路径为空，说明是重命名：additions\tdeletions\t\0old_path\0new_path\0
            if i + 2 < fields.len() {
                let _old_path = String::from_utf8_lossy(fields[i + 1]).to_string();
                let new_path = String::from_utf8_lossy(fields[i + 2]).to_string();
                records.push(DiffNumStatRecord {
                    file_path: new_path,
                    additions,
                    deletions,
                });
                i += 3;
                continue;
            }
        } else {
            // 普通文件：additions\tdeletions\tpath
            records.push(DiffNumStatRecord {
                file_path: path_field.to_string(),
                additions,
                deletions,
            });
            i += 1;
            continue;
        }

        i += 1;
    }

    Ok(records)
}

/**
 * 解析 numstat 中的行数（可能是数字或 "-"）
 *
 * - 数字字符串（如 "12"）-> Some(12)
 * - "-"（表示二进制文件）-> None
 * - 其他无效格式 -> None
 */
fn parse_numstat_count(s: &str) -> Option<u32> {
    s.trim().parse::<u32>().ok()
}

/**
 * 合并 name_status 和 num_stat 两路结果，生成完整的 FileChange 列表
 *
 * 此函数对应 gitgraph 项目中的 `generateFileChanges()` 函数。
 *
 * 合并算法：
 * 1. 遍历 name_status 记录，建立 new_file_path -> index 的映射
 * 2. 如果有 status_files（deleted/untracked），更新或添加对应条目
 * 3. 遍历 num_stat 记录，根据 file_path 查找对应的 FileChange 并填充 additions/deletions
 *
 * 参数：
 * - name_status_records: --name-status 的解析结果
 * - num_stat_records: --numstat 的解析结果
 * - status_files: 可选的状态文件（用于 commit_details 中的 uncommitted changes 场景）
 *
 * 返回值：
 * - Vec<FileChange>: 合并后的文件变更列表
 */
pub(super) fn generate_file_changes(
    name_status_records: Vec<DiffNameStatusRecord>,
    num_stat_records: Vec<DiffNumStatRecord>,
    status_files: Option<&super::status::GitStatusFiles>,
) -> Vec<FileChange> {
    let mut file_changes: Vec<FileChange> = Vec::new();
    let mut file_lookup: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    // 1. 处理 name_status 记录
    for record in &name_status_records {
        let index = file_changes.len();
        file_lookup.insert(record.new_file_path.clone(), index);
        file_changes.push(FileChange {
            old_file_path: record.old_file_path.clone(),
            new_file_path: record.new_file_path.clone(),
            r#type: record.file_type.clone(),
            additions: None,
            deletions: None,
        });
    }

    // 2. 处理 status_files（如果有）
    // 这用于 uncommitted changes 场景：将 deleted 和 untracked 文件添加到列表中
    if let Some(status) = status_files {
        // 处理 deleted 文件
        for deleted_path in &status.deleted {
            if let Some(&index) = file_lookup.get(deleted_path) {
                // 已存在：更新类型为 Deleted
                file_changes[index].r#type = GitFileStatus::Deleted;
            } else {
                // 不存在：添加新条目
                let index = file_changes.len();
                file_lookup.insert(deleted_path.clone(), index);
                file_changes.push(FileChange {
                    old_file_path: deleted_path.clone(),
                    new_file_path: deleted_path.clone(),
                    r#type: GitFileStatus::Deleted,
                    additions: None,
                    deletions: None,
                });
            }
        }

        // 处理 untracked 文件
        for untracked_path in &status.untracked {
            // untracked 文件总是添加到列表末尾（不检查是否已存在）
            let index = file_changes.len();
            file_lookup.insert(untracked_path.clone(), index);
            file_changes.push(FileChange {
                old_file_path: untracked_path.clone(),
                new_file_path: untracked_path.clone(),
                r#type: GitFileStatus::Untracked,
                additions: None,
                deletions: None,
            });
        }
    }

    // 3. 处理 num_stat 记录，填充 additions/deletions
    for record in &num_stat_records {
        if let Some(&index) = file_lookup.get(&record.file_path) {
            file_changes[index].additions = record.additions;
            file_changes[index].deletions = record.deletions;
        }
    }

    file_changes
}

/**
 * 解析 git diff/show 的输出为结构化的 DiffResult（保持向后兼容）
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

    for line in diff_text.lines() {
        // 检测新文件开始
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
                    raw_diff: String::new(),
                });
                current_hunks.clear();
                current_additions = 0;
                current_deletions = 0;
                is_new = false;
                is_deleted = false;
                is_renamed = false;
            }

            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 {
                let old_path = parts[2].strip_prefix("a/").unwrap_or(parts[2]).to_string();
                let new_path = parts[3].strip_prefix("b/").unwrap_or(parts[3]).to_string();

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

        // 检测 hunk 头
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
 */
fn parse_hunk_header(line: &str) -> Option<DiffHunk> {
    let start = line.find("@@")?;
    let rest = &line[start + 2..];
    let end = rest.find("@@")?;
    let range_str = rest[..end].trim();

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

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::status::GitStatusFiles;

    #[test]
    fn test_generate_file_changes_basic() {
        let name_status = vec![
            DiffNameStatusRecord {
                file_type: GitFileStatus::Modified,
                old_file_path: "src/main.rs".to_string(),
                new_file_path: "src/main.rs".to_string(),
            },
            DiffNameStatusRecord {
                file_type: GitFileStatus::Added,
                old_file_path: "src/new.rs".to_string(),
                new_file_path: "src/new.rs".to_string(),
            },
        ];

        let num_stat = vec![
            DiffNumStatRecord {
                file_path: "src/main.rs".to_string(),
                additions: Some(10),
                deletions: Some(5),
            },
            DiffNumStatRecord {
                file_path: "src/new.rs".to_string(),
                additions: Some(50),
                deletions: Some(0),
            },
        ];

        let changes = generate_file_changes(name_status, num_stat, None);

        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].new_file_path, "src/main.rs");
        assert_eq!(changes[0].r#type, GitFileStatus::Modified);
        assert_eq!(changes[0].additions, Some(10));
        assert_eq!(changes[0].deletions, Some(5));
        assert_eq!(changes[1].r#type, GitFileStatus::Added);
        assert_eq!(changes[1].additions, Some(50));
    }

    #[test]
    fn test_generate_file_changes_with_status() {
        let name_status = vec![];
        let num_stat = vec![];
        let status = GitStatusFiles {
            deleted: vec!["deleted.txt".to_string()],
            untracked: vec!["untracked.txt".to_string()],
        };

        let changes = generate_file_changes(name_status, num_stat, Some(&status));

        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].r#type, GitFileStatus::Deleted);
        assert_eq!(changes[1].r#type, GitFileStatus::Untracked);
    }

    #[test]
    fn test_generate_file_changes_rename() {
        let name_status = vec![DiffNameStatusRecord {
            file_type: GitFileStatus::Renamed,
            old_file_path: "old.txt".to_string(),
            new_file_path: "new.txt".to_string(),
        }];

        let num_stat = vec![DiffNumStatRecord {
            file_path: "new.txt".to_string(),
            additions: Some(2),
            deletions: Some(1),
        }];

        let changes = generate_file_changes(name_status, num_stat, None);

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].r#type, GitFileStatus::Renamed);
        assert_eq!(changes[0].old_file_path, "old.txt");
        assert_eq!(changes[0].new_file_path, "new.txt");
        assert_eq!(changes[0].additions, Some(2));
    }

    #[test]
    fn test_parse_numstat_count() {
        assert_eq!(parse_numstat_count("12"), Some(12));
        assert_eq!(parse_numstat_count("0"), Some(0));
        assert_eq!(parse_numstat_count("-"), None);
        assert_eq!(parse_numstat_count("abc"), None);
    }
}
