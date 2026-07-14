/**
 * ============================================================
 * Git 工具函数模块（TypeScript 版本）
 * ============================================================
 *
 * 这个模块提供了 GitTimePrism 前端使用的通用工具函数、常量和辅助类。
 * 内容参考了 gitgraph 项目的 web/utils.ts，但做了以下调整：
 * 1. 移除了对 gitgraph 全局状态（如 initialState、contextMenu）的依赖，
 *    改为通过函数参数传入所需配置（如 dateFormat）
 * 2. EventOverlay 类移除了对 contextMenu 全局对象的依赖，
 *    使其成为纯粹的、可独立使用的事件遮罩工具
 * 3. 所有函数、类、常量都添加了详细的中文注释
 *
 * 模块内容包括：
 *   - SVG_ICONS：内联 SVG 图标字符串集合（约 25 个图标）
 *   - 常量：正则表达式、HTML 转义映射、列宽特殊值、SVG 命名空间等
 *   - 通用工具函数：数组比较、HTML 转义/反转义、日期格式化、颜色透明度调整等
 *   - DOM 辅助函数：批量添加事件监听、修改类名、查找提交元素
 *   - ImageResizer 类：使用 Canvas 缩放头像图片
 *   - EventOverlay 类：全屏事件遮罩（用于列宽调整、对话框背景等场景）
 *
 * 使用示例：
 *   import { SVG_ICONS, escapeHtml, formatShortDate } from '../utils/git-utils.js';
 * ============================================================
 */

// 导入日期格式相关类型（用于 formatShortDate 和 formatLongDate）
// DateFormat 是接口类型（仅用于类型注解），DateFormatType 是枚举（运行时需要其值）
import { type DateFormat, DateFormatType } from './git-types.js';


/**
 * ============================================================
 * SVG_ICONS：内联 SVG 图标集合
 * ============================================================
 *
 * 这些 SVG 图标字符串可以直接插入到 HTML 中显示图标。
 * 使用内联 SVG 而不是图标文件的好处：
 *   1. 不需要额外的网络请求，加载更快
 *   2. 可以通过 CSS 控制颜色和大小
 *   3. 在任何分辨率下都清晰（矢量图形）
 *
 * 图标来源说明：
 *   - alert, branch, check, commit, copy, download, eyeOpen, eyeClosed, gear,
 *     info, openFile, package, pencil, search, stash, tag, terminal, loading,
 *     refresh：来自 MIT 许可的软件生成的图标（详见 LICENSE_OCTICONS）
 *   - openFolder, closedFolder, file：来自 icons8.com，按 CC BY-ND 3.0 许可
 *   - 其他图标为自定义制作
 */
export const SVG_ICONS: { [key: string]: string } = {
	// 警告图标（三角形带感叹号）
	alert: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8.893 1.5c-.183-.31-.52-.5-.887-.5s-.703.19-.886.5L.138 13.499a.98.98 0 0 0 0 1.001c.193.31.53.501.886.501h13.964c.367 0 .704-.19.877-.5a1.03 1.03 0 0 0 .01-1.002L8.893 1.5zm.133 11.497H6.987v-2.003h2.039v2.003zm0-3.004H6.987V5.987h2.039v4.006z"/></svg>',
	// 分支图标
	branch: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="16" viewBox="0 0 10 16"><path fill-rule="evenodd" d="M10 5c0-1.11-.89-2-2-2a1.993 1.993 0 0 0-1 3.72v.3c-.02.52-.23.98-.63 1.38-.4.4-.86.61-1.38.63-.83.02-1.48.16-2 .45V4.72a1.993 1.993 0 0 0-1-3.72C.88 1 0 1.89 0 3a2 2 0 0 0 1 1.72v6.56c-.59.35-1 .99-1 1.72 0 1.11.89 2 2 2 1.11 0 2-.89 2-2 0-.53-.2-1-.53-1.36.09-.06.48-.41.59-.47.25-.11.56-.17.94-.17 1.05-.05 1.95-.45 2.75-1.25S8.95 7.77 9 6.73h-.02C9.59 6.37 10 5.73 10 5zM2 1.8c.66 0 1.2.55 1.2 1.2 0 .65-.55 1.2-1.2 1.2C1.35 4.2.8 3.65.8 3c0-.65.55-1.2 1.2-1.2zm0 12.41c-.66 0-1.2-.55-1.2-1.2 0-.65.55-1.2 1.2-1.2.65 0 1.2.55 1.2 1.2 0 .65-.55 1.2-1.2 1.2zm6-8c-.66 0-1.2-.55-1.2-1.2 0-.65.55-1.2 1.2-1.2.65 0 1.2.55 1.2 1.2 0 .65-.55 1.2-1.2 1.2z"/></svg>',
	// 对勾图标（用于表示成功或选中状态）
	check: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 12 16"><path fill-rule="evenodd" d="M12 5l-8 8-4-4 1.5-1.5L4 10l6.5-6.5L12 5z"></path></svg>',
	// 提交图标（圆圈带横线，Git 提交的典型表示）
	commit: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="16" viewBox="0 0 14 16"><path fill-rule="evenodd" d="M10.86 7c-.45-1.72-2-3-3.86-3-1.86 0-3.41 1.28-3.86 3H0v2h3.14c.45 1.72 2 3 3.86 3 1.86 0 3.41-1.28 3.86-3H14V7h-3.14zM7 10.2c-1.22 0-2.2-.98-2.2-2.2 0-1.22.98-2.2 2.2-2.2 1.22 0 2.2.98 2.2 2.2 0 1.22-.98 2.2-2.2 2.2z"/></svg>',
	// 复制图标（剪贴板）
	copy: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="16" viewBox="0 0 14 16"><path fill-rule="evenodd" d="M2 13h4v1H2v-1zm5-6H2v1h5V7zm2 3V8l-3 3 3 3v-2h5v-2H9zM4.5 9H2v1h2.5V9zM2 12h2.5v-1H2v1zm9 1h1v2c-.02.28-.11.52-.3.7-.19.18-.42.28-.7.3H1c-.55 0-1-.45-1-1V4c0-.55.45-1 1-1h3c0-1.11.89-2 2-2 1.11 0 2 .89 2 2h3c.55 0 1 .45 1 1v5h-1V6H1v9h10v-2zM2 5h8c0-.55-.45-1-1-1H8c-.55 0-1-.45-1-1s-.45-1-1-1-1 .45-1 1-.45 1-1 1H3c-.55 0-1 .45-1 1z"/></svg>',
	// 下载图标
	download: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -0.5 16 16.5"><path fill-rule="evenodd" d="M9 12h2l-3 3-3-3h2V7h2v5zm3-8c0-.44-.91-3-4.5-3C5.08 1 3 2.92 3 5 1.02 5 0 6.52 0 8c0 1.53 1 3 3 3h3V9.7H3C1.38 9.7 1.3 8.28 1.3 8c0-.17.05-1.7 1.7-1.7h1.3V5c0-1.39 1.56-2.7 3.2-2.7 2.55 0 3.13 1.55 3.2 1.8v1.2H12c.81 0 2.7.22 2.7 2.2 0 2.09-2.25 2.2-2.7 2.2h-2V11h2c2.08 0 4-1.16 4-3.5C16 5.06 14.08 4 12 4z"/></svg>',
	// 眼睛睁开图标（表示可见）
	eyeOpen: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8.06 2C3 2 0 8 0 8s3 6 8.06 6C13 14 16 8 16 8s-3-6-7.94-6zM8 12c-2.2 0-4-1.78-4-4 0-2.2 1.8-4 4-4 2.22 0 4 1.8 4 4 0 2.22-1.78 4-4 4zm2-4c0 1.11-.89 2-2 2-1.11 0-2-.89-2-2 0-1.11.89-2 2-2 1.11 0 2 .89 2 2z"/></svg>',
	// 眼睛闭合图标（表示隐藏）
	eyeClosed: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 -1 16 16"><path fill-rule="evenodd" d="M14.822.854a.5.5 0 1 0-.707-.708l-2.11 2.11C10.89 1.483 9.565.926 8.06.926c-5.06 0-8.06 6-8.06 6s1.162 2.323 3.258 4.078l-2.064 2.065a.5.5 0 1 0 .707.707L14.822.854zM4.86 9.403L6.292 7.97A1.999 1.999 0 0 1 6 6.925c0-1.11.89-2 2-2 .384 0 .741.106 1.045.292l1.433-1.433A3.98 3.98 0 0 0 8 2.925c-2.2 0-4 1.8-4 4 0 .938.321 1.798.859 2.478zm7.005-3.514l1.993-1.992A14.873 14.873 0 0 1 16 6.925s-3 6-7.94 6a6.609 6.609 0 0 1-2.661-.57l1.565-1.566c.33.089.678.136 1.036.136 2.22 0 4-1.78 4-4 0-.358-.047-.705-.136-1.036zM9.338 8.415l.152-.151a1.996 1.996 0 0 1-.152.151z"/></svg>',
	// 齿轮图标（表示设置）
	gear: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="-1 -1 18 18"><path fill-rule="evenodd" d="M14 8.77v-1.6l-1.94-.64-.45-1.09.88-1.84-1.13-1.13-1.81.91-1.09-.45-.69-1.92h-1.6l-.63 1.94-1.11.45-1.84-.88-1.13 1.13.91 1.81-.45 1.09L0 7.23v1.59l1.94.64.45 1.09-.88 1.84 1.13 1.13 1.81-.91 1.09.45.69 1.92h1.59l.63-1.94 1.11-.45 1.84.88 1.13-1.13-.92-1.81.47-1.09L14 8.75v.02zM7 11c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z"/></svg>',
	// 信息图标（i 字母在圆圈中）
	info: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="16" viewBox="0 0 14 16"><path fill-rule="evenodd" d="M6.3 5.69a.942.942 0 0 1-.28-.7c0-.28.09-.52.28-.7.19-.18.42-.28.7-.28.28 0 .52.09.7.28.18.19.28.42.28.7 0 .28-.09.52-.28.7a1 1 0 0 1-.7.3c-.28 0-.52-.11-.7-.3zM8 7.99c-.02-.25-.11-.48-.31-.69-.2-.19-.42-.3-.69-.31H6c-.27.02-.48.13-.69.31-.2.2-.3.44-.31.69h1v3c.02.27.11.5.31.69.2.2.42.31.69.31h1c.27 0 .48-.11.69-.31.2-.19.3-.42.31-.69H8V7.98v.01zM7 2.3c-3.14 0-5.7 2.54-5.7 5.68 0 3.14 2.56 5.7 5.7 5.7s5.7-2.55 5.7-5.7c0-3.15-2.56-5.69-5.7-5.69v.01zM7 .98c3.86 0 7 3.14 7 7s-3.14 7-7 7-7-3.12-7-7 3.14-7 7-7z"/></svg>',
	// 打开文件图标
	openFile: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 12 16"><path fill-rule="evenodd" d="M8.5 1H1c-.55 0-1 .45-1 1v12c0 .55.45 1 1 1h10c.55 0 1-.45 1-1V4.5L8.5 1zM11 14H1V2h7l3 3v9zM6 4.5l4 3-4 3v-2c-.98-.02-1.84.22-2.55.7-.71.48-1.19 1.25-1.45 2.3.02-1.64.39-2.88 1.13-3.73.73-.84 1.69-1.27 2.88-1.27v-2H6z"/></svg>',
	// 包裹图标（用于创建归档）
	package: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1 4.27v7.47c0 .45.3.84.75.97l6.5 1.73c.16.05.34.05.5 0l6.5-1.73c.45-.13.75-.52.75-.97V4.27c0-.45-.3-.84-.75-.97l-6.5-1.74a1.4 1.4 0 0 0-.5 0L1.75 3.3c-.45.13-.75.52-.75.97zm7 9.09l-6-1.59V5l6 1.61v6.75zM2 4l2.5-.67L11 5.06l-2.5.67L2 4zm13 7.77l-6 1.59V6.61l2-.55V8.5l2-.53V5.53L15 5v6.77zm-2-7.24L6.5 2.8l2-.53L15 4l-2 .53z"/></svg>',
	// 铅笔图标（表示编辑）
	pencil: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="16" viewBox="0 0 14 16"><path fill-rule="evenodd" d="M0 12v3h3l8-8-3-3-8 8zm3 2H1v-2h1v1h1v1zm10.3-9.3L12 6 9 3l1.3-1.3a.996.996 0 0 1 1.41 0l1.59 1.59c.39.39.39 1.02 0 1.41z"/></svg>',
	// 搜索图标（放大镜）
	search: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="-0.5 -2 18 18"><path fill-rule="evenodd" d="M15.7 13.3l-3.81-3.83A5.93 5.93 0 0 0 13 6c0-3.31-2.69-6-6-6S1 2.69 1 6s2.69 6 6 6c1.3 0 2.48-.41 3.47-1.11l3.83 3.81c.19.2.45.3.7.3.25 0 .52-.09.7-.3a.996.996 0 0 0 0-1.41v.01zM7 10.7c-2.59 0-4.7-2.11-4.7-4.7 0-2.59 2.11-4.7 4.7-4.7 2.59 0 4.7 2.11 4.7 4.7 0 2.59-2.11 4.7-4.7 4.7z"/></svg>',
	// stash 图标（抽屉，表示暂存）
	stash: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="16" viewBox="0 0 14 16"><path fill-rule="evenodd" d="M14 9l-1.13-7.14c-.08-.48-.5-.86-1-.86H2.13c-.5 0-.92.38-1 .86L0 9v5c0 .55.45 1 1 1h12c.55 0 1-.45 1-1V9zm-3.28.55l-.44.89c-.17.34-.52.56-.91.56H4.61c-.38 0-.72-.22-.89-.55l-.44-.91c-.17-.33-.52-.55-.89-.55H1l1-7h10l1 7h-1.38c-.39 0-.73.22-.91.55l.01.01z"/></svg>',
	// 标签图标
	tag: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="16" viewBox="0 0 15 16"><path fill-rule="evenodd" d="M7.73 1.73C7.26 1.26 6.62 1 5.96 1H3.5C2.13 1 1 2.13 1 3.5v2.47c0 .66.27 1.3.73 1.77l6.06 6.06c.39.39 1.02.39 1.41 0l4.59-4.59a.996.996 0 0 0 0-1.41L7.73 1.73zM2.38 7.09c-.31-.3-.47-.7-.47-1.13V3.5c0-.88.72-1.59 1.59-1.59h2.47c.42 0 .83.16 1.13.47l6.14 6.13-4.73 4.73-6.13-6.15zM3.01 3h2v2H3V3h.01z"/></svg>',
	// 终端图标
	terminal: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="16" viewBox="0 0 14 16"><path fill-rule="evenodd" d="M7 10h4v1H7v-1zm-3 1l3-3-3-3-.75.75L5.5 8l-2.25 2.25L4 11zm10-8v10c0 .55-.45 1-1 1H1c-.55 0-1-.45-1-1V3c0-.55.45-1 1-1h12c.55 0 1 .45 1 1zm-1 0H1v10h12V3z"/></svg>',
	// 加载中图标（旋转的箭头）
	loading: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 12 16"><path fill-rule="evenodd" d="M10.24 7.4a4.15 4.15 0 0 1-1.2 3.6 4.346 4.346 0 0 1-5.41.54L4.8 10.4.5 9.8l.6 4.2 1.31-1.26c2.36 1.74 5.7 1.57 7.84-.54a5.876 5.876 0 0 0 1.74-4.46l-1.75-.34zM2.96 5a4.346 4.346 0 0 1 5.41-.54L7.2 5.6l4.3.6-.6-4.2-1.31 1.26c-2.36-1.74-5.7-1.57-7.85.54C.5 5.03-.06 6.65.01 8.26l1.75.35A4.17 4.17 0 0 1 2.96 5z"/></svg>',
	// 刷新图标（循环箭头）
	refresh: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M 8.244,15.672 C 11.441,15.558 14.868,13.024 14.828,8.55 14.773,6.644 13.911,4.852 12.456,3.619 l -1.648,1.198 c 1.265,0.861 2.037,2.279 2.074,3.809 0.016,2.25 -1.808,5.025 -4.707,5.077 -2.898,0.052 -4.933,-2.08 -5.047,-4.671 C 3.07,6.705 4.635,4.651 6.893,4.088 l 0.041,1.866 3.853,-3.126 -3.978,-2.772 0.032,2.077 c -3.294,0.616 -5.755,3.541 -5.667,6.982 -3.88e-4,4.233 3.873,6.670 7.07,6.557 z"/></svg>',

	// 打开的文件夹图标（用于文件树展开状态）
	openFolder: '<svg xmlns="http://www.w3.org/2000/svg" class="openFolderIcon" viewBox="0 0 30 30"><path d="M 5 4 C 3.895 4 3 4.895 3 6 L 3 9 L 3 11 L 22 11 L 27 11 L 27 8 C 27 6.895 26.105 6 25 6 L 12.199219 6 L 11.582031 4.9707031 C 11.221031 4.3687031 10.570187 4 9.8671875 4 L 5 4 z M 2.5019531 13 C 1.4929531 13 0.77040625 13.977406 1.0664062 14.941406 L 4.0351562 24.587891 C 4.2941563 25.426891 5.0692656 26 5.9472656 26 L 15 26 L 24.052734 26 C 24.930734 26 25.705844 25.426891 25.964844 24.587891 L 28.933594 14.941406 C 29.229594 13.977406 28.507047 13 27.498047 13 L 15 13 L 2.5019531 13 z"/></svg>',
	// 关闭的文件夹图标（用于文件树折叠状态）
	closedFolder: '<svg xmlns="http://www.w3.org/2000/svg" class="closedFolderIcon" viewBox="0 0 30 30"><path d="M 4 3 C 2.895 3 2 3.895 2 5 L 2 8 L 13 8 L 28 8 L 28 7 C 28 5.895 27.105 5 26 5 L 11.199219 5 L 10.582031 3.9707031 C 10.221031 3.3687031 9.5701875 3 8.8671875 3 L 4 3 z M 3 10 C 2.448 10 2 10.448 2 11 L 2 23 C 2 24.105 2.895 25 4 25 L 26 25 C 27.105 25 28 24.105 28 23 L 28 11 C 28 10.448 27.552 10 27 10 L 3 10 z"/></svg>',
	// 文件图标（用于显示普通文件）
	file: '<svg xmlns="http://www.w3.org/2000/svg" class="fileIcon" viewBox="0 0 30 30"><path d="M24.707,8.793l-6.5-6.5C18.019,2.105,17.765,2,17.5,2H7C5.895,2,5,2.895,5,4v22c0,1.105,0.895,2,2,2h16c1.105,0,2-0.895,2-2 V9.5C25,9.235,24.895,8.981,24.707,8.793z M18,10c-0.552,0-1-0.448-1-1V3.904L23.096,10H18z"/></svg>',

	// 向下箭头图标
	arrowDown: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><path fill-rule="evenodd" d="M6,1L6,10.1L2.7,6.8L1.3,8.2L7,13.9L12.7,8.2L11.3,6.8L8,10.1L8,1L6,1z"/></svg>',
	// 向上箭头图标
	arrowUp: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><path fill-rule="evenodd" d="M6,13L6,3.9L2.7,7.2L1.3,5.8L7,0.1L12.7,5.8L11.3,7.2L8,3.9L8,13L6,13z"/></svg>',
	// 提交详情视图图标
	cdv: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><path fill-rule="evenodd" d="M0,2V3.5H2V2ZM3.5,2V3.5H14V2ZM0,5v7H14V5Zm1,1.5h5.5v4H1Zm6.5,0H13v4H7.5Z"/></svg>',
	// 关闭图标（X 形状）
	close: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><path fill-rule="evenodd" d="M3.8,2.4L2.4,3.8L5.7,7L2.4,10.2L3.8,11.6L7,8.3L10.2,11.6L11.6,10.2L8.3,7L11.6,3.8L10.2,2.4L7,5.7L3.8,2.4z"/></svg>',
	// 失败图标（圆圈带 X，用于签名验证失败）
	failed: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 13 13"><path fill-rule="evenodd" d="M 6.5,0 A 6.5,6.5 0 0 0 0,6.5 6.5,6.5 0 0 0 6.5,13 6.5,6.5 0 0 0 13,6.5 6.5,6.5 0 0 0 6.5,0 Z M 4.1,2.54 6.5,4.95 8.9,2.54 10.46,4.1 8.05,6.5 10.46,8.9 8.9,10.46 6.5,8.05 4.1,10.46 2.54,8.9 4.95,6.5 2.54,4.1 Z"/></svg>',
	// 文件列表视图图标
	fileList: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M 2,3 V 4.5 H 4 V 3 Z M 5.5,3 V 4.5 H 18 V 3 Z M 2,7 V 8.5 H 4 V 7 Z M 5.5,7 V 8.5 H 18 V 7 Z M 2,11 v 1.5 H 4 V 11 Z m 3.5,0 v 1.5 H 18 V 11 Z M 2,15 v 1.5 H 4 V 15 Z m 3.5,0 v 1.5 H 18 V 15 Z"/></svg>',
	// 文件树视图图标
	fileTree: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M 2,3 V 4.5 H 4 V 3 Z M 5.5,3 V 4.5 H 14 V 3 Z M 4,7 V 8.5 H 6 V 7 Z M 7.5,7 V 8.5 H 16 V 7 Z M 6,11 v 1.5 H 8 V 11 Z m 3.5,0 v 1.5 H 18 V 11 Z M 4,15 v 1.5 H 6 V 15 Z m 3.5,0 v 1.5 H 16 V 15 Z"/></svg>',
	// 不确定图标（圆圈带问号，用于签名无法验证）
	inconclusive: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 13 13"><path fill-rule="evenodd" d="M 6.5,0 C 2.91,0 0,2.91 0,6.5 0,10.09 2.91,13 6.5,13 10.09,13 13,10.09 13,6.5 13,2.91 10.09,0 6.5,0 Z m 0.03,2.35 v 0 c 0.47,0 0.88,0.05 1.24,0.14 0.36,0.1 0.67,0.23 0.93,0.41 0.24,0.18 0.43,0.4 0.58,0.67 0.14,0.27 0.2,0.58 0.2,0.93 0,0.23 0,0.45 -0.09,0.63 C 9.3,5.31 9.14,5.49 9.05,5.62 8.91,5.79 8.9,5.82 8.7,6.02 8.53,6.2 8.35,6.36 8.15,6.5 8.03,6.6 7.94,6.7 7.85,6.79 7.77,6.88 7.7,6.97 7.65,7.08 7.6,7.18 7.56,7.29 7.53,7.4 7.5,7.52 7.5,7.54 7.5,7.67 H 5.75 c 0,-0.23 0,-0.33 0.03,-0.51 C 5.81,6.96 5.86,6.78 5.93,6.61 5.99,6.46 6.08,6.31 6.2,6.16 6.32,6.02 6.44,5.89 6.64,5.76 6.93,5.56 7.02,5.44 7.15,5.21 7.28,4.98 7.36,4.81 7.36,4.58 7.36,4.29 7.3,4.1 7.15,3.96 7.01,3.82 6.82,3.76 6.53,3.76 6.43,3.76 6.33,3.78 6.21,3.81 6.09,3.84 6.03,3.9 5.94,3.98 5.86,4.05 5.79,4.1 5.73,4.19 5.66,4.27 5.63,4.38 5.64,4.49 H 3.52 C 3.52,4.09 3.66,3.9 3.81,3.61 3.96,3.32 4.18,3.07 4.44,2.89 4.71,2.71 5.02,2.58 5.38,2.49 5.75,2.4 6.14,2.35 6.53,2.35 Z M 6.14,8.72 H 7.2 c 0.3,0 0.53,0.24 0.53,0.53 v 1.07 0 c 0,0.3 -0.23,0.53 -0.53,0.53 H 6.14 c -0.29,0 -0.53,-0.24 -0.53,-0.53 V 9.25 c 0,-0.3 0.25,-0.53 0.53,-0.53 z"/></svg>',
	// 外部链接图标
	linkExternal: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M3,3L3,17L17,17L17,13L15.5,13L15.5,15.5L4.5,15.5L4.5,4.5L7,4.5L7,3L3,3z M10,3L10,4.5L14.4,4.5L9.3,9.7L10.3,10.7L15.5,5.6L15.5,10L17,10L17,3L10,3z"/></svg>',
	// 通过图标（圆圈带对勾，用于签名验证通过）
	passed: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 13 13"><path fill-rule="evenodd" d="M 6.5,0 A 6.5,6.5 0 0 0 0,6.5 6.5,6.5 0 0 0 6.5,13 6.5,6.5 0 0 0 13,6.5 6.5,6.5 0 0 0 6.5,0 Z M 9.64,2.95 11.2,4.5 5.02,10.68 C 3.92,9.57 2.81,8.46 1.7,7.35 L 3.26,5.8 5.02,7.57 Z"/></svg>',
	// 加号图标（用于添加操作）
	plus: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><path fill-rule="evenodd" d="M6,2V6H2v2h4v4H8V8h4V6H8V2Z"/></svg>',
	// 代码审查图标
	review: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill-rule="evenodd" d="m4,4.7 -4,7.3 4,7.3 2.5,0 -4,-7.3 4,-7.3zM11.5,6C9,5.5 6.6,7.1 6.1,9.6c-0.5,2.6 1.1,5 3.6,5.5 1,0.2 1.8,0.1 2.7,-0.3l2.5,3.3c0.1,0.1 0.3,0.2 0.5,0.3 0.2,0 0.4,0 0.6,-0.1 0.3,-0.2 0.4,-0.4 0.4,-0.6 0,-0.2 0,-0.4 -0.1,-0.6 0,-0.2 -2.4,-3.3 -2.4,-3.3 0.7,-0.6 1,-1.5 1.3,-2.4C15.7,8.9 14,6.5 11.5,6zm8.5,-1.3 -2.5,0 4,7.3 -4.2,7.3 2.5,0L24,12zm-8.8,3c1.6,0.3 2.6,1.8 2.3,3.4 -0.3,1.6 -1.8,2.6 -3.4,2.3C8.5,13 7.4,11.6 7.8,10 8,8.4 9.6,7.3 11.2,7.7z"/></svg>'
};


/**
 * ============================================================
 * 常量定义
 * ============================================================
 */

/**
 * Git 文件变更类型映射
 *
 * 将 Git 文件状态码（单字母）映射为可读的状态名称。
 */
export const GIT_FILE_CHANGE_TYPES: { [key: string]: string } = {
	'A': 'Added',       // 新增
	'M': 'Modified',    // 修改
	'D': 'Deleted',     // 删除
	'R': 'Renamed',     // 重命名
	'U': 'Untracked'    // 未跟踪
};

/**
 * GPG 签名状态描述映射
 *
 * 将签名状态码映射为人类可读的描述文本。
 */
export const GIT_SIGNATURE_STATUS_DESCRIPTIONS: { [key: string]: string } = {
	'G': 'Valid Signature',                              // 有效签名
	'U': 'Good Signature with Unknown Validity',         // 有效但可信度未知的签名
	'X': 'Good Signature that has Expired',              // 有效但已过期的签名
	'Y': 'Good Signature made by an Expired Key',        // 有效但密钥已过期的签名
	'R': 'Good Signature made by a Revoked Key',         // 有效但密钥已被吊销的签名
	'E': 'Signature could not be checked',               // 无法检查的签名
	'B': 'Bad Signature'                                 // 无效签名
};

/**
 * 月份缩写数组
 *
 * 用于日期格式化时显示月份的英文缩写（Jan、Feb 等）。
 */
export const MONTHS: string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Git 引用（分支/标签）名称非法字符正则表达式
 *
 * 用于验证分支名、标签名等 Git 引用名称是否合法。
 * Git 对引用名称有严格限制，不能以 - 或 / 开头，不能包含某些特殊字符等。
 *
 * 非法情况包括：
 *   - 以 - 或 / 开头
 *   - 包含 \ " 空格 > < ~ ^ : ? * [ 等字符
 *   - 包含 ..（连续两个点）
 *   - 包含 //（连续两个斜杠）
 *   - 以 /. 或 /. 结尾
 *   - 包含 @{
 *   - 以 . 或 / 结尾
 *   - 以 .lock 结尾（避免与锁文件冲突）
 *   - 恰好是 @
 */
export const REF_INVALID_REGEX: RegExp = /^[-\/].*|[\\" ><~^:?*[]|\.\.|\/\/|\/\.|@{|[.\/]$|\.lock$|^@$/g;

/**
 * HTML 转义字符映射表
 *
 * 将需要转义的特殊字符映射为对应的 HTML 实体。
 * 用于防止 XSS（跨站脚本攻击），在将用户输入插入 HTML 前进行转义。
 */
export const HTML_ESCAPES: { [key: string]: string } = {
	'&': '&amp;',    // & 转义为 &amp;
	'<': '&lt;',     // < 转义为 &lt;
	'>': '&gt;',     // > 转义为 &gt;
	'"': '&quot;',   // " 转义为 &quot;
	'\'': '&#x27;',  // ' 转义为 &#x27;
	'/': '&#x2F;'    // / 转义为 &#x2F;
};

/**
 * HTML 反转义字符映射表
 *
 * 将 HTML 实体反向映射回原始字符，用于 unescapeHtml 函数。
 */
const HTML_UNESCAPES: { [key: string]: string } = {
	'&amp;': '&',     // &amp; 反转义为 &
	'&lt;': '<',      // &lt; 反转义为 <
	'&gt;': '>',      // &gt; 反转义为 >
	'&quot;': '"',    // &quot; 反转义为 "
	'&#x27;': '\'',   // &#x27; 反转义为 '
	'&#x2F;': '/'     // &#x2F; 反转义为 /
};

/**
 * HTML 转义正则表达式（匹配所有需要转义的字符）
 */
const HTML_ESCAPER_REGEX: RegExp = /[&<>"'\/]/g;

/**
 * HTML 反转义正则表达式（匹配所有 HTML 实体）
 */
const HTML_UNESCAPER_REGEX: RegExp = /&lt;|&gt;|&amp;|&quot;|&#x27;|&#x2F;/g;

/**
 * SVG 命名空间常量
 *
 * 创建 SVG 元素时必须使用这个命名空间（通过 document.createElementNS）。
 * 例如：document.createElementNS(SVG_NAMESPACE, 'circle')
 */
export const SVG_NAMESPACE: string = 'http://www.w3.org/2000/svg';

/**
 * 列宽特殊值：隐藏列
 *
 * 当列宽设置为这个值时，表示该列被隐藏（不显示）。
 * 使用负数是为了与正常的正数列宽区分。
 */
export const COLUMN_HIDDEN: number = -100;

/**
 * 列宽特殊值：自动列宽
 *
 * 当列宽设置为这个值时，表示该列使用自动宽度（根据内容自适应）。
 * 使用负数是为了与正常的正数列宽区分。
 */
export const COLUMN_AUTO: number = -101;

/**
 * 未提交变更的占位符
 *
 * 在提交图中，用 "*" 表示未提交的变更（工作区中的修改）。
 */
export const UNCOMMITTED: string = '*';

/**
 * 显示所有分支的特殊值
 *
 * 在分支筛选中，空字符串表示显示所有分支。
 */
export const SHOW_ALL_BRANCHES: string = '';

/**
 * 事件捕获元素的 ID
 *
 * EventOverlay 创建的遮罩元素使用的 DOM ID。
 */
export const ID_EVENT_CAPTURE_ELEM: string = 'eventCaptureElem';


/**
 * ============================================================
 * 通用工具函数
 * ============================================================
 */

/**
 * 比较两个数组是否相等
 *
 * 两个数组长度相同，且对应位置的元素都满足 equalElements 函数时，才认为相等。
 *
 * @param a - 第一个数组
 * @param b - 第二个数组
 * @param equalElements - 用于判断两个元素是否相等的函数
 * @returns TRUE => 数组相等，FALSE => 数组不相等
 *
 * 使用示例：
 *   arraysEqual([1, 2], [1, 2], (a, b) => a === b)  // 返回 true
 *   arraysEqual([1, 2], [2, 1], (a, b) => a === b)  // 返回 false
 */
export function arraysEqual<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>, equalElements: (a: T, b: T) => boolean): boolean {
	/* 长度不同，直接返回 false */
	if (a.length !== b.length) return false;
	/* 逐个比较对应位置的元素 */
	for (let i = 0; i < a.length; i++) {
		if (!equalElements(a[i], b[i])) return false;
	}
	return true;
}

/**
 * 比较两个数组是否严格相等
 *
 * 两个数组长度相同，且对应位置的元素使用严格相等（===）比较都相等时，才认为相等。
 *
 * @param a - 第一个数组
 * @param b - 第二个数组
 * @returns TRUE => 数组相等，FALSE => 数组不相等
 */
export function arraysStrictlyEqual<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/**
 * 修改颜色的透明度
 *
 * 将一个 RGB/RGBA/HEX 颜色与一个新的透明度相乘，返回等效的 RGBA 颜色。
 * 支持 rgb()、rgba() 和 #HEX 三种颜色格式。
 *
 * @param colour - 原始颜色字符串（如 "#ff0000"、"rgb(255,0,0)"、"rgba(255,0,0,0.5)"）
 * @param opacity - 透明度乘数（0 到 1 之间，0 完全透明，1 完全不透明）
 * @returns 等效的 RGBA 颜色字符串（如 "rgba(255,0,0,0.50)"）
 *
 * 使用示例：
 *   modifyColourOpacity('#ff0000', 0.5)        // 返回 "rgba(255,0,0,0.50)"
 *   modifyColourOpacity('rgba(255,0,0,1)', 0.5) // 返回 "rgba(255,0,0,0.50)"
 */
export function modifyColourOpacity(colour: string, opacity: number): string {
	/* 默认返回完全透明的黑色 */
	let fadedCol = 'rgba(0,0,0,0)', match;

	/* 尝试匹配 rgba() 格式 */
	if ((match = colour.match(/rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/)) !== null) {
		/* 将原始透明度与新透明度相乘 */
		fadedCol = 'rgba(' + match[1] + ',' + match[2] + ',' + match[3] + ',' + (parseFloat(match[4]) * opacity).toFixed(2) + ')';
	} else if ((match = colour.match(/#\s*([0-9a-fA-F]+)/)) !== null) {
		/* 尝试匹配 #HEX 格式（支持 3/4/6/8 位） */
		let hex = match[1];
		let length = hex.length;
		if (length === 3 || length === 4 || length === 6 || length === 8) {
			/* 将 HEX 解析为 r、g、b、a 分量 */
			let col = length < 5
				? { r: hex[0] + hex[0], g: hex[1] + hex[1], b: hex[2] + hex[2], a: length === 4 ? hex[3] + hex[3] : 'ff' }
				: { r: hex[0] + hex[1], g: hex[2] + hex[3], b: hex[4] + hex[5], a: length === 8 ? hex[6] + hex[7] : 'ff' };
			/* 将 HEX 转为十进制并应用新透明度 */
			fadedCol = 'rgba(' + parseInt(col.r, 16) + ',' + parseInt(col.g, 16) + ',' + parseInt(col.b, 16) + ',' + (parseInt(col.a, 16) * opacity / 255).toFixed(2) + ')';
		}
	} else if ((match = colour.match(/rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/)) !== null) {
		/* 尝试匹配 rgb() 格式（不透明，直接应用新透明度） */
		fadedCol = 'rgba(' + match[1] + ',' + match[2] + ',' + match[3] + ',' + opacity + ')';
	}
	return fadedCol;
}

/**
 * 数字补零到两位
 *
 * 将一个数字前面补零，使其至少有两位。
 * 用于日期时间格式化（如小时、分钟、秒）。
 *
 * @param i - 要补零的数字
 * @returns 补零后的字符串（如 9 -> "09"，12 -> "12"）
 */
export function pad2(i: number): string {
	return i > 9 ? String(i) : '0' + i;
}

/**
 * 获取仓库的短名称
 *
 * 从仓库路径中提取最后一部分作为短名称。
 * 例如 "C:/projects/my-repo" 返回 "my-repo"。
 *
 * @param path - 仓库路径
 * @returns 仓库的短名称
 *
 * 使用示例：
 *   getRepoName('C:/projects/my-repo')     // 返回 "my-repo"
 *   getRepoName('my-repo')                 // 返回 "my-repo"
 *   getRepoName('C:/projects/my-repo/')    // 返回 "my-repo"
 */
export function getRepoName(path: string): string {
	/* 查找第一个路径分隔符的位置 */
	const firstSep = path.indexOf('/');
	if (firstSep === path.length - 1 || firstSep === -1) {
		/* 路径没有斜杠，或只有一个尾随斜杠 => 直接使用原路径 */
		return path;
	} else {
		/* 移除尾随斜杠（如果存在），然后取最后一个斜杠后的部分 */
		const p = path.endsWith('/') ? path.substring(0, path.length - 1) : path;
		return p.substring(p.lastIndexOf('/') + 1);
	}
}


/**
 * ============================================================
 * HTML 转义 / 反转义
 * ============================================================
 */

/**
 * 转义 HTML 特殊字符
 *
 * 将字符串中的 &、<、>、"、'、/ 等字符替换为对应的 HTML 实体，
 * 防止 XSS（跨站脚本攻击）。
 *
 * 在将任何用户输入或外部数据插入 HTML 之前，都应该先调用此函数。
 *
 * @param str - 要转义的字符串
 * @returns 转义后的字符串
 *
 * 使用示例：
 *   escapeHtml('<script>alert("xss")</script>')
 *   // 返回 '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;'
 */
export function escapeHtml(str: string): string {
	return str.replace(HTML_ESCAPER_REGEX, (match) => HTML_ESCAPES[match]);
}

/**
 * 反转义 HTML 实体
 *
 * 将字符串中的 HTML 实体（&amp;、&lt; 等）还原为原始字符。
 * 这是 escapeHtml 的逆操作。
 *
 * @param str - 要反转义的字符串
 * @returns 反转义后的字符串
 *
 * 使用示例：
 *   unescapeHtml('&lt;script&gt;')  // 返回 '<script>'
 */
export function unescapeHtml(str: string): string {
	return str.replace(HTML_UNESCAPER_REGEX, (match) => HTML_UNESCAPES[match]);
}


/**
 * ============================================================
 * 日期格式化函数
 * ============================================================
 */

/**
 * 格式化日期（短格式）
 *
 * 将 Unix 时间戳格式化为短日期字符串。
 * 支持三种格式类型：日期+时间、仅日期、相对时间（如 "3 hours ago"）。
 *
 * 注意：与 gitgraph 不同，此函数通过参数接收 dateFormat 配置，
 * 而不是依赖全局状态。这样更易于测试和复用。
 *
 * @param unixTimestamp - Unix 时间戳（单位：秒）
 * @param dateFormat - 日期格式配置（包含类型和是否 ISO）
 * @returns 包含 title（完整日期时间，用于 tooltip）和 formatted（格式化后的日期）的对象
 *
 * 使用示例：
 *   formatShortDate(1642233600, { type: DateFormatType.DateAndTime, iso: false })
 *   // 返回 { title: '15 Jan 2022 00:00:00', formatted: '15 Jan 2022 00:00' }
 */
export function formatShortDate(unixTimestamp: number, dateFormat: DateFormat): { title: string, formatted: string } {
	/* 将 Unix 时间戳（秒）转为 JavaScript Date 对象（毫秒） */
	const date = new Date(unixTimestamp * 1000);

	/* 构建日期部分字符串 */
	let dateStr = dateFormat.iso
		? date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
		: date.getDate() + ' ' + MONTHS[date.getMonth()] + ' ' + date.getFullYear();

	/* 构建时分部分字符串 */
	let hourMinsStr = pad2(date.getHours()) + ':' + pad2(date.getMinutes());
	let formatted: string;

	if (dateFormat.type === DateFormatType.DateAndTime) {
		/* 日期+时间格式 */
		formatted = dateStr + ' ' + hourMinsStr;
	} else if (dateFormat.type === DateFormatType.DateOnly) {
		/* 仅日期格式 */
		formatted = dateStr;
	} else {
		/* 相对时间格式（如 "3 hours ago"） */
		let diff = Math.round((new Date()).getTime() / 1000) - unixTimestamp, unit: string;
		/* 根据时间差选择合适的单位 */
		if (diff < 60) {
			unit = 'second';
		} else if (diff < 3600) {
			unit = 'minute';
			diff /= 60;
		} else if (diff < 86400) {
			unit = 'hour';
			diff /= 3600;
		} else if (diff < 604800) {
			unit = 'day';
			diff /= 86400;
		} else if (diff < 2629800) {
			unit = 'week';
			diff /= 604800;
		} else if (diff < 31557600) {
			unit = 'month';
			diff /= 2629800;
		} else {
			unit = 'year';
			diff /= 31557600;
		}
		diff = Math.round(diff);
		/* 英文复数处理：如果数量不是 1，则加 s */
		formatted = diff + ' ' + unit + (diff !== 1 ? 's' : '') + ' ago';
	}

	return {
		/* title 用于鼠标悬停时显示完整日期时间（含秒） */
		title: dateStr + ' ' + hourMinsStr + ':' + pad2(date.getSeconds()),
		formatted: formatted
	};
}

/**
 * 格式化日期（长格式）
 *
 * 将 Unix 时间戳格式化为长日期字符串，包含完整的日期时间和时区信息。
 *
 * 注意：与 gitgraph 不同，此函数通过参数接收 dateFormat 配置，
 * 而不是依赖全局状态。
 *
 * @param unixTimestamp - Unix 时间戳（单位：秒）
 * @param dateFormat - 日期格式配置（使用其中的 iso 属性决定是否使用 ISO 格式）
 * @returns 格式化后的长日期字符串
 *
 * 使用示例：
 *   formatLongDate(1642233600, { type: DateFormatType.DateAndTime, iso: true })
 *   // 返回 '2022-01-15 00:00:00Z'（或带时区偏移）
 */
export function formatLongDate(unixTimestamp: number, dateFormat: DateFormat): string {
	/* 将 Unix 时间戳（秒）转为 JavaScript Date 对象（毫秒） */
	const date = new Date(unixTimestamp * 1000);

	if (dateFormat.iso) {
		/* ISO 8601 格式：2022-01-15 00:00:00+0800 */
		let timezoneOffset = date.getTimezoneOffset();
		let absoluteTimezoneOffset = Math.abs(timezoneOffset);
		/* 计算时区字符串：Z 表示 UTC，否则用 +HHMM 或 -HHMM 表示 */
		let timezone = timezoneOffset === 0 ? 'Z' : ' ' + (timezoneOffset < 0 ? '+' : '-') + pad2(Math.floor(absoluteTimezoneOffset / 60)) + pad2(absoluteTimezoneOffset % 60);
		return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds()) + timezone;
	} else {
		/* 使用本地化的完整日期字符串 */
		return date.toString();
	}
}


/**
 * ============================================================
 * DOM 辅助函数
 * ============================================================
 */

/**
 * 为所有具有指定类名的元素添加事件监听器
 *
 * 这是一个便捷函数，避免手动遍历元素集合。
 *
 * @param className - 类名，用于查找要添加监听器的元素
 * @param event - 事件类型（如 'click'、'mouseover'）
 * @param eventListener - 事件监听器函数
 */
export function addListenerToClass(className: string, event: string, eventListener: EventListener): void {
	/* 获取所有具有指定类名的元素，并为每个元素添加事件监听器 */
	addListenerToCollectionElems(document.getElementsByClassName(className), event, eventListener);
}

/**
 * 为元素集合中的所有元素添加事件监听器
 *
 * @param elems - 元素集合
 * @param event - 事件类型
 * @param eventListener - 事件监听器函数
 */
function addListenerToCollectionElems(elems: HTMLCollectionOf<Element>, event: string, eventListener: EventListener): void {
	for (let i = 0; i < elems.length; i++) {
		elems[i].addEventListener(event, eventListener);
	}
}

/**
 * 修改元素的类名（添加或移除）
 *
 * 根据state 参数决定是添加还是移除指定的类名。
 * 如果元素已经处于目标状态，则不做任何操作。
 *
 * @param elem - 要修改的 HTML 元素
 * @param className - 要添加或移除的类名
 * @param state - TRUE => 确保元素有该类名，FALSE => 确保元素没有该类名
 * @returns TRUE => 元素被修改了，FALSE => 无需修改
 */
export function alterClass(elem: HTMLElement, className: string, state: boolean): boolean {
	/* 检查元素当前是否已有该类名，与目标状态对比 */
	if (elem.classList.contains(className) !== state) {
		if (state) {
			/* 需要添加类名 */
			elem.classList.add(className);
		} else {
			/* 需要移除类名 */
			elem.classList.remove(className);
		}
		return true;  // 元素被修改了
	}
	return false;  // 无需修改
}

/**
 * 在提交元素集合中查找指定 ID 的提交元素
 *
 * 提交元素通过 data-id 属性存储其 ID。
 * 此函数遍历元素集合，找到 data-id 匹配的元素。
 *
 * @param elems - 提交元素的集合
 * @param id - 要查找的提交 ID（对应 data-id 属性）；如果为 null 则返回 null
 * @returns 匹配的 HTML 元素；如果未找到则返回 null
 */
export function findCommitElemWithId(elems: HTMLCollectionOf<HTMLElement>, id: number | null): HTMLElement | null {
	/* id 为 null 时直接返回 null */
	if (id === null) return null;
	/* 将 id 转为字符串用于比较（data-id 存储的是字符串） */
	let findIdStr = id.toString();
	/* 遍历元素集合，查找 data-id 匹配的元素 */
	for (let i = 0; i < elems.length; i++) {
		if (findIdStr === elems[i].dataset.id) return elems[i];
	}
	return null;
}


/**
 * ============================================================
 * ImageResizer 类：头像图片缩放器
 * ============================================================
 */

/**
 * 图片缩放器
 *
 * 使用 Canvas 将头像图片缩放到 18×18 像素（实际尺寸会根据设备像素比调整）。
 * 缩放后的图片作为 data URI 返回，可以直接用作 <img> 的 src。
 *
 * 使用 Canvas 缩放的好处：
 *   1. 可以控制输出尺寸，节省带宽和内存
 *   2. 适配高 DPI 屏幕（Retina 屏幕），保证清晰度
 *   3. 统一头像大小，避免布局错乱
 *
 * 使用示例：
 *   const resizer = new ImageResizer();
 *   resizer.resize(dataUri, (resizedDataUri) => {
 *     imgElement.src = resizedDataUri;
 *   });
 */
export class ImageResizer {
	/** Canvas 元素，用于绘制和缩放图片（延迟创建） */
	private canvas: HTMLCanvasElement | null = null;
	/** Canvas 2D 绘图上下文，用于执行绘制操作（延迟创建） */
	private context: CanvasRenderingContext2D | null = null;

	/**
	 * 将图片缩放到 18×18 像素的等效分辨率
	 *
	 * 实际分辨率会根据用户屏幕的设备像素比（devicePixelRatio）调整，
	 * 以保证在高 DPI 屏幕上的清晰度。
	 *
	 * @param dataUri - 包含图片数据的 data URI（如 "data:image/png;base64,..."）
	 * @param callback - 缩放完成后的回调函数，接收缩放后的 data URI
	 */
	public resize(dataUri: string, callback: (dataUri: string) => void): void {
		/* 延迟创建 Canvas 元素（第一次使用时创建） */
		if (this.canvas === null) this.canvas = document.createElement('canvas');
		/* 延迟获取 2D 绘图上下文 */
		if (this.context === null) this.context = this.canvas.getContext('2d');
		/* 如果无法获取绘图上下文，直接返回原始图片 */
		if (this.context === null) {
			callback(dataUri);
			return;
		}

		/* 创建 Image 对象加载图片 */
		let image = new Image();
		image.onload = () => {
			let outputDataUri = '';
			if (this.canvas === null || this.context === null) {
				/* 如果 Canvas 或上下文不可用，返回原始图片 */
				outputDataUri = dataUri;
			} else {
				/* 计算实际像素尺寸：18 × 设备像素比（如 Retina 屏幕为 18×2=36） */
				let size = Math.ceil(18 * window.devicePixelRatio);
				/* 设置 Canvas 尺寸（仅在尺寸变化时设置，避免不必要的重绘） */
				if (this.canvas.width !== size) this.canvas.width = size;
				if (this.canvas.height !== size) this.canvas.height = size;
				/* 清空 Canvas */
				this.context.clearRect(0, 0, size, size);
				/* 将原图绘制到 Canvas 上（自动缩放到目标尺寸） */
				this.context.drawImage(image, 0, 0, size, size);
				/* 将 Canvas 内容导出为 data URI */
				outputDataUri = this.canvas.toDataURL();
			}
			/* 调用回调函数，返回缩放后的图片 */
			callback(outputDataUri);
		};
		/* 设置图片源，触发加载 */
		image.src = dataUri;
	}
}


/**
 * ============================================================
 * EventOverlay 类：全屏事件遮罩
 * ============================================================
 */

/**
 * 事件遮罩
 *
 * 创建一个覆盖整个屏幕的透明层，用于：
 *   1. 捕获鼠标事件（如列宽调整时的鼠标移动）
 *   2. 阻止用户与遮罩下方元素的交互（如对话框背景）
 *
 * 工作原理：
 *   - create() 方法创建一个全屏的 div 元素并添加到 body
 *   - 用户可以在该元素上监听 mousemove 和 mouseup 事件
 *   - remove() 方法移除该遮罩元素
 *
 * 与 gitgraph 的 EventOverlay 不同，此版本移除了对 contextMenu 全局对象的依赖，
 * 使其成为独立的、可复用的事件遮罩工具。
 *
 * 使用示例（列宽调整）：
 *   const overlay = new EventOverlay();
 *   overlay.create('columnResizeOverlay',
 *     (e) => { /* 鼠标移动时调整列宽 *\/ },
 *     () => { /* 鼠标松开时结束调整 *\/ }
 *   );
 */
export class EventOverlay {
	/** 鼠标移动事件监听器（用于列宽调整等场景） */
	private move: EventListener | null = null;
	/** 鼠标松开事件监听器（用于结束拖拽操作） */
	private stop: EventListener | null = null;

	/**
	 * 创建事件遮罩
	 *
	 * 在 body 上添加一个全屏的 div 元素，用于捕获鼠标事件。
	 * 如果已存在遮罩，会先移除旧的遮罩。
	 *
	 * @param className - 遮罩元素的 CSS 类名（用于样式控制）
	 * @param move - 鼠标移动事件的回调函数；如果为 null 则不监听移动事件
	 * @param stop - 鼠标松开/离开事件的回调函数；如果为 null 则不监听停止事件
	 */
	public create(className: string, move: EventListener | null, stop: EventListener | null): void {
		/* 如果已存在遮罩，先移除（避免重复创建） */
		if (document.getElementById(ID_EVENT_CAPTURE_ELEM) !== null) this.remove();

		/* 创建遮罩 div 元素 */
		const eventOverlayElem = document.createElement('div');
		eventOverlayElem.id = ID_EVENT_CAPTURE_ELEM;
		eventOverlayElem.className = className;

		/* 保存回调函数引用（用于后续移除监听器） */
		this.move = move;
		this.stop = stop;

		/* 注册鼠标移动事件监听器 */
		if (this.move !== null) {
			eventOverlayElem.addEventListener('mousemove', this.move);
		}
		/* 注册鼠标松开和离开事件监听器（用于结束拖拽操作） */
		if (this.stop !== null) {
			eventOverlayElem.addEventListener('mouseup', this.stop);
			eventOverlayElem.addEventListener('mouseleave', this.stop);
		}

		/* 将遮罩添加到 body 末尾，覆盖整个页面 */
		document.body.appendChild(eventOverlayElem);
	}

	/**
	 * 移除当前的事件遮罩
	 *
	 * 移除遮罩元素及其所有事件监听器。
	 * 如果没有活动遮罩，则不做任何操作。
	 */
	public remove(): void {
		/* 查找遮罩元素 */
		let eventOverlayElem = document.getElementById(ID_EVENT_CAPTURE_ELEM);
		/* 如果不存在遮罩，直接返回 */
		if (eventOverlayElem === null) return;

		/* 移除鼠标移动事件监听器 */
		if (this.move !== null) {
			eventOverlayElem.removeEventListener('mousemove', this.move);
			this.move = null;
		}
		/* 移除鼠标松开和离开事件监听器 */
		if (this.stop !== null) {
			eventOverlayElem.removeEventListener('mouseup', this.stop);
			eventOverlayElem.removeEventListener('mouseleave', this.stop);
			this.stop = null;
		}

		/* 从 DOM 中移除遮罩元素 */
		document.body.removeChild(eventOverlayElem);
	}
}
