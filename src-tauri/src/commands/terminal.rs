/*
 * 终端相关命令模块
 * 
 * 使用 portable-pty crate 创建伪终端（PTY）。
 * PTY（Pseudo Terminal）是一个虚拟的终端设备，
 * 让 GUI 应用中的终端组件能够像真正的终端一样工作。
 * 
 * 工作原理：
 * 1. 前端 xterm.js 组件渲染终端界面
 * 2. 用户在 xterm.js 中输入的字符通过 invoke 发送到 Rust
 * 3. Rust 将字符写入 PTY 的写入端（通过 take_writer() 获取）
 * 4. PTY 中的 shell 处理字符并产生输出
 * 5. Rust 从 PTY 读取输出（通过 try_clone_reader() 获取），通过 Tauri 事件推送到前端
 * 6. 前端将输出写入 xterm.js 显示
 * 
 * portable-pty API 要点：
 * - take_writer() 返回 Box<dyn Write + Send>，只能调用一次，drop 后发送 EOF
 * - try_clone_reader() 返回 Box<dyn Read + Send>，可以多次调用
 * - resize() 用于调整 PTY 窗口大小
 */

use std::collections::HashMap;
use std::io::Write; // 引入 Write trait（用于 write_all/flush 方法和 Box<dyn Write + Send> 类型）
use std::sync::Mutex;
use tauri::command;
use tauri::Manager; // 引入 Manager trait 以使用 app.state() 方法
use tauri::{AppHandle, Emitter};

/**
 * PTY 实例数据
 * 
 * 存储一个 PTY 的所有必要组件：
 * - master: PTY 主端，用于调整大小
 * - writer: PTY 写入端，用于向 shell 发送用户输入
 * 
 * 注意：reader 在创建后立即传给后台线程，不需要存储。
 */
struct PtyInstance {
    /// PTY 主端，用于调用 resize() 调整终端大小
    master: Box<dyn portable_pty::MasterPty + Send>,
    /// PTY 写入端（由 take_writer() 获取），用于向 shell 发送用户输入
    /// 注意：drop 此 writer 会向 shell 发送 EOF，所以要一直持有
    writer: Box<dyn Write + Send>,
}

/**
 * PTY 管理器
 * 
 * 全局单例，管理所有 PTY 实例。
 * 使用 Mutex 保证线程安全。
 * 
 * 通过 Tauri 的 .manage() 注册为全局状态，
 * 所有 #[tauri::command] 函数都可以通过 app.state::<PtyManager>() 访问。
 */
pub struct PtyManager {
    /// PTY 实例存储
    /// Key: PTY 唯一标识符（如 "pty_1234567890"）
    /// Value: PTY 实例数据（包含主端和写入端）
    ptys: Mutex<HashMap<String, PtyInstance>>,
}

impl PtyManager {
    /**
     * 创建新的 PTY 管理器实例
     */
    pub fn new() -> Self {
        Self {
            ptys: Mutex::new(HashMap::new()),
        }
    }
}

/**
 * 启动一个新的 PTY 进程
 * 
 * 创建伪终端并在其中启动默认 shell。
 * 后台线程持续读取 shell 输出并通过事件推送到前端。
 * 
 * 参数：
 * - app: Tauri 应用句柄
 * - working_dir: 工作目录路径（可选）
 * 
 * 返回值：PTY 的唯一标识符
 */
#[command]
pub async fn start_pty(app: AppHandle, working_dir: String) -> Result<String, String> {
    // 生成唯一的 PTY ID（基于时间戳）
    let pty_id = format!("pty_{}", get_timestamp());

    // 获取当前平台的 PTY 系统（Windows 上是 ConPty，Unix 上是 POSIX pty）
    let pty_system = portable_pty::native_pty_system();

    // 创建 PTY 实例对（包含 master 主端和 slave 从端）
    let pair = pty_system
        .openpty(portable_pty::PtySize {
            rows: 24,   // 初始行数
            cols: 80,   // 初始列数
            pixel_width: 0,   // 像素宽度（0 表示不确定）
            pixel_height: 0,  // 像素高度（0 表示不确定）
        })
        .map_err(|e| format!("创建 PTY 失败: {}", e))?;

    // 确定要启动的 shell 命令（Windows 用 PowerShell，Unix 用 bash）
    let shell_cmd = get_default_shell();

    // 在 PTY 从端（slave）启动 shell 子进程
    // spawn_command 返回 Box<dyn Child>，我们不需要持有它，
    // 因为 PTY pair 的 drop 会自动清理子进程
    let _child = pair
        .slave
        .spawn_command(shell_cmd)
        .map_err(|e| format!("启动 shell 失败: {}", e))?;

    // 克隆 PTY 读取器（用于后台线程读取 shell 输出）
    // try_clone_reader() 可以多次调用，返回 Box<dyn Read + Send>
    // 声明为 mut 因为 read() 方法需要 &mut self
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("克隆 PTY 读取器失败: {}", e))?;

    // 获取 PTY 写入器（用于向前端用户的输入写入 shell）
    // take_writer() 只能调用一次！返回 Box<dyn Write + Send>
    // 注意：drop writer 会向 shell 发送 EOF，所以要存起来一直持有
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("获取 PTY 写入器失败: {}", e))?;

    // 如果指定了工作目录，通过 PTY 写入器发送 cd 命令切换目录
    if !working_dir.is_empty() {
        let cd_cmd = format!("cd \"{}\"\r\n", working_dir);
        // 使用 std::io::Write trait 的 write_all 方法写入命令
        writer
            .write_all(cd_cmd.as_bytes())
            .map_err(|e| format!("发送 cd 命令失败: {}", e))?;
        writer
            .flush()
            .map_err(|e| format!("刷新写入缓冲区失败: {}", e))?;
    }

    // 构建 PTY 实例并存储到全局管理器
    let instance = PtyInstance {
        master: pair.master,
        writer,
    };
    {
        let manager = app.state::<PtyManager>();
        let mut ptys = manager.ptys.lock().unwrap();
        ptys.insert(pty_id.clone(), instance);
    }

    // 启动后台线程持续读取 PTY 输出并推送到前端
    let app_handle = app.clone();
    let pty_id_clone = pty_id.clone();
    std::thread::spawn(move || {
        // 使用 4KB 缓冲区读取 PTY 输出数据
        let mut buf = [0u8; 4096];
        loop {
            // 使用 std::io::Read trait 的 read 方法读取数据
            match reader.read(&mut buf) {
                // 读取到 0 字节表示 shell 进程已退出（EOF）
                Ok(0) => {
                    log::info!("PTY {} 的 shell 已退出", pty_id_clone);
                    break;
                }
                // 读取到 n 字节数据，推送到前端 xterm.js 显示
                Ok(n) => {
                    // 将字节数据转换为 UTF-8 字符串（非 UTF-8 字节替换为替换字符）
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    // 通过 Tauri 事件系统将数据推送到前端
                    let _ = app_handle.emit("pty-output", serde_json::json!({
                        "ptyId": pty_id_clone,
                        "data": data,
                    }));
                }
                // 读取出错，记录错误并退出线程
                Err(e) => {
                    log::error!("读取 PTY {} 输出失败: {}", pty_id_clone, e);
                    break;
                }
            }
        }
    });

    Ok(pty_id)
}

/**
 * 向指定的 PTY 写入数据（用户的键盘输入）
 * 
 * 前端 xterm.js 捕获用户的键盘输入后，
 * 通过 invoke('write_to_pty', { ptyId, data }) 调用此函数，
 * 将用户输入的字符写入 PTY 的写入端，最终发送到 shell。
 */
#[command]
pub async fn write_to_pty(
    app: AppHandle,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    let manager = app.state::<PtyManager>();
    let mut ptys = manager.ptys.lock().unwrap();

    // 查找指定 ID 的 PTY 实例
    if let Some(instance) = ptys.get_mut(&pty_id) {
        // 使用 std::io::Write trait 的 write_all 方法写入用户输入
        instance
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("写入 PTY 失败: {}", e))?;
        // 刷新缓冲区，确保数据立即发送到 shell
        instance
            .writer
            .flush()
            .map_err(|e| format!("刷新 PTY 写入缓冲区失败: {}", e))?;
        Ok(())
    } else {
        Err(format!("未找到 PTY 实例: {}", pty_id))
    }
}

/**
 * 调整 PTY 的大小（行列数）
 * 
 * 当用户拖拽终端面板边缘或终端面板大小发生变化时，
 * 前端 xterm.js 通过 FitAddon 计算出新的行列数，
 * 然后调用此函数通知 PTY 调整窗口大小。
 * 调整后 shell 会收到 SIGWINCH 信号（Unix）或类似通知（Windows），
 * 从而重新布局输出内容。
 */
#[command]
pub async fn resize_pty(
    app: AppHandle,
    pty_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let manager = app.state::<PtyManager>();
    let ptys = manager.ptys.lock().unwrap();

    if let Some(instance) = ptys.get(&pty_id) {
        // 使用 portable-pty 的 resize 方法调整 PTY 窗口大小
        instance
            .master
            .resize(portable_pty::PtySize {
                rows,     // 直接使用 u16 类型的 rows
                cols,     // 直接使用 u16 类型的 cols
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("调整 PTY 大小失败: {}", e))?;
        Ok(())
    } else {
        Err(format!("未找到 PTY 实例: {}", pty_id))
    }
}

/**
 * 终止指定的 PTY 进程
 * 
 * 从管理器中移除 PTY 实例。
 * 移除后，PtyInstance 被 drop，writer 被 drop 会向 shell 发送 EOF，
 * master 被 drop 会关闭 PTY 主端，shell 进程将随之退出。
 */
#[command]
pub async fn kill_pty(
    app: AppHandle,
    pty_id: String,
) -> Result<(), String> {
    let manager = app.state::<PtyManager>();
    let mut ptys = manager.ptys.lock().unwrap();
    // 从 HashMap 中移除 PTY 实例，drop 时自动清理资源
    ptys.remove(&pty_id);
    log::info!("PTY {} 已终止", pty_id);
    Ok(())
}

/**
 * 获取当前时间戳（毫秒级）
 * 
 * 用于生成唯一的 PTY ID，避免多个 PTY 之间 ID 冲突。
 */
fn get_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/**
 * 获取当前平台的默认 shell 命令
 * 
 * Windows 上使用 PowerShell（-NoLogo 参数隐藏版权信息），
 * Linux/macOS 上使用 bash。
 * 
 * 返回 portable_pty::CommandBuilder，可以直接传给 slave.spawn_command()。
 */
fn get_default_shell() -> portable_pty::CommandBuilder {
    #[cfg(target_os = "windows")]
    {
        // Windows 上使用 PowerShell 作为默认终端
        // -NoLogo 参数隐藏启动时的版权信息，让终端更干净
        let mut cmd = portable_pty::CommandBuilder::new("powershell");
        cmd.arg("-NoLogo");
        cmd
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Linux 和 macOS 上使用 bash 作为默认终端
        portable_pty::CommandBuilder::new("bash")
    }
}
