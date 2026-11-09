import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { APP_TABS, MenuCategory } from '../../routes/app-tabs';
import { AUTOMATIONS, FEATURE_DETAILS, FeatureDetail, FLOWS, SECURITY } from './chuc-nang.data';

interface FeatureRow {
  path: string;
  title: string;
  category: string;
  subtitle: string;
  detail: FeatureDetail | null;
  adminOnly: boolean;
  desktopOnly: boolean;
}

const CATEGORY_LABEL: Record<MenuCategory, string> = {
  Main: 'Chính',
  Production: 'Sản xuất',
  'Stock Check': 'Kiểm kê',
  RM: 'Nguyên liệu (RM)',
  Quality: 'Chất lượng',
  'ASM FG': 'Thành phẩm (FG)',
  Tools: 'Công cụ',
  Report: 'Báo cáo',
  Admin: 'Quản trị'
};

/** Tab "Chức năng" (chỉ admin): toàn bộ chức năng, việc máy chủ tự làm, bảo mật — để admin xem, hiểu. */
@Component({
  selector: 'app-chuc-nang',
  templateUrl: './chuc-nang.component.html',
  styleUrls: ['./chuc-nang.component.scss']
})
export class ChucNangComponent {
  readonly flows = FLOWS;
  readonly automations = AUTOMATIONS;
  readonly security = SECURITY;
  section: 'tabs' | 'auto' | 'security' = 'tabs';
  search = '';
  categorySel = '';
  expanded = new Set<string>();

  readonly rows: FeatureRow[] = (() => {
    const seen = new Set<string>();
    return APP_TABS
      .filter((t) => {
        if (seen.has(t.path)) return false;
        seen.add(t.path);
        return true;
      })
      .map((t) => ({
        path: t.path,
        title: t.title,
        category: CATEGORY_LABEL[(t.menu?.category || t.dashboard?.category || 'Tools') as MenuCategory] || 'Khác',
        subtitle: t.subtitle || '',
        detail: FEATURE_DETAILS[t.path] || null,
        adminOnly: !!t.adminOnly,
        desktopOnly: !!t.desktopOnly
      }));
  })();

  readonly categories: string[] = [...new Set(this.rows.map((r) => r.category))];

  constructor(private router: Router) {}

  get viewRows(): FeatureRow[] {
    const q = this.norm(this.search);
    return this.rows.filter((r) =>
      (!this.categorySel || r.category === this.categorySel) &&
      (!q || this.norm([r.title, r.subtitle, r.path, ...(r.detail?.actions || []), ...(r.detail?.controls || []),
        ...(r.detail?.writes || [])].join(' ')).includes(q)));
  }

  get detailCount(): number {
    return this.rows.filter((r) => r.detail).length;
  }

  toggle(path: string): void {
    if (this.expanded.has(path)) this.expanded.delete(path);
    else this.expanded.add(path);
  }

  expandAll(open: boolean): void {
    this.expanded = new Set(open ? this.viewRows.filter((r) => r.detail).map((r) => r.path) : []);
  }

  open(path: string): void {
    void this.router.navigateByUrl(path);
  }

  goBack(): void {
    if (history.length > 1) history.back();
    else void this.router.navigateByUrl('/menu');
  }

  goMenu(): void {
    void this.router.navigateByUrl('/menu');
  }

  trackRow(_: number, r: FeatureRow): string {
    return r.path;
  }

  private norm(s: string): string {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').trim();
  }
}
