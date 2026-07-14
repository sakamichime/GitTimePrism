/*
 * 文件监听工具模块（阶段 10：Task 10.2 扩展）
 *
 * 使用 notify crate 监听文件系统变化，通过 Tauri 事件系统将变化信息推送到前端。
 *
 * 功能说明：
 * 1. 单仓库监听：监听指定仓库目录下的文件变化
 * 2. 750ms 防抖：聚合短时间内的多次文件变更事件，避免前端频繁刷新
 * 3. mute/unmute 机制：操作期间静音避免触发自身刷新
 *    - unmute 后 1.5 秒内忽略事件（resume_at 时间戳之前的事件被忽略）
 * 4. FILE_CHANGE_REGEX 过滤：只监听 .git 目录下关键文件的变更
 *    - .git/config（仓库配置）
 *    - .git/index（暂存区）
 *    - .git/HEAD（当前分支指针）
 *    - .git/refs/stash（stash 列表）
 *    - .git/refs/heads/ 通配符（本地分支引用）
 *    - .git/refs/remotes/ 通配符（远程跟踪分支引用）
 *    - .git/refs/tags/ 通配符（标签引用）
 *    - .git 顶层文件（如 .git/COMMIT_EDITMSG、.git/MERGE_HEAD 等）
 *    - 非 .git 目录下的所有文件（工作区变更）
 * 5. 触发 repo_changed Tauri 事件通知前端刷新
 *
 * 状态管理：
 * - WATCHER: 全局静态 Mutex<Option<WatcherState>> 保存当前监听状态
 *   - watcher: notify 的 RecommendedWatcher 实例
 *   - muted: 是否处于静音状态
 *   - resume_at: 静音恢复时间戳（毫秒）
 *   - debounce_handle: 防抖定时器线程句柄
 *   - current_repo: 当前监听的仓库路径
 *   - app_handle: Tauri 应用句柄（用于发送事件）
 *
 * 工作流程：
 * 1. 应用启动时调用 init_file_watcher 初始化（不监听具体目录）
 * 2. 打开仓库时调用 start_watcher(repo_path) 开始监听
 * 3. Git 操作前调用 mute_watcher 静音
 * 4. Git 操作后调用 unmute_watcher 恢复（1.5 秒内事件被忽略）
 * 5. 切换仓库时自动停止旧仓库监听，启动新仓库监听
 * 6. 关闭仓库时调用 stop_watcher 停止监听
 */

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::{RecursiveMode, Watcher, RecommendedWatcher, EventKind};
use tauri::{AppHandle, Emitter};

/**
 * 文件变更过滤正则表达式（与 gitgraph 项目的 FILE_CHANGE_REGEX 对齐）
 *
 * 此正则匹配以下文件路径（相对于仓库根目录）：
 * 1. .git/config、.git/index、.git/HEAD、.git/refs/stash、
 *    .git/refs/heads/ 通配符、.git/refs/remotes/ 通配符、.git/refs/tags/ 通配符
 * 2. 非 .git 目录下的所有文件（工作区变更）
 * 3. .git 顶层文件（如 .git/COMMIT_EDITMSG、.git/MERGE_HEAD 等）
 *
 * 注意：此正则在 Rust 中用 matches_file_change 函数手动实现，避免引入 regex 依赖。
 */
const FILE_CHANGE_REGEX_PATTERN: &str = r"(^\.git/(config|index|HEAD|refs/stash|refs/heads/.*|refs/remotes/.*|refs/tags/.*)$)|(^(?!\.git/).*$)|(^\.git[^/]*$)";

/**
 * 防抖延迟（毫秒）
 *
 * 在文件变化事件触发后等待 750ms，如果在此期间有新的事件，则重新计时。
 * 这样可以将短时间内的多次变更合并为一次刷新。
 */
const DEBOUNCE_DELAY_MS: u64 = 750;

/**
 * unmute 后忽略事件的时间窗口（毫秒）
 *
 * unmute 后 1.5 秒内的事件被忽略，避免 GitTimePrism 自身的 Git 操作
 * 触发文件监听，进而触发自身刷新。
 */
const UNMUTE_IGNORE_WINDOW_MS: u64 = 1500;

/**
 * 文件监听器状态
 *
 * 保存当前监听器的所有状态信息，存储在全局 Mutex 中。
 */
struct WatcherState {
    /// notify 的文件监听器实例（Option 是因为可能未启动监听）
    watcher: Option<RecommendedWatcher>,
    /// 当前监听的仓库路径（None 表示未监听任何仓库）
    current_repo: Option<String>,
    /// Tauri 应用句柄（用于向前端发送 repo_changed 事件）
    app_handle: Option<AppHandle>,
    /// 是否处于静音状态（true = 忽略所有事件）
    muted: bool,
    /// 静音恢复时间戳（毫秒，从 UNIX 纪元开始计算）
    /// 此时间戳之前的事件被忽略，用于 unmute 后的延迟恢复
    resume_at_ms: u64,
    /// 防抖定时器线程是否在运行
    /// true = 已有定时器在等待触发，新事件应取消旧定时器
    debounce_active: bool,
    /// 上次触发防抖的时间戳（用于判断是否需要继续触发）
    last_event_time_ms: u64,
}

/**
 * 全局监听器状态（使用 OnceLock 在第一次使用时初始化）
 *
 * 使用 Mutex 保证线程安全，多个 Tauri 命令可能同时访问此状态。
 */
static WATCHER: std::sync::OnceLock<Mutex<WatcherState>> = std::sync::OnceLock::new();

/**
 * 获取全局监听器状态的 Mutex 引用
 *
 * 第一次调用时初始化 WatcherState（所有字段为默认空值）。
 */
fn get_watcher_state() -> &'static Mutex<WatcherState> {
    WATCHER.get_or_init(|| {
        Mutex::new(WatcherState {
            watcher: None,
            current_repo: None,
            app_handle: None,
            muted: false,
            resume_at_ms: 0,
            debounce_active: false,
            last_event_time_ms: 0,
        })
    })
}

/**
 * 获取当前时间的毫秒时间戳（从 UNIX 纪元开始）
 *
 * 用于 mute/unmute 机制和防抖计时。
 *
 * 返回值：当前时间的毫秒数
 */
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/**
 * 判断文件路径是否匹配 FILE_CHANGE_REGEX
 *
 * 此函数手动实现了 gitgraph 项目中的 FILE_CHANGE_REGEX 正则匹配逻辑，
 * 避免引入 regex crate 依赖。
 *
 * 匹配规则：
 * 1. .git/config、.git/index、.git/HEAD、.git/refs/stash
 * 2. .git/refs/heads/ 通配符、.git/refs/remotes/ 通配符、.git/refs/tags/ 通配符
 * 3. 非 .git 开头的所有路径（工作区文件变更）
 * 4. .git 顶层文件（.git 后面直接跟文件名，无斜杠，如 .git/COMMIT_EDITMSG）
 *
 * 参数：
 * - relative_path: 相对于仓库根目录的文件路径（使用 / 分隔符）
 *
 * 返回值：
 * - true - 文件变更需要触发刷新
 * - false - 文件变更可忽略
 */
fn matches_file_change(relative_path: &str) -> bool {
    // 规则 1：精确匹配 .git 顶层关键文件
    if relative_path == ".git/config"
        || relative_path == ".git/index"
        || relative_path == ".git/HEAD"
        || relative_path == ".git/refs/stash"
    {
        return true;
    }
    // 规则 2：匹配 .git/refs/heads/*、.git/refs/remotes/*、.git/refs/tags/*
    if relative_path.starts_with(".git/refs/heads/")
        || relative_path.starts_with(".git/refs/remotes/")
        || relative_path.starts_with(".git/refs/tags/")
    {
        return true;
    }
    // 规则 3：匹配非 .git 开头的工作区文件
    // 即不以 ".git/" 开头的所有路径
    if !relative_path.starts_with(".git/") {
        return true;
    }
    // 规则 4：匹配 .git 顶层文件（.git 后面无斜杠）
    // 例如 .git/COMMIT_EDITMSG、.git/MERGE_HEAD、.git/FETCH_HEAD 等
    // 但需要排除已经被规则 1 处理的文件
    // 此条件：路径以 .git/ 开头，但不是 refs/、objects/、logs/ 等内部目录
    if relative_path.starts_with(".git/") {
        // 提取 .git/ 之后的部分
        let after_git = &relative_path[5..];
        // 如果不包含 /（即顶层文件），且不以 refs/、objects/、logs/ 开头
        if !after_git.contains('/')
            && !after_git.starts_with("refs/")
            && !after_git.starts_with("objects/")
            && !after_git.starts_with("logs/")
        {
            return true;
        }
    }
    false
}

/**
 * 初始化文件监听系统
 *
 * 在应用启动时调用，初始化全局监听器状态。
 * 此时不监听具体目录，等待 start_watcher 调用后再开始监听。
 *
 * 参数：
 * - app_handle: Tauri 应用句柄，用于向前端发送 repo_changed 事件
 *
 * 返回值：
 * - Ok(()) - 初始化成功
 * - Err(String) - 初始化失败
 */
pub fn init_file_watcher(app_handle: AppHandle) -> Result<(), String> {
    // 获取全局状态并保存 app_handle
    let state = get_watcher_state();
    let mut guard = state.lock().map_err(|e| format!("监听器状态锁失败: {}", e))?;
    guard.app_handle = Some(app_handle);
    log::info!("[watcher] 文件监听系统已初始化（等待仓库打开后启用）");
    Ok(())
}

/**
 * 启动文件监听器
 *
 * 开始监听指定仓库目录下的文件变化。
 * 如果当前已有监听器在运行，先停止旧的监听器。
 *
 * 工作流程：
 * 1. 如果已有监听器，停止它
 * 2. 创建新的 notify RecommendedWatcher
 * 3. 监听仓库根目录（递归模式）
 * 4. 更新 current_repo 状态
 *
 * 参数：
 * - repo_path: 要监听的仓库路径
 *
 * 返回值：
 * - Ok(()) - 启动成功
 * - Err(String) - 启动失败
 */
pub fn start_watcher(repo_path: &str) -> Result<(), String> {
    let state = get_watcher_state();
    let mut guard = state.lock().map_err(|e| format!("监听器状态锁失败: {}", e))?;

    // 如果已有监听器，先停止它（释放资源）
    if guard.watcher.is_some() {
        log::info!("[watcher] 停止旧的监听器");
        guard.watcher = None;
    }

    // 复制 app_handle 到局部变量（避免在闭包中持有 guard）
    let app_handle = guard.app_handle.clone();
    if app_handle.is_none() {
        return Err("应用句柄未初始化".to_string());
    }
    let app_handle = app_handle.unwrap();

    // 复制仓库路径到局部变量
    let repo_path_owned = repo_path.to_string();
    let repo_path_for_closure = repo_path.to_string();

    // 创建 notify 文件监听器
    // 闭包接收 notify::Result<notify::Event>，处理每个文件变化事件
    let watcher = notify::recommended_watcher(
        move |result: notify::Result<notify::Event>| {
            // 处理文件变化事件
            if let Ok(event) = result {
                handle_file_event(&app_handle, &repo_path_for_closure, &event);
            }
        },
    )
    .map_err(|e| format!("创建文件监听器失败: {}", e))?;

    // 将监听器保存到状态
    let mut watcher = watcher;
    // 开始监听仓库根目录（递归模式，监听所有子目录）
    watcher
        .watch(Path::new(repo_path), RecursiveMode::Recursive)
        .map_err(|e| format!("启动监听失败: {}", e))?;

    // 更新状态
    guard.watcher = Some(watcher);
    guard.current_repo = Some(repo_path_owned);
    // 启动时设为非静音状态，但设置 1.5 秒的延迟恢复，避免启动过程中触发的事件
    guard.muted = false;
    guard.resume_at_ms = now_ms() + UNMUTE_IGNORE_WINDOW_MS;
    log::info!("[watcher] 已开始监听仓库: {}", repo_path);
    Ok(())
}

/**
 * 停止文件监听器
 *
 * 停止当前监听并清理状态。关闭仓库或切换仓库时调用。
 *
 * 返回值：
 * - Ok(()) - 停止成功
 * - Err(String) - 失败（极少见）
 */
pub fn stop_watcher() -> Result<(), String> {
    let state = get_watcher_state();
    let mut guard = state.lock().map_err(|e| format!("监听器状态锁失败: {}", e))?;

    if guard.watcher.is_some() {
        let repo = guard.current_repo.clone().unwrap_or_default();
        guard.watcher = None;
        guard.current_repo = None;
        guard.muted = false;
        guard.debounce_active = false;
        log::info!("[watcher] 已停止监听仓库: {}", repo);
    }
    Ok(())
}

/**
 * 静音文件监听
 *
 * 在执行 Git 操作前调用，防止 GitTimePrism 自身的操作触发文件监听，
 * 进而触发自身刷新（导致循环刷新）。
 *
 * 静音后所有文件变化事件都被忽略，直到调用 unmute_watcher 恢复。
 *
 * 返回值：
 * - Ok(()) - 静音成功
 * - Err(String) - 失败
 */
pub fn mute_watcher() -> Result<(), String> {
    let state = get_watcher_state();
    let mut guard = state.lock().map_err(|e| format!("监听器状态锁失败: {}", e))?;
    guard.muted = true;
    log::info!("[watcher] 已静音文件监听");
    Ok(())
}

/**
 * 取消静音文件监听
 *
 * 在 Git 操作完成后调用，恢复正常监听。
 * 取消静音后，1.5 秒内的事件仍被忽略（resume_at_ms 之前的事件被忽略），
 * 这是为了避免 Git 操作产生的残留事件触发刷新。
 *
 * 返回值：
 * - Ok(()) - 取消静音成功
 * - Err(String) - 失败
 */
pub fn unmute_watcher() -> Result<(), String> {
    let state = get_watcher_state();
    let mut guard = state.lock().map_err(|e| format!("监听器状态锁失败: {}", e))?;
    guard.muted = false;
    // 设置 1.5 秒的延迟恢复时间窗口
    // 此时间戳之前的所有事件被忽略
    guard.resume_at_ms = now_ms() + UNMUTE_IGNORE_WINDOW_MS;
    log::info!("[watcher] 已取消静音，1.5 秒后恢复正常监听");
    Ok(())
}

/**
 * 处理单个文件变化事件
 *
 * 此函数在 notify 的回调线程中被调用，对每个文件变化事件进行处理：
 * 1. 检查是否处于静音状态（如果是，忽略事件）
 * 2. 检查是否在 unmute 后的延迟窗口内（如果是，忽略事件）
 * 3. 检查文件路径是否匹配 FILE_CHANGE_REGEX（如果不匹配，忽略事件）
 * 4. 触发 750ms 防抖（取消之前的定时器，重新计时）
 *
 * 参数：
 * - app_handle: Tauri 应用句柄
 * - repo_path: 仓库路径（用于计算相对路径）
 * - event: notify 的文件变化事件
 */
fn handle_file_event(app_handle: &AppHandle, repo_path: &str, event: &notify::Event) {
    // 跳过非文件变化事件（如访问事件）
    match event.kind {
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {}
        _ => return,
    }

    // 检查静音状态和延迟恢复窗口
    {
        let state = get_watcher_state();
        let guard = match state.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        // 静音状态下忽略所有事件
        if guard.muted {
            return;
        }
        // 在 unmute 后的延迟窗口内忽略事件
        let now = now_ms();
        if now < guard.resume_at_ms {
            return;
        }
    }

    // 检查文件路径是否匹配过滤规则
    let mut has_matching_path = false;
    for path in &event.paths {
        // 计算相对于仓库根目录的路径
        let relative = match path.strip_prefix(repo_path) {
            Ok(rel) => rel,
            Err(_) => continue, // 路径不在仓库下，跳过
        };
        // 转为字符串，使用 / 作为分隔符（跨平台一致）
        let relative_str = relative.to_string_lossy().replace('\\', "/");
        // 检查是否匹配过滤规则
        if matches_file_change(&relative_str) {
            has_matching_path = true;
            break;
        }
    }

    if !has_matching_path {
        return;
    }

    // 触发防抖
    // 由于 Rust 中没有简单的异步定时器，这里使用 spawn 线程 + sleep 的方式实现
    // 每次事件都更新 last_event_time_ms，定时器线程检查此时间戳决定是否触发
    let state = get_watcher_state();
    let mut guard = match state.lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    let now = now_ms();
    guard.last_event_time_ms = now;

    // 如果已有定时器在运行，不需要启动新的（旧定时器会检查 last_event_time_ms）
    if guard.debounce_active {
        return;
    }
    guard.debounce_active = true;
    drop(guard); // 释放锁

    // 复制 app_handle 用于在线程中发送事件
    let app_handle_clone = app_handle.clone();
    // 启动防抖线程
    std::thread::spawn(move || {
        // 等待防抖延迟
        std::thread::sleep(Duration::from_millis(DEBOUNCE_DELAY_MS));

        // 检查在此期间是否有新事件，如果有则继续等待
        loop {
            let state = get_watcher_state();
            let guard = match state.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            let last_event = guard.last_event_time_ms;
            let elapsed_since_last = now_ms().saturating_sub(last_event);
            drop(guard);

            // 如果距离上次事件不足防抖延迟，继续等待
            if elapsed_since_last < DEBOUNCE_DELAY_MS {
                let remaining = DEBOUNCE_DELAY_MS - elapsed_since_last;
                std::thread::sleep(Duration::from_millis(remaining));
                continue;
            }
            break;
        }

        // 标记防抖结束
        {
            let state = get_watcher_state();
            if let Ok(mut guard) = state.lock() {
                guard.debounce_active = false;
            }
        }

        // 再次检查静音状态（防止防抖期间被静音）
        {
            let state = get_watcher_state();
            let guard = match state.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if guard.muted {
                return;
            }
            let now = now_ms();
            if now < guard.resume_at_ms {
                return;
            }
        }

        // 发送 repo_changed 事件到前端
        log::info!("[watcher] 触发 repo_changed 事件");
        let _ = app_handle_clone.emit("repo_changed", ());
    });
}

// 注意：FILE_CHANGE_REGEX_PATTERN 常量保留用于文档参考，实际匹配逻辑在 matches_file_change 函数中实现。
// 如果未来需要更复杂的正则匹配，可以引入 regex crate 并使用此常量。
#[allow(dead_code)]
const _FILE_CHANGE_REGEX_PATTERN_DOC: &str = FILE_CHANGE_REGEX_PATTERN;
