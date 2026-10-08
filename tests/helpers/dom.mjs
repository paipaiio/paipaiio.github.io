// A small synchronous DOM surface for testing user-visible interactions in Node.
// It deliberately does not implement HTML parsing or any search logic.
class Events {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, fields = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...fields };
    this[`on${type}`]?.call(this, event);
    for (const listener of this.listeners.get(type) || []) listener.call(this, event);
    return event;
  }
}

function matches(element, selector) {
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
  if (selector === 'a[href]') return element.tagName === 'A' && Boolean(element.href);
  const tagClass = selector.match(/^([a-z]+)\.([\w-]+)$/i);
  if (tagClass) return element.tagName === tagClass[1].toUpperCase() && element.classList.contains(tagClass[2]);
  return element.tagName === selector.toUpperCase();
}

class Element extends Events {
  constructor(document, tagName, text) {
    super();
    this.ownerDocument = document;
    this.tagName = tagName.toUpperCase();
    this.nodeType = tagName === '#text' ? 3 : tagName === '#fragment' ? 11 : 1;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.className = '';
    this.value = '';
    this.hidden = false;
    this._text = text || '';
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => { if (!this.classList.contains(name)) this.className = `${this.className} ${name}`.trim(); },
      remove: name => { this.className = this.className.split(/\s+/).filter(value => value !== name).join(' '); },
    };
  }

  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get children() { return this.childNodes.filter(child => child.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children.at(-1) || null; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes.at(-1) || null; }
  get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
  get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null; }
  get textContent() { return this._text + this.childNodes.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value ?? ''); }
  get innerHTML() { return this.textContent; }
  set innerHTML(value) {
    if (value) this.ownerDocument.htmlWrites.push(String(value));
    this.replaceChildren();
    this._text = String(value || '');
  }

  appendChild(child) {
    if (child.nodeType === 11) {
      for (const nested of [...child.childNodes]) this.appendChild(nested);
      child.replaceChildren();
      return child;
    }
    if (child.parentNode) child.parentNode.childNodes = child.parentNode.childNodes.filter(node => node !== child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  replaceChildren(...children) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this._text = '';
    for (const child of children) this.appendChild(child);
  }

  contains(element) { return element === this || this.childNodes.some(child => child.contains(element)); }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.childNodes) {
      if (matches(child, selector)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? this[name] ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
  click() { this.ownerDocument.clicks.push(this); this.dispatch('click'); }
}

export function createDOM() {
  const document = new Events();
  document.htmlWrites = [];
  document.clicks = [];
  document.readyState = 'complete';
  document.baseURI = 'https://blog.example/search/';
  document.createElement = tag => new Element(document, tag);
  document.createTextNode = text => new Element(document, '#text', String(text));
  document.createDocumentFragment = () => new Element(document, '#fragment');
  document.body = document.createElement('body');
  document.documentElement = document.createElement('html');
  document.documentElement.appendChild(document.body);
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.querySelector = selector => document.body.querySelector(selector);
  document.getElementById = id => document.querySelector(`#${id}`);
  const searchbox = document.createElement('div');
  searchbox.id = 'searchbox';
  const input = document.createElement('input');
  input.id = 'searchInput';
  const results = document.createElement('ul');
  results.id = 'searchResults';
  searchbox.appendChild(input);
  searchbox.appendChild(results);
  document.body.appendChild(searchbox);
  document.activeElement = input;
  const window = new Events();
  window.document = document;
  return { document, window, searchbox, input, results };
}
