/*
 * GitTimePrism 桌面端入口文件
 * 
 * 此文件是 Windows/macOS/Linux 桌面应用的主入口点。
 * 主要职责：
 * 1. 防止 Windows 上打包后弹出控制台黑窗口
 * 2. 调用库模块中的 run() 函数启动应用
 * 
 * 注意：不要修改此文件，所有逻辑都在 lib.rs 中实现。
 * 这是因为 Tauri 在移动端编译时会把应用编译为库，
 * 桌面端通过 main.rs 调用库的 run() 函数保持一致的入口。
 */

// 防止在 Windows 上打包后的 release 版本弹出控制台窗口
// debug 模式下保留控制台以便查看日志输出
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/**
 * 程序主入口函数
 * 调用库模块（gittimeprism_lib）中的 run 函数来启动整个 Tauri 应用
 */
fn main() {
    gittimeprism_lib::run();
}
