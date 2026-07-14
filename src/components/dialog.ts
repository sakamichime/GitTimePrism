/**
 * ============================================================
 * 对话框组件（dialog.ts）
 * ============================================================
 *
 * 这个组件实现了 GitTimePrism 的全局对话框系统。
 * 移植自 gitgraph 项目的 web/dialog.ts 和 web/dropdown.ts，做了以下调整：
 *
 * 1. 改为 TypeScript 显式类型注解（gitgraph 是 JS + JSDoc）
 * 2. 移除了 gitgraph 内部依赖（如 TargetType 全局枚举、initialState.config 等），
 *    改为通过参数传入或使用项目内已有的 git-utils 工具函数
 * 3. TextRef 验证的空格替换字符硬编码为 "-"（gitgraph 从配置读取，
 *    后续阶段 7 实现配置系统后改为从 dialogDefaults 读取）
 * 4. CustomSelect 增加了搜索过滤功能（gitgraph 原版没有搜索，
 *    只有顶部的 Dropdown 有，任务描述要求 CustomSelect 也支持搜索）
 * 5. 适配毛玻璃效果：对话框和遮罩使用 backdrop-filter
 * 6. ESC 键关闭对话框（gitgraph 通过外部监听实现，这里在 Dialog 内部实现）
 *
 * 架构设计：
 *   - Dialog 类是对话框管理器（全局单例）
 *   - CustomSelect 类是表单内的自定义下拉选择器
 *   - 三种对话框类型：Form（表单）、ActionRunning（操作进行中）、Message（消息）
 *   - 五种输入类型：Text、TextRef、Select、Radio、Checkbox
 *
 * DOM 结构（以 Form 为例）：
 *   <div class="dialog">
 *     <div class="dialogContent">
 *       <span>提示信息</span>
 *       <table class="dialogForm">
 *         <tr><td>名称：</td><td><input ... /></td></tr>
 *       </table>
 *       <div id="dialogAction" class="roundedBtn">确定</div>
 *       <div id="dialogSecondaryAction" class="roundedBtn">取消</div>
 *     </div>
 *   </div>
 *   <div id="eventCaptureElem" class="dialogBacking"></div>  <!-- EventOverlay 遮罩 -->
 *
 * TextRef 验证流程：
 *   1. 用户输入时，空格自动替换为 "-"
 *   2. 用 REF_INVALID_REGEX 验证剩余字符是否合法
 *   3. 如果输入为空，添加 noInput 类（禁用提交按钮）
 *   4. 如果输入非法，添加 inputInvalid 类（禁用提交按钮并显示原因）
 *
 * 使用示例：
 *   dialog.showConfirmation("确定要删除此分支吗？", "删除", () => {
 *     // 用户点击"删除"后的回调
 *   }, target);
 *
 *   dialog.showForm("创建分支", [
 *     { type: DialogInputType.Text, name: "分支名", default: "", placeholder: "输入分支名" }
 *   ], "创建", (values) => {
 *     console.log("用户输入:", values[0]);
 *   }, target);
 * ============================================================
 */

// 导入工具函数和类
// SVG_ICONS：内联 SVG 图标（用于加载、警告、信息等）
// REF_INVALID_REGEX：Git 引用名称非法字符正则表达式
// EventOverlay：全屏事件遮罩（用于对话框背景）
// alterClass：修改元素的类名（添加或移除）
// escapeHtml：HTML 转义，防止 XSS
// 注意：不使用 findCommitElemWithId，因为它检查 dataset.id，
// 而 commit-graph.ts 渲染的提交行使用 data-row 属性。
// 这里通过 data-row 属性直接查找元素。
import {
	SVG_ICONS,
	REF_INVALID_REGEX,
	EventOverlay,
	alterClass,
	escapeHtml,
} from '../utils/git-utils.js';
// 导入 Git 提交类型（用于 refresh 方法的参数类型）
import type { GitCommit } from '../utils/git-types.js';
// 导入右键菜单单例（用于在显示对话框时关闭菜单）
import { contextMenu } from './context-menu.js';
// 导入右键菜单的目标类型和具体 target 类型（共享类型定义，避免重复）
// ContextMenuTarget：联合类型（Repo | Commit | Ref | CommitDetailsView）
// CommitTarget/RefTarget/CommitDetailsViewTarget：用于 refresh 方法中的类型断言
import type {
	ContextMenuTarget,
	CommitTarget,
	RefTarget,
	CommitDetailsViewTarget,
} from './context-menu.js';
// DialogTarget 是 ContextMenuTarget 的别名，用于对话框目标
type DialogTarget = ContextMenuTarget;


/**
 * ============================================================
 * 常量定义
 * ============================================================
 */

/**
 * 高亮活动目标的 CSS 类名
 *
 * 当对话框打开时，触发对话框的目标元素会添加这个类名。
 */
const CLASS_DIALOG_ACTIVE: string = 'dialogActive';

/**
 * 输入非法的 CSS 类名
 *
 * 当 TextRef 输入包含非法字符时，对话框添加此类名。
 * CSS 中通过此类禁用提交按钮（如降低不透明度、cursor: not-allowed）。
 */
const CLASS_DIALOG_INPUT_INVALID: string = 'inputInvalid';

/**
 * 输入为空的 CSS 类名
 *
 * 当 TextRef 输入为空字符串时，对话框添加此类名。
 * 与 inputInvalid 类似，禁用提交按钮。
 */
const CLASS_DIALOG_NO_INPUT: string = 'noInput';

/**
 * 焦点状态的 CSS 类名
 *
 * 用于 CustomSelect 中标识当前焦点选项。
 */
const CLASS_FOCUSSED: string = 'focussed';

/**
 * 选中状态的 CSS 类名
 *
 * 用于 CustomSelect 中标识当前选中选项。
 */
const CLASS_SELECTED: string = 'selected';

/**
 * 匹配所有空白字符的正则表达式
 *
 * 用于 TextRef 输入的空格替换（替换为 "-"）。
 * \s 匹配空格、制表符、换行符等所有空白字符。
 * "gu" 标志：g 表示全局匹配，u 表示 Unicode 模式。
 */
const WHITESPACE_REGEXP: RegExp = /\s/gu;

/**
 * TextRef 输入中空格的替换字符
 *
 * Git 引用名称不能包含空格，因此用户输入空格时自动替换为 "-"。
 * 后续阶段 7 配置系统实现后，从 dialogDefaults.general.referenceInputSpaceSubstitution 读取。
 */
const REF_SPACE_SUBSTITUTION: string = '-';

/**
 * 对话框默认值配置
 *
 * 各对话框中选项的默认值。后续阶段 7 配置系统实现后，
 * 这些值会从 dialogDefaults.* 配置读取。
 *
 * 目前硬编码为常用默认值，符合大多数用户的使用习惯。
 */
const DIALOG_DEFAULTS = {
	/** 通用配置 */
	general: {
		/** 引用输入框中空格的替换字符；null 表示不替换（这里默认替换为 "-"） */
		referenceInputSpaceSubstitution: REF_SPACE_SUBSTITUTION as string | null,
	},
};


/**
 * ============================================================
 * 类型定义
 * ============================================================
 */

/**
 * 对话框类型枚举
 *
 * 描述对话框的展示形式：
 *   - Form：带表单输入的对话框（用户可输入数据）
 *   - ActionRunning：操作进行中的对话框（带 loading 图标，阻止用户操作）
 *   - Message：消息对话框（仅显示信息，无输入）
 */
export enum DialogType {
	/** 表单对话框 */
	Form,
	/** 操作进行中对话框 */
	ActionRunning,
	/** 消息对话框 */
	Message
}

/**
 * 对话框输入类型枚举
 *
 * 描述对话框中表单输入的类型：
 *   - Text：普通文本输入（可带 placeholder）
 *   - TextRef：引用名输入（带验证和空格替换）
 *   - Select：下拉选择（单选或多选）
 *   - Radio：单选按钮组
 *   - Checkbox：复选框
 */
export enum DialogInputType {
	/** 普通文本输入 */
	Text,
	/** 引用名输入（带验证） */
	TextRef,
	/** 下拉选择 */
	Select,
	/** 单选按钮组 */
	Radio,
	/** 复选框 */
	Checkbox
}

/**
 * 普通文本输入配置
 */
export interface DialogTextInput {
	/** 输入类型：Text */
	readonly type: DialogInputType.Text;
	/** 输入项名称（显示在左侧标签） */
	readonly name: string;
	/** 默认值 */
	readonly default: string;
	/** 占位提示文字；null 表示无占位 */
	readonly placeholder: string | null;
	/** 信息提示（鼠标悬停 info 图标显示）；可选 */
	readonly info?: string;
}

/**
 * 引用名输入配置
 *
 * 与 Text 类似，但带有自动验证：
 *   - 空格自动替换为 REF_SPACE_SUBSTITUTION（默认 "-"）
 *   - 用 REF_INVALID_REGEX 验证合法性
 *   - 非法输入禁用提交按钮并显示原因
 */
export interface DialogTextRefInput {
	/** 输入类型：TextRef */
	readonly type: DialogInputType.TextRef;
	/** 输入项名称 */
	readonly name: string;
	/** 默认值 */
	readonly default: string;
	/** 信息提示；可选 */
	readonly info?: string;
}

/**
 * 下拉选择输入的选项
 */
export interface DialogSelectInputOption {
	/** 选项显示名称 */
	readonly name: string;
	/** 选项值 */
	readonly value: string;
}

/**
 * 下拉选择输入配置（单选或多选）
 *
 * 通过 multiple 字段区分单选和多选：
 *   - multiple 为 false 或未设置：单选，使用 default 字段作为默认值
 *   - multiple 为 true：多选，使用 defaults 字段作为默认值数组
 */
export type DialogSelectInput = {
	/** 输入类型：Select */
	readonly type: DialogInputType.Select;
	/** 输入项名称 */
	readonly name: string;
	/** 选项列表 */
	readonly options: ReadonlyArray<DialogSelectInputOption>;
	/** 默认值（单选时使用） */
	readonly default: string;
	/** 是否多选：false 表示单选 */
	readonly multiple?: false;
	/** 信息提示；可选 */
	readonly info?: string;
} | {
	/** 输入类型：Select */
	readonly type: DialogInputType.Select;
	/** 输入项名称 */
	readonly name: string;
	/** 选项列表 */
	readonly options: ReadonlyArray<DialogSelectInputOption>;
	/** 默认值数组（多选时使用） */
	readonly defaults: ReadonlyArray<string>;
	/** 是否多选：true 表示多选 */
	readonly multiple: true;
	/** 信息提示；可选 */
	readonly info?: string;
};

/**
 * 单选按钮组输入配置
 */
export interface DialogRadioInput {
	/** 输入类型：Radio */
	readonly type: DialogInputType.Radio;
	/** 输入项名称 */
	readonly name: string;
	/** 选项列表 */
	readonly options: ReadonlyArray<DialogRadioInputOption>;
	/** 默认选中的值 */
	readonly default: string;
}

/**
 * 单选按钮组的选项
 */
export interface DialogRadioInputOption {
	/** 选项显示名称 */
	readonly name: string;
	/** 选项值 */
	readonly value: string;
}

/**
 * 复选框输入配置
 */
export interface DialogCheckboxInput {
	/** 输入类型：Checkbox */
	readonly type: DialogInputType.Checkbox;
	/** 输入项名称（显示为复选框标签） */
	readonly name: string;
	/** 默认是否勾选 */
	readonly value: boolean;
	/** 信息提示；可选 */
	readonly info?: string;
}

/**
 * 所有输入类型的联合类型
 */
export type DialogInput = DialogTextInput | DialogTextRefInput | DialogSelectInput | DialogRadioInput | DialogCheckboxInput;

/**
 * 表单输入值的类型
 *
 * 不同输入类型返回不同类型的值：
 *   - Text/TextRef/Select(单选)/Radio：string
 *   - Select(多选)：string[]
 *   - Checkbox：boolean
 */
export type DialogInputValue = string | string[] | boolean;

/**
 * 错误信息类型
 *
 * 表示一个错误信息，可以是字符串（错误描述）或 null（无错误）。
 */
export type ErrorInfo = string | null;


/**
 * ============================================================
 * Dialog 类：对话框管理器
 * ============================================================
 */

/**
 * 对话框管理器
 *
 * 负责在 GitTimePrism 中显示各种类型的对话框。
 * 全局单例（应用启动时创建一次），通过 dialog 单例导出使用。
 *
 * 工作原理：
 *   1. show() 方法创建对话框 DOM 并添加到 body
 *   2. 同时创建 EventOverlay 遮罩（半透明背景，阻止用户操作下方界面）
 *   3. 用户点击主按钮或次按钮时执行回调并关闭对话框
 *   4. ESC 键关闭对话框（不触发主回调）
 *   5. Enter 键提交表单（触发主回调）
 *   6. close() 方法移除 DOM 和遮罩
 *
 * 表单输入处理：
 *   - TextRef 输入实时验证，非法时禁用提交按钮
 *   - Select 输入使用 CustomSelect 类实现自定义下拉
 *   - Radio/Checkbox 使用原生 input 元素
 */
export class Dialog {
	/** 当前显示的对话框 DOM 元素；如果没有对话框打开则为 null */
	private elem: HTMLElement | null = null;
	/** 当前对话框的目标（触发对话框的对象）；如果没有则为 null */
	private target: DialogTarget | null = null;
	/** 主按钮点击回调；如果没有则为 null（如 Message 对话框） */
	private actioned: (() => void) | null = null;
	/** 当前对话框的类型；如果没有对话框打开则为 null */
	private type: DialogType | null = null;
	/** EventOverlay 实例（用于对话框背景遮罩） */
	private eventOverlay: EventOverlay = new EventOverlay();
	/** 当前对话框中的 CustomSelect 实例（按输入项索引组织） */
	private customSelects: { [inputIndex: string]: CustomSelect } = {};

	/** ESC 键监听器引用（用于在 close 时移除） */
	private escListener: ((e: KeyboardEvent) => void) | null = null;
	/** Enter 键监听器引用（用于在 close 时移除） */
	private enterListener: ((e: KeyboardEvent) => void) | null = null;

	/**
	 * 显示确认对话框
	 *
	 * 一个简单的二选一对话框，用户点击主按钮执行 actioned 回调。
	 * 次按钮固定为"取消"，仅关闭对话框。
	 *
	 * @param message - 提示信息（说明要确认的内容）
	 * @param actionName - 主按钮文字（如 "删除"、"确认"）
	 * @param actioned - 主按钮点击回调
	 * @param target - 对话框的目标；可选
	 */
	public showConfirmation(message: string, actionName: string, actioned: () => void, target: DialogTarget | null): void {
		this.show(DialogType.Form, message, actionName, '取消', () => {
			this.close();
			actioned();
		}, null, target);
	}

	/**
	 * 显示双按钮对话框
	 *
	 * 提供两个按钮供用户选择，分别执行不同回调。
	 *
	 * @param message - 提示信息
	 * @param buttonLabel1 - 主按钮文字
	 * @param buttonAction1 - 主按钮回调
	 * @param buttonLabel2 - 次按钮文字
	 * @param buttonAction2 - 次按钮回调
	 * @param target - 对话框的目标；可选
	 */
	public showTwoButtons(
		message: string,
		buttonLabel1: string,
		buttonAction1: () => void,
		buttonLabel2: string,
		buttonAction2: () => void,
		target: DialogTarget | null
	): void {
		this.show(DialogType.Form, message, buttonLabel1, buttonLabel2, () => {
			this.close();
			buttonAction1();
		}, () => {
			this.close();
			buttonAction2();
		}, target);
	}

	/**
	 * 显示引用名输入对话框
	 *
	 * 让用户输入一个 Git 引用名称（分支名、标签名等）。
	 * 输入会实时验证：
	 *   - 空格自动替换为 "-"
	 *   - 用 REF_INVALID_REGEX 验证剩余字符
	 *   - 非法时禁用提交按钮
	 *
	 * @param message - 提示信息（如 "请输入新的分支名："）
	 * @param defaultValue - 输入框默认值
	 * @param actionName - 主按钮文字（如 "创建"）
	 * @param actioned - 主按钮回调，参数是用户输入的引用名
	 * @param target - 对话框的目标；可选
	 */
	public showRefInput(
		message: string,
		defaultValue: string,
		actionName: string,
		actioned: (value: string) => void,
		target: DialogTarget | null
	): void {
		this.showForm(message, [
			{ type: DialogInputType.TextRef, name: '', default: defaultValue }
		], actionName, (values) => actioned(values[0] as string), target);
	}

	/**
	 * 显示复选框对话框
	 *
	 * 让用户勾选或取消勾选一个选项。
	 *
	 * @param message - 提示信息
	 * @param checkboxLabel - 复选框标签文字
	 * @param checkboxValue - 复选框默认是否勾选
	 * @param actionName - 主按钮文字
	 * @param actioned - 主按钮回调，参数是复选框的最终状态
	 * @param target - 对话框的目标；可选
	 */
	public showCheckbox(
		message: string,
		checkboxLabel: string,
		checkboxValue: boolean,
		actionName: string,
		actioned: (value: boolean) => void,
		target: DialogTarget | null
	): void {
		this.showForm(message, [
			{ type: DialogInputType.Checkbox, name: checkboxLabel, value: checkboxValue }
		], actionName, (values) => actioned(values[0] as boolean), target);
	}

	/**
	 * 显示下拉选择对话框（单选）
	 *
	 * @param message - 提示信息
	 * @param defaultValue - 默认选中的值
	 * @param options - 选项列表
	 * @param actionName - 主按钮文字
	 * @param actioned - 主按钮回调，参数是选中的值
	 * @param target - 对话框的目标；可选
	 */
	public showSelect(
		message: string,
		defaultValue: string,
		options: ReadonlyArray<DialogSelectInputOption>,
		actionName: string,
		actioned: (value: string) => void,
		target: DialogTarget | null
	): void {
		this.showForm(message, [
			{ type: DialogInputType.Select, name: '', options: options, default: defaultValue }
		], actionName, (values) => actioned(values[0] as string), target);
	}

	/**
	 * 显示下拉选择对话框（多选）
	 *
	 * @param message - 提示信息
	 * @param defaultValues - 默认选中的值数组
	 * @param options - 选项列表
	 * @param actionName - 主按钮文字
	 * @param actioned - 主按钮回调，参数是选中的值数组
	 * @param target - 对话框的目标；可选
	 */
	public showMultiSelect(
		message: string,
		defaultValues: ReadonlyArray<string>,
		options: ReadonlyArray<DialogSelectInputOption>,
		actionName: string,
		actioned: (value: string[]) => void,
		target: DialogTarget | null
	): void {
		this.showForm(message, [
			{ type: DialogInputType.Select, name: '', options: options, defaults: defaultValues, multiple: true }
		], actionName, (values) => actioned(values[0] as string[]), target);
	}

	/**
	 * 显示通用表单对话框
	 *
	 * 这是最灵活的对话框方法，可以包含任意数量的输入项。
	 * 其他 show* 方法都是基于此方法实现的便捷封装。
	 *
	 * 表单布局：
	 *   - 单个输入：单列表单
	 *   - 多个 Checkbox：使用 multiCheckbox 样式
	 *   - 其他多个输入：使用 multi 样式，左侧显示输入项名称
	 *
	 * @param message - 提示信息
	 * @param inputs - 输入项数组（定义了表单的所有输入）
	 * @param actionName - 主按钮文字
	 * @param actioned - 主按钮回调，参数是各输入项的值数组（按 inputs 顺序）
	 * @param target - 对话框的目标；可选
	 * @param secondaryActionName - 次按钮文字；默认"取消"
	 * @param secondaryActioned - 次按钮回调；为 null 时仅关闭对话框
	 * @param includeLineBreak - 是否在消息和表单之间插入换行；默认 true
	 */
	public showForm(
		message: string,
		inputs: ReadonlyArray<DialogInput>,
		actionName: string,
		actioned: (values: DialogInputValue[]) => void,
		target: DialogTarget | null,
		secondaryActionName: string = '取消',
		secondaryActioned: ((values: DialogInputValue[]) => void) | null = null,
		includeLineBreak: boolean = true
	): void {
		/* 是否有多个输入项 */
		const multiElement: boolean = inputs.length > 1;
		/* 是否所有输入项都是 Checkbox（决定是否使用 multiCheckbox 样式） */
		const multiCheckbox: boolean = multiElement && inputs.every((input) => input.type === DialogInputType.Checkbox);
		/* 是否需要信息列（某些输入有 info 提示时显示 info 图标列） */
		const infoColRequired: boolean = inputs.some((input) => input.type !== DialogInputType.Checkbox && input.type !== DialogInputType.Radio && (input as DialogTextInput | DialogTextRefInput | DialogSelectInput).info);

		/* 构建每行输入的 HTML */
		const inputRowsHtml: string[] = inputs.map((input, id) => {
			let inputHtml: string;

			if (input.type === DialogInputType.Radio) {
				/* 单选按钮组：渲染多个 radio input */
				inputHtml = '<td class="inputCol"' + (infoColRequired ? ' colspan="2"' : '') + '><span class="dialogFormRadio">'
					+ input.options.map((option, optionId) =>
						'<label><input type="radio" name="dialogInput' + id + '" value="' + optionId + '"'
						+ (option.value === input.default ? ' checked' : '')
						+ ' tabindex="' + (id + 1) + '"/><span class="customRadio"></span>' + escapeHtml(option.name) + '</label>'
					).join('<br>')
					+ '</span></td>';
			} else {
				/* 信息提示 HTML（如果有 info） */
				const infoHtml: string = (input as DialogTextInput | DialogTextRefInput | DialogSelectInput).info
					? '<span class="dialogInfo" title="' + escapeHtml((input as DialogTextInput | DialogTextRefInput | DialogSelectInput).info as string) + '">' + SVG_ICONS.info + '</span>'
					: '';

				if (input.type === DialogInputType.Select) {
					/* 下拉选择：占位 div，后续由 CustomSelect 填充 */
					inputHtml = '<td class="inputCol"><div id="dialogFormSelect' + id + '"></div></td>'
						+ (infoColRequired ? '<td>' + infoHtml + '</td>' : '');
				} else if (input.type === DialogInputType.Checkbox) {
					/* 复选框 */
					inputHtml = '<td class="inputCol"' + (infoColRequired ? ' colspan="2"' : '') + '><span class="dialogFormCheckbox"><label><input id="dialogInput' + id + '" type="checkbox"'
						+ (input.value ? ' checked' : '')
						+ ' tabindex="' + (id + 1) + '"/><span class="customCheckbox"></span>'
						+ (multiElement && !multiCheckbox ? '' : input.name) + infoHtml + '</label></span></td>';
				} else {
					/* 普通文本输入或引用名输入 */
					inputHtml = '<td class="inputCol"><input id="dialogInput' + id + '" type="text" value="' + escapeHtml(input.default) + '"'
						+ (input.type === DialogInputType.Text && input.placeholder !== null ? ' placeholder="' + escapeHtml(input.placeholder) + '"' : '')
						+ ' tabindex="' + (id + 1) + '"/></td>'
						+ (infoColRequired ? '<td>' + infoHtml + '</td>' : '');
				}
			}

			/* 组装整行：左侧名称（多输入时）+ 右侧输入 */
			return '<tr' + (input.type === DialogInputType.Radio ? ' class="mediumField"' : input.type !== DialogInputType.Checkbox ? ' class="largeField"' : '') + '>'
				+ (multiElement && !multiCheckbox ? '<td>' + escapeHtml(input.name) + ': </td>' : '')
				+ inputHtml + '</tr>';
		});

		/* 组装完整 HTML */
		const html: string = message + (includeLineBreak ? '<br>' : '')
			+ '<table class="dialogForm ' + (multiElement ? (multiCheckbox ? 'multiCheckbox' : 'multi') : 'single') + '">'
			+ inputRowsHtml.join('')
			+ '</table>';

		/* 检查表单值是否有效（用于禁用提交按钮） */
		const areFormValuesInvalid = (): boolean => this.elem === null
			|| this.elem.classList.contains(CLASS_DIALOG_NO_INPUT)
			|| this.elem.classList.contains(CLASS_DIALOG_INPUT_INVALID);

		/* 获取所有表单值（按 inputs 顺序） */
		const getFormValues = (): DialogInputValue[] => inputs.map((input, index) => {
			if (input.type === DialogInputType.Radio) {
				/* Radio：遍历所有选项找选中的 */
				const elems = document.getElementsByName('dialogInput' + index) as NodeListOf<HTMLInputElement>;
				for (let i = 0; i < elems.length; i++) {
					if (elems[i].checked) {
						return input.options[parseInt(elems[i].value, 10)].value;
					}
				}
				return input.default;  /* 如果没有选中项，返回默认值 */
			} else if (input.type === DialogInputType.Select) {
				/* Select：从 CustomSelect 获取 */
				return this.customSelects[index.toString()].getValue();
			} else {
				/* Text/TextRef/Checkbox：从原生 input 获取 */
				const elem = document.getElementById('dialogInput' + index) as HTMLInputElement;
				return input.type === DialogInputType.Checkbox
					? elem.checked  /* Checkbox 返回 boolean */
					: elem.value;   /* Text/TextRef 返回 string */
			}
		});

		/* 显示对话框 */
		this.show(DialogType.Form, html, actionName, secondaryActionName, () => {
			/* 主按钮回调：先验证，再获取值，最后执行 actioned */
			if (areFormValuesInvalid()) return;
			const values = getFormValues();
			this.close();
			actioned(values);
		}, secondaryActioned !== null ? () => {
			/* 次按钮回调：先验证，再获取值，最后执行 secondaryActioned */
			if (areFormValuesInvalid()) return;
			const values = getFormValues();
			this.close();
			secondaryActioned(values);
		} : null, target);

		/* 为 Select 类型的输入创建 CustomSelect 实例 */
		inputs.forEach((input, index) => {
			if (input.type === DialogInputType.Select) {
				this.customSelects[index.toString()] = new CustomSelect(
					input,
					'dialogFormSelect' + index,
					index + 1,
					this.elem as HTMLElement
				);
			}
		});

		/* 如果表单包含 TextRef 输入，添加实时验证监听 */
		const textRefInput: number = inputs.findIndex((input) => input.type === DialogInputType.TextRef);
		if (textRefInput > -1) {
			const dialogInput = document.getElementById('dialogInput' + textRefInput) as HTMLInputElement;
			const dialogAction = document.getElementById('dialogAction') as HTMLElement;

			/* 如果初始值为空，立即标记为 noInput */
			if (dialogInput.value === '') {
				(this.elem as HTMLElement).classList.add(CLASS_DIALOG_NO_INPUT);
			}

			/* keyup 事件：实时验证（包括空格替换和合法性检查） */
			dialogInput.addEventListener('keyup', () => {
				if (this.elem === null) return;

				/* 空格替换为配置的字符（默认 "-"） */
				if (DIALOG_DEFAULTS.general.referenceInputSpaceSubstitution !== null) {
					const selectionStart = dialogInput.selectionStart;
					const selectionEnd = dialogInput.selectionEnd;
					dialogInput.value = dialogInput.value.replace(WHITESPACE_REGEXP, DIALOG_DEFAULTS.general.referenceInputSpaceSubstitution);
					/* 恢复光标位置（替换后光标会跳到末尾，需要手动恢复） */
					dialogInput.selectionStart = selectionStart;
					dialogInput.selectionEnd = selectionEnd;
				}

				/* 检查输入是否为空或非法 */
				const noInput: boolean = dialogInput.value === '';
				const invalidInput: boolean = dialogInput.value.match(REF_INVALID_REGEX) !== null;

				/* 更新 noInput 类 */
				alterClass(this.elem, CLASS_DIALOG_NO_INPUT, noInput);

				/* 更新 inputInvalid 类，并在变化时更新按钮 title */
				if (alterClass(this.elem, CLASS_DIALOG_INPUT_INVALID, !noInput && invalidInput)) {
					dialogAction.title = invalidInput
						? '无法' + actionName + '，输入包含非法字符。'
						: '';
				}
			});
		}

		/* 如果第一个输入是文本类型，自动聚焦 */
		if (inputs.length > 0 && (inputs[0].type === DialogInputType.Text || inputs[0].type === DialogInputType.TextRef)) {
			(document.getElementById('dialogInput0') as HTMLInputElement).focus();
		}
	}

	/**
	 * 显示消息对话框
	 *
	 * 仅显示一段 HTML 内容，无输入。
	 * 次按钮固定为"关闭"，主按钮不显示。
	 *
	 * @param html - 要显示的 HTML 内容
	 */
	public showMessage(html: string): void {
		this.show(DialogType.Message, html, null, '关闭', null, null, null);
	}

	/**
	 * 显示错误对话框
	 *
	 * 在对话框中显示错误信息和详细原因。
	 * 错误信息以红色警告样式显示，原因保留换行。
	 *
	 * @param message - 错误的高级描述（如 "拉取失败"）
	 * @param reason - 错误的详细原因；为 null 时不显示原因
	 * @param actionName - 主按钮文字；为 null 时不显示主按钮
	 * @param actioned - 主按钮回调；为 null 时无回调
	 */
	public showError(
		message: string,
		reason: ErrorInfo,
		actionName: string | null,
		actioned: (() => void) | null
	): void {
		const html: string = '<span class="dialogAlert">' + SVG_ICONS.alert + '错误：' + escapeHtml(message) + '</span>'
			+ (reason !== null ? '<br><span class="messageContent errorContent">' + escapeHtml(reason).split('\n').join('<br>') + '</span>' : '');
		this.show(DialogType.Message, html, actionName, '关闭', () => {
			this.close();
			if (actioned !== null) actioned();
		}, null, null);
	}

	/**
	 * 显示操作进行中对话框
	 *
	 * 显示一个带 loading 图标的对话框，表示某个操作正在进行。
	 * 用户无法关闭此对话框（必须由代码调用 closeActionRunning() 关闭）。
	 *
	 * @param action - 操作名称（如 "拉取"、"推送"）
	 */
	public showActionRunning(action: string): void {
		this.show(DialogType.ActionRunning, '<span class="actionRunning">' + SVG_ICONS.loading + escapeHtml(action) + ' ...</span>', null, '关闭', null, null, null);
	}

	/**
	 * 显示对话框（内部核心方法）
	 *
	 * 所有 show* 方法最终都调用此方法。
	 *
	 * @param type - 对话框类型
	 * @param html - 对话框内容 HTML
	 * @param actionName - 主按钮文字；为 null 时不显示主按钮
	 * @param secondaryActionName - 次按钮文字
	 * @param actioned - 主按钮回调；为 null 时无回调
	 * @param secondaryActioned - 次按钮回调；为 null 时仅关闭
	 * @param target - 对话框的目标
	 */
	private show(
		type: DialogType,
		html: string,
		actionName: string | null,
		secondaryActionName: string,
		actioned: (() => void) | null,
		secondaryActioned: (() => void) | null,
		target: DialogTarget | null
	): void {
		/* 显示前先关闭已有的对话框和右键菜单 */
		this.close();
		contextMenu.close();

		this.type = type;
		this.target = target;

		/* 创建 EventOverlay 遮罩（半透明背景，阻止用户操作下方界面） */
		this.eventOverlay.create('dialogBacking', null, null);

		/* 创建对话框容器 */
		const dialog = document.createElement('div');
		const dialogContent = document.createElement('div');
		dialog.className = 'dialog';
		dialogContent.className = 'dialogContent';
		/* 组装内容：消息 + 主按钮（如果有）+ 次按钮 */
		dialogContent.innerHTML = html + '<br>'
			+ (actionName !== null ? '<div id="dialogAction" class="roundedBtn">' + escapeHtml(actionName) + '</div>' : '')
			+ '<div id="dialogSecondaryAction" class="roundedBtn">' + escapeHtml(secondaryActionName) + '</div>';
		dialog.appendChild(dialogContent);
		this.elem = dialog;
		document.body.appendChild(dialog);

		/* 计算对话框位置（垂直居中） */
		let docHeight: number = document.body.clientHeight;
		let dialogHeight: number = dialog.clientHeight + 2;
		/* 对于非 Form 类型，如果对话框过高，限制为 80% 屏幕高度并启用滚动 */
		if (type !== DialogType.Form && dialogHeight > 0.8 * docHeight) {
			dialogContent.style.height = Math.round(0.8 * docHeight - 22) + 'px';
			dialogHeight = Math.round(0.8 * docHeight);
		}
		dialog.style.top = Math.max(Math.round((docHeight - dialogHeight) / 2), 10) + 'px';

		/* 绑定主按钮点击事件 */
		if (actionName !== null && actioned !== null) {
			(document.getElementById('dialogAction') as HTMLElement).addEventListener('click', actioned);
			this.actioned = actioned;
		}

		/* 绑定次按钮点击事件（如果有回调用回调，否则仅关闭） */
		(document.getElementById('dialogSecondaryAction') as HTMLElement).addEventListener(
			'click',
			secondaryActioned !== null ? secondaryActioned : () => this.close()
		);

		/* 高亮目标元素（如果不是 Repo 类型） */
		if (this.target !== null && this.target.type !== 'Repo') {
			alterClass(this.target.elem, CLASS_DIALOG_ACTIVE, true);
		}

		/* 注册 ESC 键关闭对话框 */
		this.escListener = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && this.elem !== null) {
				e.preventDefault();
				e.stopPropagation();
				this.close();
			}
		};
		document.addEventListener('keydown', this.escListener, true);

		/* 注册 Enter 键提交（仅 Form 类型） */
		if (type === DialogType.Form) {
			this.enterListener = (e: KeyboardEvent) => {
				if (e.key === 'Enter' && this.elem !== null) {
					/* 只在非 textarea/input[Enter 提交] 触发 */
					const target = e.target as HTMLElement;
					/* 如果焦点在 textarea 或 CustomSelect 的搜索框中，不拦截 Enter */
					if (target.tagName === 'TEXTAREA' || (target.classList.contains('customSelectFilterInput'))) {
						return;
					}
					e.preventDefault();
					this.submit();
				}
			};
			document.addEventListener('keydown', this.enterListener, true);
		}
	}

	/**
	 * 关闭对话框
	 *
	 * 移除对话框 DOM、EventOverlay 遮罩和高亮类。
	 * 清空所有状态引用。
	 */
	public close(): void {
		/* 移除 EventOverlay 遮罩 */
		this.eventOverlay.remove();

		/* 移除对话框 DOM */
		if (this.elem !== null) {
			this.elem.remove();
			this.elem = null;
		}

		/* 移除所有元素的高亮类 */
		const activeElems = document.getElementsByClassName(CLASS_DIALOG_ACTIVE) as HTMLCollectionOf<HTMLElement>;
		for (let i = 0; i < activeElems.length; i++) {
			alterClass(activeElems[i], CLASS_DIALOG_ACTIVE, false);
		}

		/* 移除所有 CustomSelect 实例（清理事件监听器） */
		Object.keys(this.customSelects).forEach((index) => this.customSelects[index].remove());
		this.customSelects = {};

		/* 移除键盘监听器 */
		if (this.escListener !== null) {
			document.removeEventListener('keydown', this.escListener, true);
			this.escListener = null;
		}
		if (this.enterListener !== null) {
			document.removeEventListener('keydown', this.enterListener, true);
			this.enterListener = null;
		}

		/* 清空状态 */
		this.target = null;
		this.actioned = null;
		this.type = null;
	}

	/**
	 * 关闭操作进行中对话框
	 *
	 * 仅当当前是对话框是 ActionRunning 类型时才关闭。
	 * 用于操作完成后关闭 loading 对话框。
	 */
	public closeActionRunning(): void {
		if (this.type === DialogType.ActionRunning) this.close();
	}

	/**
	 * 提交表单
	 *
	 * 触发主按钮的回调。用于 Enter 键提交表单。
	 * 如果没有主回调，不做任何操作。
	 */
	public submit(): void {
		if (this.actioned !== null) this.actioned();
	}

	/**
	 * 刷新对话框的目标
	 *
	 * 当提交列表重新渲染后，原 target.elem 引用的 DOM 元素可能已经被销毁。
	 * 此方法在新提交列表中查找 target 对应的新元素，更新 target.elem 引用。
	 *
	 * 逻辑与 ContextMenu.refresh 相同：
	 *   1. 如果对话框未打开、target 为 null 或为 Repo 类型，无需刷新
	 *   2. 在新 commits 中查找 target.hash 对应的提交
	 *   3. 通过 data-hash 属性在 DOM 中查找新元素
	 *   4. 如果 target 有 ref，还要查找对应的 ref-label 元素
	 *   5. 找不到则关闭对话框
	 *
	 * @param commits - 新的提交数组
	 */
	public refresh(commits: ReadonlyArray<GitCommit>): void {
		/* 如果对话框未打开、无 target、或为 Repo 类型，无需刷新 */
		if (!this.isOpen() || this.target === null || this.target.type === 'Repo') {
			return;
		}

		const typedTarget = this.target as CommitTarget | RefTarget | CommitDetailsViewTarget;

		/* 在新 commits 中查找 target.hash */
		const commitIndex = commits.findIndex((commit) => commit.hash === typedTarget.hash);

		if (commitIndex > -1) {
			/* 提交仍存在，通过 data-row 属性查找对应的 DOM 元素
			 * commit-graph.ts 渲染的提交行格式：
			 *   <tr class="commit-row" data-hash="..." data-row="N">
			 */
			const commitElem = document.querySelector('.commit-row[data-row="' + commitIndex + '"]') as HTMLElement | null;
			if (commitElem !== null) {
				if (typedTarget.ref === undefined) {
					/* target 没有 ref */
					if (typedTarget.type !== 'CommitDetailsView') {
						(this.target as CommitTarget).elem = commitElem;
						alterClass((this.target as CommitTarget).elem, CLASS_DIALOG_ACTIVE, true);
					}
					return;
				} else {
					/* target 有 ref，查找对应的 ref-label 元素 */
					const refElems = commitElem.querySelectorAll('[data-ref-name]') as NodeListOf<HTMLElement>;
					for (let i = 0; i < refElems.length; i++) {
						if (refElems[i].dataset.refName === typedTarget.ref) {
							if (typedTarget.type === 'Ref') {
								(this.target as RefTarget).elem = refElems[i];
							} else {
								(this.target as CommitDetailsViewTarget).elem = commitElem;
							}
							alterClass(this.target.elem, CLASS_DIALOG_ACTIVE, true);
							return;
						}
					}
				}
			}
		}

		/* 提交已不存在 → 关闭对话框 */
		this.close();
	}

	/**
	 * 判断对话框是否打开
	 *
	 * @returns TRUE => 对话框已打开，FALSE => 未打开
	 */
	public isOpen(): boolean {
		return this.elem !== null;
	}

	/**
	 * 获取当前对话框类型
	 *
	 * @returns 当前对话框类型；如果没有对话框打开则返回 null
	 */
	public getType(): DialogType | null {
		return this.type;
	}
}


/**
 * ============================================================
 * CustomSelect 类：自定义下拉选择器
 * ============================================================
 */

/**
 * 自定义下拉选择器
 *
 * 用于对话框中的 Select 类型输入。
 * 比原生 <select> 更灵活，支持：
 *   - 自定义样式（毛玻璃背景、圆角等）
 *   - 多选（显示勾选图标）
 *   - 搜索过滤（输入框过滤选项）
 *   - 键盘导航（ArrowUp/Down/Enter/Escape/Space）
 *   - 点击外部关闭
 *
 * DOM 结构：
 *   <div class="customSelectContainer">
 *     <div class="customSelectCurrent" tabindex="N">当前选中值</div>
 *     <input class="customSelectFilterInput" placeholder="过滤..." />  <!-- 打开时显示 -->
 *     <div class="customSelectOptions">                              <!-- 打开时显示 -->
 *       <div class="customSelectOption" data-index="0">选项 1</div>
 *       <div class="customSelectOption selected focussed" data-index="1">选项 2</div>
 *     </div>
 *   </div>
 *
 * 工作原理：
 *   - 点击 .customSelectCurrent 切换下拉打开/关闭
 *   - 点击选项时切换选中状态（单选时关闭下拉，多选时保持打开）
 *   - 搜索框输入时实时过滤选项（隐藏不匹配的）
 *   - 键盘 ArrowUp/Down 移动焦点
 *   - 键盘 Space 切换多选项的选中状态
 *   - 键盘 Enter/Escape 关闭下拉
 */
class CustomSelect {
	/** 输入配置（包含选项、是否多选、默认值等） */
	private readonly data: DialogSelectInput;
	/** 每个选项的选中状态数组（与 data.options 一一对应） */
	private readonly selected: boolean[];
	/** 最后选中的选项索引（单选时用于切换时取消旧的选中） */
	private lastSelected: number = -1;
	/** 当前焦点选项的索引（键盘导航用） */
	private focussed: number = -1;
	/** 下拉是否打开 */
	private open: boolean = false;

	/** 对话框元素（用于定位下拉选项列表） */
	private dialogElem: HTMLElement | null;
	/** 容器元素（<div class="customSelectContainer">） */
	private elem: HTMLElement | null;
	/** 当前值显示元素（<div class="customSelectCurrent">） */
	private currentElem: HTMLElement | null;
	/** 搜索输入框元素 */
	private filterInput: HTMLInputElement | null = null;
	/** 选项列表容器元素（<div class="customSelectOptions">） */
	private optionsElem: HTMLElement | null = null;
	/** 全局点击事件处理器引用（用于在 remove 时移除监听） */
	private clickHandler: ((e: MouseEvent) => void) | null;

	/**
	 * 构造一个新的 CustomSelect 实例
	 *
	 * @param data - 输入配置
	 * @param containerId - 容器元素的 DOM ID
	 * @param tabIndex - 当前值元素的 tabindex（用于键盘导航）
	 * @param dialogElem - 对话框元素（用于定位下拉选项列表）
	 */
	constructor(data: DialogSelectInput, containerId: string, tabIndex: number, dialogElem: HTMLElement) {
		this.data = data;
		/* 初始化所有选项为未选中 */
		this.selected = data.options.map(() => false);
		this.open = false;
		this.dialogElem = dialogElem;

		/* 获取容器元素并设置类名 */
		const container = document.getElementById(containerId) as HTMLElement;
		container.className = 'customSelectContainer';
		this.elem = container;

		/* 创建当前值显示元素 */
		const currentElem = document.createElement('div');
		currentElem.className = 'customSelectCurrent';
		currentElem.tabIndex = tabIndex;
		this.currentElem = currentElem;
		container.appendChild(currentElem);

		/* 创建搜索输入框（默认隐藏，下拉打开时显示） */
		const filterInput = document.createElement('input');
		filterInput.type = 'text';
		filterInput.className = 'customSelectFilterInput';
		filterInput.placeholder = '过滤...';
		filterInput.style.display = 'none';
		this.filterInput = filterInput;
		container.appendChild(filterInput);

		/* 注册全局点击事件处理器（用于切换下拉、选择选项、点击外部关闭） */
		this.clickHandler = (e: MouseEvent) => {
			if (!e.target) return;
			const targetElem = e.target as HTMLElement;

			/* 点击的是搜索框：不处理（让输入框正常工作） */
			if (targetElem === this.filterInput) return;

			/* 判断点击是否在当前 CustomSelect 内 */
			if (targetElem.closest('.customSelectContainer') !== this.elem
				&& (this.optionsElem === null || targetElem.closest('.customSelectOptions') !== this.optionsElem)) {
				/* 点击在 CustomSelect 外部 → 关闭下拉 */
				this.render(false);
				return;
			}

			if (targetElem.className === 'customSelectCurrent' || targetElem === this.currentElem) {
				/* 点击当前值显示 → 切换下拉打开/关闭 */
				this.render(!this.open);
				if (this.open) {
					/* 打开时聚焦搜索框 */
					this.filterInput?.focus();
				}
			} else if (this.open) {
				/* 下拉已打开，判断是否点击了某个选项 */
				const optionElem = targetElem.closest('.customSelectOption') as HTMLElement | null;
				if (optionElem !== null && optionElem.dataset.index !== undefined) {
					const selectedOptionIndex = parseInt(optionElem.dataset.index, 10);
					/* 切换选中状态（多选时切换，单选时设为 true） */
					this.setItemSelectedState(selectedOptionIndex, data.multiple ? !this.selected[selectedOptionIndex] : true);
					if (!data.multiple) {
						/* 单选时选择后关闭下拉 */
						this.render(false);
					}
					if (this.currentElem !== null) {
						this.currentElem.focus();
					}
				}
			}
		};
		/* 使用捕获阶段，确保在子元素的事件之前处理 */
		document.addEventListener('click', this.clickHandler, true);

		/* 注册搜索输入框的 keyup 事件（实时过滤） */
		filterInput.addEventListener('keyup', () => this.filter());

		/* 注册当前值元素的键盘事件（ArrowUp/Down/Enter/Escape/Space） */
		currentElem.addEventListener('keydown', (e: KeyboardEvent) => {
			if (this.open && e.key === 'Tab') {
				/* Tab 键关闭下拉（让焦点正常流转到下一个表单元素） */
				this.render(false);
			} else if (this.open && (e.key === 'Enter' || e.key === 'Escape')) {
				/* Enter 或 Escape 关闭下拉 */
				this.render(false);
				e.preventDefault();
				e.stopPropagation();
			} else if (data.multiple) {
				/* 多选模式 */
				if (e.key === ' ' && this.focussed > -1) {
					/* Space 切换焦点项的选中状态 */
					this.setItemSelectedState(this.focussed, !this.selected[this.focussed]);
					e.preventDefault();
					e.stopPropagation();
				} else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
					/* 上箭头：移动焦点到上一项（循环） */
					if (!this.open) this.render(true);
					this.setFocussed(this.focussed > 0 ? this.focussed - 1 : data.options.length - 1);
					this.scrollOptionIntoView(this.focussed);
					e.preventDefault();
					e.stopPropagation();
				} else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
					/* 下箭头：移动焦点到下一项（循环） */
					if (!this.open) this.render(true);
					this.setFocussed(this.focussed < data.options.length - 1 ? this.focussed + 1 : 0);
					this.scrollOptionIntoView(this.focussed);
					e.preventDefault();
					e.stopPropagation();
				}
			} else {
				/* 单选模式 */
				if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
					/* 上箭头：选中上一项 */
					this.setItemSelectedState(this.lastSelected > 0 ? this.lastSelected - 1 : data.options.length - 1, true);
					this.scrollOptionIntoView(this.lastSelected);
					e.preventDefault();
					e.stopPropagation();
				} else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
					/* 下箭头：选中下一项 */
					this.setItemSelectedState(this.lastSelected < data.options.length - 1 ? this.lastSelected + 1 : 0, true);
					this.scrollOptionIntoView(this.lastSelected);
					e.preventDefault();
					e.stopPropagation();
				}
			}
		});

		/* 初始化默认选中项 */
		/* 通过 'defaults' in data 判断是否多选（更稳健，避免 TypeScript 联合类型 narrow 问题） */
		if ('defaults' in data) {
			/* 多选：从后向前遍历，标记所有 defaults 中包含的选项 */
			for (let i = data.options.length - 1; i >= 0; i--) {
				if (data.defaults.includes(data.options[i].value)) {
					this.setItemSelectedState(i, true);
				}
			}
		} else {
			/* 单选：找到 default 对应的选项并选中（找不到则选第一个） */
			const defaultIndex = data.options.findIndex((option) => option.value === data.default);
			this.setItemSelectedState(defaultIndex > -1 ? defaultIndex : 0, true);
		}
		this.renderCurrentValue();
	}

	/**
	 * 移除 CustomSelect 实例，清理所有资源
	 *
	 * 在对话框关闭时调用，避免内存泄漏。
	 * 清理内容包括：
	 *   - 移除所有 DOM 元素
	 *   - 移除全局 click 事件监听器
	 */
	public remove(): void {
		this.dialogElem = null;
		if (this.elem !== null) {
			this.elem.remove();
			this.elem = null;
		}
		if (this.currentElem !== null) {
			this.currentElem.remove();
			this.currentElem = null;
		}
		if (this.filterInput !== null) {
			this.filterInput.remove();
			this.filterInput = null;
		}
		if (this.optionsElem !== null) {
			this.optionsElem.remove();
			this.optionsElem = null;
		}
		if (this.clickHandler !== null) {
			document.removeEventListener('click', this.clickHandler, true);
			this.clickHandler = null;
		}
	}

	/**
	 * 获取用户选择的值
	 *
	 * @returns 单选时返回 string（选中值），多选时返回 string[]（所有选中值）
	 */
	public getValue(): string | string[] {
		const values: string[] = this.data.options
			.map((option) => option.value)
			.filter((_, index) => this.selected[index]);
		/* 通过 'defaults' in data 判断是否多选（与构造函数一致） */
		return 'defaults' in this.data ? values : values[0];
	}

	/**
	 * 设置选项的选中状态
	 *
	 * @param index - 选项索引
	 * @param state - true 表示选中，false 表示取消选中
	 */
	private setItemSelectedState(index: number, state: boolean): void {
		/* 单选模式（即没有 defaults 字段）：取消之前选中的项 */
		if (!('defaults' in this.data) && this.lastSelected > -1) {
			this.selected[this.lastSelected] = false;
		}
		this.selected[index] = state;
		this.lastSelected = index;
		this.renderCurrentValue();
		this.renderOptionsStates();
	}

	/**
	 * 设置焦点项
	 *
	 * @param index - 要聚焦的选项索引；-1 表示取消焦点
	 */
	private setFocussed(index: number): void {
		if (this.focussed !== index) {
			/* 移除旧焦点项的 focussed 类 */
			if (this.focussed > -1) {
				const currentlyFocussedOption = this.getOptionElem(this.focussed);
				if (currentlyFocussedOption !== null) {
					alterClass(currentlyFocussedOption, CLASS_FOCUSSED, false);
				}
			}
			this.focussed = index;
			/* 添加新焦点项的 focussed 类 */
			const newlyFocussedOption = this.getOptionElem(this.focussed);
			if (newlyFocussedOption !== null) {
				alterClass(newlyFocussedOption, CLASS_FOCUSSED, true);
			}
		}
	}

	/**
	 * 渲染下拉的打开/关闭状态
	 *
	 * @param open - true 表示打开下拉，false 表示关闭
	 */
	private render(open: boolean): void {
		if (this.elem === null || this.currentElem === null || this.dialogElem === null) return;

		if (this.open !== open) {
			this.open = open;
			if (open) {
				/* 打开下拉：创建选项列表 */
				if (this.optionsElem !== null) {
					this.optionsElem.remove();
				}
				this.optionsElem = document.createElement('div');

				/* 计算选项列表的位置（相对于对话框） */
				const currentElemRect = this.currentElem.getBoundingClientRect();
				const dialogElemRect = this.dialogElem.getBoundingClientRect();
				this.optionsElem.style.top = (currentElemRect.top - dialogElemRect.top + currentElemRect.height - 2) + 'px';
				this.optionsElem.style.left = (currentElemRect.left - dialogElemRect.left - 1) + 'px';
				this.optionsElem.style.width = currentElemRect.width + 'px';
				/* 限制最大高度，避免超出屏幕底部 */
				this.optionsElem.style.maxHeight = Math.max(document.body.clientHeight - currentElemRect.top - currentElemRect.height - 2, 50) + 'px';
				this.optionsElem.className = 'customSelectOptions' + (this.data.multiple ? ' multiple' : '');

				/* 渲染选项 HTML */
				const icon: string = this.data.multiple ? '<div class="selectedIcon">' + SVG_ICONS.check + '</div>' : '';
				this.optionsElem.innerHTML = this.data.options.map((option, index) =>
					'<div class="customSelectOption" data-index="' + index + '">' + icon + escapeHtml(option.name) + '</div>'
				).join('');

				/* 鼠标移动时更新焦点（hover 效果） */
				const optionElems = this.optionsElem.children;
				for (let i = 0; i < optionElems.length; i++) {
					optionElems[i].addEventListener('mousemove', (e: MouseEvent) => {
						if (!e.target) return;
						const elem = (e.target as HTMLElement).closest('.customSelectOption') as HTMLElement | null;
						if (elem === null || elem.dataset.index === undefined) return;
						this.setFocussed(parseInt(elem.dataset.index, 10));
					});
				}

				/* 鼠标离开时取消焦点 */
				this.optionsElem.addEventListener('mouseleave', () => this.setFocussed(-1));

				/* 显示搜索框并清空内容 */
				if (this.filterInput !== null) {
					this.filterInput.style.display = 'block';
					this.filterInput.value = '';
				}

				this.dialogElem.appendChild(this.optionsElem);
			} else {
				/* 关闭下拉：移除选项列表 */
				if (this.optionsElem !== null) {
					this.optionsElem.remove();
					this.optionsElem = null;
				}
				/* 隐藏搜索框 */
				if (this.filterInput !== null) {
					this.filterInput.style.display = 'none';
				}
				this.setFocussed(-1);
			}
			alterClass(this.elem, 'open', open);
		}

		if (open) {
			this.renderOptionsStates();
		}
	}

	/**
	 * 渲染当前值显示
	 *
	 * 将所有选中项的名称拼接为逗号分隔的字符串，显示在 currentElem 中。
	 * 如果没有选中项，显示"无"。
	 */
	private renderCurrentValue(): void {
		if (this.currentElem === null) return;
		/* 获取所有选中项的名称 */
		const selectedNames: string[] = this.data.options
			.filter((_, index) => this.selected[index])
			.map((option) => option.name);
		/* 用逗号拼接，没有则显示"无" */
		const value: string = selectedNames.length > 0 ? selectedNames.join(', ') : '无';
		this.currentElem.title = value;
		this.currentElem.innerHTML = escapeHtml(value);
	}

	/**
	 * 渲染选项的选中/焦点状态
	 *
	 * 遍历所有选项元素，根据 selected 和 focussed 数组更新类名。
	 */
	private renderOptionsStates(): void {
		if (this.optionsElem !== null) {
			const optionElems = this.optionsElem.children;
			for (let i = 0; i < optionElems.length; i++) {
				const elemIndex = parseInt((optionElems[i] as HTMLElement).dataset.index as string, 10);
				alterClass(optionElems[i] as HTMLElement, CLASS_SELECTED, this.selected[elemIndex]);
				alterClass(optionElems[i] as HTMLElement, CLASS_FOCUSSED, this.focussed === elemIndex);
			}
		}
	}

	/**
	 * 获取指定索引选项的 DOM 元素
	 *
	 * @param index - 选项索引
	 * @returns 选项元素；找不到则返回 null
	 */
	private getOptionElem(index: number): HTMLElement | null {
		if (this.optionsElem !== null && index > -1) {
			const optionElems = this.optionsElem.children;
			const indexStr = index.toString();
			for (let i = 0; i < optionElems.length; i++) {
				if ((optionElems[i] as HTMLElement).dataset.index === indexStr) {
					return optionElems[i] as HTMLElement;
				}
			}
		}
		return null;
	}

	/**
	 * 滚动选项到可见区域
	 *
	 * 当通过键盘导航移动焦点时，确保焦点项在选项列表的可见区域内。
	 *
	 * @param index - 选项索引
	 */
	private scrollOptionIntoView(index: number): void {
		const elem = this.getOptionElem(index);
		if (this.optionsElem !== null && elem !== null) {
			const elemOffsetTop = elem.offsetTop;
			const elemHeight = elem.clientHeight;
			const optionsScrollTop = this.optionsElem.scrollTop;
			const optionsHeight = this.optionsElem.clientHeight;
			if (elemOffsetTop < optionsScrollTop) {
				/* 选项在可见区域上方 → 向上滚动 */
				this.optionsElem.scroll(0, elemOffsetTop);
			} else if (elemOffsetTop + elemHeight > optionsScrollTop + optionsHeight) {
				/* 选项在可见区域下方 → 向下滚动 */
				this.optionsElem.scroll(0, Math.max(elemOffsetTop + elemHeight - optionsHeight, 0));
			}
		}
	}

	/**
	 * 过滤选项
	 *
	 * 根据搜索框的输入，隐藏不匹配的选项。
	 * 匹配规则：选项名称（小写）包含搜索词（小写）。
	 */
	private filter(): void {
		if (this.optionsElem === null || this.filterInput === null) return;
		const val = this.filterInput.value.toLowerCase();
		let matches = false;
		const optionElems = this.optionsElem.children;
		for (let i = 0; i < this.data.options.length; i++) {
			const match = this.data.options[i].name.toLowerCase().indexOf(val) > -1;
			(optionElems[i] as HTMLElement).style.display = match ? 'block' : 'none';
			if (match) matches = true;
		}
		/* 显示/隐藏"无结果"提示（这里简单处理，不显示提示） */
	}
}


/**
 * ============================================================
 * 全局单例导出
 * ============================================================
 */

/**
 * 对话框的全局单例
 *
 * 整个应用共享一个 Dialog 实例。
 * 在 app.ts 启动时直接使用，无需手动创建。
 *
 * 使用示例：
 *   import { dialog } from './components/dialog.js';
 *   dialog.showConfirmation("确定吗？", "确定", () => { ... });
 */
export const dialog: Dialog = new Dialog();
