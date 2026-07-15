/*
 * Git 历史文件清理（Purge History Files）模块
 *
 * 此模块封装了"清理 Git 历史中的大文件 / 敏感文件"相关功能，包括：
 * 1. 扫描仓库历史中所有出现过的文件，统计每个文件的最大大小、总大小、出现次数
 * 2. 检测系统是否安装了 git-filter-repo 工具（推荐）或只能使用 git filter-branch（兼容）
 * 3. 执行历史清理操作（通过 filter-repo 或 filter-branch 重写历史）
 * 4. 查询仓库当前大小（git count-objects -vH）
 *
 * 使用场景：
 * - 用户发现仓库体积过大，想找出历史中的大文件并清理
 * - 用户误提交了敏感文件（如密码、密钥），想从历史中彻底删除
 * - 用户想优化仓库体积，减小克隆时间
 *
 * 依赖关系：
 * purge -> commands（使用 run_git / run_git_with_env 执行 git 命令，使用 GitError 处理错误）
 *
 * 重要约束：
 * - filter-repo 是独立的 Python 脚本/可执行文件，不是 git 的内置子命令，
 *   需要用 Command::new("git").args(&["filter-repo", ...]) 调用（不通过 run_git，
 *   因为 run_git 会自动添加 --no-pager 前缀，可能干扰 filter-repo 的参数解析）
 * - filter-branch 需要 FILTER_BRANCH_SQUELCH_WARNING=1 环境变量避免警告输出
 * - 清理操作会改写 Git 历史，属于危险操作，调用方应在前端做二次确认
 */

// 引入通用的 Git 命令执行器和错误类型
use super::commands::{run_git, run_git_with_env, GitError};

// 引入标准库的进程、集合、IO 相关模块
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::process::{Command, Stdio};

/**
 * 历史文件信息结构体
 *
 * 表示一个文件在 Git 历史中出现的统计信息。
 * 每个路径对应一个 HistoryFileInfo 实例（按路径去重后）。
 *
 * 字段说明：
 * - path: 文件在仓库中的相对路径（如 "src/main.rs"）
 * - max_size: 该文件所有版本中最大的大小（字节），用于识别大文件
 * - total_size: 该文件所有版本的大小总和（字节），用于评估清理收益
 * - commit_count: 该文件在历史中出现的次数（近似反映修改次数）
 *
 * 序列化为 JSON 后传递给前端，前端据此显示文件列表和筛选大文件。
 */
#[derive(Debug, Clone, serde::Serialize)]
pub struct HistoryFileInfo {
    /// 文件在仓库中的相对路径（如 "src/main.rs"）
    pub path: String,
    /// 该文件所有版本中最大的大小（字节）
    pub max_size: u64,
    /// 该文件所有版本的总大小（字节）
    pub total_size: u64,
    /// 该文件出现在多少个提交中（从 rev-list 输出统计，近似反映修改次数）
    pub commit_count: u32,
}

/**
 * git-filter-repo 工具可用性状态
 *
 * 表示系统是否安装了 git-filter-repo 工具，以及其版本号。
 * 前端据此决定是显示"建议安装 filter-repo"的提示，
 * 还是直接使用 filter-branch（兼容方案，但较慢）。
 *
 * 字段说明：
 * - available: 是否可用（true 表示已安装 filter-repo）
 * - version: 版本号字符串（如 "2.38.0"）；不可用时为 None
 */
#[derive(Debug, Clone, serde::Serialize)]
pub struct FilterRepoStatus {
    /// filter-repo 是否可用
    pub available: bool,
    /// 版本号字符串（不可用时为 None）
    pub version: Option<String>,
}

/**
 * 历史清理操作结果
 *
 * 包含清理操作的全部结果信息，前端据此显示操作结果和仓库大小对比。
 *
 * 字段说明：
 * - success: 操作是否成功
 * - before_size: 操作前的仓库大小（人类可读字符串，如 "12.5 MiB"）
 * - after_size: 操作后的仓库大小（人类可读字符串）
 * - backup_branch: 备份分支名（如果创建了备份）；未创建时为 None
 * - method: 使用的清理方法（"filter-repo" 或 "filter-branch"）
 * - error: 错误信息（操作失败时）；成功时为 None
 */
#[derive(Debug, Clone, serde::Serialize)]
pub struct PurgeResult {
    /// 操作是否成功
    pub success: bool,
    /// 操作前的仓库大小（人类可读字符串）
    pub before_size: String,
    /// 操作后的仓库大小（人类可读字符串）
    pub after_size: String,
    /// 备份分支名（如果创建了备份）
    pub backup_branch: Option<String>,
    /// 使用的清理方法（"filter-repo" 或 "filter-branch"）
    pub method: String,
    /// 错误信息（操作失败时）
    pub error: Option<String>,
}

/**
 * 扫描 Git 历史中的所有文件并统计大小信息
 *
 * 此函数执行以下步骤：
 * 1. 执行 `git rev-list --objects --all` 获取所有历史对象列表
 *    - 输出格式：每行 `<object_hash> <file_path>` 或仅 `<commit_hash>`（对于提交对象本身）
 *    - 其中带路径的行代表 blob（文件）或 tree（目录），不带路径的行代表 commit
 * 2. 解析输出，收集 (path, hash) 对，并统计每个 path 的出现次数（用于 commit_count）
 * 3. 用 `git cat-file --batch-check` 批量查询所有 hash 的对象类型和大小
 *    - 通过 stdin 传入所有 hash（每行一个），避免逐个查询的性能开销
 *    - 输出格式：`<objecttype> <objectname> <objectsize> [<rest>]`
 * 4. 过滤出 objecttype == "blob" 的对象，建立 hash -> size 映射
 * 5. 按 path 聚合统计：max_size、total_size、commit_count
 * 6. 按 max_size 降序排序，返回结果列表
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(Vec<HistoryFileInfo>) - 扫描成功，返回按 max_size 降序排序的文件列表
 * - Err(GitError) - 扫描失败（如不是 git 仓库、git 命令执行失败等）
 *
 * 使用示例：
 * ```
 * let files = scan_history_files("/path/to/repo")?;
 * for file in &files {
 *     println!("{}: max={} total={} commits={}",
 *              file.path, file.max_size, file.total_size, file.commit_count);
 * }
 * ```
 */
pub fn scan_history_files(repo_path: &str) -> Result<Vec<HistoryFileInfo>, GitError> {
    // ============================================================
    // 步骤 1: 执行 git rev-list --objects --all 获取所有历史对象
    // ============================================================
    // --objects: 除了 commit 对象外，还输出每个 commit 引用的 tree 和 blob 对象
    // --all: 包含所有引用（heads/tags/remotes）可达的提交
    let rev_list_output = run_git(repo_path, &["rev-list", "--objects", "--all"])?;
    let rev_list_str = &rev_list_output.stdout;

    // ============================================================
    // 步骤 2: 解析 rev-list 输出，收集 (path, hash) 对和 path 出现次数
    // ============================================================
    // path_hashes: 存储 (path, hash) 对，用于后续关联 blob 大小
    let mut path_hashes: Vec<(String, String)> = Vec::new();
    // path_commit_count: 统计每个 path 在 rev-list 输出中出现的次数（近似 commit_count）
    let mut path_commit_count: HashMap<String, u32> = HashMap::new();
    // all_hashes: 收集所有出现过的对象 hash（用于批量查询 cat-file）
    let mut all_hashes: HashSet<String> = HashSet::new();

    // 逐行解析 rev-list 输出
    for line in rev_list_str.lines() {
        // 去除首尾空白字符
        let line = line.trim();
        // 跳过空行
        if line.is_empty() {
            continue;
        }

        // 按空格分割，最多分成 2 部分：hash 和 path
        // 使用 splitn(2, ' ') 确保路径中的空格不会被错误分割
        let mut parts = line.splitn(2, ' ');
        let hash = parts.next().unwrap_or("");
        let path = parts.next().unwrap_or("").trim();

        // 跳过 commit 对象（只有 hash，没有 path）
        if hash.is_empty() || path.is_empty() {
            continue;
        }

        // 记录 (path, hash) 对
        path_hashes.push((path.to_string(), hash.to_string()));
        // 统计 path 出现次数（每个版本都会累加）
        *path_commit_count.entry(path.to_string()).or_insert(0) += 1;
        // 收集 hash 用于批量查询
        all_hashes.insert(hash.to_string());
    }

    // 如果没有任何对象（空仓库），直接返回空列表
    if all_hashes.is_empty() {
        return Ok(Vec::new());
    }

    // ============================================================
    // 步骤 3: 用 git cat-file --batch-check 批量查询所有 hash 的类型和大小
    // ============================================================
    // 构造 stdin 输入：每个 hash 占一行
    let hash_input: String = all_hashes
        .iter()
        .map(|h| h.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    // 创建 git cat-file 进程
    // 注意：这里不使用 run_git，因为需要通过 stdin 传入大量 hash，
    // 而 run_git 不支持 stdin 输入
    let mut cmd = Command::new("git");
    // 设置工作目录为仓库路径
    cmd.current_dir(repo_path);
    // 添加 cat-file --batch-check 参数
    // --batch-check: 批量查询对象类型和大小，不输出对象内容（性能更好）
    // 默认输出格式：%(objecttype) %(objectname) %(objectsize) %(rest)
    cmd.args(["cat-file", "--batch-check"]);
    // 配置 stdin 管道（用于写入 hash 列表）
    cmd.stdin(Stdio::piped());
    // 配置 stdout 管道（用于读取查询结果）
    cmd.stdout(Stdio::piped());

    // Windows 平台特殊处理：隐藏控制台窗口
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // 启动子进程
    let mut child = cmd.spawn().map_err(|e| GitError::CommandFailed {
        exit_code: -1,
        message: format!("无法启动 git cat-file 进程: {}", e),
    })?;

    // 获取 stdin 的可变引用并写入 hash 列表
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(hash_input.as_bytes())
            .map_err(|e| GitError::Io(format!("写入 cat-file stdin 失败: {}", e)))?;
    }

    // 关闭 stdin 以通知 git 输入结束（重要：否则 git 会一直等待输入）
    drop(child.stdin.take());

    // 等待子进程完成并获取输出
    let output = child
        .wait_with_output()
        .map_err(|e| GitError::CommandFailed {
            exit_code: -1,
            message: format!("等待 git cat-file 进程失败: {}", e),
        })?;

    // 检查命令是否执行成功
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(GitError::CommandFailed {
            exit_code: output.status.code().unwrap_or(-1),
            message: stderr,
        });
    }

    // ============================================================
    // 步骤 4: 解析 cat-file --batch-check 输出，建立 hash -> size 映射（仅 blob）
    // ============================================================
    let cat_output_str = String::from_utf8_lossy(&output.stdout);
    // hash_size: 存储 hash -> size 的映射（仅包含 blob 类型的对象）
    let mut hash_size: HashMap<String, u64> = HashMap::new();

    // 逐行解析 cat-file 输出
    for line in cat_output_str.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // 按空白字符分割
        let parts: Vec<&str> = line.split_whitespace().collect();
        // 至少需要 3 部分：objecttype, objectname, objectsize
        if parts.len() < 3 {
            continue;
        }

        let objecttype = parts[0]; // 对象类型：blob / tree / commit / tag / missing
        let objectname = parts[1]; // 对象 hash
        let objectsize_str = parts[2]; // 对象大小（字节）

        // 只关心 blob 类型（文件内容）
        // 跳过 tree（目录）、commit（提交）、tag（标签）、missing（不存在）
        if objecttype == "blob" {
            // 解析大小字符串为 u64
            if let Ok(size) = objectsize_str.parse::<u64>() {
                hash_size.insert(objectname.to_string(), size);
            }
        }
    }

    // ============================================================
    // 步骤 5: 按 path 聚合统计 max_size 和 total_size
    // ============================================================
    // path_stats: 存储 path -> (max_size, total_size)
    let mut path_stats: HashMap<String, (u64, u64)> = HashMap::new();

    // 遍历所有 (path, hash) 对，关联 blob 大小并聚合统计
    for (path, hash) in &path_hashes {
        // 只有当 hash 对应的对象是 blob 时才统计（跳过 tree 等非文件对象）
        if let Some(&size) = hash_size.get(hash) {
            // 获取或插入 path 的统计条目，初始值为 (0, 0)
            let entry = path_stats.entry(path.clone()).or_insert((0, 0));
            // 更新 max_size（取最大值）
            entry.0 = entry.0.max(size);
            // 累加 total_size
            entry.1 += size;
        }
    }

    // ============================================================
    // 步骤 6: 构造结果列表并按 max_size 降序排序
    // ============================================================
    let mut result: Vec<HistoryFileInfo> = path_stats
        .into_iter()
        .map(|(path, (max_size, total_size))| HistoryFileInfo {
            path: path.clone(),
            max_size,
            total_size,
            // 从 path_commit_count 获取出现次数，默认为 0
            commit_count: *path_commit_count.get(&path).unwrap_or(&0),
        })
        .collect();

    // 按 max_size 降序排序（大文件排在前面）
    // 使用 b.max_size.cmp(&a.max_size) 实现降序
    result.sort_by(|a, b| b.max_size.cmp(&a.max_size));

    Ok(result)
}

/**
 * 检测系统是否安装了 git-filter-repo 工具
 *
 * git-filter-repo 是一个独立的 Python 脚本工具（非 git 内置子命令），
 * 用于重写 Git 历史。相比 git filter-branch，它更快、更安全、更易用。
 *
 * 此函数执行 `git filter-repo --version` 命令：
 * - 如果成功，说明 filter-repo 已安装，返回 available=true 和版本号
 * - 如果失败（命令不存在或返回非零退出码），说明未安装，返回 available=false
 *
 * 注意：filter-repo 通常通过 `git filter-repo` 调用（git extensions 机制），
 * 而非直接调用 `git-filter-repo`。所以这里用 `git filter-repo --version`。
 *
 * 不使用 run_git 的原因：run_git 会自动添加 --no-pager 前缀，
 * 而 filter-repo 不是 git 的内置子命令，--no-pager 可能干扰其参数解析。
 *
 * 返回值：
 * - Ok(FilterRepoStatus) - 检测完成（无论是否可用都返回 Ok）
 * - Err(GitError) - 检测过程中发生异常（如无法启动 git 进程）
 *
 * 使用示例：
 * ```
 * let status = check_filter_repo_available()?;
 * if status.available {
 *     println!("filter-repo 已安装，版本: {:?}", status.version);
 * } else {
 *     println!("filter-repo 未安装，将使用 filter-branch（较慢）");
 * }
 * ```
 */
pub fn check_filter_repo_available() -> Result<FilterRepoStatus, GitError> {
    // 创建 git 命令进程，执行 filter-repo --version
    // 不使用 run_git，因为 run_git 会添加 --no-pager 前缀
    let mut cmd = Command::new("git");
    cmd.args(["filter-repo", "--version"]);

    // Windows 平台：隐藏控制台窗口
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // 执行命令并获取输出
    let output = cmd.output().map_err(|e| GitError::CommandFailed {
        exit_code: -1,
        message: format!("无法启动 git 进程检测 filter-repo: {}", e),
    })?;

    // 检查命令是否执行成功
    if output.status.success() {
        // 成功：filter-repo 已安装
        // 解析版本号（从 stdout 或 stderr 中提取）
        // filter-repo --version 的输出格式通常为：
        // "git-filter-repo version 2.38.0" 或直接输出到 stderr
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

        // 优先使用 stdout，如果 stdout 为空则使用 stderr
        let version_str = if !stdout.is_empty() { stdout } else { stderr };

        // 提取版本号：从 "git-filter-repo version 2.38.0" 中提取 "2.38.0"
        let version = extract_version(&version_str);

        Ok(FilterRepoStatus {
            available: true,
            version,
        })
    } else {
        // 失败：filter-repo 未安装或不可用
        // 不返回错误，而是返回 available=false（这是预期情况，不是异常）
        Ok(FilterRepoStatus {
            available: false,
            version: None,
        })
    }
}

/**
 * 从字符串中提取版本号
 *
 * 从形如 "git-filter-repo version 2.38.0" 的字符串中提取版本号 "2.38.0"。
 * 如果无法提取，返回原始字符串（去除首尾空白）。
 *
 * 参数：
 * - s: 包含版本号的字符串
 *
 * 返回值：
 * - Some(version) - 提取成功
 * - None - 输入字符串为空
 */
fn extract_version(s: &str) -> Option<String> {
    // 如果输入为空，返回 None
    if s.is_empty() {
        return None;
    }

    // 查找 "version" 关键字后的版本号
    // 格式通常为 "git-filter-repo version 2.38.0"
    if let Some(pos) = s.to_lowercase().find("version") {
        // 取 "version" 之后的部分
        let after_version = &s[pos + "version".len()..].trim();
        if !after_version.is_empty() {
            // 取第一个空白字符前的部分作为版本号
            let version: String = after_version
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_string();
            if !version.is_empty() {
                return Some(version);
            }
        }
    }

    // 如果找不到 "version" 关键字，返回整个字符串（可能是纯版本号）
    Some(s.to_string())
}

/**
 * 从 Git 历史中清除指定文件
 *
 * 此函数会重写 Git 历史，将指定文件从所有提交中彻底删除。
 * 支持两种实现方式：
 * 1. 优先使用 git-filter-repo（如果已安装）：更快、更安全
 * 2. 回退使用 git filter-branch（兼容方案）：较慢，但所有 Git 版本都支持
 *
 * 执行步骤：
 * 1. 调用 get_repo_size 获取操作前的仓库大小
 * 2. 如果 create_backup 为 true 且提供了 backup_branch_name，创建备份分支
 * 3. 检测 filter-repo 是否可用
 * 4. 如果 filter-repo 可用：
 *    - 执行 `git filter-repo --path <path1> --path <path2> ... --invert-paths`
 *    - --invert-paths 表示"删除匹配的路径"（默认是保留匹配的路径）
 * 5. 如果 filter-repo 不可用：
 *    - 执行 `git filter-branch --force --index-filter "git rm --cached --ignore-unmatch <paths>" --prune-empty --tag-name-filter cat -- --all`
 *    - 设置环境变量 FILTER_BRANCH_SQUELCH_WARNING=1 避免警告输出
 * 6. 调用 get_repo_size 获取操作后的仓库大小
 * 7. 执行 `git reflog expire --expire=now --all` 和 `git gc --prune=now --aggressive` 清理残留对象
 * 8. 返回 PurgeResult 包含操作结果
 *
 * ⚠️ 危险操作 ⚠️
 * - 此操作会改写 Git 历史，所有提交的 hash 都会改变
 * - 如果仓库已推送到远程，清理后需要 force push（可能影响其他协作者）
 * - 调用方应在前端做二次确认，并明确告知用户风险
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_paths: 要清除的文件路径列表（相对于仓库根目录）
 * - create_backup: 是否创建备份分支（true=创建，false=不创建）
 * - backup_branch_name: 备份分支名（create_backup 为 true 时使用）；None 时不创建备份
 *
 * 返回值：
 * - Ok(PurgeResult) - 操作完成（无论成功或失败都返回 Ok，通过 success 字段区分）
 * - Err(GitError) - 操作过程中发生异常（如无法访问仓库路径）
 *
 * 使用示例：
 * ```
 * let result = purge_files_from_history(
 *     "/path/to/repo",
 *     &["large_file.bin".to_string(), "secret.key".to_string()],
 *     true,
 *     Some("backup-before-purge"),
 * )?;
 * if result.success {
 *     println!("清理成功！仓库从 {} 减小到 {}", result.before_size, result.after_size);
 * }
 * ```
 */
pub fn purge_files_from_history(
    repo_path: &str,
    file_paths: &[String],
    create_backup: bool,
    backup_branch_name: Option<&str>,
) -> Result<PurgeResult, GitError> {
    // 验证文件路径列表不为空
    if file_paths.is_empty() {
        return Ok(PurgeResult {
            success: false,
            before_size: String::new(),
            after_size: String::new(),
            backup_branch: None,
            method: String::new(),
            error: Some("未指定要清除的文件路径".to_string()),
        });
    }

    // ============================================================
    // 步骤 1: 获取操作前的仓库大小
    // ============================================================
    let before_size = get_repo_size(repo_path).unwrap_or_else(|_| "未知".to_string());

    // ============================================================
    // 步骤 2: 创建备份分支（如果要求）
    // ============================================================
    let backup_branch = if create_backup {
        if let Some(branch_name) = backup_branch_name {
            // 执行 git branch <branch_name> 创建备份分支（指向当前 HEAD）
            let args = ["branch", branch_name];
            match run_git(repo_path, &args) {
                Ok(_) => Some(branch_name.to_string()),
                Err(e) => {
                    // 创建备份失败，返回错误结果
                    // 注意：由于 before_size 会被 move 到返回结构体中，
                    // 需要先 clone 出 after_size，避免 move 后再借用
                    let after_size = before_size.clone();
                    return Ok(PurgeResult {
                        success: false,
                        before_size,
                        after_size,
                        backup_branch: None,
                        method: String::new(),
                        error: Some(format!("创建备份分支失败: {}", e)),
                    });
                }
            }
        } else {
            // create_backup 为 true 但未提供分支名，视为不创建备份
            None
        }
    } else {
        None
    };

    // ============================================================
    // 步骤 3: 检测 filter-repo 是否可用
    // ============================================================
    let filter_repo_status = check_filter_repo_available()?;

    // ============================================================
    // 步骤 4-5: 根据可用性选择 filter-repo 或 filter-branch
    // ============================================================
    // 记录使用的方法（用于结果返回）
    let method = if filter_repo_status.available {
        "filter-repo"
    } else {
        "filter-branch"
    };

    // 执行清理操作，捕获可能的错误
    let purge_result: Result<(), GitError> = if filter_repo_status.available {
        // ----------------------------------------------------------
        // 使用 git filter-repo（推荐方案，更快更安全）
        // ----------------------------------------------------------
        // 构造参数：filter-repo --path <path1> --path <path2> ... --invert-paths
        // --invert-paths: 反转匹配，即删除匹配的路径（默认是保留匹配的路径）
        let mut args: Vec<String> = vec!["filter-repo".to_string()];
        // 为每个文件路径添加 --path 参数
        for path in file_paths {
            args.push("--path".to_string());
            args.push(path.clone());
        }
        // 添加 --invert-paths 表示删除匹配的文件
        args.push("--invert-paths".to_string());
        // 添加 --force 强制执行（filter-repo 默认要求干净的工作区，--force 跳过此检查）
        args.push("--force".to_string());

        // 将 Vec<String> 转换为 Vec<&str> 供 Command::args 使用
        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

        // 创建 git 命令进程
        // 不使用 run_git，因为 filter-repo 不是 git 的内置子命令
        let mut cmd = Command::new("git");
        cmd.current_dir(repo_path);
        cmd.args(&args_ref);

        // Windows 平台：隐藏控制台窗口
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        // 执行命令并获取输出
        let output = cmd.output().map_err(|e| GitError::CommandFailed {
            exit_code: -1,
            message: format!("无法启动 git filter-repo 进程: {}", e),
        })?;

        // 检查命令是否执行成功
        if output.status.success() {
            Ok(())
        } else {
            // 解析 stderr 作为错误信息
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Err(GitError::CommandFailed {
                exit_code: output.status.code().unwrap_or(-1),
                message: if stderr.is_empty() { stdout } else { stderr },
            })
        }
    } else {
        // ----------------------------------------------------------
        // 使用 git filter-branch（兼容方案，较慢）
        // ----------------------------------------------------------
        // 构造 index-filter 命令字符串
        // git rm --cached --ignore-unmatch <path1> <path2> ...
        // --cached: 只从索引中删除，不影响工作区
        // --ignore-unmatch: 如果文件不存在于某个提交中，不报错（静默跳过）
        let paths_joined = file_paths
            .iter()
            .map(|p| format!("'{}'", p.replace('\'', "'\\''")))
            .collect::<Vec<_>>()
            .join(" ");
        let index_filter = format!("git rm --cached --ignore-unmatch {}", paths_joined);

        // 构造 filter-branch 参数
        // --force: 强制执行（覆盖之前的 filter-branch 备份）
        // --index-filter: 索引过滤器（对每个提交的索引执行此命令）
        // --prune-empty: 删除变为空的提交
        // --tag-name-filter cat: 重写标签指向新的提交
        // -- --all: 对所有引用（branches/tags）执行
        let args: Vec<&str> = vec![
            "filter-branch",
            "--force",
            "--index-filter",
            &index_filter,
            "--prune-empty",
            "--tag-name-filter",
            "cat",
            "--",
            "--all",
        ];

        // 设置环境变量 FILTER_BRANCH_SQUELCH_WARNING=1 避免警告输出
        // filter-branch 已被废弃，每次执行都会输出警告，此环境变量抑制警告
        let env: [(&str, &str); 1] = [("FILTER_BRANCH_SQUELCH_WARNING", "1")];

        // 使用 run_git_with_env 执行（filter-branch 是 git 的内置子命令）
        run_git_with_env(repo_path, &args, &env).map(|_| ())
    };

    // 检查清理操作是否成功
    if let Err(e) = purge_result {
        // 清理失败，返回错误结果
        // 注意：由于 before_size 会被 move 到返回结构体中，
        // 需要先 clone 出 after_size，避免 move 后再借用
        let after_size = before_size.clone();
        return Ok(PurgeResult {
            success: false,
            before_size,
            after_size,
            backup_branch,
            method: method.to_string(),
            error: Some(format!("{}", e)),
        });
    }

    // ============================================================
    // 步骤 6: 获取操作后的仓库大小
    // ============================================================
    let after_size = get_repo_size(repo_path).unwrap_or_else(|_| "未知".to_string());

    // ============================================================
    // 步骤 7: 清理残留对象（reflog 过期 + gc）
    // ============================================================
    // 执行 git reflog expire --expire=now --all
    // 让所有 reflog 条目立即过期，这样 gc 才能真正清理被重写历史引用的旧对象
    let _ = run_git(repo_path, &["reflog", "expire", "--expire=now", "--all"]);

    // 执行 git gc --prune=now --aggressive
    // --prune=now: 立即清理不可达对象（默认是 2 周前）
    // --aggressive: 使用更彻底的压缩算法（耗时更长，但效果更好）
    let _ = run_git(repo_path, &["gc", "--prune=now", "--aggressive"]);

    // ============================================================
    // 步骤 8: 返回成功结果
    // ============================================================
    Ok(PurgeResult {
        success: true,
        before_size,
        after_size,
        backup_branch,
        method: method.to_string(),
        error: None,
    })
}

/**
 * 获取 Git 仓库的当前大小
 *
 * 执行 `git count-objects -vH` 命令并解析输出中的 `size-pack:` 行。
 *
 * 命令参数说明：
 * - -v: verbose，输出详细统计信息（包含 count/size/in-pack/packs/size-pack 等）
 * - -H: human-readable，输出人类可读格式（如 "12.5 MiB" 而非 "12582912"）
 *
 * 输出示例：
 * ```
 * count: 123
 * size: 0.5 KiB
 * in-pack: 789
 * packs: 2
 * size-pack: 12.5 MiB        <-- 解析此行的值
 * prune-packable: 0
 * garbage: 0
 * size-garbage: 0 bytes
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(String) - 仓库大小字符串（如 "12.5 MiB"）
 * - Err(GitError) - 命令执行失败
 *
 * 如果输出中没有 size-pack 行，返回 "0 bytes"。
 *
 * 使用示例：
 * ```
 * let size = get_repo_size("/path/to/repo")?;
 * println!("仓库大小: {}", size);  // 输出: 仓库大小: 12.5 MiB
 * ```
 */
pub fn get_repo_size(repo_path: &str) -> Result<String, GitError> {
    // 执行 git count-objects -vH
    // -v: 输出详细统计信息
    // -H: 输出人类可读格式
    let output = run_git(repo_path, &["count-objects", "-vH"])?;

    // 逐行查找 size-pack 行
    for line in output.stdout.lines() {
        let line = line.trim();
        // 检查是否以 "size-pack:" 开头
        if let Some(value) = line.strip_prefix("size-pack:") {
            // 提取冒号后的值并去除空白
            let size = value.trim();
            if !size.is_empty() {
                return Ok(size.to_string());
            }
        }
    }

    // 如果没有 size-pack 行，返回 "0 bytes"
    Ok("0 bytes".to_string())
}

// ============================================================
// 单元测试模块
// ============================================================
#[cfg(test)]
mod tests {
    use super::*;

    /**
     * 测试 extract_version 函数
     */
    #[test]
    fn test_extract_version() {
        // 标准格式 "git-filter-repo version 2.38.0"
        assert_eq!(
            extract_version("git-filter-repo version 2.38.0"),
            Some("2.38.0".to_string())
        );
        // 大小写混合
        assert_eq!(
            extract_version("git-filter-repo Version 1.5.0"),
            Some("1.5.0".to_string())
        );
        // 纯版本号（无 "version" 关键字）
        assert_eq!(
            extract_version("2.38.0"),
            Some("2.38.0".to_string())
        );
        // 空字符串
        assert_eq!(extract_version(""), None);
    }

    /**
     * 测试 HistoryFileInfo 结构体的序列化
     */
    #[test]
    fn test_history_file_info_serialize() {
        let info = HistoryFileInfo {
            path: "large.bin".to_string(),
            max_size: 1024,
            total_size: 2048,
            commit_count: 3,
        };
        let json = serde_json::to_string(&info).unwrap();
        // 验证 JSON 包含所有字段
        assert!(json.contains("\"path\":\"large.bin\""));
        assert!(json.contains("\"max_size\":1024"));
        assert!(json.contains("\"total_size\":2048"));
        assert!(json.contains("\"commit_count\":3"));
    }

    /**
     * 测试 FilterRepoStatus 结构体的序列化
     */
    #[test]
    fn test_filter_repo_status_serialize() {
        // 可用状态
        let available = FilterRepoStatus {
            available: true,
            version: Some("2.38.0".to_string()),
        };
        let json = serde_json::to_string(&available).unwrap();
        assert!(json.contains("\"available\":true"));
        assert!(json.contains("\"version\":\"2.38.0\""));

        // 不可用状态
        let unavailable = FilterRepoStatus {
            available: false,
            version: None,
        };
        let json = serde_json::to_string(&unavailable).unwrap();
        assert!(json.contains("\"available\":false"));
        assert!(json.contains("\"version\":null"));
    }

    /**
     * 测试 PurgeResult 结构体的序列化
     */
    #[test]
    fn test_purge_result_serialize() {
        // 成功结果
        let success = PurgeResult {
            success: true,
            before_size: "100 MiB".to_string(),
            after_size: "50 MiB".to_string(),
            backup_branch: Some("backup".to_string()),
            method: "filter-repo".to_string(),
            error: None,
        };
        let json = serde_json::to_string(&success).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"before_size\":\"100 MiB\""));
        assert!(json.contains("\"method\":\"filter-repo\""));

        // 失败结果
        let failure = PurgeResult {
            success: false,
            before_size: "100 MiB".to_string(),
            after_size: "100 MiB".to_string(),
            backup_branch: None,
            method: "filter-branch".to_string(),
            error: Some("命令执行失败".to_string()),
        };
        let json = serde_json::to_string(&failure).unwrap();
        assert!(json.contains("\"success\":false"));
        assert!(json.contains("\"error\":\"命令执行失败\""));
    }
}
