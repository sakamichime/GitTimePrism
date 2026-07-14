/*
 * 状态持久化模块（阶段 10：Task 10.3）
 *
 * 此模块负责持久化应用的状态到磁盘，包括：
 * 1. 仓库级状态（RepoState）：每个仓库的 UI 状态（列宽、显示选项等）
 * 2. 全局状态（GlobalState）：应用级配置（主题、最近仓库、快捷键等）
 *
 * 状态文件路径：~/.gittimeprism/state.json
 * 文件格式示例：
 * {
 *   "repoStates": {
 *     "C:\\Projects\\repo1": { ... },
 *     "C:\\Projects\\repo2": { ... }
 *   },
 *   "global": {
 *     "theme": "dark",
 *     "recentRepos": ["C:\\Projects\\repo1"],
 *     "keyboardShortcuts": { ... }
 *   }
 * }
 *
 * Code Review 状态包含 90 天过期清理逻辑：
 * - 每次创建 Code Review 时记录 timestamp
 * - 读取时检查 lastActive 字段，超过 90 天的 Code Review 被自动清理
 */

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/**
 * Code Review 状态
 *
 * 描述一次代码审查的状态，与前端 git-types.ts 的 CodeReview 类型对应。
 * 包含 90 天过期清理逻辑（基于 lastActive 时间戳）。
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeReviewState {
    /// 审查的唯一标识符（UUID 或时间戳字符串）
    pub id: String,
    /// 最后活跃时间（Unix 时间戳，单位：毫秒）
    /// 用于 90 天过期判断
    pub last_active: i64,
    /// 最后查看的文件路径；如果还没查看过文件则为 None
    pub last_viewed_file: Option<String>,
    /// 待审查的文件路径列表
    pub remaining_files: Vec<String>,
}

/**
 * 单个仓库的状态
 *
 * 描述前端 UI 的完整状态，用于在用户重新打开仓库时恢复界面。
 * 与前端 state-service.ts 的 WebViewState 对应（字段命名使用 camelCase 序列化）。
 */
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RepoState {
    /// 各列的宽度配置（像素）：graph=节点图列, date=日期列, author=作者列, commit=提交列
    #[serde(default)]
    pub column_widths: ColumnWidths,
    /// 提交详情视图（CDV）的分隔位置（百分比，0-100）
    #[serde(default = "default_cdv_divider")]
    pub cdv_divider: i32,
    /// 隐藏的远程仓库名列表（如 ["upstream"]，这些 remote 的分支不显示）
    #[serde(default)]
    pub hide_remotes: Vec<String>,
    /// 是否显示远程分支
    #[serde(default = "default_true")]
    pub show_remote_branches: bool,
    /// 是否显示 stash（暂存）记录
    #[serde(default = "default_true")]
    pub show_stashes: bool,
    /// 是否显示标签
    #[serde(default = "default_true")]
    pub show_tags: bool,
    /// 提交列表的垂直滚动位置（像素）
    #[serde(default)]
    pub scroll_top: i64,
    /// 查找窗口状态
    #[serde(default)]
    pub find_widget_state: FindWidgetState,
    /// Code Review 状态（键为审查 ID，值为审查状态）
    /// 此字段包含 90 天过期清理逻辑
    #[serde(default)]
    pub code_review_state: HashMap<String, CodeReviewState>,
}

/**
 * 各列的宽度配置
 */
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ColumnWidths {
    /// 节点图列宽度（像素）
    #[serde(default = "default_graph_width")]
    pub graph: i32,
    /// 日期列宽度（像素）
    #[serde(default = "default_date_width")]
    pub date: i32,
    /// 作者列宽度（像素）
    #[serde(default = "default_author_width")]
    pub author: i32,
    /// 提交列宽度（像素）；-1 表示占据剩余空间
    #[serde(default = "default_commit_width")]
    pub commit: i32,
}

/**
 * 查找窗口的状态
 *
 * 记录用户在提交图中查找提交时的查找状态。
 */
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FindWidgetState {
    /// 查找文本（用户输入的搜索关键字）
    #[serde(default)]
    pub text: String,
    /// 当前匹配到的提交哈希；如果没有匹配项则为 None
    pub current_hash: Option<String>,
    /// 查找窗口是否可见
    #[serde(default)]
    pub visible: bool,
    /// 是否区分大小写
    #[serde(default)]
    pub is_case_sensitive: bool,
    /// 是否使用正则表达式匹配
    #[serde(default)]
    pub is_regex: bool,
}

/**
 * 全局状态
 *
 * 描述应用级别的全局配置，不与特定仓库绑定。
 */
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GlobalState {
    /// 当前主题（'dark' 暗色或 'light' 亮色）
    #[serde(default = "default_theme")]
    pub theme: String,
    /// 最近打开的仓库列表（按时间倒序，最近打开的在前面）
    #[serde(default)]
    pub recent_repos: Vec<String>,
    /// 键盘快捷键配置（键为快捷键名称，值为快捷键字符串如 "Ctrl+F"）
    #[serde(default)]
    pub keyboard_shortcuts: HashMap<String, String>,
    /// 应用设置（包含 fetchAvatars、showSignatureStatus 等全局开关）
    #[serde(default)]
    pub settings: HashMap<String, serde_json::Value>,
}

/**
 * 完整状态文件的数据结构
 *
 * 对应 ~/.gittimeprism/state.json 文件的内容。
 * 包含所有仓库的状态和全局状态。
 */
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StateFile {
    /// 各仓库的状态（键为仓库路径，值为该仓库的状态）
    #[serde(default)]
    pub repo_states: HashMap<String, RepoState>,
    /// 全局状态
    #[serde(default)]
    pub global: GlobalState,
}

// ==================== 默认值函数 ====================

/**
 * 默认 CDV 分隔位置（50% 表示上下各半）
 */
fn default_cdv_divider() -> i32 {
    50
}

/**
 * 默认值 true（用于 show_remote_branches / show_stashes / show_tags）
 */
fn default_true() -> bool {
    true
}

/**
 * 默认节点图列宽度
 */
fn default_graph_width() -> i32 {
    80
}

/**
 * 默认日期列宽度
 */
fn default_date_width() -> i32 {
    120
}

/**
 * 默认作者列宽度
 */
fn default_author_width() -> i32 {
    150
}

/**
 * 默认提交列宽度（-1 表示占据剩余空间）
 */
fn default_commit_width() -> i32 {
    -1
}

/**
 * 默认主题（暗色）
 */
fn default_theme() -> String {
    "dark".to_string()
}

// ==================== 状态文件读写 ====================

/**
 * 获取 ~/.gittimeprism 配置目录的路径
 *
 * 跨平台处理：
 * - Windows: C:\Users\<用户>\.gittimeprism
 * - macOS/Linux: /home/<用户>/.gittimeprism 或 /Users/<用户>/.gittimeprism
 *
 * 返回值：配置目录的 PathBuf
 */
fn get_config_dir() -> PathBuf {
    // 优先使用 dirs::home_dir 获取用户主目录
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".gittimeprism")
}

/**
 * 获取状态文件 state.json 的完整路径
 *
 * 路径为：~/.gittimeprism/state.json
 *
 * 返回值：状态文件的 PathBuf
 */
fn get_state_file_path() -> PathBuf {
    get_config_dir().join("state.json")
}

/**
 * 加载完整状态文件
 *
 * 从 ~/.gittimeprism/state.json 读取状态：
 * - 如果文件不存在，返回默认的空状态
 * - 如果文件存在但解析失败，记录错误后返回默认状态（避免损坏的状态文件阻塞应用启动）
 *
 * 返回值：StateFile 状态结构体
 */
fn load_state_file() -> StateFile {
    // 获取状态文件路径
    let state_path = get_state_file_path();
    // 如果状态文件不存在，返回默认空状态
    if !state_path.exists() {
        return StateFile::default();
    }
    // 读取状态文件内容
    match fs::read_to_string(&state_path) {
        Ok(content) => {
            // 解析 JSON 内容为 StateFile 结构体
            match serde_json::from_str::<StateFile>(&content) {
                Ok(state) => state,
                Err(err) => {
                    // 状态文件解析失败，记录错误并返回默认状态
                    eprintln!("[state] 状态文件解析失败: {}，使用默认状态", err);
                    StateFile::default()
                }
            }
        }
        Err(err) => {
            eprintln!("[state] 读取状态文件失败: {}，使用默认状态", err);
            StateFile::default()
        }
    }
}

/**
 * 保存完整状态文件到磁盘
 *
 * 将状态写入 ~/.gittimeprism/state.json：
 * 1. 确保配置目录存在（不存在则创建）
 * 2. 将状态序列化为格式化的 JSON
 * 3. 写入文件（覆盖旧内容）
 *
 * 参数：
 * - state: 要保存的状态结构体
 *
 * 返回值：
 * - Ok(()) - 保存成功
 * - Err(String) - 保存失败
 */
fn save_state_file(state: &StateFile) -> Result<(), String> {
    // 获取配置目录路径
    let config_dir = get_config_dir();
    // 如果配置目录不存在，创建它
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    // 获取状态文件路径
    let state_path = get_state_file_path();
    // 将状态序列化为格式化的 JSON 字符串
    let json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("序列化状态失败: {}", e))?;
    // 写入文件
    fs::write(&state_path, json)
        .map_err(|e| format!("写入状态文件失败: {}", e))?;
    Ok(())
}

/**
 * Code Review 状态的过期时间（90 天，单位：毫秒）
 *
 * 90 天 = 90 * 24 * 60 * 60 * 1000 = 7,776,000,000 毫秒
 */
const CODE_REVIEW_EXPIRY_MS: i64 = 90 * 24 * 60 * 60 * 1000;

/**
 * 获取当前时间的毫秒时间戳（从 UNIX 纪元开始）
 *
 * 返回值：当前时间的毫秒数
 */
fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/**
 * 清理过期的 Code Review 状态
 *
 * 检查 Code Review 状态的 lastActive 字段，超过 90 天的 Code Review 被自动移除。
 * 此函数在读取仓库状态时调用，确保过期的 Code Review 不会堆积。
 *
 * 参数：
 * - repo_state: 要清理的仓库状态（直接修改此参数）
 */
fn cleanup_expired_code_reviews(repo_state: &mut RepoState) {
    // 获取当前时间
    let now = now_ms();
    // 保留 lastActive + 90 天 > now 的 Code Review（即未过期的）
    repo_state.code_review_state.retain(|_, review| {
        // 计算 last_active + 90 天是否大于当前时间
        // 如果大于，说明未过期，保留；否则移除
        review.last_active + CODE_REVIEW_EXPIRY_MS > now
    });
}

// ==================== 公开 API ====================

/**
 * 获取指定仓库的状态
 *
 * 从 ~/.gittimeprism/state.json 读取指定仓库的状态。
 * 如果该仓库没有保存过状态，返回默认状态。
 *
 * 读取时会自动清理过期的 Code Review 状态（90 天过期）。
 *
 * 参数：
 * - repo_path: 仓库路径
 *
 * 返回值：该仓库的 RepoState
 */
pub fn get_repo_state(repo_path: &str) -> RepoState {
    // 加载完整状态文件
    let mut state_file = load_state_file();
    // 获取该仓库的状态（如果不存在则使用默认值）
    let mut repo_state = state_file
        .repo_states
        .remove(repo_path)
        .unwrap_or_default();
    // 清理过期的 Code Review
    cleanup_expired_code_reviews(&mut repo_state);
    // 如果清理后有变化，保存回去
    if repo_state.code_review_state.is_empty() {
        // 仅在原本有 Code Review 但被清理掉时才保存
        // 这里简化处理：不主动保存，等下次 save_repo_state 时再保存
    }
    repo_state
}

/**
 * 保存指定仓库的状态
 *
 * 将仓库状态写入 ~/.gittimeprism/state.json。
 * 保存前会先清理过期的 Code Review 状态。
 *
 * 参数：
 * - repo_path: 仓库路径
 * - state: 要保存的仓库状态
 *
 * 返回值：
 * - Ok(()) - 保存成功
 * - Err(String) - 保存失败
 */
pub fn save_repo_state(repo_path: &str, mut state: RepoState) -> Result<(), String> {
    // 加载完整状态文件
    let mut state_file = load_state_file();
    // 保存前清理过期的 Code Review（直接对 state 调用清理函数）
    cleanup_expired_code_reviews(&mut state);
    // 更新该仓库的状态
    state_file.repo_states.insert(repo_path.to_string(), state);
    // 保存完整状态文件
    save_state_file(&state_file)
}

/**
 * 获取全局状态
 *
 * 从 ~/.gittimeprism/state.json 读取全局状态。
 * 如果文件不存在或全局状态字段缺失，返回默认状态。
 *
 * 返回值：GlobalState
 */
pub fn get_global_state() -> GlobalState {
    // 加载完整状态文件
    let state_file = load_state_file();
    // 返回全局状态（如果文件不存在则为默认值）
    state_file.global
}

/**
 * 保存全局状态
 *
 * 将全局状态写入 ~/.gittimeprism/state.json。
 * 此函数不会影响已保存的仓库状态。
 *
 * 参数：
 * - state: 要保存的全局状态
 *
 * 返回值：
 * - Ok(()) - 保存成功
 * - Err(String) - 保存失败
 */
pub fn save_global_state(state: GlobalState) -> Result<(), String> {
    // 加载完整状态文件（保留仓库状态）
    let mut state_file = load_state_file();
    // 更新全局状态
    state_file.global = state;
    // 保存完整状态文件
    save_state_file(&state_file)
}

/**
 * 更新 Code Review 状态的 lastActive 时间戳
 *
 * 当用户在 Code Review 中查看文件或导航时，调用此函数更新 lastActive。
 * 这样可以保持 Code Review 的活跃状态，避免被 90 天过期清理。
 *
 * 参数：
 * - repo_path: 仓库路径
 * - review_id: Code Review 的唯一标识符
 *
 * 返回值：
 * - Ok(()) - 更新成功（如果 Code Review 不存在则忽略）
 * - Err(String) - 失败
 */
pub fn touch_code_review(repo_path: &str, review_id: &str) -> Result<(), String> {
    // 加载完整状态文件
    let mut state_file = load_state_file();
    // 获取该仓库的状态
    if let Some(repo_state) = state_file.repo_states.get_mut(repo_path) {
        // 获取指定的 Code Review
        if let Some(review) = repo_state.code_review_state.get_mut(review_id) {
            // 更新 lastActive 为当前时间
            review.last_active = now_ms();
            // 保存状态文件
            return save_state_file(&state_file);
        }
    }
    // Code Review 不存在，忽略（不报错）
    Ok(())
}
