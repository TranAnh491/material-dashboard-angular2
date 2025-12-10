# Phân tích các tabs hiện tại

## Tabs KHÔNG có route (Không sử dụng - CẦN XÓA):

1. **`manage-inventory`** (Manage Inventory)
   - Có trong: `availableTabs`, `filtered-routes.service.ts`
   - KHÔNG có trong: `admin-layout.routing.ts`, `sidebar-routes.ts`

2. **`fg`** (Finished Goods)
   - Có trong: `availableTabs`, `filtered-routes.service.ts`
   - KHÔNG có trong: `admin-layout.routing.ts`
   - Note: Có các routes con: `fg-in`, `fg-out`, `fg-preparing`, `fg-inventory` nhưng không có route chung `/fg`

3. **`find`** (Find)
   - Có trong: `availableTabs`, `filtered-routes.service.ts`, `sidebar-routes.ts` (nhưng path là `/find` với title 'Layout' - confusing!)
   - KHÔNG có trong: `admin-layout.routing.ts`
   - Note: Có route `/find-rm1` nhưng không có `/find`

4. **`layout`** (Layout / 3D Map)
   - Có trong: `availableTabs`, `filtered-routes.service.ts`, `sidebar-routes.ts`
   - KHÔNG có trong: `admin-layout.routing.ts`

5. **`task`** (Flow Work)
   - Có trong: `availableTabs`, `filtered-routes.service.ts`, `tab-permission.guard.ts`
   - KHÔNG có trong: `admin-layout.routing.ts`, `sidebar-routes.ts`

## Tabs có route nhưng KHÔNG có trong availableTabs:

1. **`stock-check`** (Stock Check)
   - Có trong: `admin-layout.routing.ts`, `sidebar-routes.ts`
   - KHÔNG có trong: `availableTabs`

2. **`find-rm1`** (Find RM1)
   - Có trong: `admin-layout.routing.ts`, `sidebar-routes.ts`
   - Trong availableTabs là `find` (không khớp)

## Tabs CÓ route và CÓ trong availableTabs (Đang sử dụng):

- dashboard ✓
- work-order-status ✓
- shipment ✓
- inbound-asm1 ✓
- outbound-asm1 ✓
- materials-asm1 ✓
- inventory-overview-asm1 ✓
- inbound-asm2 ✓
- outbound-asm2 ✓
- materials-asm2 ✓
- location ✓
- manage ✓
- label ✓
- index ✓
- utilization ✓
- checklist ✓
- safety ✓
- equipment ✓
- qc ✓
- settings ✓

