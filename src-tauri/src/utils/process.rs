/*
 * 进程管理工具模块
 * 
 * 封装 std::process::Command 的通用执行逻辑。
 * 主要解决 Windows 平台上的兼容性问题：
 * - 防止弹出控制台黑窗口（CREATE_NO_WINDOW 标志）
 * - 处理中文路径编码问题
 * 
 * 提供一个通用的 execute_command_silent 函数，
 * 所有需要调用外部命令的地方都可以使用此函数。
 */

use std::process::Command;

/**
 * 静默执行外部命令（不弹出控制台窗口）
 * 
 * 在 Windows 上自动添加 CREATE_NO_WINDOW 标志，
 * 防止打包后的应用每次执行命令都弹出黑色控制台窗口。
 * 
 * 使用示例：
 * ```
 * let output = execute_command_silent("git", &["--version"])?;
 * println!("{}", String::from_utf8_lossy(&output.stdout));
 * ```
 * 
 * 参数：
 * - program: 要执行的程序名称（如 "git"、"cmd"）
 * - args: 命令参数数组（如 ["--version", "--porcelain"]）
 * 
 * 返回值：
 * - Ok(Output) - 命令执行结果（包含 stdout、stderr、退出码）
 * - Err(String) - 执行失败的原因（如程序不存在）
 */
pub fn execute_command_silent(
    program: &str,
    args: &[&str],
) -> Result<std::process::Output, String> {
    // 创建命令执行器
    let mut cmd = Command::new(program);
    
    // 添加命令参数
    cmd.args(args);

    // Windows 平台特殊处理：隐藏控制台窗口
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW = 0x08000000
        // 此标志告诉 Windows 不要为子进程创建控制台窗口
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // 执行命令并返回结果
    cmd.output().map_err(|e| format!("执行命令 '{}' 失败: {}", program, e))
}

/**
 * 静默执行外部命令并返回标准输出字符串
 * 
 * 这是 execute_command_silent 的便捷包装，
 * 直接返回 stdout 的字符串内容。
 * 
 * 参数：
 * - program: 要执行的程序名称
 * - args: 命令参数数组
 * 
 * 返回值：
 * - Ok(String) - 命令的标准输出内容（已去除首尾空白）
 * - Err(String) - 执行失败
 */
pub fn execute_and_capture(program: &str, args: &[&str]) -> Result<String, String> {
    let output = execute_command_silent(program, args)?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
