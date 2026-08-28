import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy } from '@angular/router';

/**
 * Giữ instance tab Materials khi rời tab — mở lại không tạo lại component,
 * không đọc lại danh mục / tồn kho.
 */
export class MaterialsRouteReuseStrategy implements RouteReuseStrategy {
  private stored: DetachedRouteHandle | null = null;

  private isMaterials(route: ActivatedRouteSnapshot): boolean {
    return !!route.component && route.pathFromRoot.some((r) => r.routeConfig?.path === 'materials');
  }

  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return this.isMaterials(route);
  }

  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    if (this.isMaterials(route)) this.stored = handle;
  }

  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    return this.isMaterials(route) && !!this.stored;
  }

  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    return this.isMaterials(route) ? this.stored : null;
  }

  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    return future.routeConfig === curr.routeConfig;
  }
}
