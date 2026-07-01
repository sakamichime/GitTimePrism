/**
 * ============================================================
 * DOM 操作工具函数模块（TypeScript 版本）
 * ============================================================
 *
 * 这个模块提供了一些常用的 DOM（文档对象模型）操作辅助函数。
 * DOM 是浏览器用来表示 HTML 页面的编程接口，
 * 通过 DOM 可以用 JavaScript 来创建、修改、删除页面上的元素。
 *
 * 这些工具函数封装了一些重复性的 DOM 操作，
 * 让其他模块的代码更简洁、更易读。
 *
 * 使用示例：
 *   import { createElement, delegate, setHTML } from '../utils/dom.js';
 * ============================================================
 */

/**
 * 创建 HTML 元素并设置属性和子元素
 *
 * 这个函数是对原生 document.createElement() 的增强版本。
 * 它可以一次性完成：创建元素 -> 设置属性 -> 添加子元素 这三个步骤。
 * 没有这个函数的话，每个元素都需要写好几行代码才能创建完成。
 *
 * @param {string} tag - 要创建的 HTML 标签名，如 'div'、'span'、'button'
 * @param {Record<string, any>} [attrs={}] - 可选的属性对象，键值对形式设置元素的属性
 *                           支持普通属性（className、id、textContent 等）
 *                           和事件监听器（以 on 开头的属性，如 onClick）
 *                           TypeScript 中使用 Record<string, any> 表示键值对对象
 * @param {...(string | HTMLElement)} children - 可变的子元素参数
 *        可以传入字符串（会创建文本节点）或 HTMLElement 对象
 * @returns {HTMLElement} 创建好的 HTML 元素
 *
 * 使用示例：
 *   // 创建一个带文字的按钮
 *   const btn = createElement('button', { className: 'btn', onClick: () => {} }, '确定');
 *
 *   // 创建一个带子元素的容器
 *   const div = createElement('div', { className: 'container' },
 *     createElement('h1', {}, '标题'),
 *     createElement('p', {}, '内容')
 *   );
 *
 *   // 创建一个带多个属性的输入框
 *   const input = createElement('input', {
 *     type: 'text',
 *     className: 'search-input',
 *     placeholder: '搜索...',
 *     value: ''
 *   });
 */
export function createElement(tag: string, attrs: Record<string, any> = {}, ...children: (string | HTMLElement)[]): HTMLElement {
  /* 第一步：创建指定标签名的 HTML 元素 */
  /* document.createElement 是浏览器内置的方法，用于创建 HTML 元素 */
  const el: HTMLElement = document.createElement(tag);

  /* 第二步：如果有传入属性对象，则遍历设置每个属性 */
  for (const [key, value] of Object.entries(attrs)) {
    /* 检查属性名是否以 'on' 开头（如 onClick、onInput）
     * 这类属性是事件监听器，需要用 addEventListener 来注册 */
    if (key.startsWith('on') && typeof value === 'function') {
      /* 提取事件类型名：去掉开头的 'on'，转为小写
       * 例如 'onClick' -> 'click'，'onInput' -> 'input' */
      const eventType: string = key.slice(2).toLowerCase();

      /* 给元素注册事件监听器 */
      el.addEventListener(eventType, value);
    } else if (key === 'className') {
      /* className 是设置 CSS 类名的特殊属性
       * 虽然可以用 el.className = value，但这里做了单独处理 */
      el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      /* style 属性需要特殊处理
       * 如果传入的是一个对象（如 { color: 'red', fontSize: '14px' }）
       * 则遍历对象的每个键值对，逐个设置 CSS 样式 */
      for (const [styleKey, styleValue] of Object.entries(value)) {
        el.style[styleKey as any] = styleValue as string;
      }
    } else if (key === 'dataset' && typeof value === 'object') {
      /* dataset 属性用于设置 data-* 自定义属性
       * 例如 { id: '123' } 会设置 data-id="123" */
      for (const [dataKey, dataValue] of Object.entries(value)) {
        el.dataset[dataKey] = dataValue as string;
      }
    } else {
      /* 其他普通属性，直接用 setAttribute 设置 */
      el.setAttribute(key, value);
    }
  }

  /* 第三步：处理传入的子元素 */
  for (const child of children) {
    if (child == null || child === undefined) {
      /* 如果子元素是 null 或 undefined，跳过不处理 */
      continue;
    }

    if (typeof child === 'string' || typeof child === 'number') {
      /* 如果子元素是字符串或数字，创建一个文本节点并添加到元素中 */
      /* document.createTextNode 创建一个包含指定文本的节点 */
      el.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      /* 如果子元素是一个 DOM 节点（HTMLElement 也是 Node 的一种），
       * 直接将它添加为子元素 */
      el.appendChild(child);
    } else {
      /* 其他类型的数据，转为字符串创建文本节点 */
      el.appendChild(document.createTextNode(String(child)));
    }
  }

  /* 返回创建好的元素 */
  return el;
}

/**
 * 事件委托 - 在父元素上监听子元素的事件
 *
 * "事件委托"是一种高效处理大量子元素事件的技术。
 * 原理是：不在每个子元素上单独绑定事件，而是在它们的父元素上绑定一个事件。
 * 当事件触发时，通过事件对象的 target 属性判断实际点击的是哪个子元素，
 * 然后执行对应的处理函数。
 *
 * 好处：
 *   1. 内存效率高：100 个子元素只需要 1 个事件监听器，而不是 100 个
 *   2. 动态元素自动支持：后来动态添加的子元素也能被监听到
 *   3. 便于统一管理：可以集中管理一组相关元素的事件
 *
 * @param {HTMLElement} parent - 父元素，事件监听器绑定在这个元素上
 * @param {string} eventType - 事件类型，如 'click'、'input'、'change'
 * @param {string} selector - CSS 选择器，用于匹配实际触发事件的子元素
 *                            支持标签名（'button'）、类名（'.btn'）、ID（'#id'）
 *                            以及任意 CSS 选择器（'.item .title'）
 * @param {(e: Event, target: HTMLElement) => void} handler - 事件处理函数，当匹配到子元素时调用
 *                            接收事件对象 event 和匹配到的目标元素作为参数
 * @returns {void} 无返回值
 *
 * 使用示例：
 *   // 在列表容器上委托点击事件
 *   delegate(listContainer, 'click', '.item-btn', (event, targetEl) => {
 *     console.log('点击了:', targetEl.textContent);
 *   });
 */
export function delegate(parent: HTMLElement, eventType: string, selector: string, handler: (e: Event, target: HTMLElement) => void): void {
  /**
   * 内部的事件处理函数
   * 这个函数会在父元素上触发指定事件时被调用
   */
  function handleEvent(event: Event): void {
    /* event.target 是实际触发事件的元素（可能点击的是子元素的内部元素）
     * 例如按钮里有一个图标，点击图标时 target 是图标而不是按钮
     * closest() 方法会从 target 开始向上查找，找到第一个匹配选择器的祖先元素 */
    const target: Element | null = (event.target as Element).closest(selector);

    /* 如果找到了匹配的元素，并且这个元素确实是父元素的后代 */
    if (target && parent.contains(target as Node)) {
      /* 调用用户传入的处理函数，传入事件对象和匹配到的目标元素 */
      handler(event, target as HTMLElement);
    }
  }

  /* 在父元素上注册事件监听器 */
  parent.addEventListener(eventType, handleEvent);
}

/**
 * 安全地设置元素的 innerHTML
 *
 * 直接设置 innerHTML 存在 XSS（跨站脚本攻击）风险，
 * 如果 HTML 字符串中包含恶意脚本标签，会导致安全问题。
 *
 * 这个函数对 innerHTML 做了基本的封装，
 * 便于将来如果需要添加安全过滤逻辑，只需要修改这里一个地方。
 *
 * 注意：当前实现并没有做 HTML 过滤/消毒（sanitization），
 * 如果需要处理用户输入的 HTML 内容，应该引入专门的消毒库（如 DOMPurify）。
 *
 * @param {HTMLElement} el - 要设置内容的 HTML 元素
 * @param {string} html - 要设置的 HTML 字符串
 * @returns {void} 无返回值
 *
 * 使用示例：
 *   const container = document.querySelector('.content');
 *   setHTML(container, '<h1>标题</h1><p>段落内容</p>');
 */
export function setHTML(el: HTMLElement, html: string): void {
  /* 直接设置 innerHTML 属性 */
  /* TODO: 如果将来需要处理用户输入的 HTML，应该在这里添加 DOMPurify 消毒处理 */
  el.innerHTML = html;
}
