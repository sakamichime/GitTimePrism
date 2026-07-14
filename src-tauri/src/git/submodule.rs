/*
 * Git 子模块（Submodule）管理模块
 *
 * 此模块负责 Git 子模块的查询与管理工作，包括：
 * 1. 读取 `.gitmodules` 文件，解析每个子模块的 path/url/branch
 * 2. 执行 `git submodule status` 获取当前提交 hash + 差异状态
 * 3. 添加子模块（git submodule add）
 * 4. 更新子模块（git submodule update [--init] [--recursive]）
 * 5. 删除子模块（git submodule deinit + git rm + 清理 .git/modules）
 *
 * 子模块是 Git 中用于在一个仓库中引用另一个仓库的机制，
 * 常用于管理第三方依赖库或共享代码。
 */

use super::commands::{run_git, GitError};
use std::fs;
use std::path::Path;

/**
 * 单个子模块的信息
 *
 * 包含子模块的路径、远程 URL、分支、当前提交等完整信息。
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleInfo {
    /// 子模块在主仓库中的相对路径（如 "vendor/lib"）
    pub path: String,
    /// 子模块的远程仓库 URL（HTTPS 或 SSH）
    pub url: String,
    /// 子模块跟踪的分支名（如 "main"）；未指定分支时为空字符串
    pub branch: String,
    /// 子模块当前检出的完整提交哈希（40 位十六进制）
    pub current_commit: String,
    /// 子模块当前检出的短提交哈希（通常 7 位）
    pub short_commit: String,
    /// 子模块的差异状态（来自 git submodule status 输出的前缀字符）
    /// - 空格：子模块已检出指定提交，无变更
    /// - "+"：子模块检出的提交与记录的提交不一致
    /// - "-"：子模块未初始化（未 git submodule update --init）
    /// - "U"：子模块存在合并冲突
    pub status: String,
    /// 子模块是否已初始化（即 .git/modules/{path} 目录是否存在）
    pub is_initialized: bool,
}

/**
 * 解析 `.gitmodules` 文件获取的子模块原始配置
 *
 * 此结构仅包含从 .gitmodules 文件读取到的信息，
 * 不包含运行时状态（如当前提交、差异状态）。
 */
#[derive(Debug, Clone)]
struct SubmoduleConfig {
    /// 子模块路径
    path: String,
    /// 子模块 URL
    url: String,
    /// 子模块分支（可能为空）
    branch: String,
}

/**
 * 获取仓库中所有子模块的完整信息列表
 *
 * 算法步骤：
 * 1. 读取 `.gitmodules` 文件，解析出每个子模块的 path/url/branch
 * 2. 执行 `git submodule status` 获取每个子模块的当前提交和差异状态
 * 3. 将两路结果合并，生成完整的 SubmoduleInfo 列表
 * 4. 检查 `.git/modules/{path}` 目录是否存在，判断是否已初始化
 *
 * 如果仓库没有 `.gitmodules` 文件，返回空列表（不是错误）。
 *
 * 参数：
 * - repo_path: 主仓库的根目录路径
 *
 * 返回值：
 * - Ok(Vec<SubmoduleInfo>) - 查询成功，返回子模块列表（无子模块时为空 Vec）
 * - Err(GitError) - 查询失败
 */
pub fn list_submodules(repo_path: &str) -> Result<Vec<SubmoduleInfo>, GitError> {
    // 步骤 1：读取并解析 .gitmodules 文件
    let configs = parse_gitmodules(repo_path)?;

    // 如果没有 .gitmodules 文件或文件中没有子模块配置，直接返回空列表
    if configs.is_empty() {
        return Ok(Vec::new());
    }

    // 步骤 2：执行 git submodule status 获取运行时状态
    // 输出格式：每个子模块一行，格式为 "<status_char> <commit_hash> <path> (<description>)"
    // status_char 为空格、+、- 或 U
    let status_output = run_git(repo_path, &["submodule", "status"])?;
    let status_map = parse_submodule_status_output(&status_output.stdout);

    // 步骤 3：合并两路结果
    let mut result = Vec::with_capacity(configs.len());
    for config in configs {
        // 从 status 输出中查找对应的子模块状态
        let status_info = status_map.get(&config.path);
        let status_char = status_info
            .map(|(s, _)| s.clone())
            .unwrap_or_else(|| "-".to_string());
        let current_commit = status_info
            .map(|(_, c)| c.clone())
            .unwrap_or_else(|| String::new());
        // 短哈希取前 7 位（如果存在）
        let short_commit = if current_commit.len() >= 7 {
            current_commit[..7].to_string()
        } else {
            current_commit.clone()
        };

        // 步骤 4：检查是否已初始化（.git/modules/{path} 目录是否存在）
        // 注意：path 中的路径分隔符需要处理，子模块路径如 "vendor/lib" 对应 .git/modules/vendor/lib
        let is_initialized = check_submodule_initialized(repo_path, &config.path);

        result.push(SubmoduleInfo {
            path: config.path,
            url: config.url,
            branch: config.branch,
            current_commit,
            short_commit,
            status: status_char,
            is_initialized,
        });
    }

    Ok(result)
}

/**
 * 添加新的子模块到当前仓库
 *
 * 执行 `git submodule add [-b {branch}] {url} {path}` 命令。
 * 此命令会：
 * 1. 克隆远程仓库到指定路径
 * 2. 在 .gitmodules 中添加配置
 * 3. 在 .git/config 中添加配置
 * 4. 将子模块路径添加到暂存区
 *
 * 参数：
 * - repo_path: 主仓库的根目录路径
 * - url: 子模块的远程仓库 URL（HTTPS 或 SSH）
 * - path: 子模块在主仓库中的相对路径
 * - branch: 可选，子模块跟踪的分支名；为 None 时不指定分支（使用远程默认分支）
 *
 * 返回值：
 * - Ok(()) - 添加成功
 * - Err(GitError) - 添加失败
 */
pub fn add_submodule(
    repo_path: &str,
    url: &str,
    path: &str,
    branch: Option<&str>,
) -> Result<(), GitError> {
    // 构建命令参数：git submodule add [-b {branch}] {url} {path}
    let mut args: Vec<String> = vec!["submodule".to_string(), "add".to_string()];

    // 如果指定了分支，添加 -b {branch} 参数
    if let Some(b) = branch {
        if !b.is_empty() {
            args.push("-b".to_string());
            args.push(b.to_string());
        }
    }

    args.push(url.to_string());
    args.push(path.to_string());

    // 将 String 转为 &str 用于 run_git 调用
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let _output = run_git(repo_path, &args_refs)?;
    Ok(())
}

/**
 * 更新子模块
 *
 * 执行 `git submodule update [--init] [--recursive]` 命令。
 * 此命令会根据 .gitmodules 和 .git/config 中的配置，
 * 将子模块检出到记录的提交。
 *
 * 参数说明：
 * - init=true：先执行 git submodule init（初始化子模块的本地配置）
 * - recursive=true：递归更新子模块中的子模块
 *
 * 参数：
 * - repo_path: 主仓库的根目录路径
 * - init: 是否执行 --init（初始化未初始化的子模块）
 * - recursive: 是否执行 --recursive（递归更新嵌套子模块）
 *
 * 返回值：
 * - Ok(()) - 更新成功
 * - Err(GitError) - 更新失败
 */
pub fn update_submodules(
    repo_path: &str,
    init: bool,
    recursive: bool,
) -> Result<(), GitError> {
    // 构建命令参数：git submodule update [--init] [--recursive]
    let mut args: Vec<String> = vec!["submodule".to_string(), "update".to_string()];

    if init {
        args.push("--init".to_string());
    }
    if recursive {
        args.push("--recursive".to_string());
    }

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let _output = run_git(repo_path, &args_refs)?;
    Ok(())
}

/**
 * 删除子模块
 *
 * 删除子模块需要多个步骤（Git 没有单一的删除命令）：
 * 1. 执行 `git submodule deinit -f {path}`：取消子模块的初始化，
 *    清除 .git/config 中的子模块配置
 * 2. 执行 `git rm -f {path}`：从工作区和暂存区移除子模块文件，
 *    并从 .gitmodules 中移除配置
 * 3. 删除 `.git/modules/{path}` 目录：移除子模块的 Git 元数据
 *
 * 参数：
 * - repo_path: 主仓库的根目录路径
 * - path: 要删除的子模块路径
 *
 * 返回值：
 * - Ok(()) - 删除成功
 * - Err(GitError) - 删除失败
 */
pub fn delete_submodule(repo_path: &str, path: &str) -> Result<(), GitError> {
    // 步骤 1：取消子模块初始化（git submodule deinit -f {path}）
    // -f 强制执行，即使子模块有未提交的变更也继续
    let deinit_args: Vec<&str> = vec!["submodule", "deinit", "-f", path];
    let _deinit_output = run_git(repo_path, &deinit_args)?;

    // 步骤 2：从工作区和暂存区移除子模块（git rm -f {path}）
    // -f 强制执行，即使子模块有未提交的变更也继续
    let rm_args: Vec<&str> = vec!["rm", "-f", path];
    let _rm_output = run_git(repo_path, &rm_args)?;

    // 步骤 3：删除 .git/modules/{path} 目录
    // 此目录存储子模块的 Git 元数据（对象库、引用等）
    // 路径分隔符在所有平台上都使用正斜杠（Git 内部约定）
    let modules_path = Path::new(repo_path)
        .join(".git")
        .join("modules")
        .join(path);

    if modules_path.exists() {
        // 删除整个子模块元数据目录
        fs::remove_dir_all(&modules_path).map_err(|e| {
            GitError::Io(format!(
                "删除子模块元数据目录失败 {}: {}",
                modules_path.display(),
                e
            ))
        })?;
    }

    Ok(())
}

/**
 * 解析 `.gitmodules` 文件，提取所有子模块的配置信息
 *
 * `.gitmodules` 文件是 INI 格式，每个子模块对应一个 [submodule "name"] 段，
 * 段内包含 path、url、branch 等属性。示例：
 *
 * ```ini
 * [submodule "vendor/lib"]
 *     path = vendor/lib
 *     url = https://github.com/example/lib.git
 *     branch = main
 * ```
 *
 * 参数：
 * - repo_path: 主仓库的根目录路径
 *
 * 返回值：
 * - Ok(Vec<SubmoduleConfig>) - 解析成功（无 .gitmodules 文件时返回空 Vec）
 * - Err(GitError) - 读取文件失败（文件存在但无法读取时）
 */
fn parse_gitmodules(repo_path: &str) -> Result<Vec<SubmoduleConfig>, GitError> {
    let gitmodules_path = Path::new(repo_path).join(".gitmodules");

    // 如果 .gitmodules 文件不存在，说明仓库没有子模块，返回空列表
    if !gitmodules_path.exists() {
        return Ok(Vec::new());
    }

    // 读取 .gitmodules 文件内容
    let content = fs::read_to_string(&gitmodules_path).map_err(|e| {
        GitError::Io(format!(
            "读取 .gitmodules 文件失败 {}: {}",
            gitmodules_path.display(),
            e
        ))
    })?;

    let mut configs: Vec<SubmoduleConfig> = Vec::new();
    // 当前正在解析的子模块配置（遇到 [submodule "..."] 段时创建）
    let mut current: Option<SubmoduleConfig> = None;
    // 是否处于 [submodule "..."] 段内（用于忽略其他类型的段，如 [core]）
    let mut in_submodule_section = false;

    // 逐行解析文件内容
    for line in content.lines() {
        let trimmed = line.trim();

        // 跳过空行和注释行
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }

        // 检测段头（如 [submodule "vendor/lib"] 或 [core]）
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            // 遇到新的段头时，先保存上一个子模块的配置
            if let Some(c) = current.take() {
                configs.push(c);
            }

            // 判断是否是 [submodule "..."] 段
            // 使用简单的字符串匹配而非正则（避免引入 regex 依赖）
            if trimmed.starts_with("[submodule \"") && trimmed.ends_with("\"]") {
                // 提取引号内的子模块名称
                // 注意：子模块的"名称"可能与 path 不同，但我们以 path 为准
                in_submodule_section = true;
                current = Some(SubmoduleConfig {
                    path: String::new(),
                    url: String::new(),
                    branch: String::new(),
                });
            } else {
                // 其他段（如 [core]），忽略其内容
                in_submodule_section = false;
            }
            continue;
        }

        // 解析段内的属性（如 path = vendor/lib）
        if in_submodule_section {
            if let Some(c) = current.as_mut() {
                // 按第一个 '=' 分割为 key 和 value
                if let Some(eq_pos) = trimmed.find('=') {
                    let key = trimmed[..eq_pos].trim();
                    // 去除 value 两端的空白和引号
                    let value = trimmed[eq_pos + 1..].trim().trim_matches('"');

                    match key {
                        "path" => c.path = value.to_string(),
                        "url" => c.url = value.to_string(),
                        "branch" => c.branch = value.to_string(),
                        _ => {} // 忽略其他属性（如 update、ignore 等）
                    }
                }
            }
        }
    }

    // 保存最后一个子模块的配置（文件末尾没有新的段头触发保存）
    if let Some(c) = current {
        configs.push(c);
    }

    // 过滤掉没有 path 或 url 的无效配置
    configs.retain(|c| !c.path.is_empty() && !c.url.is_empty());

    Ok(configs)
}

/**
 * 解析 `git submodule status` 命令的输出
 *
 * 输出格式（每个子模块一行）：
 * ```
 *  a1b2c3d4e5f6... vendor/lib (v1.0.0)
 * +a1b2c3d4e5f6... vendor/lib2 (v1.1.0)
 * -000000000000... vendor/lib3
 * U a1b2c3d4e5f6... vendor/lib4
 * ```
 *
 * 每行第一个字符是状态码（空格/+/-/U），后面是提交哈希和路径。
 *
 * 参数：
 * - output: git submodule status 命令的标准输出
 *
 * 返回值：
 * - HashMap<path, (status_char, commit_hash)>：以路径为键的状态映射
 */
fn parse_submodule_status_output(output: &str) -> std::collections::HashMap<String, (String, String)> {
    let mut map = std::collections::HashMap::new();

    for line in output.lines() {
        // 跳过空行
        if line.is_empty() {
            continue;
        }

        // 每行至少要有状态字符 + 哈希 + 路径
        // 格式：<status_char><commit_hash> <path> (<description>)
        // 注意：状态字符可能是空格、+、-、U，后面跟空格再跟哈希
        let chars: Vec<char> = line.chars().collect();
        if chars.is_empty() {
            continue;
        }

        // 第一个字符是状态码
        let status_char = chars[0].to_string();

        // 去除状态字符后的剩余部分
        let rest: String = chars[1..].iter().collect();
        let rest = rest.trim();

        // 按空格分割：第一部分是哈希，第二部分是路径
        let mut parts = rest.splitn(2, char::is_whitespace);
        let commit = parts.next().unwrap_or("").trim().to_string();
        let path_with_desc = parts.next().unwrap_or("").trim();

        // 路径部分可能包含括号描述（如 "vendor/lib (v1.0.0)"），需要去除括号部分
        let path = if let Some(paren_pos) = path_with_desc.find(" (") {
            path_with_desc[..paren_pos].trim().to_string()
        } else {
            path_with_desc.to_string()
        };

        if !path.is_empty() {
            map.insert(path, (status_char, commit));
        }
    }

    map
}

/**
 * 检查子模块是否已初始化
 *
 * 子模块已初始化的标志是 `.git/modules/{path}` 目录存在。
 * 此目录在执行 `git submodule init` 或 `git submodule update --init` 后创建。
 *
 * 参数：
 * - repo_path: 主仓库的根目录路径
 * - submodule_path: 子模块的相对路径
 *
 * 返回值：
 * - true: 子模块已初始化
 * - false: 子模块未初始化
 */
fn check_submodule_initialized(repo_path: &str, submodule_path: &str) -> bool {
    let modules_path = Path::new(repo_path)
        .join(".git")
        .join("modules")
        .join(submodule_path);
    modules_path.exists() && modules_path.is_dir()
}
