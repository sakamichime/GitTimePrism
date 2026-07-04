/*
 * 仓库管理 Tauri IPC 命令模块
 * 
 * 此模块是前端与 Git 仓库操作之间的桥梁。
 * 每个函数使用 #[tauri::command] 宏标记，前端通过 invoke() 调用。
 * 
 * 提供以下 6 个命令：
 * 1. open_repo      - 打开已有仓库，获取仓库基本信息
 * 2. init_repo      - 在指定目录初始化新仓库
 * 3. clone_repo     - 从远程 URL 克隆仓库（异步执行，不阻塞 UI）
 * 4. get_repo_status - 获取仓库的文件状态（修改/添加/删除等）
 * 5. get_branches   - 获取仓库的所有分支列表（本地+远程）
 * 6. get_commit_log - 获取仓库的提交历史记录
 * 
 * 前端调用示例：
 * ```javascript
 * import { invoke } from '@tauri-apps/api/core';
 * 
 * // 打开仓库
 * const repo = await invoke('open_repo', { path: 'C:\\Projects\\my-repo' });
 * 
 * // 克隆仓库（异步）
 * const clonedPath = await invoke('clone_repo', { url: 'https://...', path: 'C:\\...' });
 * 
 * // 获取分支列表
 * const branches = await invoke('get_branches', { repoPath: 'C:\\Projects\\my-repo' });
 * ```
 * 
 * 注意：clone_repo 是耗时操作，使用 async 函数标记
 * 并通过 tauri::async_runtime::spawn_blocking 在子线程中执行，避免阻塞 UI 主线程。
 */

use tauri::command;

/**
 * 打开 Git 仓库，获取仓库的基本信息
 * 
 * 验证指定路径是否是有效的 Git 仓库，并返回仓库的以下信息：
 * - 仓库路径
 * - 当前分支名
 * - 是否是裸仓库
 * - HEAD 提交哈希
 * 
 * 前端调用方式：
 * ```javascript
 * const info = await invoke('open_repo', { path: 'C:\\Projects\\my-repo' });
 * console.log(info.current_branch); // "main"
 * ```
 * 
 * 参数：
 * - path: 仓库根目录的路径字符串
 * 
 * 返回值：
 * - Ok(RepoInfo) - 成功打开仓库，包含仓库基本信息
 * - Err(String) - 打开失败（路径无效、不是 Git 仓库等）
 */
#[command]
pub fn open_repo(path: String) -> Result<crate::git::repo::RepoInfo, String> {
    // 调用 git::repo::open_repo 执行实际的仓库打开操作
    // 将 GitError 转换为 String 以满足 Tauri 命令的返回类型要求
    crate::git::repo::open_repo(&path).map_err(|e| e.to_string())
}

/**
 * 在指定目录初始化一个新的 Git 仓库
 * 
 * 执行 `git init` 命令创建新仓库，然后返回新仓库的基本信息。
 * 如果目录不存在，git init 会自动创建。
 * 
 * 前端调用方式：
 * ```javascript
 * const repo = await invoke('init_repo', { path: 'C:\\Projects\\new-repo' });
 * console.log(repo.path); // "C:\\Projects\\new-repo"
 * ```
 * 
 * 参数：
 * - path: 要初始化仓库的目录路径字符串
 * 
 * 返回值：
 * - Ok(RepoInfo) - 初始化成功，包含新仓库的基本信息
 * - Err(String) - 初始化失败
 */
#[command]
pub fn init_repo(path: String) -> Result<crate::git::repo::RepoInfo, String> {
    // 调用 git::repo::init_repo 执行实际的初始化操作
    crate::git::repo::init_repo(&path).map_err(|e| e.to_string())
}

/**
 * 从远程 URL 克隆 Git 仓库到本地
 * 
 * 执行 `git clone <url> <path>` 命令，将远程仓库克隆到本地。
 * 这是一个耗时操作（需要下载完整的仓库历史），因此在子线程中执行。
 * 
 * 使用 async fn 标记此函数为异步命令（Tauri 自动识别 async 命令）。
 * tauri::async_runtime::spawn_blocking 将同步的 clone_repo 函数放到
 * 异步运行时的线程池中执行，避免阻塞 Tauri 的主线程（UI 线程）。
 * 
 * 前端调用方式：
 * ```javascript
 * // 克隆可能需要较长时间，前端应显示加载状态
 * const path = await invoke('clone_repo', {
 *   url: 'https://github.com/user/repo.git',
 *   path: 'C:\\Projects\\repo'
 * });
 * ```
 * 
 * 参数：
 * - url: 远程仓库的 URL 字符串（支持 HTTPS、SSH、git:// 协议）
 * - path: 本地克隆目标目录的路径字符串
 * 
 * 返回值：
 * - Ok(String) - 克隆成功，返回克隆后的仓库路径
 * - Err(String) - 克隆失败（网络错误、URL 无效、权限不足等）
 */
#[command]
pub async fn clone_repo(url: String, path: String) -> Result<String, String> {
    // 使用 tauri::async_runtime::spawn_blocking 在子线程中执行耗时的 clone 操作
    // tauri::async_runtime 是 Tauri 提供的异步运行时封装，
    // 底层基于 tokio，可以直接使用而无需在 Cargo.toml 中额外添加 tokio 依赖
    // spawn_blocking 专门用于将阻塞的同步操作放到线程池中异步执行
    // 这样 Tauri 的主线程（负责 UI 渲染和事件处理）不会被阻塞
    tauri::async_runtime::spawn_blocking(move || {
        // 调用 git::repo::clone_repo 执行实际的克隆操作
        // move 关键字将 url 和 path 的所有权移动到闭包中
        crate::git::repo::clone_repo(&url, &path).map_err(|e| e.to_string())
    })
    // .await 等待子线程中的操作完成并获取结果
    .await
    // 处理 spawn_blocking 可能产生的 JoinError
    // （如果线程池已关闭或任务 panic）
    .map_err(|e| format!("克隆任务执行异常: {}", e))?
}

/**
 * 获取仓库的文件状态信息
 * 
 * 执行 `git status --porcelain=v2` 命令，解析并返回仓库中所有文件的变更状态。
 * 
 * 前端调用方式：
 * ```javascript
 * const status = await invoke('get_repo_status', { repoPath: 'C:\\Projects\\my-repo' });
 * console.log(`当前分支: ${status.branch}`);
 * status.entries.forEach(entry => {
 *   console.log(`${entry.status}: ${entry.path} (暂存: ${entry.staged})`);
 * });
 * ```
 * 
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * 
 * 返回值：
 * - Ok(RepoStatus) - 查询成功，包含分支名和文件状态列表
 * - Err(String) - 查询失败
 */
#[command]
pub fn get_repo_status(
    repo_path: String,
) -> Result<crate::git::status::RepoStatus, String> {
    // 调用 git::status::get_status 执行实际的状态查询操作
    crate::git::status::get_status(&repo_path).map_err(|e| e.to_string())
}

/**
 * 获取仓库的所有分支列表
 * 
 * 执行 `git branch -vv` 和 `git branch -r` 命令，
 * 返回本地分支和远程分支的完整列表。
 * 
 * 前端调用方式：
 * ```javascript
 * const branches = await invoke('get_branches', { repoPath: 'C:\\Projects\\my-repo' });
 * console.log(`本地分支数: ${branches.local.length}`);
 * console.log(`远程分支数: ${branches.remote.length}`);
 * branches.local.forEach(b => {
 *   console.log(`${b.is_current ? '* ' : '  '}${b.name} (领先${b.ahead}, 落后${b.behind})`);
 * });
 * ```
 * 
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * 
 * 返回值：
 * - Ok(BranchList) - 查询成功，包含本地和远程分支列表
 * - Err(String) - 查询失败
 */
#[command]
pub fn get_branches(
    repo_path: String,
) -> Result<crate::git::branch::BranchList, String> {
    // 调用 git::branch::get_branches 执行实际的分支查询操作
    crate::git::branch::get_branches(&repo_path).map_err(|e| e.to_string())
}

/**
 * 获取仓库的提交历史记录
 * 
 * 执行 `git log --pretty=format:...` 命令，
 * 返回指定数量的最近提交记录。
 * 
 * 前端调用方式：
 * ```javascript
 * // 获取最近 20 条提交记录
 * const log = await invoke('get_commit_log', { repoPath: 'C:\\Projects\\my-repo', count: 20 });
 * console.log(`总提交数: ${log.total_count}`);
 * log.commits.forEach(c => {
 *   console.log(`${c.short_hash} ${c.author} (${c.date}): ${c.message}`);
 * });
 * ```
 * 
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * - count: 要获取的提交数量（例如 20 表示获取最近 20 条）
 *          如果为 0，则返回所有提交记录
 * 
 * 返回值：
 * - Ok(CommitList) - 查询成功，包含提交列表和总数
 * - Err(String) - 查询失败
 */
#[command]
pub fn get_commit_log(
    repo_path: String,
    count: u32,
) -> Result<crate::git::log::CommitList, String> {
    // 调用 git::log::get_log 执行实际的提交历史查询操作
    crate::git::log::get_log(&repo_path, count).map_err(|e| e.to_string())
}

/**
 * 获取单个文件的提交历史
 * 
 * 执行 `git log --follow` 命令，获取指定文件的所有提交记录。
 * --follow 选项可以跟踪文件重命名，即使文件被改名，也能看到完整历史。
 * 
 * 前端调用方式：
 * ```javascript
 * const history = await invoke('get_file_history', {
 *   repoPath: 'C:\\Projects\\my-repo',
 *   filePath: 'src/main.rs'
 * });
 * history.forEach(c => {
 *   console.log(`${c.short_hash} ${c.author}: ${c.message}`);
 * });
 * ```
 * 
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * - file_path: 文件路径（相对于仓库根目录），例如 "src/main.rs"
 * 
 * 返回值：
 * - Ok(Vec<CommitInfo>) - 该文件的所有提交记录（按时间倒序排列）
 * - Err(String) - 查询失败
 */
#[command]
pub fn get_file_history(
    repo_path: String,
    file_path: String,
) -> Result<Vec<crate::git::log::CommitInfo>, String> {
    // 调用 git::log::get_file_history 执行实际的文件历史查询操作
    // 将 GitError 转换为 String 以满足 Tauri 命令的返回类型要求
    crate::git::log::get_file_history(&repo_path, &file_path).map_err(|e| e.to_string())
}
