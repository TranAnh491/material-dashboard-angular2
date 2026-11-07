/**
 * Dịch giao diện Việt → Anh bằng cách thay text node / placeholder / title theo từ điển.
 * Giữ nguyên bản gốc để chuyển ngược lại; tự dịch nội dung mới (modal, bảng) qua MutationObserver.
 */
export class DomTranslator {
  private lang: 'vi' | 'en' = 'vi';
  private observer: MutationObserver | null = null;
  private readonly original = new WeakMap<Node, string>();
  private applying = false;

  constructor(private root: HTMLElement, private dict: Record<string, string>) {}

  setLang(lang: 'vi' | 'en'): void {
    this.lang = lang;
    this.observer?.disconnect();
    this.observer = null;
    this.walk(this.root);
    if (lang === 'en') {
      this.observer = new MutationObserver(() => {
        if (!this.applying) this.walk(this.root);
      });
      this.observer.observe(this.root, { childList: true, subtree: true, characterData: true });
    }
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private norm(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private tr(text: string): string | null {
    const key = this.norm(text);
    if (!key) return null;
    const hit = this.dict[key];
    if (!hit) return null;
    const lead = text.match(/^\s*/)?.[0] ?? '';
    const tail = text.match(/\s*$/)?.[0] ?? '';
    return lead + hit + tail;
  }

  private walk(node: Node): void {
    this.applying = true;
    try {
      this.visit(node);
    } finally {
      this.applying = false;
    }
  }

  private visit(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      this.text(node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.classList?.contains('material-icons')) return;
    this.attr(el, 'placeholder');
    this.attr(el, 'title');
    el.childNodes.forEach(c => this.visit(c));
  }

  private text(node: Node): void {
    const cur = node.nodeValue ?? '';
    const saved = this.original.get(node);
    if (this.lang === 'vi') {
      if (saved !== undefined && cur !== saved) node.nodeValue = saved;
      return;
    }
    // Angular có thể cập nhật lại text gốc; nếu text hiện tại khác bản đã dịch thì dịch lại từ nó.
    const out = this.tr(cur);
    if (out !== null) {
      if (saved === undefined) this.original.set(node, cur);
      if (cur !== out) node.nodeValue = out;
    }
  }

  private attr(el: HTMLElement, name: string): void {
    const cur = el.getAttribute(name);
    if (cur == null) return;
    const mark = 'data-orig-' + name;
    const saved = el.getAttribute(mark);
    if (this.lang === 'vi') {
      if (saved !== null) {
        el.setAttribute(name, saved);
        el.removeAttribute(mark);
      }
      return;
    }
    const out = this.dict[this.norm(saved ?? cur)];
    if (out) {
      if (saved === null) el.setAttribute(mark, cur);
      if (cur !== out) el.setAttribute(name, out);
    }
  }
}
