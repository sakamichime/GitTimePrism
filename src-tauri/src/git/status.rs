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
 * 执行 `git status --porcelain=v2` 命令，解析其输出，
 * 返回当前分支和所有文件的状态列表。
 * 
 * 执行步骤：
 * 1. 执行 git status --porcelain=v2 --branch 获取机器可读的状态信息
 * 2. 解析 # branch 行获取当前分支名
 * 3. 解析每个文件行（1 XY PATH 或 ? PATH）获取文件状态
 * 4. 将所有信息组装为 RepoStatus 结构体返回
 * 
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * 
 * 返回值：
 * - Ok(RepoStatus) - 状态查询成功，包含分支名和文件状态列表
 * - Err(GitError) - 查询失败（不是 Git 仓库、命令执行错误等）
 * 
 * porcelain v2 格式详细说明：
 * # branch.oid [commit_hash]      - 当前 HEAD 提交的哈希值
 * # branch.head [branch_name]    - 当前分支名
 * 1 XY SUB PATH                   - 已跟踪文件的状态
 *   X = 暂存区状态
 *   Y = 工作区状态
 *   SUB = 子模块信息（通常为空）
 *   PATH = 文件路径
 * ? PATH                         - 未跟踪文件
 * u XY SUB PATH                   - 未合并文件（有冲突）
 */
pub fn get_status(repo_path: &str) -> Result<RepoStatus, GitError> {
    // 执行 git status --porcelain=v2 --branch
    // --porcelain=v2: 使用 v2 版本的机器可读格式
    // --branch: 在输出中包含分支信息（# branch.head 行）
    let output = run_git(repo_path, &["status", "--porcelain=v2", "--branch"])?;

    // 初始化结果数据
    let mut branch = String::from("unknown"); // 默认分支名
    let mut entries: Vec<StatusEntry> = Vec::new(); // 文件状态条目列表

    // 逐行解析 git status 的输出
    for line in output.stdout.lines() {
        // 跳过空行
        if line.is_empty() {
            continue;
        }

        // 解析分支信息行
        // 格式: # branch.head <branch_name>
        // 这行告诉我们当前所在的分支名称
        if line.starts_with("# branch.head ") {
            branch = line
                .strip_prefix("# branch.head ")
                .unwrap_or("unknown")
                .trim()
                .to_string();
            continue;
        }

        // 解析未跟踪文件行
        // 格式: ? <file_path>
        // ? 表示这是一个未被 Git 跟踪的新文件
        if line.starts_with("? ") {
            let path = line.strip_prefix("? ").unwrap_or("").trim().to_string();
            if !path.is_empty() {
                entries.push(StatusEntry {
                    path,
                    status: FileStatus::Untracked,
                    old_path: None,     // 未跟踪文件没有旧路径
                    staged: false,       // 未跟踪文件不可能被暂存
                });
            }
            continue;
        }

        // 解析已跟踪文件的状态行
        // 格式: 1 <xy> <sub> <path>   （普通文件）
        // 或:   1 <xy> <sub> <old_path> <new_path>  （重命名/复制的文件）
        // 第一个字符 '1' 表示这是一个普通条目
        // xy: 两个状态码字符
        //   x = 暂存区（索引）中的状态
        //   y = 工作区中的状态
        // sub: 子模块信息（对于非子模块文件为 '...' 或空）
        if line.starts_with("1 ") {
            // 去掉 "1 " 前缀，获取剩余部分
            let rest = &line[2..];

            // 提取状态码（前两个字符）
            // 例如 "M." 表示暂存区已修改，工作区未修改
            //     ".M" 表示暂存区未修改，工作区已修改
            //     "MM" 表示暂存区和工作区都已修改
            let x_char = rest.chars().next().unwrap_or(' ');  // 暂存区状态码
            let y_char = rest.chars().nth(1).unwrap_or(' '); // 工作区状态码

            // 判断文件是否已暂存
            // 如果 x_char 不是 '.' 和 ' '，说明暂存区有变更
            let staged = x_char != '.' && x_char != ' ';

            // 确定文件的最终状态
            // 优先使用暂存区状态（x），如果暂存区无变化则使用工作区状态（y）
            let status = if let Some(s) = parse_status_char(x_char) {
                s
            } else if let Some(s) = parse_status_char(y_char) {
                s
            } else {
                // 两个状态码都无效，跳过此行
                continue;
            };

            // 解析文件路径部分
            // 跳过 "XY" 状态码和 "..." 子模块标记
            // 剩余部分就是文件路径
            // 重命名/复制的文件格式为: <xy> ... <old_path> -> <new_path>
            let path_part = if rest.len() > 4 {
                // 跳过 "XY..."（4个字符），获取路径部分
                &rest[4..]
            } else {
                continue; // 行格式不正确，跳过
            };

            // 检查是否是重命名/复制文件（包含 " -> " 分隔符）
            if path_part.contains(" -> ") {
                // 重命名/复制的文件：old_path -> new_path
                let parts: Vec<&str> = path_part.splitn(2, " -> ").collect();
                let old_path = parts[0].trim().to_string();
                let new_path = parts[1].trim().to_string();

                entries.push(StatusEntry {
                    path: new_path,             // 当前路径（新路径）
                    status,                     // 文件状态
                    old_path: Some(old_path),   // 原始路径（旧路径）
                    staged,
                });
            } else {
                // 普通文件（非重命名/复制）
                let file_path = path_part.trim().to_string();
                if !file_path.is_empty() {
                    entries.push(StatusEntry {
                        path: file_path,
                        status,
                        old_path: None,
                        staged,
                    });
                }
            }
            continue;
        }

        // 解析未合并文件行（合并冲突）
        // 格式: u <xy> <sub> <path>
        // 'u' 表示此文件有合并冲突，需要手动解决
        if line.starts_with("u ") {
            let rest = &line[2..];
            let x_char = rest.chars().next().unwrap_or(' ');
            let y_char = rest.chars().nth(1).unwrap_or(' ');

            // 合并冲突的文件视为部分已暂存
            let staged = x_char != '.' && x_char != ' ';

            // 提取文件路径
            let path_part = if rest.len() > 4 {
                &rest[4..]
            } else {
                continue;
            };

            // 处理可能的重命名情况
            if path_part.contains(" -> ") {
                let parts: Vec<&str> = path_part.splitn(2, " -> ").collect();
                entries.push(StatusEntry {
                    path: parts[1].trim().to_string(),
                    status: FileStatus::Unmerged,
                    old_path: Some(parts[0].trim().to_string()),
                    staged,
                });
            } else {
                let file_path = path_part.trim().to_string();
                if !file_path.is_empty() {
                    entries.push(StatusEntry {
                        path: file_path,
                        status: FileStatus::Unmerged,
                        old_path: None,
                        staged,
                    });
                }
            }
            continue;
        }
    }

    // 组装并返回完整的仓库状态
    Ok(RepoStatus { branch, entries })
}
