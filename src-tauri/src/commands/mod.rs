/*
 * Tauri IPC 命令模块入口
 * 
 * 此文件将不同功能的命令分组到子模块中：
 * - system：系统级命令（Git 检测、打开外部链接等）
 * - terminal：终端相关命令（PTY 创建、写入、调整大小等）
 * 
 * 每个 Tauri 命令使用 #[tauri::command] 属性标记，
 * 前端通过 `invoke('命令名', { 参数 })` 来调用。
 */

// 系统级命令模块（Git 检测、打开外部链接）
pub mod system;
// 终端相关命令模块（PTY 创建、数据写入等）
pub mod terminal;
