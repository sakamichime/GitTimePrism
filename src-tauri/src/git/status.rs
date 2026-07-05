/*
 * Git 仓库状态查询模块
 * 
 * 此模块负责解析 `git status --porcelain=v2` 命令的输出，
 * 将 Git 的文件状态信息转换为前端可用的结构化数据。
 * 
 * porcelain v2 格式是 Git 提供的机器可读输出格式，
 * 每行代表一个文件的状态，格式规范且易于解析。
 * 
 * porcelain v2 输出格式说明：
 * - 普通文件行：XY PATH
 *   X = 暂存区状态（索引中的状态）
 *   Y = 工作区状态（工作目录中的状态）
 *   PATH = 文件路径
 * 
 * 状态码含义：
 * - M = Modified（已修改）
 * - A = Added（已添加）
 * - D = Deleted（已删除）
 * - ? = Untracked（未跟踪）
 * - R = Renamed（已重命名）
 * - C = Copied（已复制）
 * - U = Unmerged（未合并，有冲突）
 * 
 * 示例输出：
 * 1 M. N...  file.txt          (已修改)
 * 1 A. N...  new_file.txt       (已添加到暂存区)
 * 1 .D N...  deleted_file.txt   (在工作区被删除)
 * ? untracked_file.txt          (未跟踪)
 */

use super::commands::{run_git, GitError};

/**
 * 文件状态枚举
 * 
 * 表示一个文件在 Git 仓库中的状态。
 * 对应 git status 输出中的状态码字母（M/A/D/?/R/C/U）。
 * 
 * 通过 serde 序列化，前端可以直接比较字符串值来判断状态。
 * 例如前端可以 `entry.status === "Modified"` 来判断文件是否被修改。
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
 * 每个条目对应 `git status --porcelain=v2` 输出中的一行。
 * 
 * 前端使用示例：
 * ```javascript
 * for (const entry of status.entries) {
 *   if (entry.status === 'Modified' && entry.staged) {
 *     console.log(`已暂存的修改: ${entry.path}`);
 *   }
 * }
 * ```
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct StatusEntry {
    /// 文件的路径（相对于仓库根目录）
    /// 例如 "src/main.rs" 或 "docs/README.md"
    pub path: String,

    /// 文件的当前状态（已修改/已添加/已删除/未跟踪等）
    /// 使用 FileStatus 枚举，前端可序列化为字符串进行比较
    pub status: FileStatus,

    /// 文件的原始路径（仅在重命名或复制时有值）
    /// 对于重命名的文件，此字段存储重命名前的路径
    /// 例如 Some("old_name.txt") 或 None
    pub old_path: Option<String>,

    /// 文件是否已暂存（staged）
    /// true = 变更已通过 `git add` 添加到暂存区
    /// false = 变更仅在工作区，尚未暂存
    /// 对于未跟踪文件，此字段始终为 false
    pub staged: bool,
}

/**
 * 仓库的完整状态信息
 * 
 * 包含当前分支名和所有文件状态条目。
 * 此结构体通过 serde 序列化为 JSON 后传递给前端。
 * 
 * 前端使用示例：
 * ```javascript
 * const status = await invoke('get_repo_status', { repoPath: '/path/to/repo' });
 * console.log(`当前分支: ${status.branch}`);
 * console.log(`变更文件数: ${status.entries.length}`);
 * ```
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct RepoStatus {
    /// 当前所在的分支名称
    /// 例如 "main" 或 "feature/bug-fix"
    pub branch: String,

    /// 所有文件状态条目的列表
    /// 每个条目包含文件路径、状态、是否暂存等信息
    pub entries: Vec<StatusEntry>,
}

/**
 * 解析单个状态码字符为 FileStatus 枚举
 * 
 * 将 git status --porcelain=v2 输出中的单个字母（M/A/D/?/R/C/U）
 * 转换为对应的 FileStatus 枚举值。
 * 
 * 参数：
 * - ch: 状态码字符（单个字母）
 * 
 * 返回值：
 * - Some(FileStatus) - 成功解析状态码
 * - None - 未识别的状态码（理论上不应出现）
 */
fn parse_status_char(ch: char) -> Option<FileStatus> {
    match ch {
        'M' => Some(FileStatus::Modified),   // M = Modified（已修改）
        'A' => Some(FileStatus::Added),       // A = Added（已添加）
        'D' => Some(FileStatus::Deleted),     // D = Deleted（已删除）
        '?' => Some(FileStatus::Untracked),  // ? = Untracked（未跟踪）
        'R' => Some(FileStatus::Renamed),     // R = Renamed（已重命名）
        'C' => Some(FileStatus::Copied),      // C = Copied（已复制）
        'U' => Some(FileStatus::Unmerged),   // U = Unmerged（未合并冲突）
        _ => None,                            // 未知状态码
    }
}

/**
 * 获取仓库的完整状态信息
 * 
 * 执行 `git status --porcelain=v2 --branch` 命令，解析其输出，
 * 返回当前分支和所有文件的状态列表。
 * 
 * porcelain v2 完整格式:
 * # branch.oid <commit_hash>
 * # branch.head <branch_name>
 * 1 XY SUB MH MI MW HH HI PATH
 * ? PATH
 * u XY SUB M1 M2 M3 H1 H2 PATH
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
        // 使用 split_whitespace() 自动处理多个空格
        if line.starts_with("1 ") {
            let tokens: Vec<&str> = line.split_whitespace().collect();
            
            // 至少需要 9 个字段: 1 XY SUB MH MI MW HH HI PATH
            if tokens.len() < 9 {
                continue;
            }

            let xy = tokens[1];       // XY 状态码（2字符）
            // tokens[2] = SUB (子模块信息，跳过)
            // tokens[3] = MH (HEAD mode，跳过)
            // tokens[4] = MI (暂存区 mode，跳过)
            // tokens[5] = MW (工作区 mode，跳过)
            // tokens[6] = HH (HEAD hash，跳过)
            // tokens[7] = HI (暂存区 hash，跳过)
            // tokens[8..] = PATH (可能包含空格)

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

            // 路径是第 9 个字段开始的所有内容（可能包含空格）
            let path = tokens[8..].join(" ");

            // 检查是否是重命名/复制文件（包含 " -> " 分隔符）
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
            let y_char = xy.chars().nth(1).unwrap_or(' ');
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
