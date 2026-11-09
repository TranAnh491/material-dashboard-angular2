import { APP_TABS, SIDEBAR_LAYOUT } from './app-tabs';

export interface RouteInfo {
    path: string;
    title: string;
    icon: string;
    class: string;
    children?: RouteInfo[];
}

// Sinh từ app-tabs.ts (SIDEBAR_LAYOUT + tiêu đề/icon của từng tab) — không sửa trực tiếp ở đây.
function toRoute(path: string, cls: string): RouteInfo {
  const tab = APP_TABS.find(t => t.path === path);
  if (!tab) throw new Error(`SIDEBAR_LAYOUT: không có tab ${path} trong APP_TABS`);
  return { path, title: tab.title, icon: tab.sidebarIcon || '', class: cls };
}

export const ROUTES: RouteInfo[] = SIDEBAR_LAYOUT.map(item =>
  typeof item === 'string'
    ? toRoute(item, '')
    : { path: '', title: item.title, icon: item.icon, class: item.class, children: item.children.map(p => toRoute(p, item.childClass)) }
);
