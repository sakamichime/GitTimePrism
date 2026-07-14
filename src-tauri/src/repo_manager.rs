/*
 * 仓库管理模块（阶段 10：Task 10.1）
 *
 * 此模块负责管理多个 Git 仓库的注册、发现、忽略、子模块扫描等功能。
 * 配置文件保存在 ~/.gittimeprism/repos.json 中，记录所有已注册和被忽略的仓库。
 *
 * 主要功能：
 * 1. 仓库发现：递归搜索指定路径下的所有 Git 仓库（识别含 .git 目录的文件夹）
 * 2. 仓库注册：将仓库加入注册列表，下次启动时自动加载
 * 3. 取消注册：从注册列表中移除仓库
 * 4. 忽略仓库：加入忽略列表，发现时跳过该仓库
 * 5. 列出已注册仓库：读取配置文件返回所有已注册仓库
 * 6. 子模块扫描：调用 git submodule status 列出仓库的所有子模块
 * 7. 配置导出：将单个仓库的配置导出为 .gittimeprism.json 文件
 * 8. 配置导入：从 .gittimeprism.json 文件导入配置
 *
 * 配置文件路径：~/.gittimeprism/repos.json
 * 文件格式示例：
 * {
 *   "registered": ["/path/to/repo1", "/path/to/repo2"],
 *   "ignored": ["/path/to/ignored/repo"],
 *   "lastOpened": {"/path/to/repo1": 1700000000}
 * }
 */

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/**
 * 单个仓库的注册信息
 *
 * 描述一个被发现的或已注册的 Git 仓库的基本信息，
 * 前端用此结构渲染仓库列表 UI。
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoEntry {
    /// 仓库的绝对路径（如 "C:\\Users\\alice\\my-project"）
    pub path: String,
    /// 仓库的显示名称（默认为路径末尾的文件夹名，可被用户重命名）
    pub name: String,
    /// 是否已注册到 GitTimePrism（true = 在注册列表中，false = 仅被发现）
    pub is_registered: bool,
    /// 上次打开此仓库的时间（Unix 时间戳，秒；从未打开过则为 None）
    pub last_opened: Option<i64>,
    /// 此仓库是否包含子模块（用于前端显示子模块图标提示）
    pub has_submodules: bool,
}

/**
 * 仓库配置文件的数据结构
 *
 * 对应 ~/.gittimeprism/repos.json 文件的内容。
 * 包含已注册仓库列表、忽略仓库列表、上次打开时间记录。
 */
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ReposConfig {
    /// 已注册仓库的路径列表（按注册顺序排列）
    pub registered: Vec<String>,
    /// 已忽略仓库的路径列表（发现时跳过这些路径）
    pub ignored: Vec<String>,
    /// 各仓库的上次打开时间（键为仓库路径，值为 Unix 时间戳秒）
    pub last_opened: HashMap<String, i64>,
}

/**
 * 获取 ~/.gittimeprism 配置目录的路径
 *
 * 跨平台处理：
 * - Windows: C:\Users\<用户>\.gittimeprism
 * - macOS/Linux: /home/<用户>/.gittimeprism 或 /Users/<用户>/.gittimeprism
 *
 * 如果用户目录无法获取（极少见），返回当前目录下的 .gittimeprism。
 *
 * 返回值：配置目录的 PathBuf
 */
fn get_config_dir() -> PathBuf {
    // 优先使用 dirs::home_dir 获取用户主目录
    // 如果获取失败，退回到当前工作目录（极少见的情况）
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".gittimeprism")
}

/**
 * 获取配置文件 repos.json 的完整路径
 *
 * 路径为：~/.gittimeprism/repos.json
 *
 * 返回值：配置文件的 PathBuf
 */
fn get_config_file_path() -> PathBuf {
    get_config_dir().join("repos.json")
}

/**
 * 加载仓库配置
 *
 * 从 ~/.gittimeprism/repos.json 读取配置：
 * - 如果文件不存在，返回默认的空配置
 * - 如果文件存在但解析失败，记录错误后返回默认配置（避免损坏的配置文件阻塞应用启动）
 *
 * 返回值：ReposConfig 配置结构体
 */
fn load_config() -> ReposConfig {
    // 获取配置文件路径
    let config_path = get_config_file_path();
    // 如果配置文件不存在，返回默认空配置
    if !config_path.exists() {
        return ReposConfig::default();
    }
    // 读取配置文件内容
    match fs::read_to_string(&config_path) {
        Ok(content) => {
            // 解析 JSON 内容为 ReposConfig 结构体
            match serde_json::from_str::<ReposConfig>(&content) {
                Ok(config) => config,
                Err(err) => {
                    // 配置文件解析失败，记录错误并返回默认配置
                    // 这样即使配置文件损坏，应用也能正常启动
                    eprintln!("[repo_manager] 配置文件解析失败: {}，使用默认配置", err);
                    ReposConfig::default()
                }
            }
        }
        Err(err) => {
            eprintln!("[repo_manager] 读取配置文件失败: {}，使用默认配置", err);
            ReposConfig::default()
        }
    }
}

/**
 * 保存仓库配置到磁盘
 *
 * 将配置写入 ~/.gittimeprism/repos.json：
 * 1. 确保配置目录存在（不存在则创建）
 * 2. 将配置序列化为格式化的 JSON
 * 3. 写入文件（覆盖旧内容）
 *
 * 参数：
 * - config: 要保存的配置结构体
 *
 * 返回值：
 * - Ok(()) - 保存成功
 * - Err(String) - 保存失败（无法创建目录或写入文件）
 */
fn save_config(config: &ReposConfig) -> Result<(), String> {
    // 获取配置目录路径
    let config_dir = get_config_dir();
    // 如果配置目录不存在，创建它（包括所有父目录）
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    // 获取配置文件路径
    let config_path = get_config_file_path();
    // 将配置序列化为格式化的 JSON 字符串（pretty=true 让 JSON 易读）
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    // 写入文件（覆盖旧内容）
    fs::write(&config_path, json)
        .map_err(|e| format!("写入配置文件失败: {}", e))?;
    Ok(())
}

/**
 * 判断指定路径是否是 Git 仓库
 *
 * 通过检查路径下是否存在 .git 目录或 .git 文件来判断。
 * - 普通仓库：路径下有 .git 目录
 * - 工作区仓库（worktree）：路径下有 .git 文件（指向实际 .git 目录）
 *
 * 参数：
 * - path: 要检查的路径
 *
 * 返回值：
 * - true - 是 Git 仓库
 * - false - 不是 Git 仓库
 */
fn is_git_repo(path: &Path) -> bool {
    // 检查 .git 目录是否存在（普通仓库）
    let git_dir = path.join(".git");
    if git_dir.is_dir() {
        return true;
    }
    // 检查 .git 文件是否存在（worktree 形式的仓库）
    // worktree 仓库中 .git 是一个文件，内容指向实际 .git 目录的路径
    if git_dir.is_file() {
        return true;
    }
    false
}

/**
 * 从路径中提取仓库的显示名称
 *
 * 默认使用路径末尾的文件夹名作为仓库名称。
 * 例如 "C:\\Users\\alice\\my-project" 提取出 "my-project"。
 * 如果路径末尾为空（如根目录），使用整个路径作为名称。
 *
 * 参数：
 * - path: 仓库路径
 *
 * 返回值：仓库名称字符串
 */
fn get_repo_name_from_path(path: &Path) -> String {
    // 获取路径的最后一部分（文件夹名）
    // file_name 返回 OsStr，需要转换为 String
    match path.file_name() {
        Some(name) => name.to_string_lossy().to_string(),
        None => {
            // 无法获取文件名（如根路径），使用完整路径
            path.to_string_lossy().to_string()
        }
    }
}

/**
 * 检测仓库是否包含子模块
 *
 * 通过检查仓库根目录下是否存在 .gitmodules 文件来判断。
 * .gitmodules 文件在添加子模块时由 git submodule add 自动创建。
 *
 * 参数：
 * - repo_path: 仓库路径
 *
 * 返回值：
 * - true - 仓库包含子模块
 * - false - 仓库不含子模块
 */
fn check_has_submodules(repo_path: &Path) -> bool {
    // 检查 .gitmodules 文件是否存在
    let gitmodules = repo_path.join(".gitmodules");
    gitmodules.exists()
}

/**
 * 发现指定路径下的所有 Git 仓库
 *
 * 从 workspace_path 开始，递归搜索到 max_depth 深度，
 * 返回所有含 .git 目录的文件夹路径。
 *
 * 搜索规则：
 * 1. 起始路径本身也检查（深度 0）
 * 2. 进入子目录递归搜索，每深入一层深度 +1
 * 3. 深度超过 max_depth 时停止递归
 * 4. 跳过 node_modules、.git、target、build 等常见大型目录（性能优化）
 * 5. 忽略列表中的仓库不会被返回（但仍会递归其子目录）
 * 6. 找到 .git 目录后，不再递归该仓库的子目录（避免进入 .git 内部）
 *
 * 参数：
 * - workspace_path: 工作区根路径（如 "C:\\Users\\alice\\projects"）
 * - max_depth: 最大递归深度（0 = 仅检查 workspace_path 本身，1 = 检查一层子目录）
 *
 * 返回值：RepoEntry 向量（包含发现的仓库，含已注册与未注册的）
 */
pub fn discover_repos(workspace_path: &str, max_depth: usize) -> Vec<RepoEntry> {
    // 加载配置，查询已注册和已忽略的仓库列表
    let config = load_config();
    // 用于存放发现的仓库
    let mut entries: Vec<RepoEntry> = Vec::new();
    // 起始路径
    let start_path = PathBuf::from(workspace_path);
    // 调用递归辅助函数
    discover_repos_recursive(&start_path, 0, max_depth, &config, &mut entries);
    entries
}

/**
 * 递归搜索 Git 仓库的内部辅助函数
 *
 * 这是 discover_repos 的递归实现，使用递归方式遍历目录树。
 *
 * 参数：
 * - current_path: 当前正在检查的路径
 * - current_depth: 当前深度（从 0 开始）
 * - max_depth: 最大深度
 * - config: 仓库配置（用于查询已注册/已忽略状态）
 * - entries: 用于追加发现的仓库的列表
 */
fn discover_repos_recursive(
    current_path: &Path,
    current_depth: usize,
    max_depth: usize,
    config: &ReposConfig,
    entries: &mut Vec<RepoEntry>,
) {
    // 检查当前路径是否是 Git 仓库
    if is_git_repo(current_path) {
        // 将路径转为字符串进行比较
        let path_str = current_path.to_string_lossy().to_string();
        // 跳过被忽略的仓库（不加入结果，但仍可继续递归子目录）
        // 注意：找到仓库后不再递归其内部子目录（避免进入 .git 内部）
        let is_ignored = config.ignored.iter().any(|p| p == &path_str);
        if !is_ignored {
            // 检查是否已注册
            let is_registered = config.registered.iter().any(|p| p == &path_str);
            // 查询上次打开时间
            let last_opened = config.last_opened.get(&path_str).copied();
            // 检查是否含子模块
            let has_submodules = check_has_submodules(current_path);
            // 添加到结果列表
            entries.push(RepoEntry {
                path: path_str.clone(),
                name: get_repo_name_from_path(current_path),
                is_registered,
                last_opened,
                has_submodules,
            });
        }
        // 找到 Git 仓库后不再递归其内部（避免误入 .git 目录）
        return;
    }

    // 当前路径不是 Git 仓库，递归其子目录（如果未超过最大深度）
    if current_depth >= max_depth {
        return;
    }

    // 读取子目录列表
    let sub_dirs = match fs::read_dir(current_path) {
        Ok(entries_iter) => entries_iter,
        Err(_) => return, // 无权限或路径不存在，直接返回
    };

    // 遍历所有子目录
    for entry in sub_dirs.flatten() {
        let path = entry.path();
        // 仅递归目录，跳过文件
        if !path.is_dir() {
            continue;
        }
        // 跳过常见的大型目录以提升性能
        // node_modules: npm 依赖目录，可能包含成千上万个目录
        // .git: Git 内部目录，无需进入
        // target: Rust 构建输出目录
        // build / dist: 常见的前端构建输出目录
        // .next / .nuxt: Next.js / Nuxt.js 构建目录
        let dir_name = match path.file_name() {
            Some(name) => name.to_string_lossy().to_string(),
            None => continue,
        };
        if matches!(
            dir_name.as_str(),
            "node_modules" | ".git" | "target" | "build" | "dist" | ".next" | ".nuxt" | ".cache"
        ) {
            continue;
        }
        // 递归搜索子目录，深度 +1
        discover_repos_recursive(&path, current_depth + 1, max_depth, config, entries);
    }
}

/**
 * 注册仓库
 *
 * 将仓库路径添加到已注册列表，并记录打开时间。
 * 如果仓库已在列表中，仅更新打开时间。
 *
 * 参数：
 * - repo_path: 仓库路径
 *
 * 返回值：
 * - Ok(()) - 注册成功
 * - Err(String) - 注册失败（配置文件读写错误）
 */
pub fn register_repo(repo_path: &str) -> Result<(), String> {
    // 加载当前配置
    let mut config = load_config();
    // 如果路径不在已注册列表中，添加它
    if !config.registered.iter().any(|p| p == repo_path) {
        config.registered.push(repo_path.to_string());
    }
    // 更新上次打开时间为当前 Unix 时间戳（秒）
    config.last_opened.insert(
        repo_path.to_string(),
        chrono::Utc::now().timestamp(),
    );
    // 保存配置到磁盘
    save_config(&config)
}

/**
 * 取消注册仓库
 *
 * 将仓库从已注册列表中移除（但保留在忽略列表之外，下次发现时仍会显示）。
 * 同时移除该仓库的上次打开时间记录。
 *
 * 参数：
 * - repo_path: 仓库路径
 *
 * 返回值：
 * - Ok(()) - 取消注册成功
 * - Err(String) - 失败
 */
pub fn unregister_repo(repo_path: &str) -> Result<(), String> {
    // 加载当前配置
    let mut config = load_config();
    // 从已注册列表中移除（保留路径比较）
    config.registered.retain(|p| p != repo_path);
    // 移除上次打开时间记录
    config.last_opened.remove(repo_path);
    // 保存配置
    save_config(&config)
}

/**
 * 忽略仓库
 *
 * 将仓库加入忽略列表，发现时不再返回该仓库。
 * 同时从已注册列表中移除（被忽略的仓库不能再注册）。
 *
 * 参数：
 * - repo_path: 仓库路径
 *
 * 返回值：
 * - Ok(()) - 加入忽略列表成功
 * - Err(String) - 失败
 */
pub fn ignore_repo(repo_path: &str) -> Result<(), String> {
    // 加载当前配置
    let mut config = load_config();
    // 从已注册列表移除（被忽略的仓库不能注册）
    config.registered.retain(|p| p != repo_path);
    // 如果不在忽略列表中，添加它
    if !config.ignored.iter().any(|p| p == repo_path) {
        config.ignored.push(repo_path.to_string());
    }
    // 保存配置
    save_config(&config)
}

/**
 * 列出所有已注册的仓库
 *
 * 读取配置文件，返回所有已注册仓库的 RepoEntry 列表。
 * 对于每个仓库，实时检查是否仍含子模块（避免子模块被添加/移除后状态过期）。
 *
 * 返回值：RepoEntry 向量（仅包含已注册的仓库）
 */
pub fn list_registered_repos() -> Vec<RepoEntry> {
    // 加载配置
    let config = load_config();
    // 将所有已注册路径转为 RepoEntry
    config
        .registered
        .iter()
        .map(|path| {
            let path_buf = PathBuf::from(path);
            // 检查仓库是否仍存在
            let exists = path_buf.exists() && is_git_repo(&path_buf);
            // 检查子模块状态
            let has_submodules = if exists {
                check_has_submodules(&path_buf)
            } else {
                false
            };
            RepoEntry {
                path: path.clone(),
                name: get_repo_name_from_path(&path_buf),
                is_registered: true,
                last_opened: config.last_opened.get(path).copied(),
                has_submodules,
            }
        })
        .collect()
}

/**
 * 扫描仓库的子模块
 *
 * 执行 git submodule status 列出仓库的所有子模块。
 * 子模块路径相对于仓库根目录。
 *
 * 此函数复用 git::commands::run_git 执行 git 命令。
 *
 * 参数：
 * - repo_path: 仓库路径
 *
 * 返回值：子模块路径列表（每项为子模块在仓库中的相对路径）
 */
pub fn scan_submodules(repo_path: &str) -> Vec<String> {
    // 调用 git submodule status 获取子模块状态
    // 输出格式：<状态字符> <commit hash> <子模块路径> (<描述>)
    // 例如：" e23a4b5c6d7e8f9src/submodule (v1.0.0)"
    let output = crate::git::commands::run_git(repo_path, &["submodule", "status"]);
    match output {
        Ok(git_output) => {
            // 按行分割输出
            let lines: Vec<&str> = git_output.stdout.lines().collect();
            // 解析每行，提取子模块路径（第 3 列，索引 2）
            lines
                .iter()
                .filter_map(|line| {
                    // 跳过空行
                    let line = line.trim();
                    if line.is_empty() {
                        return None;
                    }
                    // 按空白分割，至少 3 列：状态 + hash + 路径
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 {
                        // 第 3 列是路径
                        Some(parts[2].to_string())
                    } else {
                        None
                    }
                })
                .collect()
        }
        Err(_) => Vec::new(), // 命令执行失败（无子模块或仓库无效），返回空列表
    }
}

/**
 * 导出仓库配置为 .gittimeprism.json 文件
 *
 * 将指定仓库的相关配置（已注册状态、忽略列表中的相关项、上次打开时间等）
 * 导出为 JSON 文件，便于用户备份或在其他设备上导入。
 *
 * 导出内容包括：
 * - 仓库路径
 * - 上次打开时间
 * - 子模块列表
 *
 * 参数：
 * - repo_path: 要导出配置的仓库路径
 * - output_path: 输出文件路径（如 "C:\\path\\to\\.gittimeprism.json"）
 *
 * 返回值：
 * - Ok(()) - 导出成功
 * - Err(String) - 导出失败
 */
pub fn export_config(repo_path: &str, output_path: &str) -> Result<(), String> {
    // 加载配置
    let config = load_config();
    // 收集子模块列表
    let submodules = scan_submodules(repo_path);
    // 检查是否已注册
    let is_registered = config.registered.iter().any(|p| p == repo_path);
    // 获取上次打开时间
    let last_opened = config.last_opened.get(repo_path).copied();
    // 构造导出数据
    let export_data = serde_json::json!({
        "version": 1,
        "repoPath": repo_path,
        "isRegistered": is_registered,
        "lastOpened": last_opened,
        "submodules": submodules,
        "exportedAt": chrono::Utc::now().timestamp()
    });
    // 序列化为格式化的 JSON
    let json = serde_json::to_string_pretty(&export_data)
        .map_err(|e| format!("序列化导出数据失败: {}", e))?;
    // 写入文件
    fs::write(output_path, json).map_err(|e| format!("写入导出文件失败: {}", e))?;
    Ok(())
}

/**
 * 从 .gittimeprism.json 文件导入配置
 *
 * 读取导出的配置文件，将其中的仓库注册到当前 GitTimePrism 中。
 *
 * 参数：
 * - config_path: 配置文件路径
 *
 * 返回值：
 * - Ok(()) - 导入成功
 * - Err(String) - 导入失败
 */
pub fn import_config(config_path: &str) -> Result<(), String> {
    // 读取配置文件内容
    let content = fs::read_to_string(config_path)
        .map_err(|e| format!("读取配置文件失败: {}", e))?;
    // 解析 JSON
    let import_data: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析配置文件失败: {}", e))?;
    // 提取仓库路径
    let repo_path = import_data
        .get("repoPath")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "配置文件缺少 repoPath 字段".to_string())?;
    // 注册仓库
    register_repo(repo_path)?;
    // 如果有上次打开时间，更新它
    if let Some(last_opened) = import_data.get("lastOpened").and_then(|v| v.as_i64()) {
        let mut config = load_config();
        config.last_opened.insert(repo_path.to_string(), last_opened);
        save_config(&config)?;
    }
    Ok(())
}
