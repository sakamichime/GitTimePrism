/*
 * Git 仓库配置（config）查询模块
 *
 * 此模块负责读取 Git 仓库的配置信息，与 gitgraph 项目 dataSource.ts 的 getConfig 方法对齐。
 *
 * 核心功能：
 * 1. 执行 `git config --list -z --includes` 获取合并配置（consolidated）
 * 2. 执行 `git config --list -z --includes --local` 获取仓库级配置（local）
 * 3. 执行 `git config --list -z --includes --global` 获取用户级配置（global）
 * 4. 解析 `branch.*.remote` / `branch.*.pushremote` 分支跟踪配置
 * 5. 解析 `remote.*.url` / `remote.*.pushurl` 远程仓库地址
 * 6. 解析 `user.name` / `user.email` 用户信息（同时读取 local 和 global）
 * 7. 解析 `push.default` 推送默认模式
 * 8. 解析 `diff.tool` / `diff.guitool` 差异工具
 *
 * 返回的 RepoConfig 结构同时包含 local 和 global 的 user 信息，
 * 方便前端在"仓库设置"面板中显示和编辑。
 *
 * 依赖关系：
 * config -> commands（使用 run_git / run_git_raw 执行 git 命令，使用 GitError 处理错误）
 */

// 引入通用的 Git 命令执行器（run_git 用于文本输出，run_git_raw 用于 -z NUL 分隔的原始字节输出）
use super::commands::{run_git, run_git_raw, GitError};
// 引入 HashMap 用于存储键值对形式的配置项
use std::collections::HashMap;

/**
 * 配置位置枚举（对外暴露，用于 set_config_value / unset_config_value）
 *
 * 表示 Git 配置的写入位置。Git 配置有三个层级：
 * - system：系统级（/etc/gitconfig），通常不直接修改
 * - global：用户级（~/.gitconfig），对当前用户的所有仓库生效
 * - local：仓库级（.git/config），只对当前仓库生效
 *
 * 此枚举使用 serde 序列化，前端传入 "local" 或 "global" 字符串时自动反序列化。
 * #[serde(rename_all = "lowercase")] 让序列化/反序列化使用小写形式
 * （前端传 "local" 而非 "Local"）。
 *
 * 注意：写入配置时必须指定明确的层级（local 或 global），不能写"合并配置"。
 */
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConfigLocation {
    /// 仓库级配置（.git/config），只对当前仓库生效
    Local,
    /// 用户级配置（~/.gitconfig），对当前用户的所有仓库生效
    Global,
}

impl ConfigLocation {
    /**
     * 将配置位置转换为 git config 命令的参数
     *
     * 例如 Local → "--local"，Global → "--global"
     *
     * 返回值是 'static str（静态字符串切片），可以直接用于 &str 参数数组
     */
    pub fn to_arg(self) -> &'static str {
        match self {
            ConfigLocation::Local => "--local",
            ConfigLocation::Global => "--global",
        }
    }

    /**
     * 从字符串解析配置位置
     *
     * 接受 "local" / "global"（不区分大小写），返回对应的 ConfigLocation。
     * 用于从命令参数（String）转换为枚举类型。
     *
     * 参数：
     * - s: 输入字符串（如 "local"、"GLOBAL"）
     *
     * 返回值：
     * - Ok(ConfigLocation) - 解析成功
     * - Err(GitError) - 输入字符串不是合法的配置位置
     */
    pub fn from_str(s: &str) -> Result<Self, GitError> {
        match s.to_lowercase().as_str() {
            "local" => Ok(ConfigLocation::Local),
            "global" => Ok(ConfigLocation::Global),
            _ => Err(GitError::CommandFailed {
                exit_code: -1,
                message: format!(
                    "无效的配置位置 '{}'。合法的值为: local, global",
                    s
                ),
            }),
        }
    }
}

/**
 * 内部使用的配置读取位置类型（含 Consolidated）
 *
 * 与对外暴露的 ConfigLocation 不同，此内部枚举多了 Consolidated 变体，
 * 用于读取合并后的配置（system + global + local 的最终生效值）。
 *
 * 读取配置时可以读取"合并配置"，但写入配置时必须指定明确的层级，
 * 所以 ConfigLocation（对外）只有 Local / Global 两个变体。
 */
#[derive(Debug, Clone, Copy)]
enum ConfigReadLocation {
    /// 合并配置（system + global + local 的最终生效值），不加 --local/--global 参数
    Consolidated,
    /// 仓库级配置（.git/config），对应 --local 参数
    Local,
    /// 用户级配置（~/.gitconfig），对应 --global 参数
    Global,
}

/**
 * 单个分支的跟踪配置
 *
 * 描述一个本地分支的远程跟踪设置：
 * - remote: 该分支从哪个远程仓库拉取（git pull 默认来源）
 * - push_remote: 该分支推送到哪个远程仓库（git push 默认目标）
 *
 * 如果 push_remote 为 None，则 push 时使用 remote 的值。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, Default)]
pub struct BranchConfig {
    /// 分支的远程仓库名（如 "origin"），对应 branch.<name>.remote
    pub remote: Option<String>,
    /// 分支的推送远程仓库名，对应 branch.<name>.pushremote（优先于 remote 用于 push）
    pub push_remote: Option<String>,
}

/**
 * 单个远程仓库的配置
 *
 * 描述一个远程仓库的名称和地址：
 * - name: 远程仓库名（如 "origin"、"upstream"）
 * - url: 拉取地址（fetch URL），对应 remote.<name>.url
 * - push_url: 推送地址（push URL），对应 remote.<name>.pushurl（如果为 None 则 push 时使用 url）
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, Default)]
pub struct RemoteConfig {
    /// 远程仓库名称
    pub name: String,
    /// 拉取地址（fetch URL）
    pub url: Option<String>,
    /// 推送地址（push URL），为 None 时与 url 相同
    pub push_url: Option<String>,
}

/**
 * 用户身份配置
 *
 * 包含 user.name 和 user.email 两个 Git 提交身份字段。
 * 用于在提交时标识作者信息。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, Default)]
pub struct UserConfig {
    /// 提交者姓名（user.name）
    pub name: Option<String>,
    /// 提交者邮箱（user.email）
    pub email: Option<String>,
}

/**
 * 用户身份的完整配置（含 local 和 global 两级）
 *
 * 前端"仓库设置"面板需要同时显示仓库级和用户级的 user.name/user.email，
 * 让用户选择在哪个层级修改，因此同时返回 local 和 global。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, Default)]
pub struct UserInfoConfig {
    /// 仓库级用户配置（.git/config 中的 user.name/user.email）
    pub local: UserConfig,
    /// 用户级用户配置（~/.gitconfig 中的 user.name/user.email）
    pub global: UserConfig,
}

/**
 * 仓库配置的完整数据结构
 *
 * 这是 get_config 函数的返回值，包含仓库的所有关键配置信息。
 * 前端"仓库设置"面板（settings-panel.ts）基于此结构渲染表单。
 *
 * 字段说明：
 * - branches: 所有本地分支的跟踪配置（分支名 → BranchConfig）
 * - diff_tool: 差异工具名称（diff.tool），用于 `git difftool`
 * - gui_diff_tool: GUI 差异工具名称（diff.guitool）
 * - push_default: 推送默认模式（push.default），如 "simple"、"current"、"upstream" 等
 * - remotes: 所有远程仓库的配置列表
 * - user: 用户身份配置（含 local 和 global 两级）
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, Default)]
pub struct RepoConfig {
    /// 所有本地分支的跟踪配置（键为分支名）
    pub branches: HashMap<String, BranchConfig>,
    /// 差异工具名称（diff.tool）
    pub diff_tool: Option<String>,
    /// GUI 差异工具名称（diff.guitool）
    pub gui_diff_tool: Option<String>,
    /// 推送默认模式（push.default）
    pub push_default: Option<String>,
    /// 所有远程仓库的配置列表
    pub remotes: Vec<RemoteConfig>,
    /// 用户身份配置（含 local 和 global 两级）
    pub user: UserInfoConfig,
}

/**
 * 解析 `git config --list -z` 的原始字节输出为键值对 HashMap
 *
 * git config --list -z 的输出格式：
 * - 每条配置项用 NUL 字符（\0）分隔
 * - 每条配置项内部，key 和 value 之间用换行符（\n）分隔
 * - 输出末尾有一个 NUL 字符
 *
 * 示例输出（\0 表示 NUL，\n 表示换行）：
 * ```text
 * user.name\n张三\0user.email\nzhangsan@example.com\0
 * ```
 *
 * 参数：
 * - raw: git config --list -z 的原始字节输出
 *
 * 返回值：
 * - HashMap<String, String>：键值对集合（键如 "user.name"，值如 "张三"）
 *
 * 解析逻辑：
 * 1. 按 NUL 字符切分字节流，得到每条配置项的字节切片
 * 2. 最后一个切片是空（因为输出末尾有 NUL），跳过它
 * 3. 对每条配置项，按换行符切分为 key 和 value
 * 4. 如果没有换行符（理论上不会发生），value 视为空字符串
 */
fn parse_config_list(raw: &[u8]) -> HashMap<String, String> {
    // 创建空的 HashMap 用于存储配置键值对
    let mut configs: HashMap<String, String> = HashMap::new();

    // 按 NUL 字符（\0）切分字节流，得到每条配置项的字节切片
    let pairs: Vec<&[u8]> = raw.split(|&b| b == 0).collect();

    // 最后一个元素是空（因为 -z 输出末尾有 NUL），所以有效项数为 len - 1
    // saturating_sub 防止空输入时下溢
    let num_pairs = pairs.len().saturating_sub(1);

    for i in 0..num_pairs {
        // 将字节切片转换为 UTF-8 字符串（如果失败则跳过此项）
        let pair_str = match std::str::from_utf8(pairs[i]) {
            Ok(s) => s,
            Err(_) => continue,
        };

        // 在配置项中查找第一个换行符，分隔 key 和 value
        if let Some(newline_pos) = pair_str.find('\n') {
            // 换行符之前是 key，之后是 value
            let key = pair_str[..newline_pos].to_string();
            let value = pair_str[newline_pos + 1..].to_string();
            configs.insert(key, value);
        } else {
            // 没有 value 的情况（理论上 git config --list 不会出现，但做防御性处理）
            configs.insert(pair_str.to_string(), String::new());
        }
    }

    configs
}

/**
 * 获取指定位置的配置列表
 *
 * 执行 `git config --list -z --includes [--local/--global]` 命令，
 * 返回键值对形式的配置集合。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - location: 配置读取位置（Consolidated=合并 / Local=仓库级 / Global=用户级）
 *
 * 返回值：
 * - Ok(HashMap<String, String>) - 获取成功，返回配置键值对集合
 * - Err(GitError) - 获取失败
 *
 * 底层命令：
 * - Consolidated: `git config --list -z --includes`（不加位置参数，读取合并配置）
 * - Local:        `git config --list -z --includes --local`
 * - Global:       `git config --list -z --includes --global`
 *
 * 注意：使用 -z 选项（NUL 分隔）而非默认的换行分隔，因为：
 * 1. 值中可能包含换行符（如多行配置）
 * 2. NUL 字符不会出现在正常配置值中，解析更可靠
 */
fn get_config_list(
    repo_path: &str,
    location: ConfigReadLocation,
) -> Result<HashMap<String, String>, GitError> {
    // 构造命令参数：config --list -z --includes
    let mut args: Vec<&str> = vec!["config", "--list", "-z", "--includes"];

    // 根据位置添加 --local 或 --global 参数（Consolidated 不加任何位置参数）
    match location {
        ConfigReadLocation::Consolidated => { /* 不加位置参数，读取合并配置 */ }
        ConfigReadLocation::Local => args.push("--local"),
        ConfigReadLocation::Global => args.push("--global"),
    }

    // 调用 run_git_raw 获取原始字节输出（因为 -z 输出含 NUL 字符，不能用 UTF-8 字符串处理）
    // 注意：如果指定的配置文件不存在（如用户没有 ~/.gitconfig），
    // git config --list --global 会返回非零退出码并输出 "fatal: unable to read config file"。
    // 这种情况视为"无配置"，返回空 HashMap 而非错误（与 gitgraph 行为一致）。
    match run_git_raw(repo_path, &args) {
        Ok(raw) => {
            // 解析原始字节为键值对 HashMap
            Ok(parse_config_list(&raw))
        }
        Err(GitError::CommandFailed { message, .. }) => {
            // 检查是否是"配置文件不存在"的错误
            let msg_lower = message.to_lowercase();
            if msg_lower.contains("unable to read config file")
                || msg_lower.contains("no such file or directory")
            {
                // 配置文件不存在，返回空 HashMap（视为无配置）
                Ok(HashMap::new())
            } else {
                // 其他错误，原样返回
                Err(GitError::CommandFailed {
                    exit_code: -1,
                    message,
                })
            }
        }
        Err(e) => Err(e),
    }
}

/**
 * 从配置集合中获取指定键的值
 *
 * 这是一个简单的辅助函数，封装 HashMap 的 get 操作，
 * 返回 Option<String> 而非 Option<&String>，避免生命周期问题。
 *
 * 参数：
 * - configs: 配置键值对集合
 * - key: 要查找的配置键（如 "user.name"、"remote.origin.url"）
 *
 * 返回值：
 * - Some(value) - 键存在，返回对应的值
 * - None - 键不存在
 */
fn get_config_value(configs: &HashMap<String, String>, key: &str) -> Option<String> {
    configs.get(key).cloned()
}

/**
 * 获取仓库中所有远程仓库的名称列表
 *
 * 执行 `git remote` 命令，返回所有远程仓库名称（每行一个）。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(Vec<String>) - 获取成功，返回远程仓库名称列表（如 ["origin", "upstream"]）
 * - Err(GitError) - 获取失败
 *
 * 底层命令：`git remote`（输出每行一个 remote 名称）
 */
fn get_remote_names(repo_path: &str) -> Result<Vec<String>, GitError> {
    // 执行 `git remote` 命令
    let output = run_git(repo_path, &["remote"])?;

    // 如果输出为空（仓库没有配置任何远程），返回空数组
    if output.stdout.is_empty() {
        Ok(Vec::new())
    } else {
        // 按换行符切分输出，每行是一个 remote 名称
        Ok(output.stdout.lines().map(|s| s.to_string()).collect())
    }
}

/**
 * 获取仓库的完整配置信息
 *
 * 此函数是前端"仓库设置"面板的数据源，与 gitgraph dataSource.ts 的 getConfig 方法对齐。
 *
 * 工作流程：
 * 1. 获取三组配置：consolidated（合并）、local（仓库级）、global（用户级）
 * 2. 从 local 配置中解析 branch.*.remote / branch.*.pushremote 分支跟踪设置
 * 3. 获取所有远程仓库名称，从 local 配置中读取每个 remote 的 url / pushurl
 * 4. 从 local 和 global 配置中分别读取 user.name / user.email
 * 5. 从 consolidated 配置中读取 diff.tool / diff.guitool / push.default
 * 6. 组装为 RepoConfig 结构返回
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(RepoConfig) - 获取成功，返回完整的仓库配置
 * - Err(GitError) - 获取失败（如不是 Git 仓库、git 命令执行失败等）
 *
 * 前端调用方式：
 * ```javascript
 * const config = await invoke('get_config', { repoPath: '/path/to/repo' });
 * console.log('远程仓库:', config.remotes);
 * console.log('用户名(local):', config.user.local.name);
 * console.log('用户名(global):', config.user.global.name);
 * ```
 */
pub fn get_config(repo_path: &str) -> Result<RepoConfig, GitError> {
    // 步骤 1：获取三组配置（顺序获取，因为 git 命令本身很快，无需并行）
    // consolidated: 合并 system + global + local 的配置（git config 默认行为）
    let consolidated = get_config_list(repo_path, ConfigReadLocation::Consolidated)?;
    // local: 仅仓库级配置（.git/config）
    let local = get_config_list(repo_path, ConfigReadLocation::Local)?;
    // global: 仅用户级配置（~/.gitconfig）
    let global = get_config_list(repo_path, ConfigReadLocation::Global)?;

    // 步骤 2：解析分支跟踪配置（branch.<name>.remote / branch.<name>.pushremote）
    // 这些配置只存在于 local（仓库级）配置中
    let mut branches: HashMap<String, BranchConfig> = HashMap::new();
    for (key, value) in &local {
        // 只处理 branch. 开头的键
        if key.starts_with("branch.") {
            if key.ends_with(".remote") {
                // branch.<name>.remote —— 分支的拉取来源
                // key 格式为 "branch.<name>.remote"，去掉前缀 "branch."（7 字符）和后缀 ".remote"（7 字符）
                let branch_name = &key[7..key.len() - 7];
                // 获取或创建该分支的配置项，设置 remote 字段
                let entry = branches
                    .entry(branch_name.to_string())
                    .or_default();
                entry.remote = Some(value.clone());
            } else if key.ends_with(".pushremote") {
                // branch.<name>.pushremote —— 分支的推送目标
                // key 格式为 "branch.<name>.pushremote"，去掉前缀 "branch."（7 字符）和后缀 ".pushremote"（11 字符）
                let branch_name = &key[7..key.len() - 11];
                // 获取或创建该分支的配置项，设置 push_remote 字段
                let entry = branches
                    .entry(branch_name.to_string())
                    .or_default();
                entry.push_remote = Some(value.clone());
            }
        }
    }

    // 步骤 3：解析远程仓库配置
    // 先获取所有 remote 名称，再从 local 配置中读取每个 remote 的 url / pushurl
    let remote_names = get_remote_names(repo_path)?;
    let remotes: Vec<RemoteConfig> = remote_names
        .iter()
        .map(|name| RemoteConfig {
            name: name.clone(),
            // remote.<name>.url
            url: get_config_value(&local, &format!("remote.{}.url", name)),
            // remote.<name>.pushurl（如果未配置则为 None，push 时使用 url）
            push_url: get_config_value(&local, &format!("remote.{}.pushurl", name)),
        })
        .collect();

    // 步骤 4：解析用户身份配置（同时读取 local 和 global 两级）
    let user = UserInfoConfig {
        // 仓库级 user.name / user.email
        local: UserConfig {
            name: get_config_value(&local, "user.name"),
            email: get_config_value(&local, "user.email"),
        },
        // 用户级 user.name / user.email
        global: UserConfig {
            name: get_config_value(&global, "user.name"),
            email: get_config_value(&global, "user.email"),
        },
    };

    // 步骤 5：组装并返回完整的 RepoConfig
    Ok(RepoConfig {
        branches,
        // 以下三项从 consolidated 配置中读取（合并后的最终生效值）
        diff_tool: get_config_value(&consolidated, "diff.tool"),
        gui_diff_tool: get_config_value(&consolidated, "diff.guitool"),
        push_default: get_config_value(&consolidated, "push.default"),
        remotes,
        user,
    })
}
