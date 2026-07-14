/*
 * Git 仓库状态查询模块
 *
 * 此模块负责解析 `git status` 命令的输出，将 Git 的文件状态信息
 * 转换为前端可用的结构化数据。
 *
 * 与 gitgraph 项目对齐：
 * - 改用 `git status -s --untracked-files=all --porcelain -z` 输出格式
 * - 使用 -z NUL 分隔符解析（更稳健，能正确处理包含空格、换行的文件名）
 * - 正确处理 R/C 跳 2 槽逻辑（重命名/复制的文件占用 2 个 NUL 分隔的槽位）
 * - 区分 deleted/untracked/modified/renamed/copied/unmerged 状态
 *
 * porcelain -z 输出格式说明：
 *   每个条目使用 NUL 字符（\0）分隔，不是换行符。
 *   条目格式：
 *   - 普通文件：XY <path>\0
 *     XY 是 2 字符的状态码，path 是文件路径
 *   - 重命名/复制：XY <old_path>\0<new_path>\0
 *     XY 是 R/C 状态码，old_path 是原路径，new_path 是新路径
 *     注意：重命名/复制占用 2 个 NUL 分隔的槽位
 *
 * 状态码含义（XY 两字符）：
 * - X = 暂存区状态（索引中的状态）
 * - Y = 工作区状态（工作目录中的状态）
 * - ' ' (空格) = 该位置无变更
 * - M = Modified（已修改）
 * - A = Added（已添加）
 * - D = Deleted（已删除）
 * - ? = Untracked（未跟踪，仅作为 Y 出现，整行是 "?? path"）
 * - R = Renamed（已重命名）
 * - C = Copied（已复制）
 * - U = Unmerged（未合并，有冲突）
 *
 * 示例输出（NUL 分隔）：
 *   "M  file.txt\0?? new_file.txt\0R  old.txt\0new.txt\0"
 */

use super::commands::{run_git, run_git_raw, GitError};

/**
 * 文件状态枚举
 *
 * 表示一个文件在 Git 仓库中的状态。
 * 对应 git status 输出中的状态码字母（M/A/D/?/R/C/U）。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, PartialEq)]
pub enum FileStatus {
    /// 文件内容已被修改（但可能尚未暂存）
    Modified,
    /// 新文件已被添加到暂存区（尚未提交）
    Added,
    /// 文件已被删除（从工作区或暂存区删除）
    Deleted,
    /// 文件未被 Git 跟踪（新文件，从未被 add 过）
    Untracked,
    /// 文件已被重命名（从一个路径变为另一个路径）
    Renamed,
    /// 文件已被复制（从一个路径复制到另一个路径）
    Copied,
    /// 文件存在合并冲突（需要手动解决冲突后才能提交）
    Unmerged,
}

/**
 * 单个文件的状态条目
 *
 * 描述仓库中一个文件的详细状态信息。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct StatusEntry {
    /// 文件的路径（相对于仓库根目录）
    pub path: String,

    /// 文件的当前状态（已修改/已添加/已删除/未跟踪等）
    pub status: FileStatus,

    /// 文件的原始路径（仅在重命名或复制时有值）
    /// 对于重命名的文件，此字段存储重命名前的路径
    pub old_path: Option<String>,

    /// 文件是否已暂存（staged）
    /// true = 变更已通过 `git add` 添加到暂存区
    /// false = 变更仅在工作区，尚未暂存
    pub staged: bool,
}

/**
 * 仓库的完整状态信息（使用 -s --porcelain -z 格式）
 *
 * 包含所有文件状态条目。
 * 此结构体通过 serde 序列化为 JSON 后传递给前端。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct RepoStatus {
    /// 当前所在的分支名称
    pub branch: String,

    /// 所有文件状态条目的列表
    pub entries: Vec<StatusEntry>,
}

/**
 * 简化的状态文件分类（用于 commit_details/commit_compare）
 *
 * 对应 gitgraph 项目中 `getStatus()` 的返回类型 GitStatusFiles。
 * 只区分 deleted 和 untracked 两类文件。
 */
#[derive(Debug, Clone, Default)]
pub struct GitStatusFiles {
    /// 已删除的文件路径列表
    pub deleted: Vec<String>,
    /// 未跟踪的文件路径列表
    pub untracked: Vec<String>,
}

/**
 * 解析单个状态码字符为 FileStatus 枚举
 *
 * 将 git status --porcelain 输出中的单个字母（M/A/D/?/R/C/U）
 * 转换为对应的 FileStatus 枚举值。
 *
 * 参数：
 * - ch: 状态码字符（单个字母）
 *
 * 返回值：
 * - Some(FileStatus) - 成功解析状态码
 * - None - 未识别的状态码
 */
fn parse_status_char(ch: char) -> Option<FileStatus> {
    match ch {
        'M' => Some(FileStatus::Modified),
        'A' => Some(FileStatus::Added),
        'D' => Some(FileStatus::Deleted),
        '?' => Some(FileStatus::Untracked),
        'R' => Some(FileStatus::Renamed),
        'C' => Some(FileStatus::Copied),
        'U' => Some(FileStatus::Unmerged),
        _ => None,
    }
}

/**
 * 判断 XY 状态码组合是否表示合并冲突（unmerged）状态
 *
 * Git 在合并冲突时会产生以下 7 种 unmerged 状态码组合：
 * - DD：双方都删除了该文件（both deleted）
 * - AU：我们添加，他们修改（added by us）
 * - UD：我们修改，他们删除（deleted by them）
 * - UA：我们修改，他们添加（added by them）
 * - DU：我们删除，他们修改（deleted by us）
 * - AA：双方都添加了该文件（both added）
 * - UU：双方都修改了该文件（both modified）
 *
 * 这些组合与普通状态码不同：X 和 Y 都不是空格，
 * 表示文件在暂存区和工作区都处于冲突状态。
 *
 * 参数：
 * - x: 状态码的第一个字符（暂存区状态）
 * - y: 状态码的第二个字符（工作区状态）
 *
 * 返回值：
 * - true: 该组合是合并冲突状态
 * - false: 该组合不是合并冲突状态
 */
fn is_unmerged_pair(x: char, y: char) -> bool {
    matches!(
        (x, y),
        ('D', 'D') | ('A', 'U') | ('U', 'D') | ('U', 'A') | ('D', 'U') | ('A', 'A') | ('U', 'U')
    )
}

/**
 * 获取仓库的完整状态信息（旧版，保持向后兼容）
 *
 * 执行 `git status --porcelain=v2 --branch` 命令，解析其输出，
 * 返回当前分支和所有文件的状态列表。
 *
 * 此函数保持向后兼容，使用旧的 --porcelain=v2 格式。
 * 新代码应使用 get_status_z（基于 -z NUL 分隔的更稳健格式）。
 */
pub fn get_status(repo_path: &str) -> Result<RepoStatus, GitError> {
    // 执行 git status --porcelain=v2 --branch
    let output = run_git(repo_path, &["status", "--porcelain=v2", "--branch"])?;

    // 初始化结果数据
    let mut branch = String::from("unknown");
    let mut entries: Vec<StatusEntry> = Vec::new();

    // 逐行解析 git status 的输出
    for line in output.stdout.lines() {
        if line.is_empty() {
            continue;
        }

        // 解析分支信息行: # branch.head <branch_name>
        if line.starts_with("# branch.head ") {
            branch = line
                .strip_prefix("# branch.head ")
                .unwrap_or("unknown")
                .trim()
                .to_string();
            continue;
        }

        // 解析未跟踪文件行: ? <file_path>
        if line.starts_with("? ") {
            let path = line.strip_prefix("? ").unwrap_or("").trim().to_string();
            if !path.is_empty() {
                entries.push(StatusEntry {
                    path,
                    status: FileStatus::Untracked,
                    old_path: None,
                    staged: false,
                });
            }
            continue;
        }

        // 解析已跟踪文件行: 1 XY SUB MH MI MW HH HI PATH
        if line.starts_with("1 ") {
            let tokens: Vec<&str> = line.split_whitespace().collect();

            if tokens.len() < 9 {
                continue;
            }

            let xy = tokens[1];
            let x_char = xy.chars().next().unwrap_or(' ');
            let y_char = xy.chars().nth(1).unwrap_or(' ');
            let staged = x_char != '.' && x_char != ' ';

            let status = if let Some(s) = parse_status_char(x_char) {
                s
            } else if let Some(s) = parse_status_char(y_char) {
                s
            } else {
                continue;
            };

            let path = tokens[8..].join(" ");

            if path.contains(" -> ") {
                let parts: Vec<&str> = path.splitn(2, " -> ").collect();
                let old_path = parts[0].trim().to_string();
                let new_path = parts[1].trim().to_string();

                entries.push(StatusEntry {
                    path: new_path,
                    status,
                    old_path: Some(old_path),
                    staged,
                });
            } else {
                entries.push(StatusEntry {
                    path,
                    status,
                    old_path: None,
                    staged,
                });
            }
            continue;
        }

        // 解析未合并文件行: u XY SUB M1 M2 M3 H1 H2 PATH
        if line.starts_with("u ") {
            let tokens: Vec<&str> = line.split_whitespace().collect();

            if tokens.len() < 9 {
                continue;
            }

            let xy = tokens[1];
            let x_char = xy.chars().next().unwrap_or(' ');
            let staged = x_char != '.' && x_char != ' ';

            let path = tokens[8..].join(" ");

            if path.contains(" -> ") {
                let parts: Vec<&str> = path.splitn(2, " -> ").collect();
                entries.push(StatusEntry {
                    path: parts[1].trim().to_string(),
                    status: FileStatus::Unmerged,
                    old_path: Some(parts[0].trim().to_string()),
                    staged,
                });
            } else {
                entries.push(StatusEntry {
                    path,
                    status: FileStatus::Unmerged,
                    old_path: None,
                    staged,
                });
            }
            continue;
        }
    }

    Ok(RepoStatus { branch, entries })
}

/**
 * 获取仓库状态（使用 -z NUL 分隔的稳健格式）
 *
 * 执行 `git status -s --untracked-files=all --porcelain -z` 命令，
 * 使用 NUL 分隔符解析输出。
 *
 * 与 get_status 的区别：
 * - 使用 -s --porcelain -z 格式（更简洁，更稳健）
 * - 正确处理包含空格、特殊字符的文件名
 * - 正确处理 R/C（重命名/复制）跳 2 槽逻辑
 * - 不返回 branch 字段（如果需要分支信息，单独调用其他命令）
 *
 * 此函数对应 gitgraph 项目中 `DataSource.getStatus()` 的实现。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(Vec<StatusEntry>) - 所有文件的状态条目列表
 * - Err(GitError) - 查询失败
 */
pub fn get_status_entries(repo_path: &str) -> Result<Vec<StatusEntry>, GitError> {
    // 构建命令参数
    // -s: 短格式输出
    // --untracked-files=all: 显示所有未跟踪文件（包括目录中的文件）
    // --porcelain: 机器可读格式
    // -z: 使用 NUL 字符分隔条目（而不是换行符）
    let args = &["status", "-s", "--untracked-files=all", "--porcelain", "-z"];

    // 使用 run_git_raw 获取原始字节（因为 -z 输出包含 NUL 字符）
    let bytes = run_git_raw(repo_path, args)?;

    // 解析 -z 格式的输出
    Ok(parse_status_z_output(&bytes))
}

/**
 * 获取简化的状态文件分类（deleted + untracked）
 *
 * 此函数对应 gitgraph 项目中 `DataSource.getStatus()` 的返回类型。
 * 只返回 deleted 和 untracked 两类文件路径，用于 commit_details 和 commit_compare。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(GitStatusFiles) - 包含 deleted 和 untracked 文件路径列表
 * - Err(GitError) - 查询失败
 */
pub fn get_status_files(repo_path: &str) -> Result<GitStatusFiles, GitError> {
    let entries = get_status_entries(repo_path)?;

    let mut files = GitStatusFiles::default();

    for entry in entries {
        match entry.status {
            FileStatus::Deleted => {
                files.deleted.push(entry.path);
            }
            FileStatus::Untracked => {
                files.untracked.push(entry.path);
            }
            _ => {}
        }
    }

    Ok(files)
}

/**
 * 解析 `git status -s --porcelain -z` 的输出
 *
 * -z 格式说明：
 * - 条目之间使用 NUL 字符（\0）分隔
 * - 普通文件条目：XY <path>\0（占用 1 个槽位）
 * - 重命名/复制条目：XY <old_path>\0<new_path>\0（占用 2 个槽位）
 * - 最后一个条目后也有一个 NUL 字符
 *
 * XY 是 2 字符的状态码：
 * - X = 暂存区状态
 * - Y = 工作区状态
 * - 例如 "M " = 已暂存的修改，" M" = 未暂存的修改
 *
 * 解析算法：
 * 1. 按 NUL 字符分割字节流
 * 2. 遍历分割后的字段：
 *    - 如果字段以 XY 状态码开头（长度 >= 3），是普通文件条目
 *    - 如果上一个条目是 R/C（重命名/复制），当前字段是新路径
 *    - 否则跳过（空字段或无效字段）
 *
 * 参数：
 * - bytes: git status -z 命令的原始字节输出
 *
 * 返回值：
 * - Vec<StatusEntry>: 解析后的状态条目列表
 */
fn parse_status_z_output(bytes: &[u8]) -> Vec<StatusEntry> {
    let mut entries: Vec<StatusEntry> = Vec::new();

    // 将字节流按 NUL 字符分割为字段列表
    let mut fields: Vec<&[u8]> = bytes.split(|&b| b == 0).collect();

    // 移除末尾的空字段（-z 格式最后一个 NUL 后是空字符串）
    if fields.last().map_or(false, |f| f.is_empty()) {
        fields.pop();
    }

    let mut i = 0;
    while i < fields.len() {
        let field = fields[i];

        // 字段至少要有 3 字节（XY + 空格 + 路径）
        if field.len() < 3 {
            i += 1;
            continue;
        }

        // 将字节转换为字符串（使用 lossy 转换，避免无效 UTF-8 导致 panic）
        let field_str = String::from_utf8_lossy(field);

        // 提取 XY 状态码（前 2 字符）
        let x_char = field_str.chars().next().unwrap_or(' ');
        let y_char = field_str.chars().nth(1).unwrap_or(' ');

        // 路径部分从第 4 字节开始（XY + 空格 + 路径）
        // 注意：field_str 的前 3 字符是 "XY "（状态码 + 空格）
        let path_part = field_str.get(3..).unwrap_or("").to_string();

        // 判断状态码类型
        let status_opt = if x_char == '?' && y_char == '?' {
            // 未跟踪文件：?? path
            Some((FileStatus::Untracked, false))
        } else if x_char == '!' && y_char == '!' {
            // 忽略文件：!! path（不显示）
            None
        } else if is_unmerged_pair(x_char, y_char) {
            // 合并冲突状态：UU/DU/UD/AU/UA/AA/DD
            // 这些状态码表示文件存在合并冲突，需要用户手动解决
            // Task 8.1：识别 unmerged 组合状态，正确填充 FileStatus::Unmerged
            // 注意：unmerged 状态下 staged 标记为 false，因为冲突文件既不在暂存区也不在工作区
            // 而是处于特殊的冲突状态（三个 stage 同时存在于索引中）
            Some((FileStatus::Unmerged, false))
        } else if let Some(s) = parse_status_char(x_char) {
            // X 是有效状态码（暂存区的变更）
            Some((s, true))
        } else if let Some(s) = parse_status_char(y_char) {
            // Y 是有效状态码（工作区的变更）
            Some((s, false))
        } else {
            // 无法识别的状态码，跳过
            None
        };

        if let Some((status, staged)) = status_opt {
            // 检查是否是重命名/复制（R/C 状态码）
            let is_rename_or_copy = x_char == 'R' || x_char == 'C' || y_char == 'R' || y_char == 'C';

            if is_rename_or_copy {
                // 重命名/复制：占用 2 个槽位
                // 当前字段是 old_path，下一个字段是 new_path
                if i + 1 < fields.len() {
                    let new_path_field = fields[i + 1];
                    let new_path = String::from_utf8_lossy(new_path_field).to_string();

                    entries.push(StatusEntry {
                        path: new_path,
                        status,
                        old_path: Some(path_part),
                        staged,
                    });

                    // 跳过下一个字段（已作为 new_path 使用）
                    i += 2;
                    continue;
                }
            } else {
                // 普通文件：占用 1 个槽位
                entries.push(StatusEntry {
                    path: path_part,
                    status,
                    old_path: None,
                    staged,
                });
            }
        }

        i += 1;
    }

    entries
}

/**
 * 合并冲突文件信息
 *
 * 表示一个存在合并冲突的文件的详细信息。
 * 合并冲突时，Git 索引中会同时存在该文件的三个版本（stage）：
 * - stage 1：base 版本（共同祖先提交中的版本）
 * - stage 2：ours 版本（当前分支的版本）
 * - stage 3：theirs 版本（被合并分支的版本）
 *
 * 通过 `git ls-files -u` 命令可以获取这些 stage 的 blob hash。
 * 用户解决冲突后，对应 stage 会被清除，文件回到正常的暂存状态。
 *
 * 此结构体用于 Task 8.1 合并冲突检测功能。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct ConflictFile {
    /// 冲突文件的路径（相对于仓库根目录）
    pub path: String,
    /// ours 版本的 blob hash（stage 2，当前分支版本）
    /// 如果当前分支没有该文件（如 DU 状态），则为 None
    pub ours_hash: Option<String>,
    /// theirs 版本的 blob hash（stage 3，被合并分支版本）
    /// 如果被合并分支没有该文件（如 UD 状态），则为 None
    pub theirs_hash: Option<String>,
    /// base 版本的 blob hash（stage 1，共同祖先版本）
    /// 如果文件是新增的（无共同祖先版本，如 AA 状态），则为 None
    pub base_hash: Option<String>,
}

/**
 * 检测仓库中存在合并冲突的文件列表
 *
 * 执行 `git ls-files -u -z` 命令获取所有 unmerged 文件的 stage 信息，
 * 解析后返回 ConflictFile 列表。
 *
 * `git ls-files -u -z` 输出格式（每个条目用 NUL 分隔）：
 *   `<mode> <hash> <stage>\t<file>\0`
 * 其中：
 * - mode：文件权限模式（如 100644）
 * - hash：blob 对象的 SHA-1 哈希（40 位）
 * - stage：阶段编号（1=base, 2=ours, 3=theirs）
 * - file：文件路径（相对于仓库根目录）
 *
 * 同一冲突文件会有多个 stage 条目（1/2/3），此函数会将它们合并为单个 ConflictFile。
 *
 * 此函数用于 merge/pull/rebase 等操作后检测是否产生冲突。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(Vec<ConflictFile>): 冲突文件列表（无冲突时返回空 Vec）
 * - Err(GitError): 命令执行失败
 */
pub fn detect_conflicts(repo_path: &str) -> Result<Vec<ConflictFile>, GitError> {
    // 执行 git ls-files -u -z
    // -u：显示 unmerged 文件（带 stage 信息）
    // -z：使用 NUL 字符分隔条目（处理含空格/特殊字符的文件名）
    let bytes = run_git_raw(repo_path, &["ls-files", "-u", "-z"])?;

    // 如果输出为空，说明没有冲突文件
    if bytes.is_empty() {
        return Ok(Vec::new());
    }

    // 使用 HashMap 按文件路径分组，收集每个文件的三个 stage hash
    // key: 文件路径，value: (base_hash, ours_hash, theirs_hash)
    let mut conflict_map: std::collections::HashMap<String, (Option<String>, Option<String>, Option<String>)> =
        std::collections::HashMap::new();

    // 按 NUL 字符分割字节流
    let fields: Vec<&[u8]> = bytes.split(|&b| b == 0).collect();

    for field in fields {
        // 跳过空字段（-z 格式末尾会有一个空字段）
        if field.is_empty() {
            continue;
        }

        // 将字节转换为字符串（lossy 转换避免无效 UTF-8 导致 panic）
        let line = String::from_utf8_lossy(field);

        // 解析行格式：<mode> <hash> <stage>\t<file>
        // 先按 tab 分割，分离出 "<mode> <hash> <stage>" 和 "<file>" 两部分
        let tab_pos = match line.find('\t') {
            Some(pos) => pos,
            None => continue, // 格式异常，跳过
        };

        let meta_part = &line[..tab_pos]; // "<mode> <hash> <stage>"
        let file_path = &line[tab_pos + 1..]; // "<file>"

        // 解析 meta 部分：按空格分割为 [mode, hash, stage]
        let meta_tokens: Vec<&str> = meta_part.split_whitespace().collect();
        if meta_tokens.len() < 3 {
            continue; // 格式异常，跳过
        }

        let hash = meta_tokens[1].to_string();
        let stage: u32 = meta_tokens[2].parse().unwrap_or(0);

        // 获取或创建该文件的冲突信息条目
        let entry = conflict_map
            .entry(file_path.to_string())
            .or_insert((None, None, None));

        // 根据 stage 编号填充对应的 hash
        match stage {
            1 => entry.0 = Some(hash), // base（共同祖先）
            2 => entry.1 = Some(hash), // ours（当前分支）
            3 => entry.2 = Some(hash), // theirs（被合并分支）
            _ => {} // 忽略其他 stage（理论上不会出现）
        }
    }

    // 将 HashMap 转换为 Vec<ConflictFile>
    let conflicts: Vec<ConflictFile> = conflict_map
        .into_iter()
        .map(|(path, (base_hash, ours_hash, theirs_hash))| ConflictFile {
            path,
            ours_hash,
            theirs_hash,
            base_hash,
        })
        .collect();

    Ok(conflicts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_status_z_basic() {
        // 模拟 git status -s --porcelain -z 的输出
        // "M  file.txt\0?? new_file.txt\0"
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"M  file.txt");
        bytes.push(0);
        bytes.extend_from_slice(b"?? new_file.txt");
        bytes.push(0);

        let entries = parse_status_z_output(&bytes);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "file.txt");
        assert_eq!(entries[0].status, FileStatus::Modified);
        assert!(entries[0].staged);
        assert_eq!(entries[1].path, "new_file.txt");
        assert_eq!(entries[1].status, FileStatus::Untracked);
        assert!(!entries[1].staged);
    }

    #[test]
    fn test_parse_status_z_rename() {
        // 测试重命名（R 状态码，占用 2 个槽位）
        // "R  old.txt\0new.txt\0"
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"R  old.txt");
        bytes.push(0);
        bytes.extend_from_slice(b"new.txt");
        bytes.push(0);

        let entries = parse_status_z_output(&bytes);

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "new.txt");
        assert_eq!(entries[0].status, FileStatus::Renamed);
        assert_eq!(entries[0].old_path, Some("old.txt".to_string()));
        assert!(entries[0].staged);
    }

    #[test]
    fn test_parse_status_z_deleted() {
        // 测试删除
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b" D deleted.txt");
        bytes.push(0);

        let entries = parse_status_z_output(&bytes);

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "deleted.txt");
        assert_eq!(entries[0].status, FileStatus::Deleted);
        assert!(!entries[0].staged); // 工作区删除，未暂存
    }

    #[test]
    fn test_parse_status_z_empty() {
        // 空输出应该返回空列表
        let entries = parse_status_z_output(&[]);
        assert!(entries.is_empty());
    }
}
